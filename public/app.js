const STATUS_LABEL = {
  open: 'Open',
  draft: 'Draft',
  queued: 'Merge queue',
};

// Minimal stroke-based pull-request icon, reused for every status so the only
// visual difference between states is color (+ dashed stroke for drafts).
function prIconSvg(status) {
  const dashed = status === 'draft' ? ' stroke-dasharray="2.2 2.2"' : '';
  return `
    <svg class="pr-icon ${status}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <circle cx="4" cy="3" r="1.8"${status === 'draft' ? ' stroke-dasharray="0"' : ''} />
      <circle cx="4" cy="13" r="1.8" />
      <circle cx="12" cy="5" r="1.8" />
      <path d="M4 4.8V11.2"${dashed} />
      <path d="M4 6.8c0 2.6 3.4 2.6 3.4 2.6H10.5" />
      <path d="M12 6.8v0" />
    </svg>
  `;
}

const REVIEW_LABEL = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  review_required: 'Review required',
};

// Small stroke-based badge showing where review sits, independent of the PR's
// own open/draft/queued status icon. Omitted entirely when GitHub has no
// review decision for the PR (e.g. no reviewers requested).
function reviewIconSvg(reviewDecision) {
  if (!reviewDecision) return '';

  const shapesByDecision = {
    approved: '<path d="M5.2 8.2l2 2 3.6-4" />',
    changes_requested: '<path d="M8 5.2v3.2" /><circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" />',
    review_required: '',
  };
  const dashed = reviewDecision === 'review_required' ? ' stroke-dasharray="2 2"' : '';

  return `
    <span class="review-badge ${reviewDecision}" title="${escapeAttr(REVIEW_LABEL[reviewDecision] || reviewDecision)}">
      <svg class="review-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6.5"${dashed} />
        ${shapesByDecision[reviewDecision] || ''}
      </svg>
    </span>
  `;
}

// Unread @mentions, keyed by "owner/repo#number". Populated from GitHub's own
// notification inbox (see loadMentions) so we piggyback on its read/unread
// state rather than tracking it ourselves.
let mentionedKeys = new Set();

function isMentioned(pr) {
  return mentionedKeys.has(`${pr.repo}#${pr.number}`);
}

function mentionBadgeSvg() {
  return `
    <span class="mention-badge" title="Unread activity: mention, reply, or review request">
      <svg viewBox="0 0 16 16" fill="currentColor" stroke="none">
        <path d="M8 2C4.4 2 1.5 4.4 1.5 7.4c0 1.7.95 3.2 2.45 4.2-.1.85-.45 1.6-1 2.25a.35.35 0 0 0 .3.57c1.2-.15 2.3-.6 3.2-1.3.5.1 1 .15 1.55.15 3.6 0 6.5-2.4 6.5-5.4S11.6 2 8 2z" />
      </svg>
    </span>
  `;
}

function renderPrCard(pr) {
  return `
    <a class="pr-card" href="${escapeAttr(pr.url)}" target="_blank" rel="noopener noreferrer">
      ${prIconSvg(pr.status)}
      <span class="pr-main">
        <span class="pr-title-row">
          <span class="pr-title">${escapeHtml(pr.title)} <span class="pr-number">#${pr.number}</span></span>
          ${isMentioned(pr) ? mentionBadgeSvg() : ''}
          ${reviewIconSvg(pr.reviewDecision)}
          <span class="pr-badge ${pr.status}">${STATUS_LABEL[pr.status] || pr.status}</span>
        </span>
        <span class="pr-branch">${escapeHtml(pr.headRefName)}</span>
      </span>
    </a>
  `;
}

function renderNode(pr) {
  const children = pr.children && pr.children.length
    ? `<ul class="tree">${pr.children.map((c) => `<li>${renderNode(c)}</li>`).join('')}</ul>`
    : '';
  return `${renderPrCard(pr)}${children}`;
}

