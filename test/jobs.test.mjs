import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setStore, createFileStore, getStore } from '../lib/store.js';
import { setPushSender } from '../lib/push.js';
import * as jobs from '../lib/jobs.js';
import { tmpFile } from './helpers.mjs';

const DEV = 'device_abcdefghijklmnop';
const SUB = { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } };
const t = (s) => new Date(s);
const hack = (title, deadline, extra = {}) => ({ title, url: `https://h.example/${encodeURIComponent(title)}`, source: 'Fake', deadline, tags: [], description: '', kind: 'hackathon', ...extra });

let pushes;
let listing;
const sources = [{ id: 'fake', name: 'Fake', fetch: async () => listing }];
const collectOpts = { sources, useAi: false };

beforeEach(() => {
  setStore(createFileStore(tmpFile()));
  pushes = [];
  setPushSender(async (sub, payload) => { pushes.push({ sub, payload }); return sub.endpoint.includes('gone') ? 'gone' : 'sent'; });
  listing = [hack('World Sports Tech Hack', '2026-11-30T00:00:00Z'), hack('Generative AI Agents Jam', '2026-11-15T00:00:00Z'), hack('DeFi Builders Summit Hack', '2026-11-10T00:00:00Z')];
});

async function setup(tz = 'Asia/Jerusalem') {
  await jobs.upsertProfile(DEV, { fields: [{ name: 'Sports', priority: 'high' }, { name: 'AI', priority: 'medium' }], tz, subscription: SUB });
}

test('first search shows matches + suggestions and does not push', async () => {
  await setup();
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-10-18T06:00:00Z') });
  const r = await jobs.getResults(await jobs.getProfile(DEV));
  assert.deepEqual(r.matches.map((m) => m.title), ['World Sports Tech Hack', 'Generative AI Agents Jam']);
  assert.deepEqual(r.suggestions.map((m) => m.title), ['DeFi Builders Summit Hack']);
  assert.equal(r.suggestions[0].matched[0], 'Web3 & Blockchain');
  assert.ok(r.searchedAt);
  assert.ok(r.matches.every((m) => !m.isNew), 'nothing is "new" on the very first search');
  assert.equal(pushes.length, 0);
});

test('scheduled run pushes only genuinely new matches, once', async () => {
  await setup();
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-10-18T06:00:00Z') });
  listing = [...listing, hack('NBA Fan Experience Hackathon', '2026-12-01T00:00:00Z')];
  const res = await jobs.scheduledSearch({ slot: 'afternoon', collectOpts, now: t('2026-10-18T12:00:00Z') });
  assert.equal(res.perProfile[DEV].newCount, 1);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].payload.title, 'New hackathon found 🎯');
  assert.match(pushes[0].payload.body, /NBA Fan Experience/);
  assert.match(pushes[0].payload.url, /^\/\?open=/);

  // Same slot again (e.g. GitHub backup) is skipped.
  const again = await jobs.scheduledSearch({ slot: 'afternoon', collectOpts, now: t('2026-10-18T13:20:00Z') });
  assert.equal(again.skipped, 'already ran');
  // Next day's morning run finds nothing new → no push.
  await jobs.scheduledSearch({ slot: 'morning', collectOpts, now: t('2026-10-19T05:00:00Z') });
  assert.equal(pushes.length, 1);

  const r = await jobs.getResults(await jobs.getProfile(DEV));
  assert.equal(r.matches.find((m) => m.title.startsWith('NBA')).isNew, true);
});

test('digest says "No new Hackathons were found today" only on empty days', async () => {
  await setup();
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-10-18T06:00:00Z') });
  // Day 1: the first search found things → no digest.
  let out = await jobs.dailyDigest({ now: t('2026-10-18T18:00:00Z') });
  assert.match(out[DEV], /found/);
  assert.equal(pushes.length, 0);
  // Day 2: both searches find nothing new → digest.
  await jobs.scheduledSearch({ slot: 'morning', collectOpts, now: t('2026-10-19T05:00:00Z') });
  await jobs.scheduledSearch({ slot: 'afternoon', collectOpts, now: t('2026-10-19T12:00:00Z') });
  out = await jobs.dailyDigest({ now: t('2026-10-19T18:00:00Z') });
  assert.equal(out[DEV], 'sent');
  assert.equal(pushes.at(-1).payload.body, 'No new Hackathons were found today');
  // Never twice in one day.
  out = await jobs.dailyDigest({ now: t('2026-10-19T19:20:00Z') });
  assert.equal(out[DEV], 'already sent');
  assert.equal(pushes.length, 1);
});

