import { json, error, readJson, deviceId } from '../lib/http.js';
import { getProfile, setWatched } from '../lib/jobs.js';

/** POST { id, watched: true|false } → add to / remove from this device's watchlist. */
export async function POST(request) {
  const dev = deviceId(request);
  if (!dev) return error(400, 'Missing device id');
  const body = await readJson(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!/^[0-9a-f]{16}$/.test(id)) return error(400, 'Invalid hackathon id');
  const profile = await getProfile(dev);
  if (!profile) return error(404, 'No profile yet');
  const res = await setWatched(profile, id, body.watched !== false);
  return res.ok ? json(res) : error(404, res.error);
}