function renderForest(forest) {
  if (!forest.length) {
    return '<p class="status">No open PRs match the search query.</p>';
  }

  return forest
    .map(
      (group) => `
        <div class="trunk-group">
          <div class="trunk-label">🌱 ${escapeHtml(group.trunk)}</div>
          <ul class="tree">
            ${group.roots.map((root) => `<li>${renderNode(root)}</li>`).join('')}
          </ul>
        </div>
      `
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Slack export
//
// Turns a forest into a plain-text tree that pastes nicely into Slack:
//
//   🌳 PR tree · @someone
//
//   🌱 main
//    |── 🟢 [Parent PR](https://…) ✅
//   │       |── 📝 [Child PR](https://…) 👀
//   │      │      └── 🚂 [Grandchild PR](https://…)
//   │      └── 🟢 [Other child](https://…)
//   └── 🟢 [Another root](https://…) 🔁
//
// See SLACK_INDENT_* below for how indentation survives Slack's rendering.
// ---------------------------------------------------------------------------

const SLACK_STATUS_EMOJI = {
  open: '🟢',
  draft: '📝',
  queued: '🚂',
};

const SLACK_REVIEW_EMOJI = {
  approved: '✅',
  changes_requested: '🔁',
  review_required: '👀',
};

const SLACK_LEGEND = [
  ['status', 'open', '🟢 open'],
  ['status', 'draft', '📝 draft'],
  ['status', 'queued', '🚂 merge queue'],
  ['review', 'approved', '✅ approved'],
  ['review', 'changes_requested', '🔁 changes requested'],
  ['review', 'review_required', '👀 review needed'],
];

// Slack renders messages in a proportional font and trims/collapses plain and
// typographic spaces, which glued the "│" guides onto the "├─" connectors.
// Non-breaking spaces (U+00A0) are kept as-is, so we use runs of them to give
// each tree level a clear, consistent gap.
const NBSP = '\u00A0';
// "├" renders poorly in Slack's font, so mid branches use an ASCII "|" instead,
// with a leading space to line it up with the wider "└" of last branches.
const SLACK_BRANCH_MID = `${NBSP}|──${NBSP}`;
const SLACK_BRANCH_LAST = `└──${NBSP}`;
const SLACK_INDENT_PIPE = `│${NBSP.repeat(6)}`;
const SLACK_INDENT_BLANK = NBSP.repeat(8);

// Square brackets in a title would break the [text](url) markdown link.
function slackLinkText(title) {
  return String(title).replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
}

function slackPrLine(pr, used) {
  used.status.add(pr.status);
  if (pr.reviewDecision) used.review.add(pr.reviewDecision);

  const status = SLACK_STATUS_EMOJI[pr.status] || '⚪';
  const review = pr.reviewDecision ? ` ${SLACK_REVIEW_EMOJI[pr.reviewDecision] || ''}` : '';
  return `${status} [${slackLinkText(pr.title)}](${pr.url})${review}`.trimEnd();
}

function slackNodeLines(pr, prefix, isLast, used) {
  const branch = isLast ? SLACK_BRANCH_LAST : SLACK_BRANCH_MID;
  const lines = [`${prefix}${branch}${slackPrLine(pr, used)}`];
  const childPrefix = prefix + (isLast ? SLACK_INDENT_BLANK : SLACK_INDENT_PIPE);
  const children = pr.children || [];
  children.forEach((child, i) => {
    lines.push(...slackNodeLines(child, childPrefix, i === children.length - 1, used));
  });
  return lines;
}

function forestToSlack(forest, who) {
  const used = { status: new Set(), review: new Set() };
  const lines = [`🌳 *PR tree · ${who}*`];

  if (!forest || !forest.length) {
    lines.push('', '_No open PRs_ 🍃');
    return lines.join('\n');
  }

  forest.forEach((group) => {
    lines.push('', `🌱 \`${group.trunk}\``);
    group.roots.forEach((root, i) => {
      lines.push(...slackNodeLines(root, '', i === group.roots.length - 1, used));
    });
  });

  const legend = SLACK_LEGEND.filter(([kind, key]) => used[kind].has(key)).map(([, , label]) => label);
  if (legend.length) {
    lines.push('', `_${legend.join('  ·  ')}_`);
  }

  return lines.join('\n');
}

async function copySlackTree(button, forest, who) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(forestToSlack(forest, who));
    button.textContent = '✓ Copied';
    button.classList.add('copied');
  } catch (err) {
    console.warn('Could not copy to clipboard:', err);
    button.textContent = 'Copy failed';
    button.classList.add('failed');
  }
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('copied', 'failed');
  }, 1500);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

