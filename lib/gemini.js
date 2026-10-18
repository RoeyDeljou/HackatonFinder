/**
 * Free AI discovery: Gemini + "Grounding with Google Search".
 * Uses the Gemini API free tier (key from https://aistudio.google.com/apikey).
 * Each run makes one call per high-priority field plus one general call, so a
 * day uses ~10 grounded requests, far below the free daily allowance.
 */
import { buildPrompt, JSON_SHAPE, parseJsonLoose, toItems } from './ai-common.js';
import { aiFocusFor } from './fields.js';

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
// Google retires model names over time (2.5 Flash is closed to new keys), so try
// these in order and remember the first one that answers.
export const MODEL_CANDIDATES = [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'].filter(Boolean))];
let workingModel = null;
export function _resetModel() { workingModel = null; }
const ENDPOINT = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
const MAX_CALLS = 8;

export function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
}

async function callModel(model, body, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(ENDPOINT(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const data = await res.json();
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
      const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter(Boolean);
      return { text, sources };
    }
    const errText = await res.text().catch(() => '');
    lastErr = Object.assign(new Error(`Gemini ${model} HTTP ${res.status}: ${errText.slice(0, 160)}`), { status: res.status, body: errText });
    // 429 can be a per-minute limit: back off and retry. Other errors are final for this model.
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw lastErr;
}

/** Errors that mean "this model can't do it for this key", so the next model should be tried. */
const tryNext = (e) => e.status === 404 || (e.status === 400 && /not (supported|available|enabled)|grounding|google_search|search/i.test(e.body || '')) || (e.status === 403) || (e.status === 429 && /free.?tier|limit: 0|quota/i.test(e.body || ''));

async function generate({ prompt, search = true, json = false, timeoutMs = 90_000 }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  const models = workingModel ? [workingModel, ...MODEL_CANDIDATES.filter((m) => m !== workingModel)] : MODEL_CANDIDATES;
  const errors = [];
  for (const model of models) {
    try {
      const out = await callModel(model, body, timeoutMs);
      workingModel = model;
      return out;
    } catch (e) {
      errors.push(e);
      if (!tryNext(e)) throw e;
    }
  }
  if (search && errors.some((e) => e.status !== 404)) {
    throw new Error("Your Gemini key's free tier doesn't include Google Search on current models. The app's free web search covers this instead");
  }
  throw new Error(`No Gemini model available for this key (tried ${models.join(', ')})`);
}

/**
 * Splits the work: focused calls for each high-priority field (fields with
 * sub-topics, like Sports, get one call per sub-topic), plus one general sweep.
 * Returns [{ focus, field }] where focus=null is the general sweep.
 */
export function planCalls(fields) {
  const calls = [];
  for (const f of fields.filter((x) => x.priority === 'high')) {
    for (const focus of aiFocusFor(f)) calls.push({ focus, field: f.name });
  }
  return [...calls.slice(0, MAX_CALLS - 1), { focus: null, field: null }];
}

export async function discover({ fields, leads = [], knownTitles = [], now = new Date() }) {
  const today = now.toISOString().slice(0, 10);
  const calls = planCalls(fields);
  const results = [];
  const failures = [];
  // Small concurrency keeps us under the free tier's requests-per-minute limit.
  for (let i = 0; i < calls.length; i += 3) {
    const batch = calls.slice(i, i + 3).map(async ({ focus, field }) => {
      const prompt = `${buildPrompt({ fields, leads: focus ? [] : leads, knownTitles, today, focus })}\n\n${JSON_SHAPE}`;
      const { text } = await generate({ prompt });
      const items = toItems(parseJsonLoose(text), 'AI web search');
      if (field) for (const it of items) if (!it.aiFields.includes(field)) it.aiFields.push(field);
      return items;
    });
    for (const r of await Promise.allSettled(batch)) {
      if (r.status === 'fulfilled') results.push(...r.value);
      else { failures.push(r.reason); console.error('gemini call failed:', r.reason?.message); }
    }
  }
  // Every call failed: surface the real reason (bad key, no Search on free tier…).
  if (!results.length && failures.length === calls.length) throw failures[0];
  return results;
}

export async function expandField(name) {
  const { text } = await generate({
    prompt: `List 15 short lowercase keywords or phrases that would appear in the title or description of a hackathon about "${name}". Include synonyms, sub-topics and well-known organizations or brands in that space. Reply with only {"keywords":["..."]}.`,
    search: false,
    json: true,
    timeoutMs: 20_000,
  });
  const data = parseJsonLoose(text);
  return (data?.keywords || []).map((k) => String(k).toLowerCase().trim()).filter((k) => k && k.length <= 40).slice(0, 20);
}
