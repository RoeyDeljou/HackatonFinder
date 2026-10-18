import { DEVICE_RE } from './jobs.js';

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const error = (status, message) => json({ error: message }, status);

export async function readJson(request) {
  try {
    const text = await request.text();
    if (text.length > 64_000) return null;
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

/** Device id from the x-device-id header or ?device= query param. */
export function deviceId(request) {
  const id = request.headers.get('x-device-id') || new URL(request.url).searchParams.get('device');
  return id && DEVICE_RE.test(id) ? id : null;
}

/** Cron endpoints: Vercel sends "Authorization: Bearer $CRON_SECRET". */
export function cronAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !process.env.VERCEL; // allow locally when unset
  const auth = request.headers.get('authorization') || '';
  const q = new URL(request.url).searchParams.get('key');
  return auth === `Bearer ${secret}` || q === secret;
}
