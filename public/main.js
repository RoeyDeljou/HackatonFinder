const $ = (sel) => document.querySelector(sel);
const PRIORITY_LABEL = { high: 'High', medium: 'Med', low: 'Low' };
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const state = {
  config: null,
  fields: [],
  results: null,
  filter: 'all',
  query: '',
  sort: (() => { try { return localStorage.getItem('hf-sort') || 'best'; } catch { return 'best'; } })(),
  searching: false,
};

// ------------------------------------------------------------ device id
function deviceId() {
  let id = null;
  try { id = localStorage.getItem('hf-device'); } catch { /* private mode */ }
  if (!id) {
    id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-zA-Z0-9]/g, '');
    try { localStorage.setItem('hf-device', id); } catch { /* ignore */ }
  }
  return id;
}
const DEVICE = deviceId();

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-device-id': DEVICE, ...(opts.headers || {}) } });
  if (!res.ok && !opts.raw) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return opts.raw ? res : res.json();
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}

function show(view) {
  for (const v of ['setupView', 'loadingView', 'resultsView']) $('#' + v).classList.toggle('hidden', v !== view);
  $('#editBtn').classList.toggle('hidden', view !== 'resultsView');
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------ setup view
function renderFields() {
  const list = $('#fieldList');
  list.innerHTML = '';
  state.fields.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'field';
    const name = document.createElement('span');
    name.className = 'field-name';
    name.textContent = f.name;
    const prio = document.createElement('div');
    prio.className = 'prio';
    prio.setAttribute('role', 'group');
    prio.setAttribute('aria-label', `Priority for ${f.name}`);
    for (const p of ['high', 'medium', 'low']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.p = p;
      b.textContent = PRIORITY_LABEL[p];
      b.setAttribute('aria-pressed', String(f.priority === p));
      b.onclick = () => { f.priority = p; renderFields(); };
      prio.append(b);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'remove';
    rm.setAttribute('aria-label', `Remove ${f.name}`);
    rm.textContent = '×';
    rm.onclick = () => { state.fields.splice(i, 1); renderFields(); };
    li.append(name, prio, rm);
    list.append(li);
  });
  renderSuggestions();
  $('#searchBtn').disabled = !state.fields.length;
}

function renderSuggestions() {
  const box = $('#suggestChips');
  box.innerHTML = '';
  const have = new Set(state.fields.map((f) => f.name.toLowerCase()));
  for (const name of state.config?.suggestedFields || []) {
    if (have.has(name.toLowerCase())) continue;
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = '+ ' + name;
    c.onclick = () => addField(name);
    box.append(c);
  }
}

function addField(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 2) return;
  if (state.fields.some((f) => f.name.toLowerCase() === name.toLowerCase())) { toast(`${name} is already in your list`); return; }
  state.fields.push({ name: name.charAt(0).toUpperCase() + name.slice(1), priority: 'medium' });
  renderFields();
}

// ------------------------------------------------------------ push notifications
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush({ quiet = false } = {}) {
  if (!pushSupported || !state.config?.vapidPublicKey) return false;
  try {
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.config.vapidPublicKey) });
    await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), tz: TZ }) });
    renderNotice();
    return true;
  } catch (e) {
    if (!quiet) toast('Could not turn on notifications: ' + e.message);
    return false;
  }
}

function noticeHtml() {
  if (!state.config) return null;
  if (isIos && !isStandalone) {
    return 'To get push notifications on iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>, then open Hackathon Finder from your home screen.';
  }
  if (!pushSupported) return 'This browser does not support push notifications. Results still update twice a day in the app.';
  if (!state.config.push) return 'Push notifications are not configured on the server yet (missing VAPID keys).';
  if (Notification.permission === 'denied') return 'Notifications are blocked. Turn them on for this app in your device settings to get alerts.';
  if (Notification.permission === 'default') return 'Get an alert when new hackathons are found.<br><button type="button" class="secondary" data-action="enable-push">Turn on notifications</button>';
  return null;
}

function renderNotice() {
  for (const id of ['#notifyCard', '#notifyCard2']) {
    const el = $(id);
    const html = noticeHtml();
    el.classList.toggle('hidden', !html);
    if (html) el.innerHTML = html;
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="enable-push"]')) {
    enablePush().then((ok) => { if (ok) api('/api/test-push', { method: 'POST' }).catch(() => {}); });
  }
});

