import { getStore } from '../store.js';
import { UA, fetchJSON, fetchText, stripHtml, summarize, parseDateRange, parseDayEnd, toIso, decodeEntities, extractJsonAt, mapLimit, uniqBy } from '../util.js';

/**
 * Every source returns normalized raw items:
 * { title, url, source, organizer, description, image, startDate, endDate,
 *   deadline, location, online, prize, participants, tags[], kind }
 * deadline = last moment you can still register/submit (ISO) when known.
 */

function item(fields) {
  const out = {
    title: '', url: '', source: '', organizer: null, description: '', image: null,
    startDate: null, endDate: null, deadline: null, location: null, online: null,
    prize: null, participants: null, tags: [], kind: 'hackathon',
    ...fields,
  };
  out.title = decodeEntities(String(out.title || '')).replace(/\s+/g, ' ').trim();
  return out;
}

// ---------------------------------------------------------------- Devpost
export function parseDevpost(json) {
  return (json.hackathons || [])
    .filter((h) => !h.invite_only && h.open_state !== 'ended')
    .map((h) => {
      const { start, end } = parseDateRange(h.submission_period_dates);
      const loc = h.displayed_location?.location || null;
      return item({
        title: h.title,
        url: h.url,
        source: 'Devpost',
        organizer: h.organization_name || null,
        image: h.thumbnail_url ? (h.thumbnail_url.startsWith('//') ? 'https:' + h.thumbnail_url : h.thumbnail_url) : null,
        startDate: start,
        endDate: end,
        deadline: end,
        location: loc,
        online: loc ? /online/i.test(loc) : null,
        prize: h.prize_amount ? decodeEntities(h.prize_amount.replace(/<[^>]*>/g, '')).trim() : null,
        participants: h.registrations_count ?? null,
        tags: (h.themes || []).map((t) => t.name),
        description: h.time_left_to_submission ? `Submissions: ${h.submission_period_dates} (${h.time_left_to_submission})` : '',
      });
    });
}

async function fetchDevpost() {
  const base = 'https://devpost.com/api/hackathons?status[]=open&status[]=upcoming&per_page=40';
  const first = await fetchJSON(`${base}&page=1`);
  const total = first.meta?.total_count || 0;
  const perPage = first.meta?.per_page || (first.hackathons || []).length || 40;
  const pages = Math.min(Math.ceil(total / perPage), 25);
  const rest = await mapLimit(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2),
    4,
    (p) => fetchJSON(`${base}&page=${p}`).catch(() => ({ hackathons: [] })),
  );
  return [first, ...rest].flatMap(parseDevpost);
}

// ---------------------------------------------------------------- Devfolio
export function parseDevfolio(json) {
  return (json?.hits?.hits || []).map(({ _source: h }) => {
    const s = h.hackathon_setting || {};
    const sub = s.subdomain || h.slug;
    return item({
      title: h.name,
      url: s.external_apply_url || `https://${sub}.devfolio.co/`,
      source: 'Devfolio',
      organizer: h.hosted_by?.name || null,
      description: summarize(h.tagline || h.desc),
      image: h.cover_img || s.logo || null,
      startDate: toIso(h.starts_at),
      endDate: toIso(h.ends_at),
      deadline: toIso(s.reg_ends_at) || toIso(h.ends_at),
      location: h.is_online ? 'Online' : [h.city, h.country].filter(Boolean).join(', ') || h.location || null,
      online: !!h.is_online,
      participants: h.participants_count ?? null,
      tags: [...(h.themes || []).map((t) => t.name), ...(h.hashtags || []).map((t) => t.name || t)].filter(Boolean),
    });
  });
}

async function fetchDevfolio() {
  const call = (type) =>
    fetchJSON('https://api.devfolio.co/api/search/hackathons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, from: 0, size: 100 }),
    });
  const results = await Promise.allSettled([call('application_open'), call('upcoming')]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw results[0].reason;
  return ok.flatMap((r) => parseDevfolio(r.value));
}

