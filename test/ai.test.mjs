// AI discovery against a simulated Anthropic Messages API (SSE).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key';
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
// The SDK client keeps the fetch it saw first, so route through one swappable handler.
let handler = null;
globalThis.fetch = (url, init) => handler(url, init);
const ai = await import('../lib/ai.js');

function sse(message, text) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const { stop_reason, ...msg } = message;
  return [
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: ai.AI_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 }, ...msg } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } }),
    ev('message_stop', {}),
  ].join('');
}

test('discover sends web tools + structured output, resumes pause_turn, and normalizes results', async () => {
  const bodies = [];
  const headers = [];
  handler = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    headers.push(new Headers(init.headers));
    const first = bodies.length === 1;
    const payload = {
      hackathons: [
        { title: 'NBA Launchpad Hack', url: 'https://nba.com/launchpad-hack', organizer: 'NBA', description: 'Build for fans.', fields: ['Sports'], registration_deadline: '2026-11-20', start_date: '2026-12-01', end_date: '', location: 'Online', online: true, prize: '$20,000', evidence: 'Official page says registration open' },
        { title: 'No URL Hack', url: 'not-a-url', organizer: '', description: '', fields: [], registration_deadline: '', start_date: '', end_date: '', location: '', online: false, prize: '', evidence: '' },
      ],
    };
    const body = first ? sse({ stop_reason: 'pause_turn' }, 'Searching...') : sse({ stop_reason: 'end_turn' }, JSON.stringify(payload));
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const items = await ai.discover({ fields: [{ name: 'Sports', priority: 'high' }, { name: 'AI', priority: 'medium' }], leads: [{ title: 'NBA announces hackathon', organizer: 'ESPN' }], knownTitles: ['Known Hack'], now: new Date('2026-10-18T12:00:00Z'), verify: async (x) => x });
    assert.equal(bodies.length, 2, 'resumed after pause_turn');
    const b = bodies[0];
    assert.equal(b.model, 'claude-opus-5-5');
    assert.equal(b.stream, true);
    assert.deepEqual(b.tools.map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
    assert.equal(b.output_config.format.type, 'json_schema');
    assert.equal(b.fallbacks, 'default');
    assert.ok(!('thinking' in b) || b.thinking.type === 'adaptive');
    assert.match(headers[0].get('anthropic-beta') || '', /server-side-fallback-2026-07-01/);
    assert.match(b.messages[0].content, /Sports \(priority: high\)/);
    assert.match(b.messages[0].content, /NBA announces hackathon/);
    assert.match(b.messages[0].content, /Known Hack/);
    assert.equal(bodies[1].messages.at(-1).role, 'assistant', 'paused turn appended');

    assert.equal(items.length, 1, 'invalid url dropped');
    const [nba] = items;
    assert.equal(nba.source, 'AI web search');
    assert.equal(nba.deadline, '2026-11-20T23:59:59.000Z');
    assert.deepEqual(nba.aiFields, ['Sports']);
    assert.equal(nba.online, true);
  } finally {
    handler = null;
  }
});

test('discover falls back to plain JSON when the API rejects the request shape', async () => {
  const bodies = [];
  handler = async (url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (bodies.length === 1) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: unsupported' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response(sse({ stop_reason: 'end_turn' }, 'Here you go: {"hackathons":[{"title":"Fit Hack","url":"https://fit.example","organizer":"","description":"","fields":["Sports"],"registration_deadline":"","start_date":"","end_date":"","location":"","online":false,"prize":"","evidence":""}]}'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const items = await ai.discover({ fields: [{ name: 'Sports', priority: 'high' }], verify: async (x) => x });
    assert.equal(items.length, 1);
    assert.ok(!('fallbacks' in bodies[1]) && !bodies[1].output_config.format);
  } finally {
    handler = null;
  }
});
