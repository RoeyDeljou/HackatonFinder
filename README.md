# Hackathon Finder

An installable web app (PWA) that finds hackathons that are **open for registration**, ranks them by the fields you care about, and sends **push notifications** when new ones appear.

- Pick fields (default: **Sports, AI, Innovation**), set each to High / Med / Low priority, and add or remove fields.
- Press **Search**. A loading screen shows each source as it's checked, then the results appear, with the date and time of the search at the top.
- After that, the app searches **twice a day** (10:00 and 18:00 Israel time), removes hackathons that have closed, and pushes a notification for new matches.
- If a day brings nothing new, an end-of-day notification says **"No new Hackathons were found today"**.
- Tap any result to open its registration / info page.

## Where it searches

| Source | What it covers |
|---|---|
| Devpost | Every open and upcoming hackathon (all pages, via its JSON API) |
| Devfolio | Hackathons with applications open |
| MLH | The official student hackathon season (current and next) |
| Luma | Hackathon events, using extra keyword searches per field |
| lablab.ai | AI hackathons |
| Cerebral Valley | AI hackathons (often company-run: Meta, Anthropic, NVIDIA…) |
| Hack Club | High-school hackathons |
| Hackster.io | Hardware / IoT contests |
| Google News | Fresh announcements ("registration open", per-field queries) |
| **AI web search** *(optional, free)* | Gemini with Google Search looks on LinkedIn, big companies' sites, X and news for hackathons the platforms don't list. It runs one focused search per High-priority field plus one general sweep. Every link it returns is checked, and dead ones are dropped |
| **LinkedIn & web (Tavily)** *(optional, free)* | Searches LinkedIn posts and company pages for hackathon announcements |

**Priority affects search depth.** High-priority fields get more keyword searches on Luma and News, and a larger AI search budget. Results are ranked by your highest-priority matching field first, then match strength, then size and prize. Hackathons outside your fields appear under **Other fields** as suggestions.

The same hackathon found on several sites is merged into one card. Closed ones are removed on every run: anything past its deadline, or gone from its source listing for 3 days.

> LinkedIn has no public API. LinkedIn posts are reached through Google-grounded AI search and Tavily, both free. Set `GEMINI_API_KEY` (and optionally `TAVILY_API_KEY`) for the widest coverage.

---

## Deploy (about 10 minutes, all on free tiers)

### 1. Import to Vercel
1. Go to <https://vercel.com/new> and import this GitHub repo (`HackatonFinder`). Keep the defaults (Framework: *Other*). Deploy.

### 2. Add storage (Upstash Redis)
1. In the Vercel project: **Storage → Create Database → Upstash (Redis)** → free plan → connect it to the project.
   This adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) automatically.

### 3. Set environment variables
Vercel project → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Run `npx web-push generate-vapid-keys` (or `npm run vapid` in this repo) |
| `VAPID_SUBJECT` | `mailto:your@email.com` |
| `CRON_SECRET` | Any long random string (protects the scheduled jobs) |
| `GEMINI_API_KEY` | *Optional, free, recommended.* Turns on AI web search. Get a key at <https://aistudio.google.com/apikey> (Google account, no card) |
| `TAVILY_API_KEY` | *Optional, free.* Extra LinkedIn and company-announcement feed. Get a key at <https://app.tavily.com> |

Then **Deployments → ⋯ → Redeploy** so the variables take effect.

### 4. Install on your phone
- **iPhone (iOS 16.4+):** open the site in **Safari** → Share → **Add to Home Screen** → open it **from the home screen** → press **Search hackathons** and allow notifications. On iPhone, push only works from the home-screen app.
- **Android:** open in Chrome → menu → **Install app** (or Add to Home screen) → allow notifications.

### 5. (Recommended) Backup scheduler
Vercel's free cron fires at a random minute within the hour, and very rarely skips. The included GitHub Action calls the same jobs about an hour later as a safety net. The server skips any slot that already ran, so nothing is ever sent twice.