// ---------------------------------------------------------------- MLH
export function parseMlh(html) {
  const m = html.match(/<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('MLH page format changed');
  const props = JSON.parse(m[1]).props || {};
  return (props.upcomingEvents || [])
    .filter((e) => e.status !== 'ended' && e.status !== 'in_progress')
    .map((e) =>
      item({
        title: e.name,
        url: e.websiteUrl || `https://www.mlh.com/events/${e.slug}`,
        source: 'MLH',
        organizer: 'Major League Hacking',
        image: e.backgroundUrl || e.logoUrl || null,
        startDate: toIso(e.startsAt),
        endDate: toIso(e.endsAt),
        deadline: toIso(e.startsAt),
        location: e.formatType === 'digital' ? 'Online' : e.location || null,
        online: e.formatType === 'digital' ? true : e.formatType === 'physical' ? false : null,
        tags: [...(e.customFields?.hackathon_focus || []), e.region].filter(Boolean),
      }),
    );
}

async function fetchMlh() {
  const now = new Date();
  const season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const pages = await Promise.allSettled(
    [season, season + 1].map((y) => fetchText(`https://www.mlh.com/seasons/${y}/events`, {}, { retries: 1 })),
  );
  const ok = pages.filter((p) => p.status === 'fulfilled');
  if (!ok.length) throw pages[0].reason;
  return ok.flatMap((p) => {
    try { return parseMlh(p.value); } catch { return []; }
  });
}

// ---------------------------------------------------------------- Luma
const HACK_WORDS = /\b(hack(athon|athons|day|night|fest|week)?|buildathon|build[- ]?day|datathon|ideathon|codefest|game ?jam|challenge|sprint)\b/i;

export function parseLuma(json) {
  return (json.entries || [])
    .map((e) => e.event)
    .filter((e) => e && HACK_WORDS.test(e.name))
    .map((e) => {
      const g = e.geo_address_info || {};
      const online = e.location_type === 'online' || e.location_type === 'zoom';
      return item({
        title: e.name,
        url: `https://lu.ma/${e.url}`,
        source: 'Luma',
        image: e.cover_url || null,
        startDate: toIso(e.start_at),
        endDate: toIso(e.end_at),
        deadline: toIso(e.start_at),
        location: online ? 'Online' : g.city_state || [g.city, g.country].filter(Boolean).join(', ') || null,
        online,
        description: '',
      });
    });
}

async function fetchLuma(ctx) {
  const queries = uniqBy(['hackathon', 'buildathon', ...ctx.queries.map((q) => `${q} hackathon`)], (q) => q.toLowerCase()).slice(0, 16);
  const results = await mapLimit(queries, 4, (q) =>
    fetchJSON(`https://api.lu.ma/discover/get-paginated-events?query=${encodeURIComponent(q)}&pagination_limit=50`).catch(() => null),
  );
  if (results.every((r) => r === null)) throw new Error('Luma unreachable');
  return results.filter(Boolean).flatMap(parseLuma);
}

// ---------------------------------------------------------------- Hack Club
export function parseHackClub(json) {
  return (Array.isArray(json) ? json : []).map((e) =>
    item({
      title: e.name,
      url: e.website,
      source: 'Hack Club',
      image: e.banner || e.logo || null,
      startDate: toIso(e.start),
      endDate: toIso(e.end),
      deadline: toIso(e.start),
      location: e.virtual ? 'Online' : [e.city, e.state, e.country].filter(Boolean).join(', ') || null,
      online: !!e.virtual,
      tags: ['High school', e.hybrid ? 'Hybrid' : null].filter(Boolean),
    }),
  );
}

async function fetchHackClub() {
  return parseHackClub(await fetchJSON('https://hackathons.hackclub.com/api/events/upcoming'));
}

// ---------------------------------------------------------------- lablab.ai
/** Joins the Next.js flight payload chunks embedded in the page. */
function nextFlight(html) {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(m[1]); } catch { /* skip malformed chunk */ }
  }
  return out;
}

export function parseLablab(html, now = new Date()) {
  const flight = nextFlight(html);
  const at = flight.indexOf('"sortedEvents":[');
  if (at < 0) throw new Error('lablab page format changed');
  const events = extractJsonAt(flight, at + '"sortedEvents":'.length);
  return events
    .filter((e) => e && e.name && e.slug && e.active !== false && e.signupActive !== false)
    .filter((e) => !e.endAt || new Date(e.endAt) > now)
    .map((e) =>
      item({
        title: e.name,
        url: `https://lablab.ai/ai-hackathons/${e.slug}`,
        source: 'lablab.ai',
        description: summarize(e.description),
        image: e.thumbnailLink || e.imageLink || null,
        startDate: toIso(e.startAt),
        endDate: toIso(e.endAt),
        deadline: toIso(e.endAt),
        location: 'Online',
        online: true,
        tags: ['AI', ...(Array.isArray(e.tech) ? e.tech.map((t) => t?.name || t).filter((t) => typeof t === 'string') : [])],
      }),
    );
}

