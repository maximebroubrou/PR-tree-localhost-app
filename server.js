import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

try {
  process.loadEnvFile();
} catch {
  // No .env file found — fall back to real environment variables.
}

const PORT = Number(process.env.PORT) || 8030;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_OWNER = process.env.GITHUB_OWNER || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const DEFAULT_QUERY = 'is:open is:pr -label:"For next sprint"';
const DEFAULT_ASSIGNEE = process.env.GITHUB_DEFAULT_ASSIGNEE || "";
const OPEN_BROWSER = process.env.OPEN_BROWSER !== "false";

function openInBrowser(url) {
  const openCommand =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(openCommand, (err) => {
    if (err)
      console.warn(`Could not automatically open the browser: ${err.message}`);
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const GRAPHQL_QUERY = `
  query PullRequestSearch($searchQuery: String!) {
    search(query: $searchQuery, type: ISSUE, first: 100) {
      nodes {
        ... on PullRequest {
          number
          title
          url
          isDraft
          headRefName
          baseRefName
          repository { nameWithOwner }
          mergeQueueEntry { id }
        }
      }
    }
  }
`;

// Groups PRs into forests keyed by the "trunk" branch each chain is based on.
// A PR is a root of its trunk group when nothing else in the result set has a
// headRefName matching that PR's baseRefName; otherwise it nests under the PR
// whose head branch it targets.
export function buildForest(prs) {
  const byHead = new Map(prs.map((p) => [p.headRefName, p]));
  const childrenByBase = new Map();
  for (const p of prs) {
    if (!childrenByBase.has(p.baseRefName))
      childrenByBase.set(p.baseRefName, []);
    childrenByBase.get(p.baseRefName).push(p);
  }

  function attachChildren(p) {
    return {
      ...p,
      children: (childrenByBase.get(p.headRefName) || []).map(attachChildren),
    };
  }

  const roots = prs.filter((p) => !byHead.has(p.baseRefName));
  const trunks = new Map();
  for (const root of roots) {
    if (!trunks.has(root.baseRefName)) trunks.set(root.baseRefName, []);
    trunks.get(root.baseRefName).push(attachChildren(root));
  }

  return [...trunks.entries()].map(([trunk, roots]) => ({ trunk, roots }));
}

function requireToken() {
  if (!GITHUB_TOKEN) {
    const err = new Error(
      "Missing GITHUB_TOKEN. Copy .env.example to .env and add a GitHub personal access token.",
    );
    err.code = "NO_TOKEN";
    throw err;
  }
}

export function buildSearchQuery(userQuery, assignee) {
  const trimmed = (userQuery || "").trim() || DEFAULT_QUERY;
  const assigneeClause = assignee ? ` assignee:${assignee}` : "";
  return `repo:${GITHUB_OWNER}/${GITHUB_REPO} ${trimmed}${assigneeClause}`;
}

export async function fetchPullRequests(userQuery, assignee = "") {
  requireToken();

  const searchQuery = buildSearchQuery(userQuery, assignee);

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "pr-tree-localhost-app",
    },
    body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { searchQuery } }),
  });

  const json = await response.json();

  if (!response.ok || json.errors) {
    const message =
      json.errors?.map((e) => e.message).join("; ") || response.statusText;
    throw new Error(`GitHub API error: ${message}`);
  }

  return json.data.search.nodes.map((n) => ({
    number: n.number,
    title: n.title,
    url: n.url,
    headRefName: n.headRefName,
    baseRefName: n.baseRefName,
    status: n.mergeQueueEntry ? "queued" : n.isDraft ? "draft" : "open",
  }));
}

const MAX_MEMBER_PAGES = 5; // caps at 500 members

export async function fetchOrgMembers() {
  requireToken();

  const members = [];
  for (let page = 1; page <= MAX_MEMBER_PAGES; page++) {
    const response = await fetch(
      `https://api.github.com/orgs/${GITHUB_OWNER}/members?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "User-Agent": "pr-tree-localhost-app",
        },
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        `GitHub API error listing org members: ${body.message || response.statusText}`,
      );
    }

    const batch = await response.json();
    members.push(...batch.map((m) => m.login));
    if (batch.length < 100) break;
  }

  return members.sort((a, b) => a.localeCompare(b));
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, requestedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/config") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          defaultQuery: DEFAULT_QUERY,
          defaultAssignee: DEFAULT_ASSIGNEE,
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
        }),
      );
      return;
    }

    if (url.pathname === "/api/org-members") {
      const members = await fetchOrgMembers();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ members }));
      return;
    }

    if (url.pathname === "/api/prs") {
      const userQuery = url.searchParams.get("q") || "";
      const assignee = (url.searchParams.get("assignee") || "").trim();

      const prs = await fetchPullRequests(userQuery, assignee);
      const forest = buildForest(prs);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          query: buildSearchQuery(userQuery, assignee),
          generatedAt: new Date().toISOString(),
          forest,
        }),
      );
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    console.error(err);
    res.writeHead(err.code === "NO_TOKEN" ? 400 : 500, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ error: err.message, code: err.code || null }));
  }
});

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`PR tree app running at ${url}`);
    if (OPEN_BROWSER) openInBrowser(url);
  });
}

export { server };
