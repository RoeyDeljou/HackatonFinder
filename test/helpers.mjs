import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
export const fixture = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
export const NOW = new Date('2026-10-18T12:00:00Z');

export function tmpFile(name = 'db.json') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hf-')), name);
}

/** Replaces global fetch with one that answers hackathon-source URLs from fixtures. */
export function mockFetch({ fail = [] } = {}) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url || input);
    calls.push(url);
    const respond = (body, type = 'application/json') => new Response(body, { status: 200, headers: { 'content-type': type } });
    const host = new URL(url).hostname;
    if (fail.some((f) => host.includes(f))) throw new TypeError('fetch failed');
    if (host === 'devpost.com') return url.includes('page=1') ? respond(fixture('devpost.json')) : respond('{"hackathons":[]}');
    if (host === 'api.devfolio.co') return respond(fixture('devfolio.json'));
    if (host.endsWith('mlh.com')) return url.includes('/2027/') ? respond(fixture('mlh.html'), 'text/html') : new Response('nope', { status: 404 });
    if (host === 'api.lu.ma') return respond(fixture('luma.json'));
    if (host === 'hackathons.hackclub.com') return respond(fixture('hackclub.json'));
    if (host === 'lablab.ai') return respond(fixture('lablab.html'), 'text/html');
    if (host === 'cerebralvalley.ai') return respond(fixture('cerebralvalley.html'), 'text/html');
    if (host === 'www.hackster.io') return respond(fixture('hackster.html'), 'text/html');
    if (host === 'html.duckduckgo.com') return respond(fixture('ddg.html'), 'text/html');
    if (host === 'news.google.com') return respond(fixture('gnews.xml'), 'application/xml');
    if (host === '127.0.0.1' || host === 'localhost') return real(input, init);
    throw new TypeError(`unexpected fetch ${url}`);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
