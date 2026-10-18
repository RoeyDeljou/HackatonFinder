import { SOURCES } from './sources/index.js';
import { fieldQueries } from './fields.js';
import { hashId, normalizeUrl, normalizeTitle } from './util.js';
import * as ai from './ai.js';

const SOURCE_TIMEOUT_MS = 45_000;
const ANNOUNCEMENT_TTL_DAYS = 21;
const UNDATED_TTL_DAYS = 30;
// A platform listing that vanished from its source for this long is treated as closed.
const VANISHED_DAYS = 3;

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

export function itemKey(it) {
  const u = normalizeUrl(it.url);
  return hashId(u || normalizeTitle(it.title));
}

/** Is registration (or the event itself) still open at `now`? */
export function isActive(it, now = Date.now()) {
  const t = (s) => (s ? new Date(s).getTime() : null);
  if (it.kind === 'announcement') {
    const pub = t(it.publishedAt) ?? t(it.firstSeenAt) ?? now;
    const close = t(it.deadline);
    return close ? close > now : now - pub < ANNOUNCEMENT_TTL_DAYS * 864e5;
  }
  const close = t(it.deadline) ?? t(it.endDate) ?? t(it.startDate);
  if (close) return close > now;
  const seen = t(it.firstSeenAt) ?? now;
  return now - seen < UNDATED_TTL_DAYS * 864e5;
}

function mergeInto(a, b) {
  const pick = (x, y) => (x == null || x === '' ? y : x);
  // A dated platform listing beats an undated announcement.
  const [primary, other] = a.kind === 'announcement' && b.kind !== 'announcement' ? [b, a] : [a, b];
  const out = { ...primary };
  for (const k of ['organizer', 'description', 'image', 'startDate', 'endDate', 'deadline', 'location', 'online', 'prize', 'participants', 'evidence']) {
    out[k] = pick(primary[k], other[k]);
  }
  out.tags = [...new Set([...(primary.tags || []), ...(other.tags || [])])];
  out.aiFields = [...new Set([...(primary.aiFields || []), ...(other.aiFields || [])])];
  out.sources = [...new Set([...(primary.sources || [primary.source]), ...(other.sources || [other.source])])];
  return out;
}

/** Merges duplicates found on several sources (same URL, or same long title). */
export function dedupe(items) {
  const byUrl = new Map();
  const byTitle = new Map();
  const out = [];
  for (const raw of items) {
    if (!raw?.title || !raw?.url) continue;
    const it = { ...raw, sources: raw.sources || [raw.source] };
    const u = normalizeUrl(it.url);
    const t = normalizeTitle(it.title);
    const titleKey = t.length >= 12 ? t : null;
    const existingIdx = byUrl.get(u) ?? (titleKey ? byTitle.get(titleKey) : undefined);
    if (existingIdx !== undefined) {
      out[existingIdx] = mergeInto(out[existingIdx], it);
      byUrl.set(normalizeUrl(out[existingIdx].url), existingIdx);
      continue;
    }
    const idx = out.push(it) - 1;
    byUrl.set(u, idx);
    if (titleKey) byTitle.set(titleKey, idx);
  }
  return out.map((it) => ({ ...it, id: itemKey(it) }));
}

/**
 * Runs every source (and AI discovery when enabled) and returns active,
 * de-duplicated items.
 * @param {object} o
 * @param {Array} o.fields  union of fields to search for
 * @param {(e:object)=>void} [o.onProgress]
 * @param {Array} [o.sources] override for tests
 * @param {boolean} [o.useAi]
 * @param {Function} [o.aiDiscover] override for tests
 * @param {(items:Array)=>void} [o.onPlatformResults] called before AI starts
 */
