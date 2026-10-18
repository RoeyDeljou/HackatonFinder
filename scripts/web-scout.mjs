// Runs the DuckDuckGo web searches from GitHub Actions (search engines often
// block Vercel's servers) and posts the results to the app.
//   APP_URL=https://… CRON_SECRET=… node scripts/web-scout.mjs
import { runDdgQueries } from '../lib/sources/index.js';

const base = (process.env.APP_URL || '').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;
if (!base || !secret) {
  console.log('APP_URL / CRON_SECRET not set, skipping');
  process.exit(0);
}
const auth = { authorization: `Bearer ${secret}` };

const plan = await fetch(`${base}/api/ingest`, { headers: auth });
if (!plan.ok) throw new Error(`GET /api/ingest → ${plan.status} ${await plan.text()}`);
const { queries, total } = await plan.json();
console.log(`${queries.length} queries (starting where the last run stopped)`);

// Space requests out; if DuckDuckGo starts blocking, pause and retry once.
const items = [];
let done = 0;
for (let i = 0; i < queries.length; ) {
  const { items: found, ok } = await runDdgQueries(queries.slice(i), { gapMs: 12_000 });
  items.push(...found);
  done += ok;
  i += ok;
  if (i >= queries.length) break;
  if (!ok) {
    let resumed = false;
    for (const wait of [60_000, 120_000]) {
      console.log(`blocked at query ${i + 1}, waiting ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait));
      const retry = await runDdgQueries([queries[i]], { gapMs: 0 });
      if (retry.ok) { items.push(...retry.items); done++; i++; resumed = true; break; }
    }
    if (!resumed) { console.log('still blocked, sending what we have'); break; }
  }
}
const unique = [...new Map(items.map((it) => [it.url, it])).values()];
console.log(`${done}/${queries.length} queries ok, ${unique.length} results`);
for (const it of unique.slice(0, 40)) console.log(`  - ${it.title} | ${it.url}`);

const res = await fetch(`${base}/api/ingest`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ queries: done, total, items: unique }),
});
console.log('ingest →', res.status, await res.text());
if (!res.ok) process.exit(1);
