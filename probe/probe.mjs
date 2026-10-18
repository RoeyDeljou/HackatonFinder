const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const fs = await import('node:fs'); fs.mkdirSync('out', { recursive: true });
const ddg = (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
const targets = [
  ['ddg-pl', ddg('"premier league" hackathon')],
  ['ddg-pl-ms', ddg('microsoft premier league hackathon')],
  ['ddg-sports-li', ddg('site:linkedin.com sports hackathon registration')],
  ['ddg-football', ddg('football hackathon 2026 register')],
  ['ddg-msevents', ddg('site:events.microsoft.com hackathon')],
  ['ddg-lite-pl', `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent('"premier league" hackathon')}`],
  ['gnews-pl', 'https://news.google.com/rss/search?q=%22premier+league%22+hackathon&hl=en-US&gl=US&ceid=US:en'],
  ['msevents-page', 'https://events.microsoft.com/flow/microsoft/plmshackathon/registration/page/landing'],
  ['reactor-series', 'https://developer.microsoft.com/en-us/reactor/series/s-1709/'],
];
for (const [name, url] of targets) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    fs.writeFileSync(`out/${name}.txt`, t);
    const titles = [...t.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).slice(0, 8);
    const lite = [...t.matchAll(/class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).slice(0, 8);
    const news = [...t.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) => m[1]).slice(0, 8);
    console.log(`\n### ${name} ${r.status} ${t.length}B final=${r.url.slice(0, 90)}`);
    console.log([...titles, ...lite, ...news].join('\n') || t.slice(0, 300).replace(/\s+/g, ' '));
  } catch (e) { console.log(`\n### ${name} ERROR ${e.message}`); }
}