test('finished hackathons are cleared from results', async () => {
  await setup();
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-10-18T06:00:00Z') });
  await jobs.scheduledSearch({ slot: 'morning', collectOpts, now: t('2026-11-20T05:00:00Z') });
  const r = await jobs.getResults(await jobs.getProfile(DEV));
  assert.deepEqual(r.matches.map((m) => m.title), ['World Sports Tech Hack']);
  const catalog = await getStore().hgetall('catalog');
  assert.equal(Object.keys(catalog).length, 1);
});

test('expired push subscriptions are removed', async () => {
  await jobs.upsertProfile(DEV, { fields: [{ name: 'Sports', priority: 'high' }], tz: 'UTC', subscription: { ...SUB, endpoint: 'https://push.example/gone' } });
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-10-18T06:00:00Z') });
  listing = [...listing, hack('Olympic Data Hackathon', '2026-12-01T00:00:00Z')];
  await jobs.scheduledSearch({ slot: 'afternoon', collectOpts, now: t('2026-10-18T12:00:00Z') });
  assert.equal(pushes.length, 1);
  assert.equal((await jobs.getProfile(DEV)).subscription, null);
});

test('scheduled run skips devices that never searched', async () => {
  await jobs.upsertProfile(DEV, { fields: [{ name: 'Sports', priority: 'high' }] });
  const res = await jobs.scheduledSearch({ slot: 'morning', collectOpts, now: t('2026-10-18T05:00:00Z') });
  assert.equal(res.skipped, 'no profiles');
});

test('unionFields keeps the highest priority', () => {
  const u = jobs.unionFields([{ fields: [{ name: 'AI', priority: 'low' }] }, { fields: [{ name: 'ai', priority: 'high', keywords: ['x'] }, { name: 'Gaming', priority: 'medium' }] }]);
  assert.deepEqual(u.map((f) => [f.name, f.priority]), [['AI', 'high'], ['Gaming', 'medium']]);
});

test('watchlist: add, list, keep after closing, remove', async () => {
  await setup();
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-10-18T06:00:00Z') });
  let r = await jobs.getResults(await jobs.getProfile(DEV));
  const ai = r.matches.find((m) => m.title.startsWith('Generative AI'));
  const defi = r.suggestions[0];
  assert.deepEqual(await jobs.setWatched(await jobs.getProfile(DEV), ai.id, true), { ok: true, watched: true });
  await jobs.setWatched(await jobs.getProfile(DEV), defi.id, true);
  assert.equal((await jobs.setWatched(await jobs.getProfile(DEV), '0123456789abcdef', true)).ok, false, 'unknown id refused');
  r = await jobs.getResults(await jobs.getProfile(DEV));
  assert.deepEqual(r.watchlist.map((w) => w.title).sort(), ['DeFi Builders Summit Hack', 'Generative AI Agents Jam']);
  assert.ok(r.watchlist.every((w) => !w.closed));
  assert.deepEqual(r.watchlist.find((w) => w.id === ai.id).matched, ['AI']);

  // After the AI jam's deadline passes and it leaves the catalog, it stays watched, marked closed.
  await jobs.scheduledSearch({ slot: 'morning', collectOpts, now: t('2026-11-16T05:00:00Z') });
  const w = jobs.buildWatchlist(await getStore().hgetall(`watch:${DEV}`), await getStore().hgetall('catalog'), { matches: [], suggestions: [] }, t('2026-11-16T06:00:00Z').getTime());
  assert.equal(w.find((x) => x.id === ai.id).closed, true);
  assert.equal(w.find((x) => x.id === ai.id).title, 'Generative AI Agents Jam');

  await jobs.setWatched(await jobs.getProfile(DEV), ai.id, false);
  r = await jobs.getResults(await jobs.getProfile(DEV));
  assert.deepEqual(r.watchlist.map((x) => x.id), [defi.id]);
});

