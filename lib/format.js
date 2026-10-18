/**
 * How you take part in a hackathon: 'online' | 'in-person' | 'hybrid' | null (unknown).
 * Sources set `format` when they know it; otherwise it's inferred from the
 * online flag, the location and the wording of the title/description.
 */
const ONLINE_RE = /\b(online|virtual|remote(ly)?|from anywhere|worldwide online|digital event|zoom)\b/i;
const INPERSON_RE = /\b(in[- ]person|on[- ]?site|onsite|offline|venue|campus|at the office|irl)\b/i;
const HYBRID_RE = /\b(hybrid|online (and|&|or) (in[- ]person|on[- ]?site|offline)|(in[- ]person|on[- ]?site|offline) (and|&|or) online)\b/i;
const NOT_A_PLACE = /^(online|virtual|remote|global|worldwide|anywhere|other|tbd|tba|n\/a)$/i;

export function hasPlace(location) {
  return !!location && !NOT_A_PLACE.test(String(location).trim());
}

export function deriveFormat(it) {
  if (it.format === 'online' || it.format === 'in-person' || it.format === 'hybrid') return it.format;
  const text = [it.title, it.description, ...(it.tags || [])].filter(Boolean).join(' ');
  if (HYBRID_RE.test(text)) return 'hybrid';
  if (it.online === true) return hasPlace(it.location) && INPERSON_RE.test(text) ? 'hybrid' : 'online';
  if (it.online === false) return 'in-person';
  if (hasPlace(it.location)) return ONLINE_RE.test(text) && !INPERSON_RE.test(text) ? 'hybrid' : 'in-person';
  if (/^online$/i.test(String(it.location || '').trim())) return 'online';
  const on = ONLINE_RE.test(text);
  const off = INPERSON_RE.test(text);
  if (on && off) return 'hybrid';
  if (on) return 'online';
  if (off) return 'in-person';
  return null;
}

/** Location text worth showing (never "Online"/"Other"). */
export function placeOf(it) {
  return hasPlace(it.location) ? String(it.location).trim() : null;
}