const statusEl = document.getElementById('status');
const treeRootEl = document.getElementById('tree-root');
const metaEl = document.getElementById('meta');
const refreshBtn = document.getElementById('refresh-btn');
const queryInput = document.getElementById('query-input');
const assigneePicker = document.getElementById('assignee-picker');
const assigneeSummary = document.getElementById('assignee-summary');
const assigneeHeaderEl = document.getElementById('assignee-header');
const assigneeSearch = document.getElementById('assignee-search');
const assigneeList = document.getElementById('assignee-list');

const colleaguesPicker = document.getElementById('colleagues-picker');
const colleaguesSummary = document.getElementById('colleagues-summary');
const colleaguesSearch = document.getElementById('colleagues-search');
const colleaguesList = document.getElementById('colleagues-list');
const colleaguesRoot = document.getElementById('colleagues-root');
const copyMineBtn = document.getElementById('copy-mine-btn');

const LS_QUERY_KEY = 'pr-tree.query';
const LS_ASSIGNEE_KEY = 'pr-tree.assignee';
const LS_COLLEAGUES_KEY = 'pr-tree.colleagues';
const MAX_COLLEAGUES = 4;

let allMembers = [];
let selectedAssignee = '';
let selectedColleagues = [];

// Last successfully loaded forests, kept around for the "Copy for Slack" buttons.
let myForest = null;
const colleagueForests = new Map();

function updateAssigneeSummary() {
  assigneeSummary.textContent = selectedAssignee || 'Anyone';
  assigneeHeaderEl.textContent = selectedAssignee ? `@${selectedAssignee}` : 'Anyone';
}

function selectAssignee(login) {
  selectedAssignee = login;
  updateAssigneeSummary();
  renderAssigneeOptions(assigneeSearch.value);
  assigneePicker.open = false;
  persistState();
  load();
}

function renderAssigneeOptions(filterText = '') {
  const needle = filterText.trim().toLowerCase();
  const filtered = needle ? allMembers.filter((login) => login.toLowerCase().includes(needle)) : allMembers;

  const anyoneRow = `
    <div class="assignee-option anyone ${selectedAssignee === '' ? 'selected' : ''}" data-login="">
      Anyone
    </div>
  `;

  if (!allMembers.length) {
    assigneeList.innerHTML = `${anyoneRow}<p class="assignee-empty">No org members found.</p>`;
  } else if (!filtered.length) {
    assigneeList.innerHTML = `${anyoneRow}<p class="assignee-empty">No match.</p>`;
  } else {
    assigneeList.innerHTML =
      anyoneRow +
      filtered
        .map(
          (login) => `
            <div class="assignee-option ${login === selectedAssignee ? 'selected' : ''}" data-login="${escapeAttr(login)}">
              ${escapeHtml(login)}
            </div>
          `
        )
        .join('');
  }

  assigneeList.querySelectorAll('.assignee-option[data-login]').forEach((el) => {
    el.addEventListener('click', () => selectAssignee(el.dataset.login));
  });

  updateAssigneeSummary();
}

function updateColleaguesSummary() {
  colleaguesSummary.textContent = selectedColleagues.length
    ? selectedColleagues.join(', ')
    : 'None selected';
}

function toggleColleague(login) {
  const idx = selectedColleagues.indexOf(login);
  if (idx >= 0) {
    selectedColleagues.splice(idx, 1);
  } else {
    if (selectedColleagues.length >= MAX_COLLEAGUES) return;
    selectedColleagues.push(login);
  }
  renderColleagueOptions(colleaguesSearch.value);
  persistState();
  loadColleagues();
}

