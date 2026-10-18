import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, isActive, mergeCatalog, collect } from '../lib/engine.js';
import { NOW } from './helpers.mjs';

const base = { tags: [], kind: 'hackathon', description: '' };
const day = 864e5;

test('isActive: deadline, end date, announcements, undated', () => {
  const now = NOW.getTime();
  assert.equal(isActive({ ...base, deadline: new Date(now + day).toISOString() }, now), true);
  assert.equal(isActive({ ...base, deadline: new Date(now - 1).toISOString() }, now), false);
  assert.equal(isActive({ ...base, endDate: new Date(now - day).toISOString() }, now), false);
  assert.equal(isActive({ ...base, kind: 'announcement', publishedAt: new Date(now - 5 * day).toISOString() }, now), true);
  assert.equal(isActive({ ...base, kind: 'announcement', publishedAt: new Date(now - 40 * day).toISOString() }, now), false);
  assert.equal(isActive({ ...base, firstSeenAt: new Date(now - 40 * day).toISOString() }, now), false);
});

test('dedupe merges same url and same long title, preferring dated listings', () => {
  const items = dedupe([
    { ...base, title: 'Global Sports Innovation Hackathon', url: 'https://news.example.com/a', source: 'News', kind: 'announcement' },
    { ...base, title: 'Global Sports Innovation Hackathon', url: 'https://gsih.devpost.com/', source: 'Devpost', deadline: '2026-11-01T00:00:00Z', tags: ['Sports'] },
    { ...base, title: 'Other', url: 'https://www.gsih.devpost.com', source: 'Luma' },
    { ...base, title: 'AI Hack', url: 'https://a.com/1', source: 'Luma' },
    { ...base, title: 'AI Hack', url: 'https://b.com/2', source: 'Luma' },
  ]);
  assert.equal(items.length, 3, 'short generic titles are not merged');
  const gs = items.find((i) => i.url.includes('devpost'));
  assert.equal(gs.kind, 'hackathon');
  assert.equal(gs.deadline, '2026-11-01T00:00:00Z');
  assert.deepEqual(gs.sources.sort(), ['Devpost', 'Luma', 'News']);
  assert.ok(gs.id && /^[0-9a-f]{16}$/.test(gs.id));
});

test('mergeCatalog keeps firstSeenAt, prunes finished and vanished, and re-keys news→platform', () => {
  const now = NOW.getTime();
  const iso = (t) => new Date(t).toISOString();
  const existing = {
    old: { ...base, id: 'old', title: 'Done Hack', url: 'https://x/1', source: 'Devpost', deadline: iso(now - day), firstSeenAt: iso(now - 9 * day), lastSeenAt: iso(now - day) },
    gone: { ...base, id: 'gone', title: 'Vanished Hack', url: 'https://x/2', source: 'Devpost', deadline: iso(now + 9 * day), firstSeenAt: iso(now - 9 * day), lastSeenAt: iso(now - 5 * day) },
    keep: { ...base, id: 'keep', title: 'Keep Hack', url: 'https://x/3', source: 'Devpost', deadline: iso(now + 9 * day), firstSeenAt: iso(now - 9 * day), lastSeenAt: iso(now - day) },
    news1: { ...base, id: 'news1', kind: 'announcement', title: 'Mega Sports Hackathon 2026', url: 'https://news/x', source: 'News', firstSeenAt: iso(now - 2 * day), lastSeenAt: iso(now - day), publishedAt: iso(now - 2 * day) },
  };
  const fresh = dedupe([
    { ...base, title: 'Keep Hack', url: 'https://x/3', source: 'Devpost', deadline: iso(now + 9 * day) },
    { ...base, title: 'Mega Sports Hackathon 2026', url: 'https://mega.devpost.com', source: 'Devpost', deadline: iso(now + 20 * day) },
  ]);
  const { catalog, removed } = mergeCatalog(existing, fresh, { now, healthySources: new Set(['Devpost', 'News']) });
  assert.ok(!catalog.old && !catalog.gone && !catalog.news1);
  assert.ok(removed.includes('old') && removed.includes('gone') && removed.includes('news1'));
  const keep = Object.values(catalog).find((i) => i.title === 'Keep Hack');
  assert.equal(keep.firstSeenAt, existing.keep.firstSeenAt);
  const mega = Object.values(catalog).find((i) => i.title.startsWith('Mega'));
  assert.deepEqual(mega.aliasIds, ['news1']);
  assert.equal(mega.firstSeenAt, existing.news1.firstSeenAt);
});

test('vanished items are kept when their source failed this run', () => {
  const now = NOW.getTime();
  const existing = { a: { ...base, id: 'a', title: 'A hack', url: 'https://x/a', source: 'Devpost', deadline: new Date(now + 9 * day).toISOString(), lastSeenAt: new Date(now - 5 * day).toISOString() } };
  const { catalog } = mergeCatalog(existing, [], { now, healthySources: new Set() });
  assert.ok(catalog.a);
});

test('collect survives failing sources and slow AI', async () => {
  const sources = [
    { id: 'ok', name: 'OK', fetch: async () => [{ ...base, title: 'Open Sports Hack', url: 'https://ok/1', source: 'OK', deadline: '2026-12-01T00:00:00Z' }, { ...base, title: 'Old', url: 'https://ok/2', source: 'OK', deadline: '2026-01-01T00:00:00Z' }] },
    { id: 'bad', name: 'Bad', fetch: async () => { throw new Error('boom'); } },
  ];
  const events = [];
  const { items, stats } = await collect({
    fields: [{ name: 'Sports', priority: 'high' }], sources, now: NOW, useAi: true, aiTimeoutMs: 50,
    aiDiscover: () => new Promise((r) => setTimeout(() => r([]), 1000)),
    onProgress: (e) => events.push(e),
  });
  assert.deepEqual(items.map((i) => i.title), ['Open Sports Hack']);
  assert.equal(stats.bad.ok, false);
  assert.equal(stats.ai.ok, false);
  assert.ok(events.some((e) => e.id === 'bad' && e.status === 'error'));
});

test('collect merges AI discoveries', async () => {
  const { items } = await collect({
    fields: [{ name: 'Sports', priority: 'high' }], sources: [], now: NOW, useAi: true,
    aiDiscover: async ({ fields }) => {
      assert.equal(fields[0].name, 'Sports');
      return [{ ...base, title: 'NBA Launchpad Hack', url: 'https://nba.com/hack', source: 'AI web search', deadline: '2026-11-20T00:00:00Z', aiFields: ['Sports'] }];
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'AI web search');
});