test('watchlist reminders: 3 days before and on the last day, each once', async () => {
  await setup();
  listing = [hack('World Sports Tech Hack', '2026-11-30T00:00:00Z'), hack('Generative AI Agents Jam', '2026-11-15T00:00:00Z'), hack('NBA Fan Hackathon', '2026-11-16T12:00:00Z')];
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-11-01T06:00:00Z') });
  const r = await jobs.getResults(await jobs.getProfile(DEV));
  const id = (title) => r.matches.find((m) => m.title === title).id;
  await jobs.setWatched(await jobs.getProfile(DEV), id('Generative AI Agents Jam'), true);
  await jobs.setWatched(await jobs.getProfile(DEV), id('World Sports Tech Hack'), true);

  // Nov 10: 5 days left → nothing yet.
  await jobs.watchReminders({ now: t('2026-11-10T07:00:00Z') });
  assert.equal(pushes.length, 0);
  // Nov 12 07:00: ~2.7 days left → "3 days" reminder.
  await jobs.watchReminders({ now: t('2026-11-12T07:00:00Z') });
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].payload.title, '⏰ Watchlist: closing soon');
  assert.equal(pushes[0].payload.body, 'Generative AI Agents Jam closes in 3 days');
  assert.match(pushes[0].payload.url, /^\/\?open=/);
  // Same window again → not repeated.
  await jobs.watchReminders({ now: t('2026-11-12T15:00:00Z') });
  assert.equal(pushes.length, 1);
  // Nov 14 07:00: 17 h left → last-day reminder, once.
  await jobs.watchReminders({ now: t('2026-11-14T07:00:00Z') });
  await jobs.watchReminders({ now: t('2026-11-14T15:00:00Z') });
  assert.equal(pushes.length, 2);
  assert.equal(pushes[1].payload.body, 'Generative AI Agents Jam closes tomorrow');
  // Unwatched items never remind (NBA closes Nov 16).
  assert.ok(!pushes.some((p) => p.payload.body.includes('NBA')));
});

test('watchlist reminders: watched late, inside the last day → one reminder, grouped when several', async () => {
  await setup();
  listing = [hack('Generative AI Agents Jam', '2026-11-15T00:00:00Z'), hack('Sports Data Jam', '2026-11-15T10:00:00Z')];
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-11-14T06:00:00Z') });
  const r = await jobs.getResults(await jobs.getProfile(DEV));
  for (const m of r.matches) await jobs.setWatched(await jobs.getProfile(DEV), m.id, true);
  await jobs.watchReminders({ now: t('2026-11-14T07:00:00Z') });
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].payload.title, '⏰ 2 watchlist hackathons close soon');
  assert.equal(pushes[0].payload.url, '/?watch=1');
  await jobs.watchReminders({ now: t('2026-11-14T15:00:00Z') });
  assert.equal(pushes.length, 1, 'the earlier "3 days" stage is not sent afterwards');
});

test('scheduled search also sends watchlist reminders', async () => {
  await setup();
  listing = [hack('Generative AI Agents Jam', '2026-11-15T00:00:00Z')];
  await jobs.runSearch({ profiles: [await jobs.getProfile(DEV)], collectOpts, now: t('2026-11-01T06:00:00Z') });
  const r = await jobs.getResults(await jobs.getProfile(DEV));
  await jobs.setWatched(await jobs.getProfile(DEV), r.matches[0].id, true);
  const res = await jobs.scheduledSearch({ slot: 'morning', collectOpts, now: t('2026-11-14T07:00:00Z') });
  assert.equal(res.watchReminders[DEV].sent, 1);
  assert.ok(pushes.some((p) => p.payload.tag === 'hf-watch'));
});
