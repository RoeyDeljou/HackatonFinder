import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inWindow, localMinutes } from '../lib/schedule.js';

const at = (iso) => new Date(iso);

test('Israel summer time (UTC+3): 07:xx UTC is the 10:00 run, 08:xx UTC is a duplicate inside the window', () => {
  assert.equal(localMinutes(at('2026-10-18T07:00:00Z')), 10 * 60);
  assert.equal(inWindow('morning', at('2026-10-18T07:05:00Z')), true);
  assert.equal(inWindow('morning', at('2026-10-18T06:59:00Z')), false);
  assert.equal(inWindow('afternoon', at('2026-10-18T15:30:00Z')), true); // 18:30
  assert.equal(inWindow('digest', at('2026-10-18T18:10:00Z')), true); // 21:10
});

test('Israel winter time (UTC+2, from Oct 25 2026): 07:xx UTC is skipped, 08:xx UTC runs', () => {
  assert.equal(inWindow('morning', at('2026-11-18T07:30:00Z')), false); // 09:30
  assert.equal(inWindow('morning', at('2026-11-18T08:30:00Z')), true); // 10:30
  assert.equal(inWindow('afternoon', at('2026-11-18T15:30:00Z')), false); // 17:30
  assert.equal(inWindow('afternoon', at('2026-11-18T16:30:00Z')), true); // 18:30
  assert.equal(inWindow('digest', at('2026-11-18T18:30:00Z')), false); // 20:30
  assert.equal(inWindow('digest', at('2026-11-18T19:30:00Z')), true); // 21:30
});

test('backup runs ~40 min later still land inside the window; far-late ones do not', () => {
  assert.equal(inWindow('morning', at('2026-10-18T07:40:00Z')), true); // 10:40 summer
  assert.equal(inWindow('morning', at('2026-11-18T08:40:00Z')), true); // 10:40 winter
  assert.equal(inWindow('morning', at('2026-10-18T09:10:00Z')), false); // 12:10
});
