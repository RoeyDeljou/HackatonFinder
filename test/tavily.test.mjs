import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpFile } from './helpers.mjs';

process.env.TAVILY_API_KEY = 't-test';
process.env.TAVILY_MONTHLY_BUDGET = '12';
const { setStore, createFileStore, getStore } = await import('../lib/store.js');
const { SOURCES, parseTavily, tavilyQueries } = await import('../lib/sources/index.js');

test('parseTavily cleans LinkedIn titles and keeps only hackathon posts', () => {
  const items = parseTavily({
    results: [
      { title: 'Jane Doe on LinkedIn: Excited to launch the Adidas Sports Innovation Hackathon!', url: 'https://www.linkedin.com/posts/jane_abc', content: 'Registration is open until Nov 30.' },
      { title: 'Our Q3 results | LinkedIn', url: 'https://www.linkedin.com/posts/x', content: 'Revenue grew.' },
      { title: 'Company update', url: 'https://corp.example/news', content: 'Join our global AI hackathon, apply by December 1.' },
    ],
  }, new Date('2026-10-18T12:00:00Z'));
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Excited to launch the Adidas Sports Innovation Hackathon!');
  assert.equal(items[0].source, 'LinkedIn');
  assert.equal(items[0].kind, 'announcement');
  assert.equal(items[1].source, 'Web');
});

test('Tavily source is registered only with a key, and respects the monthly budget', async () => {
  setStore(createFileStore(tmpFile()));
  const src = SOURCES.find((s) => s.id === 'tavily');
  assert.ok(src);
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.tavily.com/search');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer t-test');
    return new Response(JSON.stringify({ results: [{ title: 'Sports hackathon open', url: `https://x.example/${calls}`, content: '' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const ctx = { queries: ['sports', 'sportstech', 'football', 'ai', 'ai agents', 'innovation'] };
    assert.ok(tavilyQueries(ctx.queries).length > 10);
    const first = await src.fetch(ctx);
    assert.equal(calls, 10, 'max 10 searches per run');
    assert.equal(first.length, 10);
    await src.fetch(ctx); // only 2 left in the budget of 12
    assert.equal(calls, 12);
    assert.deepEqual(await src.fetch(ctx), [], 'budget exhausted → no calls');
    assert.equal(calls, 12);
    const month = new Date().toISOString().slice(0, 7);
    assert.equal(await getStore().get(`tavily:${month}`), 12);
  } finally {
    globalThis.fetch = real;
  }
});
