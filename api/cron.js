import { json, error, cronAuthorized } from '../lib/http.js';
import { scheduledSearch, dailyDigest } from '../lib/jobs.js';
import { inWindow, SLOTS, SCHEDULE_TZ } from '../lib/schedule.js';

/**
 * Called by Vercel Cron (see vercel.json) and by the GitHub Actions backup:
 *   /api/cron?job=search&slot=morning|afternoon
 *   /api/cron?job=digest
 * Each job is triggered at two UTC hours (summer and winter time); it only runs
 * inside its local-time window (SLOTS in lib/schedule.js). Add &force=1 to
 * run it right now regardless of the time.
 */
export async function GET(request) {
  if (!cronAuthorized(request)) return error(401, 'Unauthorized');
  const url = new URL(request.url);
  const job = url.searchParams.get('job');
  const force = url.searchParams.get('force') === '1';
  try {
    if (job === 'search') {
      const slot = url.searchParams.get('slot') === 'afternoon' ? 'afternoon' : 'morning';
      if (!force && !inWindow(slot)) return json({ job, slot, skipped: `outside ${SLOTS[slot].at} ${SCHEDULE_TZ} window` });
      const summary = await scheduledSearch({ slot });
      return json({ job, slot, ...summary, perProfile: undefined, profiles: summary.perProfile ? Object.keys(summary.perProfile).length : 0 });
    }
    if (job === 'digest') {
      if (!force && !inWindow('digest')) return json({ job, skipped: `outside ${SLOTS.digest.at} ${SCHEDULE_TZ} window` });
      return json({ job, result: await dailyDigest() });
    }
    return error(400, 'Unknown job');
  } catch (e) {
    console.error('cron failed', e);
    return error(500, String(e.message || e));
  }
}
