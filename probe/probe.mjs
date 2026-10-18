// Probes candidate hackathon sources and prints response shapes.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const targets = [
  ['devpost', 'https://devpost.com/api/hackathons?status[]=open&status[]=upcoming&page=1'],
  ['devpost-search', 'https://devpost.com/api/hackathons?search=sports&status[]=open&status[]=upcoming'],
  ['mlh-org', 'https://mlh.io/seasons/2027/events'],
  ['mlh-com', 'https://www.mlh.com/seasons/2027/events'],
  ['devfolio', 'https://api.devfolio.co/api/search/hackathons', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'application_open', from: 0, size: 20 }) }],
  ['unstop', 'https://unstop.in/api/public/opportunity/search-result?opportunity=hackathons&per_page=20&oppstatus=open&page=1'],
  ['dorahacks', 'https://dorahacks.io/api/hackathon/?page=1&page_size=20&status=ongoing'],
  ['dorahacks2', 'https://dorahacks.io/api/hackathon/?page=1&page_size=20'],
  ['hackerearth', 'https://www.hackerearth.com/chrome-extension/events/'],
  ['hackclub', 'https://hackathons.hackclub.com/api/events/upcoming'],
  ['lablab', 'https://lablab.ai/event'],
  ['ethglobal', 'https://ethglobal.com/events'],
  ['luma-search', 'https://api.lu.ma/discover/get-paginated-events?query=hackathon&pagination_limit=20'],
  ['luma-search2', 'https://api.lu.ma/search/get-results?query=hackathon'],
  ['eventbrite', 'https://www.eventbrite.com/d/online/hackathon/'],
  ['hackster', 'https://www.hackster.io/contests'],
  ['taikai', 'https://taikai.network/hackathons'],
  ['hackathon.com', 'https://www.hackathon.com/online'],
  ['gnews', 'https://news.google.com/rss/search?q=hackathon+registration+open+when:7d&hl=en-US&gl=US&ceid=US:en'],
  ['bing-rss-linkedin', 'https://www.bing.com/search?q=site%3Alinkedin.com+hackathon+register&format=rss'],
  ['bing-news-rss', 'https://www.bing.com/news/search?q=hackathon+registration&format=rss'],
  ['ddg', 'https://html.duckduckgo.com/html/?q=hackathon+registration+open+site%3Alinkedin.com'],
  ['hn', 'https://hn.algolia.com/api/v1/search_by_date?query=hackathon&tags=story&hitsPerPage=5'],
  ['reddit', 'https://www.reddit.com/r/hackathon/new.json?limit=5'],
  ['cerebralvalley', 'https://cerebralvalley.ai/events'],
  ['kaggle', 'https://www.kaggle.com/api/v1/competitions/list'],
  ['devpost-p2-perpage', 'https://devpost.com/api/hackathons?status[]=open&status[]=upcoming&page=2&per_page=50'],
  ['unstop2', 'https://unstop.in/api/public/opportunity/search-result?opportunity=hackathons&per_page=20&oppstatus=open&page=1', { headers: { referer: 'https://unstop.in/hackathons', origin: 'https://unstop.in' } }],
  ['unstop3', 'https://unstop.in/hackathons'],
  ['dorahacks-api3', 'https://dorahacks.io/api/hackathon-list/?page=1&page_size=20&status=ongoing'],
  ['dorahacks-api4', 'https://dorahacks.io/api/hackathon/list?page=1&page_size=20'],
  ['dorahacks-page', 'https://dorahacks.io/hackathon'],
  ['luma-discover-ai', 'https://api.lu.ma/discover/get-paginated-events?query=hackathon&pagination_limit=50&slug=ai'],
  ['gnews-sports', 'https://news.google.com/rss/search?q=%22sports+hackathon%22+when:30d&hl=en-US&gl=US&ceid=US:en'],
  ['bing-linkedin-ai', 'https://www.bing.com/search?q=site%3Alinkedin.com%2Fposts+%22hackathon%22+%22register%22+AI&format=rss&count=50'],
  ['mlh-2026', 'https://www.mlh.com/seasons/2026/events'],
  ['devpost-themes', 'https://devpost.com/api/hackathons?themes[]=Machine%20Learning%2FAI&status[]=open'],
];
for (const [name, url, opts = {}] of targets) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opts, headers: { 'user-agent': UA, accept: 'application/json, text/html, */*', ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let shape = '';
    try { const j = JSON.parse(text); shape = 'JSON keys=' + JSON.stringify(Object.keys(j)).slice(0, 300); } catch {}
    console.log(`\n### ${name} ${r.status} ${text.length}B ${Date.now() - t0}ms ${r.headers.get('content-type')}\n${shape}`);
    const outName = 'out/' + name.replace(/[^a-z0-9.-]/gi, '_') + '.txt';
    await import('node:fs').then(fs => { fs.mkdirSync('out', { recursive: true }); fs.writeFileSync(outName, text); });
    console.log(text.slice(0, 1500).replace(/\s+/g, ' '));
  } catch (e) { console.log(`\n### ${name} ERROR ${e.message}`); }
}
