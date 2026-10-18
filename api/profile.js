import { json, error, readJson, deviceId } from '../lib/http.js';
import { getProfile, upsertProfile, deleteProfile } from '../lib/jobs.js';
import { sanitizeFields, libraryEntry } from '../lib/fields.js';
import { aiEnabled, expandField } from '../lib/ai.js';
import { isValidTimeZone } from '../lib/util.js';

const publicProfile = (p) => p && { id: p.id, fields: p.fields, tz: p.tz, lastSearchAt: p.lastSearchAt || null, firstSearchAt: p.firstSearchAt || null, pushEnabled: !!p.subscription };

export async function GET(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  return json({ profile: publicProfile(await getProfile(id)) });
}

export async function PUT(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  const body = await readJson(request);
  if (!body) return error(400, 'Invalid JSON');
  const fields = sanitizeFields(body.fields);
  if (!fields || !fields.length) return error(400, 'Add at least one field');

  // Teach the matcher about custom fields (e.g. "Music") once, using AI when available.
  const prev = await getProfile(id);
  const prevKw = Object.fromEntries((prev?.fields || []).map((f) => [f.name.toLowerCase(), f.keywords]));
  await Promise.all(fields.map(async (f) => {
    if (libraryEntry(f.name)) return;
    if (prevKw[f.name.toLowerCase()]?.length) { f.keywords = prevKw[f.name.toLowerCase()]; return; }
    if (!aiEnabled()) return;
    try {
      f.keywords = await Promise.race([expandField(f.name), new Promise((r) => setTimeout(() => r([]), 20_000))]);
    } catch { /* matching still works on the field's own words */ }
  }));

  const patch = { fields };
  if (isValidTimeZone(body.tz)) patch.tz = body.tz;
  return json({ profile: publicProfile(await upsertProfile(id, patch)) });
}

export async function DELETE(request) {
  const id = deviceId(request);
  if (!id) return error(400, 'Missing device id');
  await deleteProfile(id);
  return json({ ok: true });
}
