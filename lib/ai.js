/**
 * Optional AI discovery layer. Finds open hackathons announced on LinkedIn,
 * company sites and news that the platform APIs don't list.
 *
 * Providers (picked automatically, or with AI_PROVIDER=gemini|anthropic|off):
 *  - gemini    FREE tier: Gemini + Grounding with Google Search (GEMINI_API_KEY)
 *  - anthropic paid: Claude with server-side web search (ANTHROPIC_API_KEY)
 * Every AI result's link is checked before it is shown (see verify.js).
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt, parseJsonLoose, toItems } from './ai-common.js';
import * as gemini from './gemini.js';
import { verifyItems } from './verify.js';

export const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

/** Which AI provider is active, or null. Gemini (free) wins when both keys are set. */
export function aiProvider() {
  const forced = (process.env.AI_PROVIDER || '').toLowerCase();
  if (forced === 'off' || process.env.AI_DISCOVERY === 'off') return null;
  const hasGemini = gemini.geminiKey();
  const hasClaude = !!process.env.ANTHROPIC_API_KEY;
  if (forced === 'gemini') return hasGemini ? 'gemini' : null;
  if (forced === 'anthropic') return hasClaude ? 'anthropic' : null;
  if (hasGemini) return 'gemini';
  if (hasClaude) return 'anthropic';
  return null;
}

export function aiEnabled() {
  return aiProvider() !== null;
}

let client;
function getClient() {
  client ??= new Anthropic({ timeout: 240_000, maxRetries: 2 });
  return client;
}

export const HACKATHON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hackathons'],
  properties: {
    hackathons: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url', 'organizer', 'description', 'fields', 'registration_deadline', 'start_date', 'end_date', 'location', 'online', 'prize', 'evidence'],
        properties: {
          title: { type: 'string' },
          url: { type: 'string', description: 'Official registration or info page (not a news article when an official page exists)' },
          organizer: { type: 'string' },
          description: { type: 'string', description: 'One or two sentences' },
          fields: { type: 'array', items: { type: 'string' }, description: 'Which of the requested fields it fits' },
          registration_deadline: { type: 'string', description: 'ISO 8601 date, or empty string if unknown' },
          start_date: { type: 'string', description: 'ISO 8601 date, or empty string if unknown' },
          end_date: { type: 'string', description: 'ISO 8601 date, or empty string if unknown' },
          location: { type: 'string', description: 'City/country, or "Online"' },
          online: { type: 'boolean' },
          prize: { type: 'string', description: 'Prize pool if stated, else empty string' },
          evidence: { type: 'string', description: 'Where you confirmed registration is open (short)' },
        },
      },
    },
  },
};

/** Runs one Claude request with server tools, resuming on pause_turn. */
async function runWithTools(params, { maxContinuations = 4 } = {}) {
  const messages = [...params.messages];
  let message;
  for (let i = 0; i <= maxContinuations; i++) {
    const stream = getClient().beta.messages.stream({ ...params, messages });
    message = await stream.finalMessage();
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }
  return message;
}

/** Claude with server-side web search. Returns raw (unverified) items. */
async function discoverClaude({ fields, leads, knownTitles, now }) {
  const highCount = fields.filter((f) => f.priority === 'high').length;
  const searches = Math.min(8 + highCount * 3 + fields.length, 24);
  const base = {
    model: AI_MODEL,
    max_tokens: 32000,
    output_config: { effort: process.env.AI_EFFORT || 'medium', format: { type: 'json_schema', schema: HACKATHON_SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    tools: [
      { type: 'web_search_20260209', name: 'web_search', max_uses: searches },
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 12 },
    ],
    messages: [{ role: 'user', content: buildPrompt({ fields, leads, knownTitles, today: now.toISOString().slice(0, 10) }) }],
  };

  let message;
  try {
    message = await runWithTools(base);
  } catch (e) {
    // Fall back to plain JSON-in-text if the account or model rejects structured output or fallbacks.
    if (e?.status === 400) {
      const { output_config, betas, fallbacks, ...rest } = base;
      message = await runWithTools({ ...rest, output_config: { effort: output_config.effort } });
    } else {
      throw e;
    }
  }
  if (message.stop_reason === 'refusal') return [];
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = parseJsonLoose(text);
  return toItems(data, 'AI web search');
}

/**
 * Finds hackathons with the active provider and drops results whose link is dead.
 * @returns {Promise<Array>} normalized raw items (same shape as sources)
 */
export async function discover({ fields, leads = [], knownTitles = [], now = new Date(), verify = verifyItems }) {
  const provider = aiProvider();
  if (!provider) return [];
  const raw = provider === 'gemini'
    ? await gemini.discover({ fields, leads, knownTitles, now })
    : await discoverClaude({ fields, leads, knownTitles, now });
  return verify(raw);
}

/** Expands a custom field (e.g. "Music") into ~15 keywords for matching. */
export async function expandField(name) {
  const provider = aiProvider();
  if (!provider) return [];
  if (provider === 'gemini') return gemini.expandField(name);
  const res = await getClient().messages.create({
    model: AI_MODEL,
    max_tokens: 2000,
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: { type: 'object', additionalProperties: false, required: ['keywords'], properties: { keywords: { type: 'array', items: { type: 'string' } } } },
      },
    },
    messages: [{
      role: 'user',
      content: `List 15 short lowercase keywords or phrases that would appear in the title or description of a hackathon about "${name}". Include synonyms, sub-topics and well-known organizations or brands in that space. Single words or two-word phrases only.`,
    }],
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = parseJsonLoose(text);
  return (data?.keywords || []).map((k) => String(k).toLowerCase().trim()).filter((k) => k && k.length <= 40).slice(0, 20);
}
