/**
 * Wall-clock schedule in one time zone (default Israel), independent of UTC
 * and daylight saving. Vercel Cron only speaks UTC, so each job is triggered
 * at both possible UTC hours and the server runs it only inside its window.
 */
export const SCHEDULE_TZ = process.env.SCHEDULE_TZ || 'Asia/Jerusalem';

export const SLOTS = {
  morning: { at: process.env.SCHEDULE_MORNING || '10:00', windowHours: 2 },
  afternoon: { at: process.env.SCHEDULE_AFTERNOON || '18:00', windowHours: 2 },
  digest: { at: process.env.SCHEDULE_DIGEST || '21:00', windowHours: 3 },
};

/** Minutes since local midnight in `tz`. */
export function localMinutes(now = new Date(), tz = SCHEDULE_TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return get('hour') * 60 + get('minute');
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

/** True when `now` falls inside [slot time, slot time + window) local time. */
export function inWindow(slot, now = new Date(), tz = SCHEDULE_TZ) {
  const s = SLOTS[slot];
  if (!s) return false;
  const start = toMinutes(s.at);
  const cur = localMinutes(now, tz);
  return cur >= start && cur < start + s.windowHours * 60;
}
