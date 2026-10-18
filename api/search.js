import { error, deviceId, readJson } from '../lib/http.js';
import { getProfile, upsertProfile, runSearch, getResults, buildResults } from '../lib/jobs.js';
import { getStore } from '../lib/store.js';
import { isValidTimeZone } from '../lib/util.js';

const COOLDOWN_MS = 3 * 60_000;

/**
 * Runs a search for one device and streams progress as NDJSON lines:
 *   {type:"source", id, name, status, count?}
 *   {type:"partial", results}   platform results while AI search continues
 *   {type:"done", results}
 *   {type:"error", message}
 */
export async function POST(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  const body = (await readJson(request)) || {};
  let profile = await getProfile(id);
  if (!profile) return error(404, 'Save your fields first');
  if (isValidTimeZone(body.tz) && body.tz !== profile.tz) profile = await upsertProfile(id, { tz: body.tz });

  const last = profile.lastManualAt ? Date.now() - new Date(profile.lastManualAt).getTime() : Infinity;
  if (profile.firstSearchAt && last < COOLDOWN_MS) {
    return error(429, `Please wait ${Math.ceil((COOLDOWN_MS - last) / 60_000)} min before searching again`);
  }
  if (!(await getStore().setNX(`manual:${id}`, 1, { ttlSec: 300 }))) return error(409, 'A search is already running');
  profile = await upsertProfile(id, { lastManualAt: new Date().toISOString() });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(enc.encode(JSON.stringify(obj) + '\n')); } catch { /* client left */ } };
      const ping = setInterval(() => send({ type: 'ping' }), 15_000);
      try {
        await runSearch({
          profiles: [profile],
          notifyUsers: false,
          onProgress: send,
          onPlatformResults: (items) => {
            const catalog = Object.fromEntries(items.map((i) => [i.id, i]));
            send({ type: 'partial', results: { ...buildResults(profile, catalog), searchedAt: new Date().toISOString() } });
          },
        });
        send({ type: 'done', results: await getResults(await getProfile(id)) });
      } catch (e) {
        console.error('search failed', e);
        send({ type: 'error', message: 'Search failed. Please try again.' });
      } finally {
        clearInterval(ping);
        await getStore().del(`manual:${id}`).catch(() => {});
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