export async function collect({ fields, onProgress = () => {}, sources = SOURCES, useAi = ai.aiEnabled(), aiDiscover = ai.discover, onPlatformResults, aiTimeoutMs = Number(process.env.AI_TIMEOUT_MS) || 180_000, now = new Date() }) {
  const ctx = { queries: fieldQueries(fields), now };
  const stats = {};
  const results = await Promise.all(
    sources.map(async (s) => {
      onProgress({ type: 'source', id: s.id, name: s.name, status: 'running' });
      const t0 = Date.now();
      try {
        const items = await withTimeout(s.fetch(ctx), SOURCE_TIMEOUT_MS, s.name);
        stats[s.id] = { name: s.name, ok: true, count: items.length, ms: Date.now() - t0 };
        onProgress({ type: 'source', id: s.id, name: s.name, status: 'done', count: items.length });
        return items;
      } catch (e) {
        stats[s.id] = { name: s.name, ok: false, error: String(e.message || e).slice(0, 200), ms: Date.now() - t0 };
        onProgress({ type: 'source', id: s.id, name: s.name, status: 'error' });
        return [];
      }
    }),
  );
  let items = dedupe(results.flat()).filter((it) => isActive(it, now.getTime()));
  onPlatformResults?.(items);

  if (useAi) {
    onProgress({ type: 'source', id: 'ai', name: 'AI web search (LinkedIn, companies, news)', status: 'running' });
    const t0 = Date.now();
    try {
      const leads = items.filter((i) => i.kind === 'announcement').slice(0, 20);
      const knownTitles = items.filter((i) => i.kind !== 'announcement').map((i) => i.title);
      const found = await withTimeout(aiDiscover({ fields, leads, knownTitles, now }), aiTimeoutMs, 'AI search');
      stats.ai = { name: 'AI web search', ok: true, count: found.length, ms: Date.now() - t0 };
      onProgress({ type: 'source', id: 'ai', name: 'AI web search (LinkedIn, companies, news)', status: 'done', count: found.length });
      items = dedupe([...items, ...found]).filter((it) => isActive(it, now.getTime()));
    } catch (e) {
      stats.ai = { name: 'AI web search', ok: false, error: String(e.message || e).slice(0, 200), ms: Date.now() - t0 };
      onProgress({ type: 'source', id: 'ai', name: 'AI web search (LinkedIn, companies, news)', status: 'error' });
    }
  }
  return { items, stats };
}

/**
 * Merges fresh results into the stored catalog and prunes finished entries.
 * Returns { catalog, upserts, removed }.
 */
export function mergeCatalog(existing, fresh, { now = Date.now(), healthySources = null } = {}) {
  const iso = new Date(now).toISOString();
  const catalog = { ...existing };
  const upserts = {};
  const removed = [];
  const byTitle = new Map();
  for (const [id, it] of Object.entries(catalog)) {
    const t = normalizeTitle(it.title);
    if (t.length >= 12) byTitle.set(t, id);
  }
  for (const it of fresh) {
    let prev = catalog[it.id];
    if (!prev) {
      // Same hackathon stored under another id (e.g. first seen as a news item).
      const t = normalizeTitle(it.title);
      const oldId = t.length >= 12 ? byTitle.get(t) : undefined;
      if (oldId && oldId !== it.id && catalog[oldId]) {
        prev = catalog[oldId];
        delete catalog[oldId];
        delete upserts[oldId];
        removed.push(oldId);
        it.aliasIds = [...new Set([...(prev.aliasIds || []), oldId])];
      }
    }
    const merged = prev
      ? { ...mergeInto(it, prev), id: it.id, aliasIds: it.aliasIds || prev.aliasIds, firstSeenAt: prev.firstSeenAt, lastSeenAt: iso }
      : { ...it, firstSeenAt: iso, lastSeenAt: iso };
    catalog[it.id] = merged;
    upserts[it.id] = merged;
    const t = normalizeTitle(it.title);
    if (t.length >= 12) byTitle.set(t, it.id);
  }
  for (const [id, it] of Object.entries(catalog)) {
    const lastSeen = new Date(it.lastSeenAt || it.firstSeenAt || iso).getTime();
    // Only treat "vanished" as closed if every source it came from ran fine this time.
    const fromHealthy = !healthySources || (it.sources || [it.source]).every((s) => healthySources.has(s));
    const vanished = it.source !== 'AI web search' && it.kind !== 'announcement' && fromHealthy && now - lastSeen > VANISHED_DAYS * 864e5;
    if (!isActive(it, now) || vanished) {
      removed.push(id);
      delete catalog[id];
      delete upserts[id];
    }
  }
  return { catalog, upserts, removed };
}
