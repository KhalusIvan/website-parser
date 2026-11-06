// Website Parser UI - runs on GitHub Pages.
// The scraping itself runs in GitHub Actions (browsers can't load other sites because of CORS).
// This page: starts the "Scrape" workflow, shows its runs and lists the Excel files it produced.

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'website-parser:github-token';

const state = {
  config: { owner: 'KhalusIvan', repo: 'website-parser', branch: 'main', workflow: 'scrape.yml' },
  sources: [],
  files: [],
  runs: [],
  token: '',
  pollTimer: null,
  activeRunIds: new Set(),
};

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function storage(action, value) {
  try {
    if (action === 'get') return localStorage.getItem(TOKEN_KEY) ?? '';
    if (action === 'set') localStorage.setItem(TOKEN_KEY, value);
    if (action === 'remove') localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked - token only lives for this page view */
  }
  return '';
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

async function getJson(url) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function github(path, options = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(`https://api.github.com/repos/${state.config.owner}/${state.config.repo}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
}

const workflowPage = () =>
  `https://github.com/${state.config.owner}/${state.config.repo}/actions/workflows/${state.config.workflow}`;

function timeAgo(date) {
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function duration(from, to) {
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60}s` : `${s}s`;
}

const formatSize = (bytes) => (bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

// ---------- form ----------

function currentSource() {
  return state.sources.find((s) => s.id === $('f-source').value);
}

function fillSelect(select, entries) {
  const previous = select.value;
  select.replaceChildren(...entries.map(([value, label]) => h('option', { value }, label)));
  if (entries.some(([v]) => v === previous)) select.value = previous;
}

function renderForm() {
  fillSelect($('f-source'), state.sources.map((s) => [s.id, `${s.name} - ${s.website.replace(/^https?:\/\//, '')}`]));
  onSourceChange();
}

function onSourceChange() {
  const source = currentSource();
  if (!source) return;
  $('f-source-desc').textContent = source.description ?? '';
  fillSelect($('f-lang'), Object.entries(source.languages));
  fillSelect($('f-mode'), Object.entries(source.modes).map(([id, m]) => [id, m.label]));
  onModeChange();
}

function onModeChange() {
  const mode = currentSource()?.modes[$('f-mode').value];
  $('f-url-wrap').hidden = !mode?.needsUrl;
  $('f-url').placeholder = `${currentSource()?.website ?? 'https://'}/...`;
}

function showFormError(message) {
  $('form-error').textContent = message;
  $('form-error').hidden = !message;
}

async function onSubmit(event) {
  event.preventDefault();
  showFormError('');
  const source = currentSource();
  const inputs = { source: source.id, lang: $('f-lang').value, mode: $('f-mode').value, url: '' };

  if (source.modes[inputs.mode]?.needsUrl) {
    inputs.url = $('f-url').value.trim();
    let host = '';
    try {
      host = new URL(inputs.url).hostname;
    } catch {
      /* invalid URL */
    }
    if (!host || host !== new URL(source.website).hostname) {
      showFormError(`Paste a category link from ${source.website}`);
      $('f-url').focus();
      return;
    }
  }

  if (!state.token) {
    window.open(workflowPage(), '_blank', 'noopener');
    return;
  }

  const button = $('f-submit');
  button.disabled = true;
  button.textContent = 'Starting...';
  try {
    const res = await github(`/actions/workflows/${state.config.workflow}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: state.config.branch, inputs }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('GitHub rejected the token. Check that it has "Actions: Read and write" for this repo.');
    if (res.status === 404) throw new Error('Workflow not found, or the token has no access to this repo.');
    if (!res.ok) throw new Error(`GitHub error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    toast('Scrape started - it will show up in Recent runs in a few seconds');
    setTimeout(refreshRuns, 3000);
    setTimeout(refreshRuns, 8000);
  } catch (err) {
    showFormError(err.message);
  } finally {
    button.disabled = false;
    renderSubmitLabel();
  }
}

function renderSubmitLabel() {
  $('f-submit').textContent = state.token ? 'Start scraping' : 'Start scraping on GitHub ↗';
  $('no-token-hint').hidden = Boolean(state.token);
}

// ---------- runs ----------

function runStatus(run) {
  if (run.status !== 'completed') return { label: run.status === 'queued' ? 'Queued' : 'Running', cls: 'active' };
  if (run.conclusion === 'success') return { label: 'Done', cls: 'success' };
  if (run.conclusion === 'failure') return { label: 'Failed', cls: 'failure' };
  return { label: run.conclusion ?? 'Unknown', cls: 'other' };
}

function renderRuns(message) {
  const list = $('runs');
  if (message) {
    list.replaceChildren(h('li', { class: 'empty' }, message));
    return;
  }
  if (!state.runs.length) {
    list.replaceChildren(h('li', { class: 'empty' }, 'No runs yet. Start your first export.'));
    return;
  }
  list.replaceChildren(
    ...state.runs.map((run) => {
      const st = runStatus(run);
      const title = (run.display_title || run.name || '').replace(/^Scrape\s*/, '');
      const meta =
        run.status === 'completed'
          ? `${timeAgo(run.run_started_at ?? run.created_at)} · took ${duration(run.run_started_at ?? run.created_at, run.updated_at)}`
          : `started ${timeAgo(run.run_started_at ?? run.created_at)}`;
      return h(
        'li',
        { class: 'run' },
        h('span', { class: `chip ${st.cls}` }, st.label),
        h('div', { style: 'min-width:0' }, h('div', { class: 'run-title', title }, title), h('div', { class: 'run-meta' }, meta)),
        h('a', { href: run.html_url, target: '_blank', rel: 'noopener' }, 'Logs ↗'),
      );
    }),
  );
}

async function refreshRuns() {
  try {
    const res = await github(`/actions/workflows/${state.config.workflow}/runs?per_page=8`);
    if (res.status === 404 || res.status === 401) {
      renderRuns(state.token ? 'Cannot read runs with this token.' : 'The repository is private. Add a token in Settings to see runs.');
      return schedulePoll(false);
    }
    if (res.status === 403) {
      renderRuns('GitHub API rate limit reached. Add a token in Settings or try again later.');
      return schedulePoll(false);
    }
    const data = await res.json();
    state.runs = data.workflow_runs ?? [];
    renderRuns();

    // a run just finished -> its Excel file is now published, reload the downloads list
    const active = new Set(state.runs.filter((r) => r.status !== 'completed').map((r) => r.id));
    const finished = [...state.activeRunIds].some((id) => !active.has(id));
    state.activeRunIds = active;
    if (finished) {
      toast('A scrape finished - downloads updated');
      refreshFiles();
    }
    schedulePoll(active.size > 0);
  } catch {
    renderRuns('Could not load runs (network error).');
    schedulePoll(false);
  }
}

function schedulePoll(fast) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(refreshRuns, fast ? 10_000 : 60_000);
}

// ---------- files ----------

function renderFiles(message) {
  const box = $('files');
  if (message || !state.files.length) {
    box.replaceChildren(h('p', { class: 'empty' }, message ?? 'No Excel files yet. Finished scrapes appear here.'));
    return;
  }
  const bySource = new Map();
  for (const f of state.files) {
    if (!bySource.has(f.source)) bySource.set(f.source, []);
    bySource.get(f.source).push(f);
  }
  box.replaceChildren(
    ...[...bySource].map(([sourceId, files]) => {
      const source = state.sources.find((s) => s.id === sourceId);
      files.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
      return h(
        'div',
        { class: 'source-group' },
        h('h3', {}, source?.name ?? sourceId, source && h('a', { href: source.website, target: '_blank', rel: 'noopener' }, source.website.replace(/^https?:\/\//, ''))),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Export'), h('th', {}, 'Products'), h('th', {}, 'Updated'), h('th', {}, 'Size'), h('th', {}, ''))),
            h(
              'tbody',
              {},
              files.map((f) => {
                const lang = source?.languages?.[f.lang] ?? f.lang?.toUpperCase() ?? '';
                const what = f.mode === 'all' || !f.mode ? 'Whole site' : 'Category';
                return h(
                  'tr',
                  {},
                  h('td', { class: 'what' }, `${what} · ${lang}`, f.url && h('span', { class: 'sub' }, decodeURI(f.url))),
                  h('td', { class: 'num', 'data-label': 'Products' }, f.products != null ? String(f.products) : '-', f.failed ? h('span', { class: 'muted' }, ` (${f.failed} failed)`) : null),
                  h('td', { 'data-label': 'Updated', title: f.finishedAt ? new Date(f.finishedAt).toLocaleString() : '' }, f.finishedAt ? timeAgo(f.finishedAt) : '-'),
                  h('td', { class: 'num', 'data-label': 'Size' }, formatSize(f.size ?? 0)),
                  h('td', { class: 'action' }, h('a', { class: 'btn small', href: `files/${encodeURIComponent(f.file)}?v=${encodeURIComponent(f.finishedAt ?? '')}`, download: f.file }, 'Download .xlsx')),
                );
              }),
            ),
          ),
        ),
      );
    }),
  );
}

async function refreshFiles() {
  try {
    state.files = await getJson('files/index.json');
    renderFiles();
  } catch {
    renderFiles('Could not load the list of files.');
  }
}

// ---------- settings ----------

function renderToken() {
  $('token').value = '';
  $('token').placeholder = state.token ? '•••••••• (saved)' : 'github_pat_...';
  $('token-status').textContent = state.token
    ? 'A token is saved in this browser. Exports start directly from this page.'
    : 'No token saved.';
  renderSubmitLabel();
}

// ---------- start ----------

async function init() {
  state.token = storage('get');
  try {
    state.config = { ...state.config, ...(await getJson('config.json')) };
  } catch {
    /* defaults */
  }
  $('repo-link').href = `https://github.com/${state.config.owner}/${state.config.repo}`;

  try {
    state.sources = await getJson('sources.json');
  } catch {
    showFormError('Could not load the list of websites.');
  }

  $('f-source').addEventListener('change', onSourceChange);
  $('f-mode').addEventListener('change', onModeChange);
  $('scrape-form').addEventListener('submit', onSubmit);
  $('runs-refresh').addEventListener('click', refreshRuns);
  $('files-refresh').addEventListener('click', refreshFiles);
  $('token-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('token').value.trim();
    if (!value) return;
    state.token = value;
    storage('set', value);
    renderToken();
    toast('Token saved');
    refreshRuns();
  });
  $('token-clear').addEventListener('click', () => {
    state.token = '';
    storage('remove');
    renderToken();
    toast('Token removed');
  });
  if (location.hash === '#settings') $('settings-details').open = true;
  document.querySelectorAll('a[href="#settings"]').forEach((a) => a.addEventListener('click', () => ($('settings-details').open = true)));

  renderForm();
  renderToken();
  renderRuns('Loading...');
  renderFiles('Loading...');
  refreshFiles();
  refreshRuns();
}

init();
