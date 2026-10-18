import { getStore } from './store.js';
import { collect, mergeCatalog, isActive } from './engine.js';
import { matchFields, otherFieldsFor, relevance, PRIORITIES, DEFAULT_FIELDS } from './fields.js';
import { sendPush } from './push.js';
import { dateKey, isValidTimeZone } from './util.js';
import { SCHEDULE_TZ } from './schedule.js';
import { deriveFormat, placeOf } from './format.js';

export const NO_NEW_TEXT = 'No new Hackathons were found today';
const MAX_SUGGESTIONS = 40;
const DAY = 86400;

// ------------------------------------------------------------ profiles
export const DEVICE_RE = /^[a-zA-Z0-9_-]{16,64}$/;

export async function getProfile(id) {
  return getStore().get(`profile:${id}`);
}

export async function saveProfile(profile) {
  const s = getStore();
  await s.set(`profile:${profile.id}`, profile);
  await s.sadd('devices', [profile.id]);
  return profile;
}

export async function upsertProfile(id, patch) {
  const prev = (await getProfile(id)) || { id, fields: DEFAULT_FIELDS, tz: 'UTC', createdAt: new Date().toISOString() };
  const next = { ...prev, ...patch, id };
  if (!isValidTimeZone(next.tz)) next.tz = 'UTC';
  return saveProfile(next);
}

export async function deleteProfile(id) {
  const s = getStore();
  await s.del(`profile:${id}`);
  await s.del(`found:${id}`);
  await s.del(`watch:${id}`);
  await s.srem('devices', [id]);
}

export async function allProfiles() {
  const ids = await getStore().smembers('devices');
  const profiles = await Promise.all(ids.map(getProfile));
  return profiles.filter(Boolean);
}

/** Union of everyone's fields, keeping the highest priority per field. */
export function unionFields(profiles) {
  const map = new Map();
  for (const p of profiles) {
    for (const f of p.fields || []) {
      const key = f.name.toLowerCase();
      const prev = map.get(key);
      if (!prev) map.set(key, { ...f, keywords: [...(f.keywords || [])] });
      else {
        if (PRIORITIES[f.priority] > PRIORITIES[prev.priority]) prev.priority = f.priority;
        prev.keywords = [...new Set([...prev.keywords, ...(f.keywords || [])])];
      }
    }
  }
  return [...map.values()];
}

// ------------------------------------------------------------ results view
function present(it, extra) {
  const { aiFields, aliasIds, ...rest } = it;
  return { ...rest, format: deriveFormat(it), place: placeOf(it), ...extra };
}

/** Splits the catalog into the user's matches and suggestions from other fields. */
export function buildResults(profile, catalog, found = {}, now = Date.now()) {
  const fields = profile.fields || [];
  const firstSearch = profile.firstSearchAt ? new Date(profile.firstSearchAt).getTime() : now;
  const isNew = (it) => {
    const t = found[it.id] ? new Date(found[it.id]).getTime() : now;
    // "New" = first shown to this user after their first search, within the last 36h.
    return t > firstSearch + 60_000 && now - t < 36 * 3600_000;
  };
  const matches = [];
  const suggestions = [];
  for (const it of Object.values(catalog)) {
    if (!isActive(it, now)) continue;
    const m = matchFields(it, fields);
    if (m.length) {
      matches.push(present(it, { matched: m.map((x) => x.name), score: relevance(it, m, now), isNew: isNew(it) }));
    } else {
      const other = otherFieldsFor(it, fields);
      const pseudo = other.length ? [{ name: other[0], priority: 'low', score: 2 }] : [];
      suggestions.push(present(it, { matched: other.slice(0, 2), score: relevance(it, pseudo, now), isNew: isNew(it) }));
    }
  }
  const byScore = (a, b) => b.score - a.score || (a.deadline || '9').localeCompare(b.deadline || '9');
  matches.sort(byScore);
  suggestions.sort(byScore);
  return {
    searchedAt: profile.lastSearchAt || null,
    fields,
    matches,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
  };
}

export async function getResults(profile) {
  const s = getStore();
  const [catalog, found, lastrun, watch] = await Promise.all([s.hgetall('catalog'), s.hgetall(`found:${profile.id}`), s.get('lastrun'), s.hgetall(`watch:${profile.id}`)]);
  const results = buildResults(profile, catalog, found);
  return { ...results, watchlist: buildWatchlist(watch, catalog, results), sources: sourceSummary(lastrun?.stats) };
}

// ------------------------------------------------------------ watchlist
const MAX_WATCH = 200;

/**
 * Watched items, newest first. Uses the live catalog entry when it still
 * exists (fresh dates), otherwise the saved snapshot marked closed.
 */
export function buildWatchlist(watch = {}, catalog = {}, results = { matches: [], suggestions: [] }, now = Date.now()) {
  const shown = new Map([...results.matches, ...results.suggestions].map((it) => [it.id, it]));
  return Object.entries(watch)
    .sort((a, b) => String(b[1].addedAt).localeCompare(String(a[1].addedAt)))
    .map(([id, w]) => {
      const live = shown.get(id) || (catalog[id] && present(catalog[id], { matched: [] }));
      const item = live || present(w.item || {}, { matched: w.item?.matched || [] });
      return { ...item, id, watchedAt: w.addedAt, closed: !live || !isActive(item, now) };
    });
}

