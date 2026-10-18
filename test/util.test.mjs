import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateRange, normalizeUrl, normalizeTitle, extractJsonAt, dateKey, summarize } from '../lib/util.js';

test('parseDateRange handles Devpost formats', () => {
  assert.deepEqual(parseDateRange('Aug 31 - Oct 23, 2026'), { start: '2026-08-31T00:00:00.000Z', end: '2026-10-23T23:59:59.999Z' });
  assert.deepEqual(parseDateRange('Oct 10 - 12, 2026'), { start: '2026-10-10T00:00:00.000Z', end: '2026-10-12T23:59:59.999Z' });
  assert.deepEqual(parseDateRange('Dec 15, 2026 - Jan 10, 2027'), { start: '2026-12-15T00:00:00.000Z', end: '2027-01-10T23:59:59.999Z' });
  assert.deepEqual(parseDateRange('Nov 20 - Jan 05, 2027'), { start: '2026-11-20T00:00:00.000Z', end: '2027-01-05T23:59:59.999Z' });
  assert.equal(parseDateRange('Oct 23, 2026').end, '2026-10-23T23:59:59.999Z');
  assert.equal(parseDateRange('Sept 3 - 9, 2026').start, '2026-09-03T00:00:00.000Z');
  assert.deepEqual(parseDateRange('soon'), { start: null, end: null });
  assert.deepEqual(parseDateRange(null), { start: null, end: null });
});

test('normalizeUrl canonicalizes for dedupe', () => {
  assert.equal(normalizeUrl('https://www.Example.com/a/'), 'example.com/a');
  assert.equal(normalizeUrl('https://luma.com/abc?x=1'), 'lu.ma/abc');
  assert.equal(normalizeUrl('//cdn.x.io/p'), 'cdn.x.io/p');
});

test('normalizeTitle strips punctuation and accents', () => {
  assert.equal(normalizeTitle('  Café  Hack: 2026!! '), 'cafe hack 2026');
});

test('extractJsonAt handles nesting and strings with brackets', () => {
  const text = 'x "a":[{"n":"]["},{"m":[1,2]}] tail';
  assert.deepEqual(extractJsonAt(text, text.indexOf('[')), [{ n: '][' }, { m: [1, 2] }]);
});

test('dateKey respects time zones', () => {
  const d = new Date('2026-10-18T22:30:00Z');
  assert.equal(dateKey(d, 'UTC'), '2026-10-18');
  assert.equal(dateKey(d, 'Asia/Jerusalem'), '2026-10-19');
  assert.equal(dateKey(d, 'Not/AZone'), '2026-10-18');
});

test('summarize strips markdown and cuts long text', () => {
  const s = summarize('**Build** on [Arkiv](https://arkiv.network) ' + 'word '.repeat(100), 60);
  assert.ok(s.length <= 60);
  assert.ok(s.startsWith('Build on Arkiv'));
});