function renderColleagueOptions(filterText = '') {
  const needle = filterText.trim().toLowerCase();
  const filtered = needle ? allMembers.filter((login) => login.toLowerCase().includes(needle)) : allMembers;
  const atMax = selectedColleagues.length >= MAX_COLLEAGUES;

  if (!allMembers.length) {
    colleaguesList.innerHTML = '<p class="assignee-empty">No org members found.</p>';
  } else if (!filtered.length) {
    colleaguesList.innerHTML = '<p class="assignee-empty">No match.</p>';
  } else {
    colleaguesList.innerHTML = filtered
      .map((login) => {
        const isSelected = selectedColleagues.includes(login);
        const disabled = !isSelected && atMax;
        return `
          <div class="assignee-option colleague-option ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" data-login="${escapeAttr(login)}">
            <span class="colleague-checkbox">${isSelected ? '✓' : ''}</span>
            ${escapeHtml(login)}
          </div>
        `;
      })
      .join('');
  }

  colleaguesList.querySelectorAll('.colleague-option:not(.disabled)').forEach((el) => {
    el.addEventListener('click', () => toggleColleague(el.dataset.login));
  });

  updateColleaguesSummary();
}

function persistState() {
  localStorage.setItem(LS_QUERY_KEY, queryInput.value);
  localStorage.setItem(LS_ASSIGNEE_KEY, selectedAssignee);
  localStorage.setItem(LS_COLLEAGUES_KEY, JSON.stringify(selectedColleagues));
}

async function loadOrgMembers() {
  try {
    const res = await fetch('/api/org-members');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load org members.');
    allMembers = data.members;
    renderAssigneeOptions();
    renderColleagueOptions();
  } catch (err) {
    assigneeList.innerHTML = `<p class="assignee-empty">${escapeHtml(err.message)}</p>`;
    colleaguesList.innerHTML = `<p class="assignee-empty">${escapeHtml(err.message)}</p>`;
  }
}

async function loadMentions() {
  try {
    const res = await fetch('/api/mentions');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load mentions.');
    mentionedKeys = new Set(data.mentions.map((m) => `${m.repo}#${m.number}`));
  } catch (err) {
    // Non-critical: the tree still works without mention badges (e.g. the
    // token lacks the `notifications` scope).
    console.warn('Could not load mention notifications:', err.message);
  }
}

async function load() {
  statusEl.textContent = 'Loading…';
  statusEl.classList.remove('error');
  statusEl.style.display = 'block';
  treeRootEl.innerHTML = '';
  metaEl.textContent = '';
  myForest = null;
  copyMineBtn.disabled = true;

  const params = new URLSearchParams({
    q: queryInput.value.trim(),
    assignee: selectedAssignee,
  });

  try {
    const res = await fetch(`/api/prs?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load pull requests.');
    }

    metaEl.textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;
    treeRootEl.innerHTML = renderForest(data.forest);
    statusEl.style.display = 'none';
    myForest = data.forest;
    copyMineBtn.disabled = false;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
    statusEl.style.display = 'block';
  }
}

function renderColleaguesSkeleton() {
  colleagueForests.clear();
  if (!selectedColleagues.length) {
    colleaguesRoot.innerHTML = '<p class="status">Select up to 4 colleagues to see their PRs.</p>';
    return;
  }

  colleaguesRoot.innerHTML = selectedColleagues
    .map(
      (login) => `
        <section class="colleague-section" data-login="${escapeAttr(login)}">
          <div class="header-row">
            <div class="colleague-header">@${escapeHtml(login)}</div>
            <button class="copy-slack-btn" type="button" disabled title="Copy this tree as a Slack message">
              📋 Copy for Slack
            </button>
          </div>
          <p class="status colleague-status">Loading…</p>
          <div class="colleague-tree"></div>
        </section>
      `
    )
    .join('');
}

async function loadColleagues() {
  renderColleaguesSkeleton();
  if (!selectedColleagues.length) return;

  const query = queryInput.value.trim();

  await Promise.all(
    selectedColleagues.map(async (login) => {
      const section = colleaguesRoot.querySelector(`.colleague-section[data-login="${CSS.escape(login)}"]`);
      if (!section) return;
      const statusEl2 = section.querySelector('.colleague-status');
      const treeEl2 = section.querySelector('.colleague-tree');

      const params = new URLSearchParams({ q: query, assignee: login });

      try {
        const res = await fetch(`/api/prs?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load pull requests.');
        treeEl2.innerHTML = renderForest(data.forest);
        statusEl2.style.display = 'none';
        colleagueForests.set(login, data.forest);
        section.querySelector('.copy-slack-btn').disabled = false;
      } catch (err) {
        statusEl2.textContent = err.message;
        statusEl2.classList.add('error');
        statusEl2.style.display = 'block';
      }
    })
  );
}

