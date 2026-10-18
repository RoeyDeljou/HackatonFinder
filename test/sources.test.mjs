import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../lib/sources/index.js';
import { fixture, NOW } from './helpers.mjs';

const valid = (it) => {
  assert.ok(it.title && typeof it.title === 'string', 'title');
  assert.match(it.url, /^https?:\/\//, 'url');
  for (const k of ['deadline', 'startDate', 'endDate']) if (it[k]) assert.ok(!Number.isNaN(new Date(it[k]).getTime()), k);
};

test('Devpost: parses list with dates, prize and themes', () => {
  const items = S.parseDevpost(JSON.parse(fixture('devpost.json')));
  assert.equal(items.length, 9);
  items.forEach(valid);
  const amazon = items.find((i) => i.title.includes('Amazon'));
  assert.equal(amazon.deadline, '2026-10-23T23:59:59.999Z');
  assert.equal(amazon.prize, '$138,000');
  assert.ok(amazon.tags.includes('Machine Learning/AI'));
  assert.equal(amazon.online, true);
});

test('Devfolio: uses registration deadline and subdomain url', () => {
  const items = S.parseDevfolio(JSON.parse(fixture('devfolio.json')));
  assert.equal(items.length, 17);
  items.forEach(valid);
  assert.equal(items[0].url, 'https://arkiv.devfolio.co/');
  assert.equal(items[0].deadline, '2026-10-18T22:59:00.000Z');
});

test('MLH: reads Inertia props and skips in-progress events', () => {
  const items = S.parseMlh(fixture('mlh.html'));
  assert.ok(items.length > 50);
  items.forEach(valid);
  assert.ok(!items.some((i) => i.title === 'SwampHacks XII'), 'in-progress event excluded');
  assert.throws(() => S.parseMlh('<html></html>'), /format changed/);
});

test('Luma: keeps only hackathon-like events', () => {
  const items = S.parseLuma(JSON.parse(fixture('luma.json')));
  assert.ok(items.length >= 15);
  items.forEach(valid);
  assert.ok(items.every((i) => i.url.startsWith('https://lu.ma/')));
});

test('Hack Club, lablab, Cerebral Valley, Hackster parse', () => {
  const hc = S.parseHackClub(JSON.parse(fixture('hackclub.json')));
  assert.equal(hc.length, 13); hc.forEach(valid);
  const lab = S.parseLablab(fixture('lablab.html'), NOW);
  assert.deepEqual(lab.map((i) => i.title).sort(), ['AMD AI League', 'Vultr: Agent Rush Hackathon']);
  const cv = S.parseCerebralValley(fixture('cerebralvalley.html'));
  assert.ok(cv.length >= 10); cv.forEach(valid);
  assert.ok(cv.some((i) => i.title === 'Meta Global AI Developer Hackathon'));
  const hs = S.parseHackster(fixture('hackster.html'));
  assert.equal(hs.length, 3); hs.forEach(valid);
  assert.equal(hs.find((i) => i.url.endsWith('autodesk-university-2027-product')).deadline, '2026-12-21T23:59:59.999Z');
});

test('Google News: hackathon headlines become announcements', () => {
  const items = S.parseGoogleNews(fixture('gnews.xml'), NOW);
  assert.ok(items.length >= 5);
  items.forEach(valid);
  assert.ok(items.every((i) => i.kind === 'announcement'));
  assert.ok(!items.some((i) => i.title.endsWith('GSA (.gov)')), 'publisher suffix removed');
  assert.ok(items.some((i) => i.title.startsWith('Model Context Protocol Server')));
});

test('DuckDuckGo: finds company-hosted hackathons and skips video/code/job pages', () => {
  const items = S.parseDdg(fixture('ddg.html'), NOW);
  const ms = items.find((i) => i.url.startsWith('https://events.microsoft.com/flow/microsoft/plmshackathon'));
  assert.ok(ms, 'Microsoft + Premier League registration page found');
  assert.equal(ms.title, 'Microsoft + Premier League: Inside the Game: Developer Hackathon');
  assert.equal(ms.kind, 'announcement');
  assert.ok(items.some((i) => i.url.includes('developer.microsoft.com/en-us/reactor/series')));
  assert.ok(!items.some((i) => /youtube|github\.com|linkedin\.com\/jobs/.test(i.url)));
  items.forEach(valid);
});

test('DuckDuckGo queries put high-priority field terms first, plus company event sites', () => {
  const q = S.ddgQueries(['sports', 'football', 'premier league'], NOW);
  assert.equal(q[2], '"premier league" hackathon 2026');
  assert.ok(q.some((x) => x.includes('site:events.microsoft.com')));
});

test('web results skip recaps and list pages', () => {
  for (const t of ['Innovators Triumph: Insights from the 2026 SportsTech Hackathon', 'GXSLab Global Football Hackathon: Results & Highlights', 'Upcoming AI & Machine Learning Hackathons 2026', 'Find Hackathon about AI in 2026', 'AI Hackathons 2026 & 2027 — Worldwide']) assert.ok(S.isNoiseTitle(t), t);
  for (const t of ['TUM Football Analytics Hackathon 2026', 'Registration: Inside the Game: Developer Hackathon', 'NBA Playoffs Prediction Market Hackathon']) assert.ok(!S.isNoiseTitle(t), t);
});