export async function setWatched(profile, id, on) {
  const s = getStore();
  if (!on) {
    await s.hdel(`watch:${profile.id}`, [id]);
    return { ok: true, watched: false };
  }
  const current = await s.hgetall(`watch:${profile.id}`);
  if (!current[id] && Object.keys(current).length >= MAX_WATCH) return { ok: false, error: `Watchlist is full (${MAX_WATCH})` };
  const catalog = await s.hgetall('catalog');
  const it = catalog[id];
  if (!it && !current[id]) return { ok: false, error: 'This hackathon is no longer listed' };
  // Keep a snapshot so the item stays visible after it closes or leaves the catalog.
  const match = it ? matchFields(it, profile.fields || []).map((m) => m.name) : undefined;
  const item = it ? present(it, { matched: match.length ? match : otherFieldsFor(it, profile.fields || []).slice(0, 2) }) : current[id].item;
  await s.hset(`watch:${profile.id}`, { [id]: { addedAt: current[id]?.addedAt || new Date().toISOString(), item } });
  return { ok: true, watched: true };
}

/** Per-source results of the latest run, for the "Sources checked" line in the app. */
export function sourceSummary(stats) {
  if (!stats) return [];
  return Object.entries(stats).map(([id, st]) => ({ id, name: st.name, ok: !!st.ok, count: st.count ?? 0, ...(st.ok ? {} : { error: String(st.error || '').slice(0, 140) }) }));
}

// ------------------------------------------------------------ notifications
function newHackathonsPayload(items) {
  const n = items.length;
  const top = items.slice(0, 3).map((i) => i.title).join(' • ');
  return {
    title: n === 1 ? 'New hackathon found 🎯' : `${n} new hackathons found 🎯`,
    body: n > 3 ? `${top} and ${n - 3} more` : top,
    url: n === 1 ? `/?open=${encodeURIComponent(items[0].id)}` : '/?new=1',
    tag: 'hf-new',
  };
}

async function notify(profile, payload) {
  if (!profile.subscription) return 'no-subscription';
  const res = await sendPush(profile.subscription, payload);
  if (res === 'gone') {
    const fresh = await getProfile(profile.id);
    if (fresh) await saveProfile({ ...fresh, subscription: null });
  }
  return res;
}

// ------------------------------------------------------------ search runs
/**
 * Runs a search for the given profiles, updates the shared catalog, records
 * which hackathons are new for each profile and (optionally) pushes.
 */
export async function runSearch({ profiles, notifyUsers = false, onProgress, onPlatformResults, collectOpts = {}, now = new Date() }) {
  const s = getStore();
  const fields = unionFields(profiles);
  const { items, stats } = await collect({ fields, onProgress, onPlatformResults, now, ...collectOpts });

  const healthy = new Set(Object.values(stats).filter((x) => x.ok).map((x) => x.name));
  const existing = await s.hgetall('catalog');
  const { catalog, upserts, removed } = mergeCatalog(existing, items, { now: now.getTime(), healthySources: healthy });
  if (Object.keys(upserts).length) await s.hset('catalog', upserts);
  if (removed.length) await s.hdel('catalog', removed);

  const perProfile = {};
  for (const p0 of profiles) {
    const p = (await getProfile(p0.id)) || p0;
    const firstRun = !p.firstSearchAt;
    if (firstRun) p.firstSearchAt = now.toISOString();
    const found = await s.hgetall(`found:${p.id}`);
    const results = buildResults(p, catalog, found, now.getTime());
    const shown = [...results.matches, ...results.suggestions];
    const known = (it) => found[it.id] || (catalog[it.id]?.aliasIds || []).some((a) => found[a]);
    const newMatches = results.matches.filter((it) => !known(it));
    const additions = {};
    for (const it of shown) if (!found[it.id]) additions[it.id] = now.toISOString();
    if (Object.keys(additions).length) await s.hset(`found:${p.id}`, additions);
    const stale = Object.keys(found).filter((id) => !catalog[id]);
    if (stale.length) await s.hdel(`found:${p.id}`, stale);

    const day = dateKey(now, p.tz);
    await s.incr(`daily:${p.id}:${day}`, newMatches.length, { ttlSec: 3 * DAY });

    let pushed = null;
    if (notifyUsers && !firstRun && newMatches.length) pushed = await notify(p, newHackathonsPayload(newMatches));

    // Re-read so edits the user made while this run was in flight are kept.
    const latest = (await getProfile(p.id)) || p;
    await saveProfile({
      ...latest,
      firstSearchAt: latest.firstSearchAt || p.firstSearchAt,
      subscription: pushed === 'gone' ? null : latest.subscription,
      lastSearchAt: now.toISOString(),
      lastRun: { at: now.toISOString(), newCount: newMatches.length, pushed },
    });
    perProfile[p.id] = { newCount: newMatches.length, matches: results.matches.length, pushed };
  }

  const summary = { at: now.toISOString(), total: items.length, catalogSize: Object.keys(catalog).length, removed: removed.length, stats, perProfile };
  await s.set('lastrun', summary);
  return summary;
}

