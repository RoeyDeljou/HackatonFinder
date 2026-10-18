// Diagnostics: /api/health. Uses the classic (req, res) signature and only
// dynamic imports, so it still answers when another function crashes on load.
// Never prints secret values; only whether each setting exists and looks valid.

const has = (k) => typeof process.env[k] === 'string' && process.env[k].trim() !== '';
const clean = (k) => (has(k) ? process.env[k] !== process.env[k].trim() || /^["']|["']$/.test(process.env[k]) : false);

export default async function handler(req, res) {
  const report = { node: process.version, region: process.env.VERCEL_REGION || null, checks: {}, modules: {} };
  const c = report.checks;
  c.storage = has('KV_REST_API_URL') || has('UPSTASH_REDIS_REST_URL') ? 'set' : 'MISSING (connect Upstash Redis in Storage)';
  const restUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  if (restUrl && !/^https:\/\//.test(restUrl.trim())) c.storage = 'INVALID: REST URL must start with https://';
  c.storageToken = has('KV_REST_API_TOKEN') || has('UPSTASH_REDIS_REST_TOKEN') ? 'set' : 'MISSING';
  c.vapidPublic = has('VAPID_PUBLIC_KEY') ? (/^[A-Za-z0-9_-]{80,100}$/.test(process.env.VAPID_PUBLIC_KEY.trim()) ? 'ok' : 'INVALID format') : 'MISSING';
  c.vapidPrivate = has('VAPID_PRIVATE_KEY') ? (/^[A-Za-z0-9_-]{40,50}$/.test(process.env.VAPID_PRIVATE_KEY.trim()) ? 'ok' : 'INVALID format') : 'MISSING';
  c.vapidSubject = has('VAPID_SUBJECT') ? (/^(mailto:|https:\/\/)/.test(process.env.VAPID_SUBJECT.trim()) ? 'ok' : 'INVALID: must start with mailto:') : 'MISSING';
  c.cronSecret = has('CRON_SECRET') ? 'set' : 'MISSING';
  c.gemini = has('GEMINI_API_KEY') || has('GOOGLE_API_KEY') ? 'set' : 'not set (AI search off)';
  const spaced = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'GEMINI_API_KEY', 'CRON_SECRET', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'].filter(clean);
  if (spaced.length) c.whitespaceOrQuotes = spaced;

  // Literal paths so Vercel bundles every module into this function.
  const loaders = {
    config: () => import('./config.js'),
    profile: () => import('./profile.js'),
    hackathons: () => import('./hackathons.js'),
    search: () => import('./search.js'),
    subscribe: () => import('./subscribe.js'),
    cron: () => import('./cron.js'),
    'test-push': () => import('./test-push.js'),
  };
  for (const [name, load] of Object.entries(loaders)) {
    try {
      const mod = await load();
      report.modules[name] = 'loads';
      if (name === 'config') {
        const r = await mod.GET(new Request('https://local/api/config'));
        report.modules.config = `GET → ${r.status}`;
      }
    } catch (e) {
      report.modules[name] = `ERROR: ${e?.message || e}`;
      report.firstError ??= String(e?.stack || e).split('\n').slice(0, 4).join(' | ');
    }
  }
  try {
    const { getStore } = await import('../lib/store.js');
    const s = getStore();
    if (s.kind === 'redis') {
      await s.set('health', { at: new Date().toISOString() }, { ttlSec: 600 });
      report.checks.storageConnection = (await s.get('health')) ? 'ok (read/write works)' : 'FAILED';
    }
  } catch (e) {
    report.checks.storageConnection = `ERROR: ${e?.message || e}`;
  }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify(report, null, 2));
}
