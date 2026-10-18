import { json, error, deviceId } from '../lib/http.js';
import { getProfile, testPush } from '../lib/jobs.js';

export async function POST(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  const profile = await getProfile(id);
  if (!profile?.subscription) return error(400, 'Notifications are not enabled on this device');
  return json({ result: await testPush(profile) });
}
