import { json, error, deviceId } from '../lib/http.js';
import { getProfile, getResults } from '../lib/jobs.js';

export async function GET(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  const profile = await getProfile(id);
  if (!profile) return error(404, 'No profile yet');
  return json(await getResults(profile));
}
