/**
 * Field library + matching. A "field" is a topic the user wants (Sports, AI…).
 * Known fields carry curated keywords; custom fields fall back to their own
 * words plus any AI-expanded keywords stored on the profile.
 */

export const PRIORITIES = { high: 3, medium: 2, low: 1 };

export const DEFAULT_FIELDS = [
  { name: 'Sports', priority: 'high' },
  { name: 'AI', priority: 'high' },
  { name: 'Innovation', priority: 'high' },
];

// Keywords are matched on word boundaries, case-insensitively.
export const FIELD_LIBRARY = {
  AI: {
    queries: ['ai', 'generative ai', 'ai agents', 'machine learning', 'llm'],
    aliases: ['artificial intelligence', 'machine learning', 'ml', 'genai', 'generative ai', 'llm', 'ai/ml'],
    keywords: ['ai', 'a.i.', 'artificial intelligence', 'machine learning', 'ml', 'deep learning', 'llm', 'llms', 'genai', 'gen ai', 'generative', 'gpt', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'mistral', 'llama', 'agent', 'agents', 'agentic', 'multi-agent', 'rag', 'computer vision', 'nlp', 'neural', 'transformer', 'diffusion', 'copilot', 'chatbot', 'prompt', 'mcp', 'model context protocol', 'hugging face', 'nvidia', 'data science', 'executorch', 'pytorch', 'tensorflow', 'voice agent', 'elevenlabs', 'codex', 'vibe coding'],
  },
  Sports: {
    queries: ['sports', 'football', 'premier league', 'sportstech', 'basketball', 'nba', 'fifa', 'sports analytics', 'esports', 'fitness'],
    // Sub-searches for the AI web search: each becomes its own focused query.
    aiFocus: [
      'football/soccer: leagues (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, MLS, Israeli Premier League), clubs, FIFA, UEFA, and football analytics',
      'basketball (NBA, WNBA, EuroLeague), American football (NFL), baseball (MLB), ice hockey (NHL), and their teams',
      'tennis, golf, Formula 1 and motorsport, Olympics, cycling, running, cricket, rugby, combat sports, esports, fitness and sports tech (wearables, sports analytics, fan engagement)',
    ],
    aliases: ['sport', 'sportstech', 'sports tech', 'sports & fitness', 'fitness', 'esports', 'football', 'soccer', 'basketball'],
    keywords: [
      // general
      'sport', 'sports', 'sportstech', 'sports tech', 'sports-tech', 'sporttech', 'athlete', 'athletes', 'athletic', 'athletics', 'sports analytics', 'sports science', 'sports data', 'sports betting', 'fan engagement', 'fan experience', 'stadium', 'matchday', 'world cup', 'olympic', 'olympics', 'paralympic', 'paralympics', 'referee', 'fitness', 'workout', 'gym', 'wearable', 'wearables',
      // sports
      'football', 'footballer', 'soccer', 'futsal', 'basketball', 'baseball', 'softball', 'american football', 'tennis', 'padel', 'pickleball', 'golf', 'cricket', 'rugby', 'hockey', 'ice hockey', 'volleyball', 'handball', 'cycling', 'marathon', 'triathlon', 'swimming', 'rowing', 'sailing', 'surfing', 'skiing', 'snowboard', 'skateboarding', 'climbing', 'boxing', 'mma', 'wrestling', 'judo', 'karate', 'taekwondo', 'fencing', 'gymnastics', 'motorsport', 'motorsports', 'formula 1', 'formula one', 'motogp', 'nascar', 'indycar', 'horse racing', 'equestrian', 'esports', 'e-sports',
      // leagues & bodies
      'premier league', 'english premier league', 'epl', 'la liga', 'laliga', 'serie a', 'bundesliga', 'ligue 1', 'eredivisie', 'champions league', 'europa league', 'uefa', 'fifa', 'mls', 'nwsl', 'nba', 'wnba', 'euroleague', 'fiba', 'nfl', 'ncaa', 'mlb', 'nhl', 'ipl', 'atp', 'wta', 'pga', 'lpga', 'ufc', 'wwe', 'world athletics', 'tour de france', 'super bowl', 'wimbledon', 'roland garros', 
      // clubs & brands
      'manchester united', 'manchester city', 'liverpool fc', 'arsenal fc', 'chelsea fc', 'tottenham', 'real madrid', 'fc barcelona', 'atletico madrid', 'juventus', 'ac milan', 'inter milan', 'bayern munich', 'borussia dortmund', 'psg', 'paris saint-germain', 'maccabi', 'hapoel', 'beitar', 'lakers', 'golden state warriors', 'celtics', 'mercedes amg', 'red bull racing', 'ferrari', 'mclaren', 'nike', 'adidas', 'puma', 'under armour', 'new balance', 'asics', 'peloton', 'strava', 'garmin', 'whoop', 'catapult', 'hudl', 'second spectrum', 'stats perform', 'opta', 'sportradar', 'genius sports', 'espn', 'dazn', 'sky sports',
    ],
  },
  Innovation: {
    queries: ['innovation', 'open innovation', 'startup', 'ideathon'],
    aliases: ['innovations', 'open innovation', 'startups', 'entrepreneurship'],
    keywords: ['innovation', 'innovations', 'innovate', 'innovative', 'innovator', 'innovators', 'open innovation', 'startup', 'startups', 'entrepreneur', 'entrepreneurs', 'entrepreneurship', 'venture', 'founder', 'founders', 'pitch', 'ideathon', 'moonshot', 'disrupt', 'disruptive', 'emerging tech', 'emerging technologies', 'deep tech', 'future of', 'smart city', 'smart cities', 'open ended', 'prototype', 'r&d', 'incubator', 'accelerator'],
  },
  Fintech: {
    aliases: ['finance', 'fin tech', 'banking', 'payments'],
    keywords: ['fintech', 'fin tech', 'finance', 'financial', 'banking', 'bank', 'payments', 'payment', 'trading', 'insurtech', 'insurance', 'credit', 'lending', 'wealth', 'stripe', 'visa', 'mastercard', 'paypal'],
  },
  'Web3 & Blockchain': {
    aliases: ['web3', 'blockchain', 'crypto', 'defi', 'ethereum'],
    keywords: ['web3', 'blockchain', 'crypto', 'cryptocurrency', 'defi', 'ethereum', 'eth', 'solana', 'bitcoin', 'nft', 'nfts', 'dao', 'smart contract', 'smart contracts', 'zk', 'zero knowledge', 'layer 2', 'polygon', 'avalanche', 'sui', 'aptos', 'starknet', 'cosmos', 'polkadot', 'onchain', 'on-chain', 'dapp'],
  },
  Health: {
    aliases: ['healthcare', 'medtech', 'health tech', 'healthtech', 'medical', 'biotech'],
    keywords: ['health', 'healthcare', 'health tech', 'healthtech', 'medtech', 'medical', 'medicine', 'hospital', 'clinical', 'patient', 'patients', 'mental health', 'wellness', 'wellbeing', 'biotech', 'bio', 'genomics', 'pharma', 'digital health'],
  },
  'Climate & Sustainability': {
    aliases: ['climate', 'sustainability', 'cleantech', 'green', 'environment', 'energy'],
    keywords: ['climate', 'sustainability', 'sustainable', 'cleantech', 'clean tech', 'green', 'environment', 'environmental', 'energy', 'renewable', 'renewables', 'solar', 'carbon', 'net zero', 'circular economy', 'recycling', 'ocean', 'biodiversity', 'agritech', 'agriculture', 'water'],
  },
  Education: {
    aliases: ['edtech', 'ed tech', 'learning'],
    keywords: ['education', 'edtech', 'ed tech', 'learning', 'students', 'school', 'teacher', 'teachers', 'classroom', 'university', 'e-learning', 'tutoring'],
  },
  Cybersecurity: {
    aliases: ['security', 'cyber', 'infosec', 'ctf'],
    keywords: ['cybersecurity', 'cyber security', 'security', 'cyber', 'infosec', 'ctf', 'capture the flag', 'privacy', 'encryption', 'threat', 'malware', 'pentest', 'zero trust'],
  },
  Gaming: {
    aliases: ['games', 'game dev', 'gamedev', 'game jam'],
    keywords: ['gaming', 'game', 'games', 'game dev', 'gamedev', 'game jam', 'unity', 'unreal', 'godot', 'roblox', 'esports', 'metaverse'],
  },
  'Hardware & IoT': {
    aliases: ['hardware', 'iot', 'robotics', 'embedded'],
    keywords: ['hardware', 'iot', 'internet of things', 'embedded', 'arduino', 'raspberry pi', 'robotics', 'robot', 'robots', 'drone', 'drones', 'sensor', 'sensors', 'edge ai', 'firmware', 'fpga', 'microcontroller'],
  },
  'Social Good': {
    aliases: ['social impact', 'nonprofit', 'civic tech', 'govtech'],
    keywords: ['social good', 'social impact', 'nonprofit', 'non-profit', 'ngo', 'civic', 'civic tech', 'govtech', 'government', 'public sector', 'humanitarian', 'accessibility', 'inclusion', 'diversity', 'sdg', 'sdgs', 'digital4good'],
  },
  'Mobility & Space': {
    aliases: ['mobility', 'automotive', 'space', 'aerospace', 'transportation'],
    keywords: ['mobility', 'automotive', 'autonomous', 'vehicle', 'vehicles', 'ev', 'transportation', 'transport', 'logistics', 'space', 'aerospace', 'satellite', 'nasa', 'esa', 'maritime', 'aviation'],
  },
  'AR/VR': {
    aliases: ['xr', 'vr', 'ar', 'mixed reality', 'spatial computing'],
    keywords: ['ar', 'vr', 'xr', 'augmented reality', 'virtual reality', 'mixed reality', 'spatial computing', 'vision pro', 'metaverse'],
  },
  'Data & Cloud': {
    aliases: ['data', 'cloud', 'devtools', 'developer tools', 'open source'],
    keywords: ['data', 'database', 'analytics', 'big data', 'cloud', 'aws', 'azure', 'google cloud', 'gcp', 'devops', 'serverless', 'api', 'apis', 'open source', 'developer tools', 'devtools', 'snowflake', 'databricks', 'supabase', 'datathon'],
  },
};