async function fetchLablab() {
  return parseLablab(await fetchText('https://lablab.ai/ai-hackathons'));
}

// ---------------------------------------------------------------- Cerebral Valley
export function parseCerebralValley(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    if (j['@type'] !== 'ItemList') continue;
    for (const { item: e } of j.itemListElement || []) {
      if (!e) continue;
      const types = [].concat(e['@type'] || []);
      if (!types.includes('Hackathon') && !HACK_WORDS.test(e.name || '')) continue;
      const online = /Online/i.test(e.eventAttendanceMode || '');
      out.push(
        item({
          title: decodeEntities(e.name),
          url: e.url,
          source: 'Cerebral Valley',
          organizer: [].concat(e.organizer || []).map((o) => o.name).filter(Boolean).join(', ') || null,
          description: summarize(e.description),
          image: e.image || null,
          startDate: toIso(e.startDate),
          endDate: toIso(e.endDate),
          deadline: toIso(e.startDate),
          location: online ? 'Online' : e.location?.name && e.location.name !== 'Other' ? e.location.name : null,
          online,
          tags: ['AI'],
        }),
      );
    }
  }
  return out;
}

async function fetchCerebralValley() {
  return parseCerebralValley(await fetchText('https://cerebralvalley.ai/events'));
}

// ---------------------------------------------------------------- Hackster.io
export function parseHackster(html) {
  const out = new Map();
  for (const m of html.matchAll(/href="\/contests\/([^"#?]+)"><h4[^>]*>([^<]+)<\/h4>/g)) {
    const slug = m[1];
    if (out.has(slug)) continue;
    const tail = html.slice(m.index, m.index + 4000);
    const sponsor = tail.match(/<span>With <\/span><span><a[^>]*>([^<]+)<\/a>/);
    const until = tail.match(/(?:open until|Submissions? (?:due|close)[^:]*):<\/p><p[^>]*>([^<]+)<\/p>/i);
    out.set(slug, item({
      title: decodeEntities(m[2].trim()),
      url: `https://www.hackster.io/contests/${slug}`,
      source: 'Hackster.io',
      organizer: sponsor ? decodeEntities(sponsor[1]) : null,
      deadline: until ? parseDayEnd(until[1].trim()) : null,
      endDate: until ? parseDayEnd(until[1].trim()) : null,
      location: 'Online',
      online: true,
      tags: ['Hardware', 'IoT'],
    }));
  }
  return [...out.values()];
}

async function fetchHackster() {
  return parseHackster(await fetchText('https://www.hackster.io/contests'));
}

// ---------------------------------------------------------------- Google News (announcements)
export function parseGoogleNews(xml, now = new Date()) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1];
    const rawTitle = decodeEntities((get('title') || '').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const publisher = decodeEntities(get('source') || '');
    const title = publisher && rawTitle.endsWith(` - ${publisher}`) ? rawTitle.slice(0, -publisher.length - 3) : rawTitle;
    if (!HACK_WORDS.test(title)) continue;
    const pub = toIso(get('pubDate'));
    if (pub && now - new Date(pub) > 30 * 864e5) continue;
    out.push(
      item({
        title,
        url: decodeEntities(get('link') || ''),
        source: 'News',
        organizer: publisher || null,
        description: publisher ? `Announced via ${publisher}` : '',
        kind: 'announcement',
        publishedAt: pub,
      }),
    );
  }
  return out;
}

async function fetchGoogleNews(ctx) {
  const base = ['hackathon registration open', 'hackathon "register now"', 'hackathon announced', 'linkedin hackathon apply'];
  const fieldQ = ctx.queries.slice(0, 14).map((q) => `"${q} hackathon"`);
  const queries = uniqBy([...base, ...fieldQ], (q) => q.toLowerCase());
  const feeds = await mapLimit(queries, 4, (q) =>
    fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:14d')}&hl=en-US&gl=US&ceid=US:en`).catch(() => null),
  );
  if (feeds.every((f) => f === null)) throw new Error('Google News unreachable');
  return feeds.filter(Boolean).flatMap((x) => parseGoogleNews(x));
}

