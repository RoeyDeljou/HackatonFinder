/** Prompt + parsing shared by every AI provider. */

export function buildPrompt({ fields, leads = [], knownTitles = [], today, focus = null }) {
  const fieldLines = fields.map((f) => `- ${f.name} (priority: ${f.priority})`).join('\n');
  const leadLines = leads.length ? leads.map((l) => `- ${l.title}${l.organizer ? ` (${l.organizer})` : ''}`).join('\n') : '(none)';
  const focusLine = focus
    ? `Focus this search on ${focus} hackathons. Search several different ways (synonyms, sub-topics, big brands and leagues in this space).`
    : 'Search harder for high-priority fields. Also include strong hackathons from other fields if you come across them.';
  return `Today is ${today}. Find hackathons that are OPEN FOR REGISTRATION right now (or open soon), in these fields:
${fieldLines}

${focusLine}

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

/** The JSON shape every provider is asked to return. */
export const JSON_SHAPE = `Reply with ONLY a JSON object, no prose, in exactly this shape:
{"hackathons":[{"title":"","url":"","organizer":"","description":"","fields":[""],"registration_deadline":"YYYY-MM-DD or empty","start_date":"YYYY-MM-DD or empty","end_date":"YYYY-MM-DD or empty","location":"","online":false,"prize":"","evidence":""}]}`;

export function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

const iso = (s) => {
  if (!s || typeof s !== 'string') return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Converts a provider's {hackathons:[…]} answer into normalized raw items. */
export function toItems(data, source = 'AI web search') {
  const list = Array.isArray(data?.hackathons) ? data.hackathons : [];
  return list
    .filter((h) => h && h.title && /^https?:\/\//.test(h.url || ''))
    .map((h) => ({
      title: String(h.title).trim(),
      url: h.url,
      source,
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
      aiFields: Array.isArray(h.fields) ? h.fields.filter((f) => typeof f === 'string') : [],
      evidence: h.evidence || '',
      kind: 'hackathon',
    }));
}
