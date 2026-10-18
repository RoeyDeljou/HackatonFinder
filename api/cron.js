import { json, error, cronAuthorized } from '../lib/http.js';
import { scheduledSearch, dailyDigest } from '../lib/jobs.js';

/**
 * Called by Vercel Cron (see vercel.json) and by the GitHub Actions backup:
 *   /api/cron?job=search&slot=morning|afternoon
 *   /api/cron?job=digest
 */
export async function GET(request) {
  if (!cronAuthorized(request)) return error(401, 'Unauthorized');
  const url = new URL(request.url);
  const job = url.searchParams.get('job');
  try {
    if (job === 'search') {
      const slot = url.searchParams.get('slot') === 'afternoon' ? 'afternoon' : 'morning';
      const summary = await scheduledSearch({ slot });
      return json({ job, slot, ...summary, perProfile: undefined, profiles: summary.perProfile ? Object.keys(summary.perProfile).length : 0 });
    }
    if (job === 'digest') return json({ job, result: await dailyDigest() });
    return error(400, 'Unknown job');
  } catch (e) {
    console.error('cron failed', e);
    return error(500, String(e.message || e));
  }
}
