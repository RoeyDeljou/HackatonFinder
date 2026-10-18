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
  return json({ queries: ddgQueries(fieldQueries(fields)) });
}

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
  const items = sanitizeIngested(body.items);
  await getStore().set('ingest:web', { at: new Date().toISOString(), queries: Number(body.queries) || 0, items }, { ttlSec: 3 * 86400 });
  return json({ ok: true, stored: items.length });
}
