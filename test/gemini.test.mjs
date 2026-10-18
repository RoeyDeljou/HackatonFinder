// Free provider: Gemini + Google Search grounding, against a simulated API.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'g-test';
process.env.ANTHROPIC_API_KEY = 'also-set';
const ai = await import('../lib/ai.js');
const { planCalls } = await import('../lib/gemini.js');
const { verifyItems } = await import('../lib/verify.js');

const reply = (text, status = 200) => new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://x', title: 'x' } }] } }] } : { error: { message: 'quota' } }), { status, headers: { 'content-type': 'application/json' } });
const hj = (title, url, extra = {}) => ({ title, url, organizer: '', description: '', fields: [], registration_deadline: '2026-11-30', start_date: '', end_date: '', location: 'Online', online: true, prize: '', evidence: 'page says open', ...extra });

test('Gemini is preferred over Claude when both keys are set (it is free)', () => {
  assert.equal(ai.aiProvider(), 'gemini');
});

test('one focused call per high-priority field plus a general sweep', () => {
  assert.deepEqual(planCalls([{ name: 'AI', priority: 'high' }, { name: 'Fintech', priority: 'low' }]).map((c) => c.field), ['AI', null]);
});

test('discover: grounded calls, JSON in markdown fences, focus field tagging, 429 retry', async () => {
  const real = globalThis.fetch;
  const bodies = [];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent/);
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'g-test');
    const body = JSON.parse(init.body);
    bodies.push(body);
    calls++;
    if (calls === 1) return reply('', 429); // rate limited once → retried
    const prompt = body.contents[0].parts[0].text;
    if (prompt.includes('Focus this search on Sports')) return reply('```json\n' + JSON.stringify({ hackathons: [hj('FIFA Football Data Hackathon', 'https://fifa.example/hack')] }) + '\n```');
    return reply('Here: ' + JSON.stringify({ hackathons: [hj('LinkedIn Corp Innovation Hack', 'https://corp.example/hack', { fields: ['Innovation'] }), hj('Broken', 'nope')] }));
  };
  try {
    const items = await ai.discover({ fields: [{ name: 'Sports', priority: 'high' }, { name: 'Innovation', priority: 'medium' }], now: new Date('2026-10-18T12:00:00Z'), verify: async (x) => x });
    assert.deepEqual(bodies[0].tools, [{ google_search: {} }]);
    assert.deepEqual([...new Set(items.map((i) => i.title))].sort(), ['FIFA Football Data Hackathon', 'LinkedIn Corp Innovation Hack']); // duplicates are merged later by the engine
    const fifa = items.find((i) => i.title.startsWith('FIFA'));
    assert.deepEqual(fifa.aiFields, ['Sports'], 'focused call tags its field');
    assert.equal(fifa.deadline, '2026-11-30T23:59:59.000Z');
    assert.equal(fifa.source, 'AI web search');
  } finally {
    globalThis.fetch = real;
  }
});

test('discover surfaces a real error when every call fails (e.g. bad key)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 });
  try {
    await assert.rejects(ai.discover({ fields: [{ name: 'AI', priority: 'high' }], verify: async (x) => x }), /HTTP 400/);
  } finally {
    globalThis.fetch = real;
  }
});

test('verifyItems drops dead links, keeps bot-blocked ones, and unwraps redirects', async () => {
  const items = [
    { title: 'Dead', url: 'https://dead.example' },
    { title: 'Blocked', url: 'https://blocked.example' },
    { title: 'Redirect', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' },
    { title: 'Down', url: 'https://down.example' },
  ];
  const check = async (url) => ({
    'https://dead.example': { ok: false, status: 404 },
    'https://blocked.example': { ok: true, status: 403, finalUrl: 'https://blocked.example' },
    'https://down.example': { ok: false, error: 'unreachable' },
  })[url] || { ok: true, status: 200, finalUrl: 'https://real.example/hackathon' };
  const out = await verifyItems(items, { check });
  assert.deepEqual(out.map((i) => i.title), ['Blocked', 'Redirect']);
  assert.equal(out[1].url, 'https://real.example/hackathon');
});

test('Sports gets one AI sub-search per sub-topic (football, US leagues, other sports)', () => {
  const calls = planCalls([{ name: 'Sports', priority: 'high' }, { name: 'AI', priority: 'high' }]);
  const sports = calls.filter((c) => c.field === 'Sports');
  assert.equal(sports.length, 3);
  assert.match(sports[0].focus, /Premier League/);
  assert.equal(calls.filter((c) => c.field === 'AI').length, 1);
  assert.equal(calls.at(-1).focus, null, 'general sweep last');
});

test('retired models (404 "no longer available") fall through to the next working model', async () => {
  const { _resetModel } = await import('../lib/gemini.js');
  _resetModel();
  const real = globalThis.fetch;
  const tried = [];
  globalThis.fetch = async (url) => {
    const model = String(url).match(/models\/([^:]+):/)[1];
    tried.push(model);
    if (model === 'gemini-2.5-flash') return new Response('{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users."}}', { status: 404 });
    return reply(JSON.stringify({ hackathons: [hj('Premier League Hack', 'https://pl.example/hack')] }));
  };
  try {
    const items = await ai.discover({ fields: [{ name: 'Fintech', priority: 'low' }], verify: async (x) => x });
    assert.equal(items[0].title, 'Premier League Hack');
    assert.deepEqual(tried.slice(0, 2), ['gemini-2.5-flash', 'gemini-flash-latest']);
    tried.length = 0;
    await ai.discover({ fields: [{ name: 'Fintech', priority: 'low' }], verify: async (x) => x });
    assert.equal(tried[0], 'gemini-flash-latest', 'remembers the working model');
  } finally {
    globalThis.fetch = real;
    _resetModel();
  }
});

test('free tier without Google Search gives a plain explanation', async () => {
  const { _resetModel } = await import('../lib/gemini.js');
  _resetModel();
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('gemini-2.5-flash')
    ? new Response('{"error":{"message":"no longer available to new users"}}', { status: 404 })
    : new Response('{"error":{"message":"Grounding with Google Search is not available on the free tier"}}', { status: 400 });
  try {
    await assert.rejects(ai.discover({ fields: [{ name: 'AI', priority: 'low' }], verify: async (x) => x }), /free tier doesn't include Google Search/);
  } finally {
    globalThis.fetch = real;
    _resetModel();
  }
});