/**
 * Scheduled search with an idempotency lock so the Vercel cron and the
 * GitHub Actions backup never double-run the same slot.
 */
export async function scheduledSearch({ slot, now = new Date(), collectOpts } = {}) {
  const s = getStore();
  const key = `lock:${slot}:${dateKey(now, SCHEDULE_TZ)}`;
  const lock = await s.get(key);
  if (lock?.state === 'done') return { skipped: 'already ran', lock };
  if (lock?.state === 'running' && now - new Date(lock.at) < 10 * 60_000) return { skipped: 'running', lock };
  await s.set(key, { state: 'running', at: now.toISOString() }, { ttlSec: DAY });
  const profiles = await allProfiles();
  const active = profiles.filter((p) => p.firstSearchAt);
  if (!active.length) {
    await s.set(key, { state: 'done', at: now.toISOString(), profiles: 0 }, { ttlSec: DAY });
    return { skipped: 'no profiles' };
  }
  const summary = await runSearch({ profiles: active, notifyUsers: true, now, collectOpts });
  try {
    summary.watchReminders = await watchReminders({ now });
  } catch (e) {
    console.error('watch reminders failed', e);
  }
  await s.set(key, { state: 'done', at: new Date().toISOString(), total: summary.total }, { ttlSec: DAY });
  return summary;
}

// ------------------------------------------------------------ watchlist reminders
// Two reminders per watched hackathon: ~3 days before it closes, and on its last day.
export const REMIND_STAGES = [
  { key: 'lastDay', maxHours: 30 },
  { key: '3days', maxHours: 84 },
];

const closingAt = (it) => {
  const iso = it?.deadline || it?.endDate || it?.startDate;
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

function whenText(hoursLeft) {
  if (hoursLeft < 12) return 'closes in a few hours';
  if (hoursLeft < 30) return 'closes tomorrow';
  return `closes in ${Math.round(hoursLeft / 24)} days`;
}

/** Sends closing-soon pushes for watchlist items; each stage is sent once per item. */
export async function watchReminders({ now = new Date() } = {}) {
  const s = getStore();
  const catalog = await s.hgetall('catalog');
  const out = {};
  for (const p of await allProfiles()) {
    if (!p.subscription) continue;
    const watch = await s.hgetall(`watch:${p.id}`);
    const due = [];
    const updates = {};
    for (const [id, w] of Object.entries(watch)) {
      const it = catalog[id] || w.item;
      const close = closingAt(it);
      if (!close || close <= now.getTime()) continue;
      const hoursLeft = (close - now.getTime()) / 3600_000;
      // The tightest stage that applies; sending it also covers the earlier, wider one.
      const stage = REMIND_STAGES.find((st) => hoursLeft <= st.maxHours);
      if (!stage || w.reminded?.[stage.key]) continue;
      const reminded = { ...(w.reminded || {}) };
      for (const st of REMIND_STAGES) if (st.maxHours >= stage.maxHours) reminded[st.key] = now.toISOString();
      updates[id] = { ...w, reminded };
      due.push({ id, title: it.title, hoursLeft });
    }
    if (!due.length) continue;
    due.sort((a, b) => a.hoursLeft - b.hoursLeft);
    const payload = due.length === 1
      ? { title: '⏰ Watchlist: closing soon', body: `${due[0].title} ${whenText(due[0].hoursLeft)}`, url: `/?open=${encodeURIComponent(due[0].id)}`, tag: 'hf-watch' }
      : { title: `⏰ ${due.length} watchlist hackathons close soon`, body: due.slice(0, 3).map((d) => `${d.title} (${whenText(d.hoursLeft).replace('closes ', '')})`).join(' • '), url: '/?watch=1', tag: 'hf-watch' };
    const res = await notify(p, payload);
    // Only mark as reminded if the push went out (or there's no way to deliver it).
    if (res === 'sent' || res === 'gone' || res === 'disabled') await s.hset(`watch:${p.id}`, updates);
    out[p.id] = { sent: due.length, result: res };
  }
  return out;
}

/** End-of-day push to everyone who got no new hackathons today. */
export async function dailyDigest({ now = new Date() } = {}) {
  const s = getStore();
  const out = {};
  for (const p of await allProfiles()) {
    if (!p.firstSearchAt || !p.subscription) continue;
    const day = dateKey(now, p.tz);
    if (!(await s.setNX(`digest:${p.id}:${day}`, 1, { ttlSec: 2 * DAY }))) { out[p.id] = 'already sent'; continue; }
    const count = Number((await s.get(`daily:${p.id}:${day}`)) || 0);
    out[p.id] = count > 0 ? `found ${count}, no digest needed` : await notify(p, { title: 'Hackathon Finder', body: NO_NEW_TEXT, url: '/', tag: 'hf-digest' });
  }
  return out;
}

export async function testPush(profile) {
  return notify(profile, { title: 'Notifications are on ✅', body: 'You will get an alert when new hackathons are found.', url: '/', tag: 'hf-test' });
}

