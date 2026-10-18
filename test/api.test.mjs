// End-to-end: real HTTP server + real source parsers, network answered from fixtures.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpFile, mockFetch } from './helpers.mjs';

process.env.DATA_FILE = tmpFile();
process.env.CRON_SECRET = 'test-secret';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

const { createServer } = await import('../server.js');
const { setPushSender } = await import('../lib/push.js');

let server, base, mock;
const pushes = [];
const DEV = 'e2eDevice_1234567890abcd';
const h = { 'content-type': 'application/json', 'x-device-id': DEV };

before(async () => {
  mock = mockFetch();
  setPushSender(async (sub, payload) => { pushes.push(payload); return 'sent'; });
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); mock.restore(); });

test('static app shell and PWA files are served', async () => {
  for (const [p, type] of [['/', 'text/html'], ['/app.js', 'javascript'], ['/sw.js', 'javascript'], ['/manifest.webmanifest', 'manifest'], ['/icons/icon-192.png', 'image/png']]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), new RegExp(type), p);
  }
  const m = await (await fetch(base + '/manifest.webmanifest')).json();
  assert.equal(m.display, 'standalone');
});

test('config exposes fields, sources and storage', async () => {
  const c = await (await fetch(base + '/api/config')).json();
  assert.deepEqual(c.defaultFields.map((f) => f.name), ['Sports', 'AI', 'Innovation']);
  assert.equal(c.storage, 'file');
  assert.equal(c.ai, false);
  assert.ok(c.sources.includes('Devpost'));
});

test('profile validation', async () => {
  assert.equal((await fetch(base + '/api/profile')).status, 400);
  const bad = await fetch(base + '/api/profile', { method: 'PUT', headers: h, body: JSON.stringify({ fields: [] }) });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(base + '/api/search', { method: 'POST', headers: h, body: '{}' })).status, 404);
});

test('full flow: save fields → streamed first search → results → cron → digest', async () => {
  const put = await fetch(base + '/api/profile', { method: 'PUT', headers: h, body: JSON.stringify({ tz: 'Asia/Jerusalem', fields: [{ name: 'AI', priority: 'high' }, { name: 'Sports', priority: 'high' }, { name: 'Innovation', priority: 'medium' }, { name: 'Music', priority: 'low' }] }) });
  assert.equal(put.status, 200);
  const sub = await fetch(base + '/api/subscribe', { method: 'POST', headers: h, body: JSON.stringify({ subscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } } }) });
  assert.equal(sub.status, 200);

  const res = await fetch(base + '/api/search', { method: 'POST', headers: h, body: JSON.stringify({ tz: 'Asia/Jerusalem' }) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /ndjson/);
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const sourceDone = events.filter((e) => e.type === 'source' && e.status === 'done').map((e) => e.id);
  for (const id of ['devpost', 'devfolio', 'mlh', 'luma', 'lablab', 'cerebralvalley', 'hackclub', 'hackster', 'news']) assert.ok(sourceDone.includes(id), `${id} done`);
  const done = events.find((e) => e.type === 'done');
  assert.ok(done, 'done event');
  const { matches, suggestions, searchedAt } = done.results;
  assert.ok(searchedAt);
  assert.ok(matches.length >= 20, `matches: ${matches.length}`);
  assert.ok(suggestions.length >= 5, `suggestions: ${suggestions.length}`);
  assert.ok(matches.every((m) => m.matched.length && m.url && m.id));
  assert.ok(matches.some((m) => m.matched.includes('AI')));
  // Every listed hackathon is still open.
  const now = Date.now();
  for (const m of [...matches, ...suggestions]) {
    const close = m.deadline || m.endDate || m.startDate;
    if (close) assert.ok(new Date(close).getTime() > now - 864e5 * 400, 'sanity');
  }
  assert.equal(pushes.length, 0, 'first search does not push');

  // Cooldown on immediate repeat.
  assert.equal((await fetch(base + '/api/search', { method: 'POST', headers: h, body: '{}' })).status, 429);

  const list = await (await fetch(base + '/api/hackathons', { headers: h })).json();
  assert.equal(list.matches.length, matches.length);

  // Cron requires the secret.
  assert.equal((await fetch(base + '/api/cron?job=search&slot=morning')).status, 401);
  const cron = await fetch(base + '/api/cron?job=search&slot=morning', { headers: { authorization: 'Bearer test-secret' } });
  assert.equal(cron.status, 200);
  const cj = await cron.json();
  assert.equal(cj.profiles, 1);
  assert.equal(pushes.length, 0, 'nothing new since first search');

  const dig = await (await fetch(base + '/api/cron?job=digest', { headers: { authorization: 'Bearer test-secret' } })).json();
  assert.match(dig.result[DEV], /found|sent/);

  const tp = await fetch(base + '/api/test-push', { method: 'POST', headers: h });
  assert.equal(tp.status, 200);
  assert.equal(pushes.at(-1).title, 'Notifications are on ✅');
});

test('search keeps working when some sources are down', async () => {
  mock.restore();
  mock = mockFetch({ fail: ['devpost.com', 'lu.ma', 'news.google.com'] });
  const dev2 = { ...h, 'x-device-id': 'secondDevice_1234567890' };
  await fetch(base + '/api/profile', { method: 'PUT', headers: dev2, body: JSON.stringify({ fields: [{ name: 'AI', priority: 'high' }] }) });
  const events = (await (await fetch(base + '/api/search', { method: 'POST', headers: dev2, body: '{}' })).text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.id === 'devpost' && e.status === 'error'));
  const done = events.find((e) => e.type === 'done');
  assert.ok(done.results.matches.length > 5);
});
