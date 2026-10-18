import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveFormat, placeOf } from '../lib/format.js';
import * as S from '../lib/sources/index.js';
import { fixture, NOW } from './helpers.mjs';

test('deriveFormat: explicit, flags, location and wording', () => {
  assert.equal(deriveFormat({ format: 'hybrid' }), 'hybrid');
  assert.equal(deriveFormat({ online: true, location: 'Online' }), 'online');
  assert.equal(deriveFormat({ online: false, location: 'Tel Aviv, Israel' }), 'in-person');
  assert.equal(deriveFormat({ location: 'Munich' }), 'in-person');
  assert.equal(deriveFormat({ title: 'Virtual AI hackathon' }), 'online');
  assert.equal(deriveFormat({ title: 'On-site hackathon at Google campus' }), 'in-person');
  assert.equal(deriveFormat({ description: '🌎 Hybrid Hackathon | Online Build + On-site phase' }), 'hybrid');
  assert.equal(deriveFormat({ title: 'Sports hackathon' }), null, 'unknown stays unknown');
  assert.equal(placeOf({ location: 'Other' }), null);
  assert.equal(placeOf({ location: 'Online' }), null);
  assert.equal(placeOf({ location: 'Menlo Park, CA' }), 'Menlo Park, CA');
});

test('every platform source yields a clear format', () => {
  const sets = {
    devpost: S.parseDevpost(JSON.parse(fixture('devpost.json'))),
    devfolio: S.parseDevfolio(JSON.parse(fixture('devfolio.json'))),
    mlh: S.parseMlh(fixture('mlh.html')),
    luma: S.parseLuma(JSON.parse(fixture('luma.json'))),
    hackclub: S.parseHackClub(JSON.parse(fixture('hackclub.json'))),
    cv: S.parseCerebralValley(fixture('cerebralvalley.html')),
    hackster: S.parseHackster(fixture('hackster.html')),
  };
  for (const [name, items] of Object.entries(sets)) {
    const unknown = items.filter((i) => !deriveFormat(i));
    assert.equal(unknown.length, 0, `${name}: ${unknown.map((i) => i.title).join(', ')}`);
  }
  const mlh = sets.mlh.find((i) => i.title.startsWith('Cal Hacks'));
  assert.equal(deriveFormat(mlh), 'in-person');
  assert.equal(placeOf(mlh), 'San Francisco, California');
  const vultr = S.parseLablab(fixture('lablab.html'), NOW).find((i) => i.title.startsWith('Vultr'));
  assert.equal(deriveFormat(vultr), 'hybrid');
});

test('web results take the city from "· City" titles', () => {
  const html = '<a class="result__a" href="https://hackathonhub.eu/x">TUM Football Analytics Hackathon 2026 · Munich | Hackathon Hub</a><a class="result__snippet">Join the hackathon 2026</a>'
    + '<a class="result__a" href="https://hackathonhub.eu/y">More Than a Hack 2027 · Online 2026 | Hackathon Hub</a><a class="result__snippet">hackathon 2026</a>';
  const [tum, mth] = S.parseDdg(html, NOW);
  assert.equal(placeOf(tum), 'Munich');
  assert.equal(deriveFormat(tum), 'in-person');
  assert.equal(deriveFormat(mth), 'online');
});
