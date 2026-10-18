// Runs a live search from the command line.
//   node scripts/run-search.mjs            → prints top results for the default fields
//   node scripts/run-search.mjs --check    → exits non-zero if too many sources fail (used in CI)
import { collect } from '../lib/engine.js';
import { DEFAULT_FIELDS, matchFields } from '../lib/fields.js';

const check = process.argv.includes('--check');
const t0 = Date.now();
const { items, stats } = await collect({
  fields: DEFAULT_FIELDS,
  onProgress: (e) => e.status !== 'running' && console.log(`  ${e.status === 'done' ? '✓' : '✗'} ${e.name}${e.count != null ? ` (${e.count})` : ''}`),
});
console.log(`\n${items.length} open hackathons in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const [id, s] of Object.entries(stats)) if (!s.ok) console.log(`  ! ${s.name}: ${s.error}`);

const ranked = items.map((it) => ({ it, m: matchFields(it, DEFAULT_FIELDS) })).filter((x) => x.m.length);
console.log(`${ranked.length} match ${DEFAULT_FIELDS.map((f) => f.name).join('/')}:`);
for (const { it, m } of ranked.slice(0, 25)) console.log(`  - [${m.map((x) => x.name).join(',')}] ${it.title} — ${it.deadline?.slice(0, 10) || '?'} — ${it.url}`);

if (check) {
  const failed = Object.values(stats).filter((s) => !s.ok);
  const okCount = Object.values(stats).length - failed.length;
  if (okCount < 5 || items.length < 50) {
    console.error(`\nSource health check failed: ${okCount} sources ok, ${items.length} items`);
    process.exit(1);
  }
}
