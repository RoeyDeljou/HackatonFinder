/**
 * Checks AI-found links before they reach the user: follows redirects to the
 * real page and drops links that are dead (404/410, unknown host, timeouts).
 * Sites that block bots (401/403/429) are kept, since the page usually exists.
 */
import { UA, mapLimit } from './util.js';

const DEAD = new Set([404, 410]);

export async function checkUrl(url, { timeoutMs = 10_000 } = {}) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(timeoutMs) });
    res.body?.cancel?.().catch(() => {});
    if (DEAD.has(res.status)) return { ok: false, status: res.status };
    return { ok: true, status: res.status, finalUrl: res.url || url };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

export async function verifyItems(items, { check = checkUrl } = {}) {
  const results = await mapLimit(items, 6, async (it) => {
    const r = await check(it.url);
    if (!r.ok) return null;
    // Replace Google redirect wrappers etc. with the page's real address.
    const finalUrl = r.finalUrl && !/^https?:\/\/(www\.)?google\./.test(r.finalUrl) ? r.finalUrl : it.url;
    return { ...it, url: finalUrl };
  });
  return results.filter(Boolean);
}
