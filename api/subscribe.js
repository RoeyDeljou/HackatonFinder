import { json, error, readJson, deviceId } from '../lib/http.js';
import { upsertProfile } from '../lib/jobs.js';

function validSubscription(sub) {
  return sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 2000 &&
    sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
}

export async function POST(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  const body = await readJson(request);
  if (!validSubscription(body?.subscription)) return error(400, 'Invalid push subscription');
  const { endpoint, keys } = body.subscription;
  await upsertProfile(id, { subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, ...(body.tz ? { tz: body.tz } : {}) });
  return json({ ok: true });
}

export async function DELETE(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  await upsertProfile(id, { subscription: null });
  return json({ ok: true });
}
