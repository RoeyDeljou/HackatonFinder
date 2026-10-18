import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchFields, sanitizeFields, canonicalFieldName, otherFieldsFor, fieldQueries, relevance, DEFAULT_FIELDS } from '../lib/fields.js';

const it = (title, extra = {}) => ({ title, description: '', tags: [], ...extra });

test('AI matches on word boundaries only', () => {
  assert.deepEqual(matchFields(it('Build AI Agents Hackathon'), [{ name: 'AI', priority: 'high' }]).map((m) => m.name), ['AI']);
  assert.deepEqual(matchFields(it('Said the Rain: a poetry jam', { description: 'maintain, captain' }), [{ name: 'AI', priority: 'high' }]), []);
  assert.equal(matchFields(it('Hack', { tags: ['Machine Learning/AI'] }), [{ name: 'AI', priority: 'high' }]).length, 1);
});

test('Sports keywords catch leagues and sports tech', () => {
  const f = [{ name: 'Sports', priority: 'high' }];
  for (const t of ['NBA Launchpad Hackathon', 'SportsTech Hack 2026', 'FIFA World Cup Innovation Challenge', 'Fitness wearables hackathon']) {
    assert.equal(matchFields(it(t), f).length, 1, t);
  }
  assert.equal(matchFields(it('Running a web3 node'), f).length, 0);
});

test('matches are ordered by priority, then strength', () => {
  const fields = [{ name: 'Innovation', priority: 'low' }, { name: 'AI', priority: 'high' }];
  const m = matchFields(it('AI Innovation Hackathon'), fields);
  assert.deepEqual(m.map((x) => x.name), ['AI', 'Innovation']);
});

test('custom fields use their own words and extra keywords', () => {
  const music = { name: 'Music', priority: 'medium', keywords: ['spotify', 'audio'] };
  assert.equal(matchFields(it('Spotify Audio Hack'), [music]).length, 1);
  assert.equal(matchFields(it('Music Tech Jam'), [music]).length, 1);
  assert.equal(matchFields(it('Climate Hack'), [music]).length, 0);
});

test('AI-assigned fields count as a match', () => {
  assert.equal(matchFields(it('Mystery Hack', { aiFields: ['Sports'] }), [{ name: 'Sports', priority: 'high' }]).length, 1);
});

test('canonical names and sanitizing', () => {
  assert.equal(canonicalFieldName('artificial intelligence'), 'AI');
  assert.equal(canonicalFieldName('sport'), 'Sports');
  assert.equal(canonicalFieldName('  music  production '), 'Music production');
  const s = sanitizeFields([{ name: 'ai', priority: 'high' }, { name: 'AI', priority: 'low' }, { name: 'x' }, { name: 'Fintech', priority: 'bogus' }, null]);
  assert.deepEqual(s, [{ name: 'AI', priority: 'high' }, { name: 'Fintech', priority: 'medium' }]);
  assert.equal(sanitizeFields('nope'), null);
});

test('suggestions come from fields the user did not pick', () => {
  const other = otherFieldsFor(it('DeFi Ethereum Blockchain Hackathon'), DEFAULT_FIELDS);
  assert.equal(other[0], 'Web3 & Blockchain');
});

test('high priority fields produce more search queries', () => {
  const hi = fieldQueries([{ name: 'Sports', priority: 'high' }]);
  const lo = fieldQueries([{ name: 'Sports', priority: 'low' }]);
  assert.ok(hi.length > lo.length);
});

test('relevance ranks high-priority matches above low', () => {
  const a = relevance(it('x'), [{ name: 'AI', priority: 'high', score: 3 }]);
  const b = relevance(it('x'), [{ name: 'Fintech', priority: 'low', score: 9 }]);
  assert.ok(a > b);
});

test('Sports covers leagues, clubs and individual sports without false positives', () => {
  const f = [{ name: 'Sports', priority: 'high' }];
  const yes = ['Microsoft x Premier League Hackathon', 'EPL Data Hack', 'Real Madrid innovation challenge', 'Padel tech hackathon', 'NBA hack', 'EuroLeague basketball data jam', 'Formula 1 strategy hackathon', 'Maccabi Tel Aviv fan app hack', 'FIFA World Cup hackathon', 'Wimbledon AI challenge'];
  for (const t of yes) assert.equal(matchFields(it(t), f).length, 1, t);
  const no = ['Agents League Hackathon', 'Infineon Boss Battle in the AI Arena', 'Improve F1 score with LLMs', 'AJAX web performance hack', 'Code Warriors Hackathon', 'AI coach for students', 'Matchmaking app jam'];
  for (const t of no) assert.equal(matchFields(it(t), f).length, 0, t);
});