document.addEventListener('click', (e) => {
  if (assigneePicker.open && !assigneePicker.contains(e.target)) {
    assigneePicker.open = false;
  }
  if (colleaguesPicker.open && !colleaguesPicker.contains(e.target)) {
    colleaguesPicker.open = false;
  }
});

assigneePicker.addEventListener('toggle', () => {
  if (assigneePicker.open) {
    assigneeSearch.value = '';
    renderAssigneeOptions();
    assigneeSearch.focus();
  }
});

assigneeSearch.addEventListener('input', () => {
  renderAssigneeOptions(assigneeSearch.value);
});

colleaguesPicker.addEventListener('toggle', () => {
  if (colleaguesPicker.open) {
    colleaguesSearch.value = '';
    renderColleagueOptions();
    colleaguesSearch.focus();
  }
});

colleaguesSearch.addEventListener('input', () => {
  renderColleagueOptions(colleaguesSearch.value);
});

copyMineBtn.addEventListener('click', () => {
  if (!myForest) return;
  copySlackTree(copyMineBtn, myForest, selectedAssignee ? `@${selectedAssignee}` : 'everyone');
});

colleaguesRoot.addEventListener('click', (e) => {
  const button = e.target.closest('.copy-slack-btn');
  if (!button) return;
  const login = button.closest('.colleague-section')?.dataset.login;
  if (!login || !colleagueForests.has(login)) return;
  copySlackTree(button, colleagueForests.get(login), `@${login}`);
});

refreshBtn.addEventListener('click', async () => {
  persistState();
  await loadMentions();
  load();
  loadColleagues();
});

queryInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    persistState();
    await loadMentions();
    load();
    loadColleagues();
  }
});

async function init() {
  queryInput.value = localStorage.getItem(LS_QUERY_KEY) || '';

  const storedAssignee = localStorage.getItem(LS_ASSIGNEE_KEY);
  selectedAssignee = storedAssignee !== null ? storedAssignee : '';

  try {
    const storedColleagues = JSON.parse(localStorage.getItem(LS_COLLEAGUES_KEY) || '[]');
    if (Array.isArray(storedColleagues)) {
      selectedColleagues = storedColleagues.filter((v) => typeof v === 'string').slice(0, MAX_COLLEAGUES);
    }
  } catch {
    // Ignore malformed localStorage content.
  }

  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    // Older stored queries predate baking `repo:` scoping into the editable
    // field — without it, the search would silently run across all of GitHub.
    if (!queryInput.value || !queryInput.value.includes('repo:')) {
      queryInput.value = config.defaultQuery;
    }
    // Only apply the .env default assignee if the user has never picked one
    // themselves — a stored empty string means they explicitly chose "Anyone".
    if (storedAssignee === null && config.defaultAssignee) {
      selectedAssignee = config.defaultAssignee;
    }
  } catch {
    // /api/config should always succeed; if it doesn't, the /api/prs call
    // below will surface a clearer error.
  }

  updateAssigneeSummary();
  updateColleaguesSummary();
  await loadOrgMembers();
  await loadMentions();
  await Promise.all([load(), loadColleagues()]);
}

init();