GitHub repo → **Settings → Secrets and variables → Actions** → add:
- `APP_URL` = your Vercel URL, e.g. `https://hackaton-finder.vercel.app`
- `CRON_SECRET` = the same value as in Vercel

## Schedule

Times are Israel time all year. Daylight saving is handled automatically.

| Job | Israel time |
|---|---|
| Morning search | 10:00 |
| Afternoon search | 18:00 |
| End-of-day check ("No new Hackathons were found today") | 21:00 |

How it works: Vercel Cron only accepts UTC times, so `vercel.json` triggers each job at both possible UTC hours (summer is UTC+3, winter is UTC+2). The server runs a job only inside its local-time window (`lib/schedule.js`), and a daily lock stops it running twice. Vercel's free plan fires cron at a random minute within the scheduled hour, so a 10:00 run happens between 10:00 and 10:59.

To change the times, set `SCHEDULE_MORNING`, `SCHEDULE_AFTERNOON` and `SCHEDULE_DIGEST` (e.g. `10:00`) and, if needed, `SCHEDULE_TZ` (default `Asia/Jerusalem`). Then make sure the UTC hours in `vercel.json` and `.github/workflows/backup-cron.yml` cover the new times. "Today" for the end-of-day message uses each phone's own time zone.

## Cost: $0

Everything runs on free tiers:

| Piece | Free allowance | This app uses |
|---|---|---|
| Vercel Hobby (hosting + cron) | daily cron jobs, 300 s functions | 6 daily triggers (3 jobs × summer/winter hour) |
| Upstash Redis | 500K commands/month | a few thousand |
| GitHub Actions (backup + CI) | unlimited on public repos | ~5 short runs/day |
| Gemini API, Grounding with Google Search | free tier on `gemini-2.5-flash` (hundreds of grounded requests a day) | ~4 per search run, ~10/day |
| Tavily | 1,000 searches/month | capped at 900/month (`TAVILY_MONTHLY_BUDGET`) |

Notes:
- If Gemini's free per-minute limit is hit, the app waits and retries. If the daily limit is hit, that run simply continues without AI results.
- On Gemini's free tier, Google may use prompts to improve its products. The prompts here only contain your field names and public hackathon titles.
- Manual searches are rate-limited to one every 3 minutes per device.
- **Paid alternative:** set `ANTHROPIC_API_KEY` (and `AI_PROVIDER=anthropic`) to use Claude with web search instead, at roughly $0.30–$1 per run.

## Run locally

```bash
npm install
cp .env.example .env      # fill in VAPID keys (npm run vapid); storage falls back to .data/db.json
npm run dev               # http://localhost:3000
npm test                  # unit + end-to-end tests (no network needed)
npm run search            # live search from the terminal
```

Push notifications need HTTPS (localhost is allowed in desktop browsers).

**Self-hosting without Vercel** (VPS, Docker, Raspberry Pi): run `SCHEDULER=on node server.js`. The server then runs the three daily jobs itself (`SCHEDULE_TZ`, `SCHEDULE_MORNING`, `SCHEDULE_AFTERNOON`, `SCHEDULE_DIGEST`). It stores data in `.data/db.json` unless Upstash variables are set.

## Project layout

```
public/            the PWA: index.html, app.js, styles.css, sw.js (push + offline), manifest, icons
api/               serverless endpoints (Vercel): config, profile, subscribe, search (streams progress), hackathons, test-push, cron
lib/sources/       one parser per hackathon site
lib/engine.js      runs sources in parallel, merges duplicates, drops closed hackathons
lib/fields.js      field library, keyword matching, ranking
lib/ai.js          AI discovery: picks Gemini (free) or Claude; lib/gemini.js, lib/verify.js (link checks)
lib/jobs.js        profiles, scheduled runs, "new" tracking, notifications, end-of-day digest
lib/store.js       Upstash Redis (prod) / JSON file (local)
server.js          local + self-hosted server and scheduler
test/              tests with real saved responses from every source
```

CI (`.github/workflows/ci.yml`) runs the tests and a **live source check** on every push, so a site that changes its format is caught quickly.
