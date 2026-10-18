/**
 * Local / self-hosted server. Serves public/ and routes /api/<name> to the
 * same handlers Vercel runs. With SCHEDULER=on it also runs the daily jobs
 * itself (for hosts without Vercel Cron, e.g. a VPS or Docker).
 *   node dev-server.js            → http://localhost:3000
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency).
for (const f of ['.env.local', '.env']) {
  try {
    for (const line of fs.readFileSync(path.join(root, f), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const PORT = Number(process.env.PORT) || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const API = new Set(['health', 'config', 'profile', 'subscribe', 'search', 'hackathons', 'test-push', 'cron']);

async function handleApi(name, req, res) {
  const mod = await import(`./api/${name}.js`);
  if (typeof mod.default === 'function') return mod.default(req, res); // classic (req, res) handler
  const handler = mod[req.method];
  if (!handler) { res.writeHead(405).end(); return; }
  const url = `http://${req.headers.host}${req.url}`;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
  const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' });
  const response = await handler(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) { res.end(); return; }
  for await (const chunk of response.body) res.write(chunk);
  res.end();
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(root, 'public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(root, 'public'))) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(root, 'public', 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, { 'content-type': MIME['.html'] }).end(html);
      });
      return;
    }
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' };
    if (p === '/sw.js') headers['cache-control'] = 'no-cache';
    res.writeHead(200, headers).end(data);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const m = req.url.match(/^\/api\/([a-z-]+)(?:[/?]|$)/);
      if (m && API.has(m[1])) await handleApi(m[1], req, res);
      else serveStatic(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });
}

/** Self-hosted scheduler: checks every minute against SCHEDULE_TZ wall-clock times. */
async function startScheduler() {
  const { scheduledSearch, dailyDigest } = await import('./lib/jobs.js');
  const tz = process.env.SCHEDULE_TZ || 'Asia/Jerusalem';
  const plan = [
    { at: process.env.SCHEDULE_MORNING || '10:00', run: () => scheduledSearch({ slot: 'morning' }) },
    { at: process.env.SCHEDULE_AFTERNOON || '18:00', run: () => scheduledSearch({ slot: 'afternoon' }) },
    { at: process.env.SCHEDULE_DIGEST || '21:00', run: () => dailyDigest() },
  ];
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const startedAt = fmt.format(new Date());
  const fired = new Map(plan.map((j) => [j.at, j.at <= startedAt ? day.format(new Date()) : null]));
  setInterval(async () => {
    const now = new Date();
    const hhmm = fmt.format(now);
    const today = day.format(now);
    for (const job of plan) {
      // Fire once per day as soon as the wall clock passes the job time (survives missed ticks).
      if (hhmm >= job.at && fired.get(job.at) !== today) {
        fired.set(job.at, today);
        job.run().then((r) => console.log('[scheduler]', job.at, JSON.stringify(r).slice(0, 300))).catch((e) => console.error('[scheduler]', e));
      }
    }
  }, 30_000);
  console.log(`[scheduler] on (${tz}): ${plan.map((p) => p.at).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => console.log(`Hackathon Finder on http://localhost:${PORT}`));
  if (process.env.SCHEDULER === 'on') startScheduler();
}