// ---------------------------------------------------------------- Tavily (optional, free tier)
// Web search API with a free 1,000 searches/month. Used for LinkedIn posts and
// company announcements. A monthly counter keeps usage inside the free tier.
const TAVILY_BUDGET = () => Number(process.env.TAVILY_MONTHLY_BUDGET) || 900;
const TAVILY_PER_RUN = 10;

export function tavilyQueries(queries) {
  const topics = queries.slice(0, 6);
  const out = [];
  for (const q of topics.slice(0, 4)) out.push({ query: `${q} hackathon registration open`, include_domains: ['linkedin.com'] });
  for (const q of topics) out.push({ query: `"${q} hackathon" 2026 register` });
  out.push({ query: 'company hackathon announced registration open', include_domains: ['linkedin.com'] });
  return out;
}

export function parseTavily(json, now = new Date()) {
  return (json?.results || [])
    .filter((r) => r?.url && r?.title)
    .map((r) => {
      // LinkedIn titles look like "Jane Doe on LinkedIn: Excited to announce the X Hackathon…"
      let title = decodeEntities(r.title).replace(/^.{0,80}? on LinkedIn:\s*/i, '').replace(/\s*\|\s*LinkedIn$/i, '').trim();
      const body = summarize(r.content || '', 240);
      if (!HACK_WORDS.test(title) && HACK_WORDS.test(body)) title = summarize(body, 110);
      return { r, title, body };
    })
    .filter(({ title }) => HACK_WORDS.test(title))
    .map(({ r, title, body }) =>
      item({
        title: title.length > 140 ? title.slice(0, 139) + '…' : title,
        url: r.url,
        source: /linkedin\.com/.test(r.url) ? 'LinkedIn' : 'Web',
        description: body,
        kind: 'announcement',
        publishedAt: toIso(r.published_date) || now.toISOString(),
      }),
    );
}

async function fetchTavily(ctx) {
  const store = getStore();
  const month = new Date().toISOString().slice(0, 7);
  const used = Number((await store.get(`tavily:${month}`)) || 0);
  const allowed = Math.max(0, Math.min(TAVILY_PER_RUN, TAVILY_BUDGET() - used));
  if (!allowed) return [];
  const queries = tavilyQueries(ctx.queries).slice(0, allowed);
  await store.incr(`tavily:${month}`, queries.length, { ttlSec: 40 * 86400 });
  const results = await mapLimit(queries, 3, (q) =>
    fetchJSON('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ ...q, search_depth: 'basic', max_results: 10, time_range: 'month' }),
    }).catch(() => null),
  );
  if (results.every((r) => r === null)) throw new Error('Tavily unreachable or key invalid');
  return results.filter(Boolean).flatMap((r) => parseTavily(r));
}

// ---------------------------------------------------------------- DuckDuckGo (free, no key)
// Finds hackathons hosted on company sites (e.g. events.microsoft.com) that no
// platform lists. DuckDuckGo blocks bursts, so each run sends a few spaced-out
// queries and rotates through the full list across runs.
const DDG_PER_RUN = Number(process.env.DDG_QUERIES_PER_RUN) || 4;
const DDG_GAP_MS = 2500;
const SKIP_HOSTS = /(^|\.)(youtube\.com|youtu\.be|github\.com|facebook\.com|instagram\.com|tiktok\.com|reddit\.com|devpost\.com|devfolio\.co|mlh\.com|mlh\.io|lu\.ma|luma\.com|lablab\.ai)$/i;
const SKIP_PATHS = /linkedin\.com\/(jobs|in\/|company\/)/i;

export function ddgQueries(queries, now = new Date()) {
  const year = now.getUTCFullYear();
  const out = queries.slice(0, 10).map((q) => `"${q}" hackathon ${year}`);
  out.push(`hackathon registration site:events.microsoft.com`, `hackathon ${year} register site:linkedin.com/posts`, `company hackathon ${year} registration open`);
  return out;
}

