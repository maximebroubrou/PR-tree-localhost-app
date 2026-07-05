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

function renderPrCard(pr) {
  return `
    <a class="pr-card" href="${escapeAttr(pr.url)}" target="_blank" rel="noopener noreferrer">
      ${prIconSvg(pr.status)}
      <span class="pr-title">${escapeHtml(pr.title)} <span class="pr-number">#${pr.number}</span></span>
      <span class="pr-badge ${pr.status}">${STATUS_LABEL[pr.status] || pr.status}</span>
      <span class="pr-branch">${escapeHtml(pr.headRefName)}</span>
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
const assigneeSearch = document.getElementById('assignee-search');
const assigneeList = document.getElementById('assignee-list');

const LS_QUERY_KEY = 'pr-tree.query';
const LS_ASSIGNEE_KEY = 'pr-tree.assignee';

let allMembers = [];
let selectedAssignee = '';

function updateAssigneeSummary() {
  assigneeSummary.textContent = selectedAssignee || 'Anyone';
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

function persistState() {
  localStorage.setItem(LS_QUERY_KEY, queryInput.value);
  localStorage.setItem(LS_ASSIGNEE_KEY, selectedAssignee);
}

async function loadOrgMembers() {
  try {
    const res = await fetch('/api/org-members');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load org members.');
    allMembers = data.members;
    renderAssigneeOptions();
  } catch (err) {
    assigneeList.innerHTML = `<p class="assignee-empty">${escapeHtml(err.message)}</p>`;
  }
}

async function load() {
  statusEl.textContent = 'Loading…';
  statusEl.classList.remove('error');
  statusEl.style.display = 'block';
  treeRootEl.innerHTML = '';
  metaEl.textContent = '';

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

    metaEl.textContent = `Query: ${data.query} · Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;
    treeRootEl.innerHTML = renderForest(data.forest);
    statusEl.style.display = 'none';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
    statusEl.style.display = 'block';
  }
}

document.addEventListener('click', (e) => {
  if (assigneePicker.open && !assigneePicker.contains(e.target)) {
    assigneePicker.open = false;
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

refreshBtn.addEventListener('click', () => {
  persistState();
  load();
});

queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    persistState();
    load();
  }
});

async function init() {
  queryInput.value = localStorage.getItem(LS_QUERY_KEY) || '';

  const storedAssignee = localStorage.getItem(LS_ASSIGNEE_KEY);
  selectedAssignee = storedAssignee !== null ? storedAssignee : '';

  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (!queryInput.value) queryInput.value = config.defaultQuery;
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
  await loadOrgMembers();
  await load();
}

init();
