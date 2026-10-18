import { json, error, readJson, cronAuthorized } from '../lib/http.js';
import { allProfiles, unionFields } from '../lib/jobs.js';
import { fieldQueries, DEFAULT_FIELDS } from '../lib/fields.js';
import { ddgQueries } from '../lib/sources/index.js';
import { getStore } from '../lib/store.js';

/**
 * Web search results gathered outside Vercel (GitHub Actions runs the
 * DuckDuckGo queries, since search engines often block Vercel's servers).
 *   GET  → { queries }  what to search for, from everyone's fields
 *   POST { items }      store results; the next search run picks them up
 * Both need "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(request) {
  if (!cronAuthorized(request)) return error(401, 'Unauthorized');
  const profiles = await allProfiles();
  const fields = profiles.length ? unionFields(profiles) : DEFAULT_FIELDS;
  const all = ddgQueries(fieldQueries(fields));
  // Rotate so each run continues where the last one stopped (search engines
  // only allow a few queries per run).
  const start = Number((await getStore().get('ingest:cursor')) || 0) % all.length;
  return json({ queries: [...all.slice(start), ...all.slice(0, start)], total: all.length });
}

const KEEP_DAYS = 7;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function sanitizeIngested(items, now = new Date()) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items.slice(0, 400)) {
    const url = str(it?.url, 1000);
    const title = str(it?.title, 200);
    if (!title || !/^https?:\/\//.test(url)) continue;
    out.push({
      title, url,
      source: /linkedin\.com/.test(url) ? 'LinkedIn' : 'Web',
      organizer: str(it.organizer, 100) || null,
      description: str(it.description, 400),
      image: null, startDate: null, endDate: null, deadline: null, location: null, online: null,
      prize: null, participants: null, tags: [], kind: 'announcement',
      publishedAt: now.toISOString(),
    });
  }
  return out;
}

export async function POST(request) {
  if (!cronAuthorized(request)) return error(401, 'Unauthorized');
  const body = await readJson(request);
  if (!body) return error(400, 'Invalid JSON');
  const store = getStore();
  const now = new Date();
  const fresh = sanitizeIngested(body.items, now);
  // Merge with earlier runs (by URL), keeping each result for KEEP_DAYS.
  const prev = (await store.get('ingest:web'))?.items || [];
  const byUrl = new Map(prev.filter((it) => now - new Date(it.publishedAt) < KEEP_DAYS * 864e5).map((it) => [it.url, it]));
  for (const it of fresh) byUrl.set(it.url, { ...(byUrl.get(it.url) || {}), ...it });
  const items = [...byUrl.values()].slice(-600);
  await store.set('ingest:web', { at: now.toISOString(), items }, { ttlSec: (KEEP_DAYS + 1) * 86400 });
  const done = Math.max(0, Number(body.queries) || 0);
  const total = Math.max(1, Number(body.total) || 1);
  const cursor = (Number((await store.get('ingest:cursor')) || 0) + done) % total;
  await store.set('ingest:cursor', cursor);
  return json({ ok: true, stored: fresh.length, kept: items.length, nextQuery: cursor });
}