export function parseDdg(html, now = new Date()) {
  const year = now.getUTCFullYear();
  const out = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    let url = decodeEntities(m[1]);
    const wrapped = url.match(/[?&]uddg=([^&]+)/);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    let host;
    try { host = new URL(url).hostname; } catch { continue; }
    if (SKIP_HOSTS.test(host) || SKIP_PATHS.test(url) || /duckduckgo\.com/.test(host)) continue;
    const title = stripHtml(m[2]).replace(/\s+[|·-]\s+LinkedIn$/i, '');
    const snippet = stripHtml(m[3]);
    const text = `${title} ${snippet}`;
    if (!HACK_WORDS.test(text)) continue;
    // Skip pages about past editions: they mention only earlier years.
    const years = [...text.matchAll(/\b(20\d\d)\b/g)].map((y) => Number(y[1]));
    if (years.length && Math.max(...years) < year) continue;
    // "Microsoft + Premier League" → "Microsoft + Premier League: Inside the Game: Developer Hackathon"
    const named = snippet.match(/\b(?:join|in|for|at)\s+((?:[A-Z0-9][\w'&+:.-]*)(?:\s+(?:[A-Z0-9][\w'&+:.-]*|the|of|for|and|x|&)){0,8}?\s+(?:Hackathon|Buildathon|Datathon|Ideathon|Hack|Challenge))\b/);
    const fullTitle = HACK_WORDS.test(title) ? title : named ? `${title}: ${named[1]}` : title;
    out.push(item({
      title: fullTitle,
      url,
      source: /linkedin\.com/.test(host) ? 'LinkedIn' : 'Web',
      organizer: host.replace(/^www\./, ''),
      description: summarize(snippet, 260),
      kind: 'announcement',
      publishedAt: now.toISOString(),
    }));
  }
  return out;
}

/** Live DuckDuckGo queries (often blocked from Vercel; works from GitHub Actions). */
export async function runDdgQueries(queries, { gapMs = DDG_GAP_MS, now = new Date(), fetchImpl = fetch } = {}) {
  const items = [];
  let ok = 0;
  for (const [i, q] of queries.entries()) {
    if (i) await new Promise((r) => setTimeout(r, gapMs));
    let res;
    try {
      res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
    } catch { break; }
    if (res.status !== 200) break; // 202 = rate limited
    items.push(...parseDdg(await res.text(), now));
    ok++;
  }
  return { items, ok };
}

async function fetchDuckDuckGo(ctx) {
  const store = getStore();
  // 1) Results posted by the GitHub Actions web scout (fresh within 36 h).
  const ingested = await store.get('ingest:web');
  const fresh = (ingested?.items || []).filter((it) => Date.now() - new Date(it.publishedAt).getTime() < 7 * 864e5);
  // 2) A few live queries as well (rotating), in case the scout isn't set up.
  const all = ddgQueries(ctx.queries, ctx.now);
  const start = Number((await store.get('ddg:cursor')) || 0) % all.length;
  const batch = Array.from({ length: Math.min(DDG_PER_RUN, all.length) }, (_, i) => all[(start + i) % all.length]);
  await store.set('ddg:cursor', (start + batch.length) % all.length);
  const live = await runDdgQueries(batch, { now: ctx.now });
  if (!fresh.length && !live.ok) {
    throw new Error(ingested ? 'DuckDuckGo blocked this run and the GitHub web scout has no results from the last 7 days' : 'DuckDuckGo blocks Vercel; turn on the GitHub web scout (see README)');
  }
  return [...fresh.map((it) => item(it)), ...live.items];
}

export const SOURCES = [
  { id: 'devpost', name: 'Devpost', fetch: fetchDevpost },
  { id: 'devfolio', name: 'Devfolio', fetch: fetchDevfolio },
  { id: 'mlh', name: 'MLH', fetch: fetchMlh },
  { id: 'luma', name: 'Luma', fetch: fetchLuma },
  { id: 'lablab', name: 'lablab.ai', fetch: fetchLablab },
  { id: 'cerebralvalley', name: 'Cerebral Valley', fetch: fetchCerebralValley },
  { id: 'hackclub', name: 'Hack Club', fetch: fetchHackClub },
  { id: 'hackster', name: 'Hackster.io', fetch: fetchHackster },
  { id: 'news', name: 'News & social', fetch: fetchGoogleNews },
  { id: 'web', name: 'Web search (company sites, LinkedIn)', fetch: fetchDuckDuckGo },
  ...(process.env.TAVILY_API_KEY ? [{ id: 'tavily', name: 'LinkedIn & web (Tavily)', fetch: fetchTavily }] : []),
];
