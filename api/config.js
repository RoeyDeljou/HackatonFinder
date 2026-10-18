import { json } from '../lib/http.js';
import { aiEnabled, aiProvider } from '../lib/ai.js';
import { pushConfigured } from '../lib/push.js';
import { getStore, storageMisconfigured } from '../lib/store.js';
import { SUGGESTED_FIELDS, DEFAULT_FIELDS } from '../lib/fields.js';
import { SOURCES } from '../lib/sources/index.js';

export async function GET() {
  return json({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    push: pushConfigured(),
    ai: aiEnabled(),
    aiProvider: aiProvider(),
    storage: storageMisconfigured() ? 'missing' : getStore().kind,
    sources: [...SOURCES.map((s) => s.name), ...(aiEnabled() ? ['AI web search'] : [])],
    suggestedFields: SUGGESTED_FIELDS,
    defaultFields: DEFAULT_FIELDS,
    schedule: { morning: process.env.SCHEDULE_MORNING_LABEL || '08:00', afternoon: process.env.SCHEDULE_AFTERNOON_LABEL || '15:00', digest: process.env.SCHEDULE_DIGEST_LABEL || '21:00', tz: process.env.SCHEDULE_TZ_LABEL || 'Israel time' },
  });
}
