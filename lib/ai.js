/**
 * Optional AI layer (enabled when ANTHROPIC_API_KEY is set):
 *  1. discover(): Claude uses server-side web search/fetch to find open
 *     hackathons announced on LinkedIn, company sites and news that the
 *     platform APIs don't list, and returns them as structured JSON.
 *  2. expandField(): turns a custom field name into matching keywords.
 */
import Anthropic from '@anthropic-ai/sdk';

export const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY && process.env.AI_DISCOVERY !== 'off';
}

let client;
function getClient() {
  client ??= new Anthropic({ timeout: 240_000, maxRetries: 2 });
  return client;
}

const HACKATHON_SCHEMA = {
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

function buildPrompt({ fields, leads, knownTitles, today }) {
  const fieldLines = fields.map((f) => `- ${f.name} (priority: ${f.priority})`).join('\n');
  const leadLines = leads.length ? leads.map((l) => `- ${l.title}${l.organizer ? ` (${l.organizer})` : ''}`).join('\n') : '(none)';
  return `Today is ${today}. Find hackathons that are OPEN FOR REGISTRATION right now (or open soon), in these fields:
${fieldLines}

Search harder for high-priority fields. Also include strong hackathons from other fields if you come across them.

Where to look: LinkedIn posts and company pages, the hackathon or developer pages of major companies (for example Google, Microsoft, Meta, NVIDIA, AWS, OpenAI, IBM, Intel, Samsung, Adidas, Nike, FIFA, NBA, NFL, UEFA, Formula 1 teams, football clubs), universities, accelerators, government innovation programs, X/Twitter, and recent tech news. Platforms like Devpost, Devfolio, MLH, Luma and lablab are already covered, so focus on what is announced elsewhere.

Recent news headlines worth checking (find the official page and confirm the dates):
${leadLines}

Already known, so skip these: ${knownTitles.slice(0, 120).join(' | ') || '(none)'}

Rules:
- Only include a hackathon if you found evidence that registration or applications are currently open or will open soon. Skip anything that has ended or whose deadline has passed.
- The url must be the official registration or info page. Use a news article only if no official page exists.
- Use ISO dates (YYYY-MM-DD). Leave a date empty when it is unknown. Never guess a date.
- Quality over quantity: 5-25 verified results is ideal.`;
}

function parseJsonLoose(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

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

/**
 * @returns {Promise<Array>} normalized raw items (same shape as sources)
 */
export async function discover({ fields, leads = [], knownTitles = [], now = new Date() }) {
  if (!aiEnabled()) return [];
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
  const list = Array.isArray(data?.hackathons) ? data.hackathons : [];
  const iso = (s) => {
    if (!s) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59Z` : s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return list
    .filter((h) => h && h.title && /^https?:\/\//.test(h.url || ''))
    .map((h) => ({
      title: String(h.title).trim(),
      url: h.url,
      source: 'AI web search',
      organizer: h.organizer || null,
      description: h.description || '',
      image: null,
      startDate: iso(h.start_date),
      endDate: iso(h.end_date),
      deadline: iso(h.registration_deadline) || iso(h.start_date) || iso(h.end_date),
      location: h.location || (h.online ? 'Online' : null),
      online: typeof h.online === 'boolean' ? h.online : null,
      prize: h.prize || null,
      participants: null,
      tags: [],
      aiFields: Array.isArray(h.fields) ? h.fields : [],
      evidence: h.evidence || '',
      kind: 'hackathon',
    }));
}

/** Expands a custom field (e.g. "Music") into ~15 keywords for matching. */
export async function expandField(name) {
  if (!aiEnabled()) return [];
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
