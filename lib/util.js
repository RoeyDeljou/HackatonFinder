import { createHash } from 'node:crypto';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** fetch with a timeout and one retry on network errors / 5xx / 429. */
export async function fetchWithRetry(url, opts = {}, { timeoutMs = 15000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.noRetry = true;
        throw err;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e.noRetry) break;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchText(url, opts, cfg) {
  return (await fetchWithRetry(url, opts, cfg)).text();
}

export async function fetchJSON(url, opts, cfg) {
  return (await fetchWithRetry(url, opts, cfg)).json();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hashId(s) {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Strips markdown/HTML and cuts to a readable summary length. */
export function summarize(s, max = 280) {
  if (!s) return '';
  const text = stripHtml(String(s).replace(/[*_`#>\[\]]/g, '').replace(/\(https?:[^)]+\)/g, ''));
  return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : text;
}

/** Canonical form of a URL used for de-duplication. */
export function normalizeUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u.startsWith('//') ? 'https:' + u : u);
    const host = url.hostname.replace(/^www\./, '').replace(/^luma\.com$/, 'lu.ma');
    const path = url.pathname.replace(/\/+$/, '');
    return (host + path).toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
}

/** Canonical form of a title used for de-duplication across sources. */
export function normalizeTitle(t = '') {
  return String(t)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function toIso(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Parses Devpost style ranges: "Aug 31 - Oct 23, 2026", "Oct 10 - 12, 2026",
 * "Dec 15, 2026 - Jan 10, 2027", "Oct 23, 2026". Returns {start, end} as ISO
 * (end is end-of-day UTC so a hackathon stays listed through its last day).
 */
export function parseDateRange(str) {
  if (!str) return { start: null, end: null };
  const s = String(str).replace(/\s+/g, ' ').trim();
  const [leftRaw, rightRaw] = s.split(/\s[-–]\s/);
  const part = (p) => {
    const m = p && p.trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
    if (m) return { mon: MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()], day: +m[2], year: m[3] ? +m[3] : null };
    const d = p && p.trim().match(/^(\d{1,2})(?:,\s*(\d{4}))?$/);
    if (d) return { mon: null, day: +d[1], year: d[2] ? +d[2] : null };
    return null;
  };
  const L = part(leftRaw);
  const R = rightRaw ? part(rightRaw) : null;
  if (!L) return { start: null, end: null };
  if (!R) {
    if (L.mon == null || L.year == null) return { start: null, end: null };
    const start = Date.UTC(L.year, L.mon, L.day);
    return { start: toIso(start), end: toIso(start + 86399999) };
  }
  const rMon = R.mon ?? L.mon;
  const rYear = R.year ?? L.year;
  if (rMon == null || rYear == null) return { start: null, end: null };
  let lYear = L.year ?? rYear;
  if (L.year == null && L.mon > rMon) lYear = rYear - 1;
  return {
    start: toIso(Date.UTC(lYear, L.mon, L.day)),
    end: toIso(Date.UTC(rYear, rMon, R.day) + 86399999),
  };
}

/** Parses "Dec 21, 2026" as end of that day UTC. */
export function parseDayEnd(str) {
  const { end } = parseDateRange(str);
  return end;
}

export function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Runs async fn over items with a concurrency cap. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/** YYYY-MM-DD for a date in an IANA time zone. */
export function dateKey(date = new Date(), tz = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Extracts the JSON value (object/array) starting at text[start] using bracket matching. */
export function extractJsonAt(text, start) {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open || c === '[' || c === '{') depth++;
    else if (c === close || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('Unterminated JSON');
}