// ------------------------------------------------------------ search
function renderSources(status) {
  const list = $('#sourceList');
  list.innerHTML = '';
  for (const s of status.values()) {
    const li = document.createElement('li');
    li.className = s.status;
    const n = document.createElement('span');
    n.textContent = s.name;
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = s.status === 'done' ? `✓ ${s.count ?? 0}` : s.status === 'error' ? 'unavailable' : 'searching…';
    li.append(n, st);
    list.append(li);
  }
}

async function runSearch() {
  if (state.searching) return;
  state.searching = true;
  const firstTime = !state.results;
  $('#setupError').classList.add('hidden');
  try {
    await api('/api/profile', { method: 'PUT', body: JSON.stringify({ fields: state.fields, tz: TZ }) });
    // Ask for notification permission while we still have the user's tap.
    if (pushSupported && Notification.permission === 'default' && (!isIos || isStandalone)) await enablePush({ quiet: true });

    show('loadingView');
    $('#loadingTitle').textContent = 'Searching for hackathons…';
    const status = new Map((state.config?.sources || []).map((name) => [name, { name, status: 'running' }]));
    renderSources(status);

    const res = await api('/api/search', { method: 'POST', body: JSON.stringify({ tz: TZ }), raw: true });
    if (!res.ok) {
      let msg = `Search failed (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'source') {
          const key = ev.id === 'ai' ? 'AI web search' : ev.name;
          status.set(key, { ...(status.get(key) || {}), name: ev.name, status: ev.status, count: ev.count });
          renderSources(status);
        } else if (ev.type === 'partial' && state.config?.ai) {
          state.results = ev.results;
          renderResults({ aiPending: true });
          show('resultsView');
        } else if (ev.type === 'done') {
          state.results = ev.results;
          done = true;
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
      }
    }
    if (!done) state.results = await api('/api/hackathons');
    renderResults();
    show('resultsView');
    applyDeepLink();
  } catch (e) {
    if (firstTime && !state.results) {
      show('setupView');
      const err = $('#setupError');
      err.textContent = e.message;
      err.classList.remove('hidden');
    } else {
      show('resultsView');
      renderResults();
      toast(e.message);
    }
  } finally {
    state.searching = false;
  }
}

// ------------------------------------------------------------ results
const fmtDateTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function deadlineText(it) {
  const iso = it.deadline || it.endDate || it.startDate;
  if (!iso) return it.kind === 'announcement' ? { text: 'Dates: check the announcement', soon: false } : null;
  const ms = new Date(iso) - Date.now();
  const days = Math.floor(ms / 864e5);
  const when = fmtDate.format(new Date(iso));
  let rel;
  if (ms < 864e5) rel = 'today';
  else if (days === 1) rel = 'tomorrow';
  else rel = `in ${days} days`;
  const label = it.source === 'MLH' || it.source === 'Luma' || it.source === 'Hack Club' || it.source === 'Cerebral Valley' ? 'Starts' : 'Closes';
  return { text: `${label} ${rel} · ${when}`, soon: days < 3 };
}

// ------------------------------------------------------------ watchlist
const isWatched = (id) => !!state.results?.watchlist?.some((w) => w.id === id);

async function toggleWatch(it) {
  const r = state.results;
  if (!r) return;
  r.watchlist ||= [];
  const on = !isWatched(it.id);
  // Optimistic update, rolled back if the server says no.
  const before = r.watchlist;
  r.watchlist = on ? [{ ...it, watchedAt: new Date().toISOString(), closed: false }, ...before] : before.filter((w) => w.id !== it.id);
  rerender();
  try {
    await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ id: it.id, watched: on }) });
    toast(on ? 'Added to watchlist ★' : 'Removed from watchlist', 1800);
  } catch (e) {
    r.watchlist = before;
    rerender();
    toast(e.message);
  }
}

function rerender() {
  const y = window.scrollY;
  renderResults({ aiPending: !$('#aiBanner').classList.contains('hidden') });
  window.scrollTo({ top: y });
}

function card(it, prioByField) {
  const node = $('#cardTpl').content.firstElementChild.cloneNode(true);
  node.href = it.url;
  node.dataset.id = it.id;
  node.querySelector('.source').textContent = (it.sources && it.sources.length > 1 ? it.sources.slice(0, 2).join(' · ') : it.source) || '';
  node.querySelector('.badge-new').classList.toggle('hidden', !it.isNew);
  const wb = node.querySelector('.watch-btn');
  const setWatchUi = (on) => {
    wb.setAttribute('aria-pressed', String(on));
    wb.textContent = on ? '★ Watching' : '☆ Watch';
    wb.setAttribute('aria-label', on ? `Remove ${it.title} from watchlist` : `Add ${it.title} to watchlist`);
  };
  setWatchUi(isWatched(it.id));
  wb.addEventListener('click', (e) => {
    // The card is a link; keep the tap on the button.
    e.preventDefault();
    e.stopPropagation();
    toggleWatch(it);
  });
  if (it.closed) node.classList.add('closed');
  node.querySelector('.title').textContent = it.title;
  node.querySelector('.org').textContent = it.organizer || '';
  const meta = node.querySelector('.meta');
  const dl = deadlineText(it);
  const add = (text, cls) => { if (!text) return; const s = document.createElement('span'); s.textContent = text; if (cls) s.className = cls; meta.append(s); };
  if (dl) add(dl.text, 'deadline' + (dl.soon ? ' soon' : ''));
  add(it.online ? '🌐 Online' : it.location ? '📍 ' + it.location : null);
  add(it.prize && /\d/.test(it.prize) ? '🏆 ' + it.prize : null);
  add(it.participants ? `👥 ${Number(it.participants).toLocaleString()}` : null);
  const tags = node.querySelector('.tags');
  for (const f of it.matched || []) {
    const t = document.createElement('span');
    t.className = 'tag p-' + (prioByField[f.toLowerCase()] || 'low');
    t.textContent = f;
    tags.append(t);
  }
  if (it.closed) {
    const t = document.createElement('span');
    t.className = 'tag closed-tag';
    t.textContent = 'Closed';
    tags.append(t);
  }
  if (it.kind === 'announcement') {
    const t = document.createElement('span');
    t.className = 'tag unverified';
    t.textContent = it.source === 'LinkedIn' ? 'LinkedIn post' : 'Announcement';
    tags.append(t);
  }
  return node;
}

// ------------------------------------------------------------ sorting
// Rough rates so prizes in different currencies can be compared.
const FX = { $: 1, usd: 1, '€': 1.1, eur: 1.1, '£': 1.27, gbp: 1.27, '₹': 0.012, inr: 0.012, rs: 0.012, '¥': 0.007, jpy: 0.007, cad: 0.73, aud: 0.66, '₪': 0.27, ils: 0.27, nis: 0.27 };

/** "$138,000" → 138000, "€10k" → 11000, "₹1,00,000" → 1200, "$1.5M in prizes" → 1500000. */
export function prizeValue(prize) {
  if (!prize) return null;
  const s = String(prize).toLowerCase().replace(/\s+/g, ' ');
  const m = s.match(/(\$|€|£|₹|¥|₪|usd|eur|gbp|inr|rs\.?|jpy|cad|aud|ils|nis)?\s*([\d][\d,.]*)\s*(k|m|million|thousand)?\b\s*(usd|eur|gbp|inr|jpy|cad|aud|ils|nis)?/);
  if (!m) return null;
  let n = parseFloat(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (m[3] === 'k' || m[3] === 'thousand') n *= 1e3;
  if (m[3] === 'm' || m[3] === 'million') n *= 1e6;
  const cur = (m[1] || m[4] || '$').replace('.', '');
  return n * (FX[cur] ?? 1);
}

const closingTime = (it) => {
  const iso = it.deadline || it.endDate || it.startDate;
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

const SORTS = {
  best: null, // server order: priority of matched field, then relevance
  closing: (it) => closingTime(it),
  name: (it) => (it.title || '').toLocaleLowerCase(),
  prize: (it) => { const v = prizeValue(it.prize); return v == null ? null : -v; },
  participants: (it) => (it.participants ? -it.participants : null),
};
const SORT_LABELS = { best: '', closing: 'Closing', name: 'A–Z', prize: 'Prize', participants: 'People' };

/** Sorts a copy; items without a value for the chosen sort go last, in their previous order. */
function sortList(list) {
  const key = SORTS[state.sort];
  if (!key) return list;
  const withKey = list.map((it, i) => ({ it, i, k: key(it) }));
  withKey.sort((a, b) => {
    if (a.k == null && b.k == null) return a.i - b.i;
    if (a.k == null) return 1;
    if (b.k == null) return -1;
    if (typeof a.k === 'string') return a.k.localeCompare(b.k) || a.i - b.i;
    return a.k - b.k || a.i - b.i;
  });
  return withKey.map((x) => x.it);
}

function matchesQuery(it, q) {
  if (!q) return true;
  const hay = [it.title, it.organizer, it.location, it.source, ...(it.sources || []), ...(it.matched || []), ...(it.tags || []), it.description]
    .filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function renderSourcesInfo(r) {
  const box = $('#sourcesBox');
  const list = r.sources || [];
  box.classList.toggle('hidden', !list.length);
  if (!list.length) return;
  const failed = list.filter((s) => !s.ok);
  const ai = list.find((s) => s.id === 'ai');
  let summary = `Checked ${list.length} sources`;
  if (ai) summary += ai.ok ? ` · AI search found ${ai.count}` : ' · AI search failed';
  if (failed.length && !(failed.length === 1 && ai && !ai.ok)) summary += ` · ${failed.length} unavailable`;
  $('#sourcesSummary').textContent = summary;
  const ul = $('#sourcesDetail');
  ul.innerHTML = '';
  for (const s of list) {
    const li = document.createElement('li');
    li.textContent = s.ok ? `✓ ${s.name}: ${s.count}` : `✗ ${s.name}: ${s.error || 'unavailable'}`;
    if (!s.ok) li.className = 'bad';
    ul.append(li);
  }
}

function renderResults({ aiPending = false } = {}) {
  const r = state.results;
  if (!r) return;
  $('#searchedAt').textContent = r.searchedAt ? fmtDateTime.format(new Date(r.searchedAt)) : '—';
  const sch = state.config?.schedule;
  $('#nextRun').textContent = sch ? `Auto-search daily at ${sch.morning} and ${sch.afternoon} (${sch.tz})` : '';
  $('#aiBanner').classList.toggle('hidden', !aiPending);
  renderNotice();
  renderSourcesInfo(r);

  const fields = r.fields || state.fields;
  const prioByField = Object.fromEntries(fields.map((f) => [f.name.toLowerCase(), f.priority]));
  r.watchlist ||= [];
  const counts = { all: r.matches.length, other: r.suggestions.length, watch: r.watchlist.length, new: [...r.matches, ...r.suggestions].filter((i) => i.isNew).length };
  for (const f of fields) counts['f:' + f.name] = r.matches.filter((i) => i.matched.includes(f.name)).length;

  if (state.filter === 'new' && !counts.new) state.filter = 'all';
  if (state.filter.startsWith('f:') && !fields.some((f) => 'f:' + f.name === state.filter)) state.filter = 'all';
  const filters = $('#filters');
  filters.innerHTML = '';
  const chip = (key, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.filter === key));
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = counts[key] ?? 0;
    b.append(document.createTextNode(label), n);
    b.onclick = () => { state.filter = key; renderResults({ aiPending: !$('#aiBanner').classList.contains('hidden') }); };
    filters.append(b);
  };
  chip('all', 'Your fields');
  chip('watch', '★ Watchlist');
  if (counts.new) chip('new', 'New');
  for (const f of fields) chip('f:' + f.name, f.name);
  chip('other', 'Other fields');

  const box = $('#results');
  box.innerHTML = '';
  let list;
  if (state.filter === 'watch') list = r.watchlist;
  else if (state.filter === 'other') list = r.suggestions;
  else if (state.filter === 'new') list = [...r.matches, ...r.suggestions].filter((i) => i.isNew);
  else if (state.filter.startsWith('f:')) list = r.matches.filter((i) => i.matched.includes(state.filter.slice(2)));
  else list = r.matches;
  const q = state.query.trim();
  // On "Your fields", a search also looks through every other-field suggestion.
  if (q) list = (state.filter === 'all' ? [...r.matches, ...r.suggestions] : list).filter((it) => matchesQuery(it, q));
  list = sortList(list);
  $('#sortSelect').value = state.sort;
  $('#sortLabel').textContent = SORT_LABELS[state.sort] || '';
  document.querySelector('.sort-btn').classList.toggle('active', state.sort !== 'best');
  const info = $('#queryInfo');
  info.classList.toggle('hidden', !q);
  if (q) info.textContent = `${list.length} result${list.length === 1 ? '' : 's'} for “${q}”`;

  const frag = document.createDocumentFragment();
  list.forEach((it) => frag.append(card(it, prioByField)));
  box.append(frag);

  // On the main tab, follow matches with suggestions from other fields.
  if (!q && state.filter === 'all' && r.suggestions.length) {
    const h = document.createElement('div');
    h.className = 'group-title';
    h.textContent = 'Suggested from other fields';
    box.append(h);
    sortList(r.suggestions).slice(0, 12).forEach((it) => box.append(card(it, prioByField)));
  }
  const empty = $('#emptyState');
  empty.textContent = state.filter === 'watch' && !q
    ? 'Your watchlist is empty. Tap ☆ Watch on any hackathon to save it here.'
    : q
    ? `Nothing matches “${q}” right now. Try a shorter word, or another tab.`
    : state.filter.startsWith('f:')
    ? `No open ${state.filter.slice(2)} hackathons right now. This field is checked every morning and afternoon, and you'll get a notification when one appears.`
    : 'No open hackathons match these filters right now. New ones are checked every morning and afternoon.';
  empty.classList.toggle('hidden', list.length > 0 || (!q && state.filter === 'all' && r.suggestions.length > 0));
}

function applyDeepLink() {
  const params = new URLSearchParams(location.search);
  const open = params.get('open');
  if (params.get('watch') && state.results) {
    state.filter = 'watch';
    renderResults();
  }
  if (params.get('new') && state.results) {
    const anyNew = [...state.results.matches, ...state.results.suggestions].some((i) => i.isNew);
    state.filter = anyNew ? 'new' : 'all';
    renderResults();
  }
  if (open) {
    let el = document.querySelector(`.card[data-id="${CSS.escape(open)}"]`);
    if (!el && isWatched(open)) {
      state.filter = 'watch';
      renderResults();
      el = document.querySelector(`.card[data-id="${CSS.escape(open)}"]`);
    }
    if (el) { el.classList.add('highlight'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  if (open || params.get('new') || params.get('watch')) history.replaceState(null, '', '/');
}

// ------------------------------------------------------------ boot
async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'push') refreshResults();
      if (e.data?.type === 'resubscribe') enablePush({ quiet: true });
    });
  }
  try {
    state.config = await api('/api/config');
  } catch {
    state.config = { suggestedFields: [], defaultFields: [], sources: [] };
  }
  if (state.config.storage === 'missing') toast('Server storage is not configured yet. See the README setup steps.', 8000);

  let profile = null;
  try { profile = (await api('/api/profile')).profile; } catch { /* offline or first run */ }
  state.fields = profile?.fields?.length ? profile.fields.map((f) => ({ ...f })) : (state.config.defaultFields || []).map((f) => ({ ...f }));
  renderFields();
  renderNotice();

  if (profile?.firstSearchAt) {
    try {
      state.results = await api('/api/hackathons');
      renderResults();
      show('resultsView');
      applyDeepLink();
      // Keep the push subscription fresh (browsers rotate them).
      if (pushSupported && Notification.permission === 'granted') enablePush({ quiet: true });
      return;
    } catch { /* fall through to setup */ }
  }
  show('setupView');
}

async function refreshResults() {
  try {
    state.results = await api('/api/hackathons');
    renderResults();
  } catch { /* ignore */ }
}

$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  addField($('#addInput').value);
  $('#addInput').value = '';
});
$('#searchBtn').addEventListener('click', runSearch);
$('#queryInput').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderResults({ aiPending: !$('#aiBanner').classList.contains('hidden') });
});
$('#sortSelect').addEventListener('change', (e) => {
  state.sort = e.target.value;
  try { localStorage.setItem('hf-sort', state.sort); } catch { /* private mode */ }
  renderResults({ aiPending: !$('#aiBanner').classList.contains('hidden') });
});
$('#queryInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#refreshBtn').addEventListener('click', runSearch);
$('#editBtn').addEventListener('click', () => {
  if (state.results?.fields) state.fields = state.results.fields.map((f) => ({ ...f }));
  renderFields();
  show('setupView');
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.results && !state.searching) refreshResults();
});

boot();