export const SUGGESTED_FIELDS = Object.keys(FIELD_LIBRARY);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
function wordRegex(keyword) {
  let re = reCache.get(keyword);
  if (!re) {
    // Word boundaries that also work for keywords with punctuation (a.i., r&d, ai/ml).
    re = new RegExp(`(^|[^a-z0-9])${escapeRe(keyword.toLowerCase())}(?=$|[^a-z0-9])`, 'i');
    reCache.set(keyword, re);
  }
  return re;
}

/** Finds the library entry for a user-entered field name, if any. */
export function libraryEntry(name) {
  const n = String(name || '').trim().toLowerCase();
  for (const [key, entry] of Object.entries(FIELD_LIBRARY)) {
    if (key.toLowerCase() === n || entry.aliases.includes(n)) return { key, ...entry };
  }
  return null;
}

/** Canonical display name: "ai" → "AI", "sport" → "Sports", unknown → trimmed input. */
export function canonicalFieldName(name) {
  const entry = libraryEntry(name);
  if (entry) return entry.key;
  const s = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Keywords for a field (library + custom extras). */
export function fieldKeywords(field) {
  const entry = libraryEntry(field.name);
  const base = entry ? entry.keywords : [];
  const own = String(field.name || '').toLowerCase();
  const words = own.split(/[\s/&,]+/).filter((w) => w.length >= 4);
  const extra = Array.isArray(field.keywords) ? field.keywords : [];
  return [...new Set([own, ...words, ...base, ...extra].map((k) => String(k).toLowerCase().trim()).filter(Boolean))];
}

/** AI sub-searches for a field: curated sub-topics, or the field itself. */
export function aiFocusFor(field) {
  const entry = libraryEntry(field.name);
  return entry?.aiFocus?.length ? entry.aiFocus.map((f) => `${field.name} (${f})`) : [field.name];
}

/** Search queries to send to keyword-searchable sources, more for higher priority. */
export function fieldQueries(fields) {
  const perPriority = { high: 6, medium: 2, low: 1 };
  const sorted = [...fields].sort((a, b) => (PRIORITIES[b.priority] || 0) - (PRIORITIES[a.priority] || 0));
  const out = [];
  for (const f of sorted) {
    const entry = libraryEntry(f.name);
    const own = f.name.toLowerCase();
    const pool = [own, ...(entry?.queries || []), ...(f.keywords || []), ...fieldKeywords(f).filter((k) => k.length > 3)];
    out.push(...[...new Set(pool)].slice(0, perPriority[f.priority] || 2));
  }
  return [...new Set(out)];
}

/**
 * Scores how well an item matches one field. Title hits weigh most, then
 * tags/themes, then description/organizer.
 */
export function scoreField(item, field) {
  const kws = fieldKeywords(field);
  const title = item.title || '';
  const tags = (item.tags || []).join(' | ');
  const body = [item.description, item.organizer].filter(Boolean).join(' ');
  let score = 0;
  for (const k of kws) {
    const re = wordRegex(k);
    if (re.test(title)) score += 3;
    else if (re.test(tags)) score += 2;
    else if (re.test(body)) score += 1;
  }
  // AI-assigned fields (from AI discovery) count as a strong signal.
  if ((item.aiFields || []).some((f) => f.toLowerCase() === field.name.toLowerCase())) score += 3;
  return score;
}

/** Which of the given fields an item belongs to, strongest first. */
export function matchFields(item, fields) {
  return fields
    .map((f) => ({ name: f.name, priority: f.priority, score: scoreField(item, f) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => (PRIORITIES[b.priority] - PRIORITIES[a.priority]) || b.score - a.score);
}

/** Which library fields (not chosen by the user) an item fits, for "suggestions". */
export function otherFieldsFor(item, chosen) {
  const chosenKeys = new Set(chosen.map((f) => (libraryEntry(f.name)?.key || f.name).toLowerCase()));
  return Object.keys(FIELD_LIBRARY)
    .filter((k) => !chosenKeys.has(k.toLowerCase()))
    .map((k) => ({ name: k, score: scoreField(item, { name: k }) }))
    .filter((m) => m.score >= 2)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.name);
}

/** Ranking score: priority of best field dominates, then match strength, then urgency/popularity. */
export function relevance(item, matches, now = Date.now()) {
  const best = matches[0];
  let r = best ? PRIORITIES[best.priority] * 100 + Math.min(best.score, 12) * 4 + (matches.length - 1) * 6 : 0;
  if (item.kind === 'announcement') r -= 25;
  if (item.participants) r += Math.min(Math.log10(item.participants + 1) * 4, 16);
  if (item.prize && /\d/.test(item.prize)) r += 6;
  const dl = item.deadline ? new Date(item.deadline).getTime() : null;
  if (dl) {
    const days = (dl - now) / 864e5;
    if (days < 3) r += 4; // closing soon: surface it
  }
  return Math.round(r);
}

/** Validates and cleans a user-supplied field list. */
export function sanitizeFields(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of input.slice(0, 25)) {
    if (!raw || typeof raw.name !== 'string') continue;
    const name = canonicalFieldName(raw.name);
    if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const priority = PRIORITIES[raw.priority] ? raw.priority : 'medium';
    const keywords = Array.isArray(raw.keywords)
      ? raw.keywords.filter((k) => typeof k === 'string' && k.length <= 40).slice(0, 25)
      : undefined;
    out.push({ name, priority, ...(keywords?.length ? { keywords } : {}) });
  }
  return out;
}
