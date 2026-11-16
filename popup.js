const RECORDS_KEY = 'ppRecords';
const STATUS_KEY = 'ppStatus';
const SETTINGS_KEY = 'ppSettings';

const SCRIPTS = [
  'src/config.js',
  'src/storage.js',
  'src/extractors.js',
  'src/modal.js',
  'src/pagination.js',
  'src/engine.js',
  'content.js'
];

const $ = (id) => document.getElementById(id);
const els = {
  start: $('start'), stop: $('stop'), exportBtn: $('export'), clear: $('clear'),
  count: $('count'), withEmail: $('withEmail'), status: $('status'),
  bar: $('bar'), delay: $('delay'), auto: $('auto'), maxPages: $('maxPages')
};

// ---------- rendering ----------
async function renderCounts() {
  const d = await chrome.storage.local.get(RECORDS_KEY);
  const records = d[RECORDS_KEY] || [];
  els.count.textContent = records.length;
  els.withEmail.textContent = records.filter((r) => r.email && r.email.includes('@')).length;
  els.exportBtn.disabled = records.length === 0;
  els.clear.disabled = records.length === 0;
}

function renderStatus(s) {
  if (!s) return;
  els.status.textContent = s.message || 'Idle.';
  els.status.className = 'status ' + (s.kind === 'error' ? 'error' : s.kind === 'ok' ? 'ok' : '');

  // Reset running state if watchdog exceeds 90s
  if (s.running && s.updatedAt && Date.now() - s.updatedAt > 90000) {
    s = { ...s, running: false };
  }

  els.start.disabled = !!s.running;
  els.stop.disabled = !s.running;

  if (s.running && s.total) {
    els.bar.hidden = false;
    els.bar.max = s.total;
    els.bar.value = s.done || 0;
  } else {
    els.bar.hidden = true;
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[RECORDS_KEY]) renderCounts();
  if (changes[STATUS_KEY]) renderStatus(changes[STATUS_KEY].newValue);
});

// ---------- tab / content-script helpers ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'pp:ping' });
  } catch {
    // Tab was open before extension reloaded: inject all modular scripts in order
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: SCRIPTS });
    await new Promise((r) => setTimeout(r, 150));
  }
}

function setError(msg) {
  renderStatus({ kind: 'error', message: msg, running: false });
}

// ---------- actions ----------
els.start.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab || !/^https?:\/\/([^/]*\.)?prepostseo\.com\//i.test(tab.url || '')) {
    return setError('Open the Prepostseo guest posting directory in the active tab first.');
  }

  try {
    await ensureContentScript(tab);
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'pp:start',
      delay: Number.isFinite(Number(els.delay.value)) && els.delay.value !== '' ? Number(els.delay.value) : 50,
      auto: els.auto.checked,
      maxPages: Math.max(0, Number(els.maxPages.value) || 0)
    });

    if (!res?.ok) return setError(res?.error || 'Could not start.');
    renderStatus({ running: true, kind: 'info', message: 'Starting…' });
  } catch (e) {
    setError('Could not reach page: ' + e.message + ' (try reloading the tab).');
  }
});

els.stop.addEventListener('click', async () => {
  const tab = await activeTab();
  await chrome.storage.local.set({ ppAuto: { active: false } });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'pp:stop' });
  } catch { /* ignore */ }
  renderStatus({ kind: 'info', message: 'Stopping…', running: false, updatedAt: Date.now() });
});

// CSV export -------------------------------------------------------------
const CSV_COLUMNS = [
  ['Category', 'category'],
  ['Website URL', 'url'],
  ['DA', 'da'],
  ['PA', 'pa'],
  ['Email / Status', 'email']
];

function csvCell(v) {
  let s = v == null ? '' : String(v);
  // Protect spreadsheet formulas without breaking email @ symbols
  if (/^[=+\-\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = "'" + s;
  }
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(records) {
  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(',')];
  for (const r of records) {
    lines.push(CSV_COLUMNS.map(([, k]) => csvCell(r[k])).join(','));
  }
  return lines.join('\r\n');
}

async function exportCsv() {
  const d = await chrome.storage.local.get(RECORDS_KEY);
  const records = d[RECORDS_KEY] || [];
  if (!records.length) return;

  const csvContent = '\uFEFF' + toCsv(records);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `prepostseo-guest-sites-${stamp}.csv`;

  // Use chrome.downloads API if available
  if (chrome.downloads && chrome.downloads.download) {
    const reader = new FileReader();
    reader.onload = function() {
      chrome.downloads.download({ url: reader.result, filename, saveAs: true });
    };
    reader.readAsDataURL(blob);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
els.exportBtn.addEventListener('click', exportCsv);

els.clear.addEventListener('click', async () => {
  if (!confirm('Delete all stored records? This cannot be undone.')) return;

  // Signal any running tab to clear memory so it does not resurrect old data
  try {
    const tab = await activeTab();
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'pp:clear' });
    }
  } catch { /* ignore */ }

  await chrome.storage.local.remove([RECORDS_KEY, STATUS_KEY, 'ppDebug', 'ppAuto']);
  renderStatus({ message: 'Data cleared.', running: false });
  renderCounts();
});

// ---------- settings ----------
function saveSettings() {
  chrome.storage.local.set({
    [SETTINGS_KEY]: {
      auto: els.auto.checked,
      maxPages: els.maxPages.value,
      delay: els.delay.value
    }
  });
}
[els.auto, els.maxPages, els.delay].forEach((el) => el.addEventListener('change', saveSettings));

// ---------- init ----------
(async () => {
  const st = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  if (st) {
    els.auto.checked = st.auto !== false;
    if (st.maxPages != null) els.maxPages.value = st.maxPages;
    if (st.delay != null && st.delay !== '') els.delay.value = st.delay;
  }
  await renderCounts();
  const d = await chrome.storage.local.get(STATUS_KEY);
  renderStatus(d[STATUS_KEY] || { message: 'Idle.', running: false });
})();
