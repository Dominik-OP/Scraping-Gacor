# IndonesiaBerkumpul

**Turn public conversations on X into a clearer picture of what people are discussing.** IndonesiaBerkumpul is a local-first social listening dashboard for creating topic searches, collecting posts with Apify, exploring engagement and sentiment signals, and generating on-demand conversation briefs with Google Gemini.

Built for researchers, communications teams, and product teams monitoring public conversations. Create a focused query, collect a bounded sample, inspect the evidence, and ask AI to help summarize the themes—all from one dashboard.

> **Local and hosted storage:** The app uses SQLite locally, or PostgreSQL when `DATABASE_URL` is set. It does not include user authentication or multi-tenant access controls.

## Workflow

Social conversations move quickly, and searching manually can make it hard to spot repeated themes or find posts that deserve a closer look. IndonesiaBerkumpul brings collection, exploration, and summarization into one workflow:

1. Define the topic and search query you want to follow.
2. Collect public X posts through Apify, with a configurable result cap and time window.
3. Explore the resulting conversation through post feeds, engagement metrics, authors, hashtags, timelines, and indicative sentiment.
4. Ask Gemini for a concise executive-style summary when you want one.
5. Export the collected posts as CSV for further analysis.

Collection and AI analysis are separate actions. You can explore collected data without spending Gemini quota, then request a summary when it is useful.

## Contents

- [Features](#features)
- [Architecture and workflow](#architecture-and-workflow)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Using the dashboard](#using-the-dashboard)
- [How AI analysis works](#how-ai-analysis-works)
- [Metrics and interpretation](#metrics-and-interpretation)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Usage limits and costs](#usage-limits-and-costs)
- [Security and production considerations](#security-and-production-considerations)
- [Troubleshooting](#troubleshooting)

## Features

- **Topic-based monitoring:** Create named searches with a query, language, lookback window, and maximum number of posts.
- **Apify-powered collection:** Run the configured X scraper and track each collection run's status and results.
- **Conversation dashboard:** Explore post volume, engagement, authors, hashtags, timeline, and sentiment distribution.
- **On-demand AI intelligence:** Generate a structured Gemini brief with an overall summary, positive and negative highlights, and key topics.
- **Persistent storage:** Store topics, posts, collection runs, and analysis state in local SQLite or hosted PostgreSQL.
- **CSV export:** Download posts for a topic and continue analysis in a spreadsheet or other tool.
- **Topic lifecycle controls:** Archive and restore topics; remove a topic's posts when needed.
- **Usage-aware workflow:** Apify collection and Gemini analysis are separate, and every Apify Actor run has a US$0.50 maximum charge configured by the backend.

## Architecture and workflow

```text
┌──────────────────────────────┐
│ Browser dashboard            │
│ TanStack Start + React :3000 │
└──────────────┬───────────────┘
               │ typed server functions
               ▼
┌──────────────────────────────┐       ┌────────────────────────┐
│ Python API :8765             │──────▶│ Apify X scraper        │
│ validation, jobs, analytics  │       └────────────────────────┘
└──────────────┬───────────────┘
               │                     ┌────────────────────────┐
               ├────────────────────▶│ Gemini API             │
               │                     │ on-demand summaries    │
               ▼                     └────────────────────────┘
┌──────────────────────────────┐
│ SQLite or PostgreSQL         │
│ local file or DATABASE_URL   │
└──────────────────────────────┘
```

1. **Create a topic.** The dashboard sends a topic name, query, language, lookback window, and post limit to the local Python API.
2. **Collect posts.** The API validates the settings and starts an Apify Actor run. It normalizes returned posts and stores them in the configured database, ignoring duplicate post IDs.
3. **Explore the data.** Dashboard metrics and charts are calculated from the collected posts. Sentiment labels are local rule-based indicators.
4. **Request an AI brief.** When you click **AI Analysis**, the backend ranks stored posts by likes, reposts, replies, and quotes, selects up to 10, and sends those posts to Gemini.
5. **Export or manage topics.** Export topic posts to CSV, or archive and restore topics from the dashboard.

## Quick start

### Prerequisites

- **Python 3.10+**
- **Node.js** and **npm** (pnpm can also be used)
- **Apify API token** for live X collection
- **Google Gemini API token** for AI analysis (optional until you request an analysis)

The SQLite backend uses the Python standard library. Hosted PostgreSQL requires the Psycopg driver:

```bash
python -m pip install -r requirements.txt
```

### 1. Get the project and install frontend packages

```bash
git clone https://github.com/Dominik-OP/Scraping-Gacor
cd Scraping-Gacor
npm install
```

### 2. Add credentials

Copy `.env.example` to `.env` in the repository root, then enter your own API credentials. Leave optional settings blank to use the backend defaults.

Get an Apify token from [Apify Console](https://console.apify.com/settings/integrations) and a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey). The Gemini token is only needed for AI analysis. The backend accepts either `API_GEMINI_TOKEN` or `GEMINI_API_KEY`; `.env.example` uses `API_GEMINI_TOKEN`.

### 3. Run the backend and frontend

Start each process in a separate terminal at the repository root.

**Terminal 1 — Python API**

```bash
python app.py
```

**Terminal 2 — web dashboard**

```bash
npm run dev
```

Open **http://127.0.0.1:3000** in your browser. The Python API listens on **http://127.0.0.1:8765** by default. Keep both processes running while using the app. Press `Ctrl+C` in each terminal to stop it.

### Windows PowerShell alternative for copying `.env.example`

```powershell
Copy-Item .env.example .env
```

On macOS/Linux, use `cp .env.example .env`.

## Configuration

| Variable | Required for | Default / behavior |
|---|---|---|
| `APIFY_API_TOKEN` | Live collection | No default. Required when starting an Apify collection. |
| `API_GEMINI_TOKEN` | AI analysis | No default. Accepted Gemini credential name used in `.env.example`. |
| `GEMINI_API_KEY` | AI analysis | Alternate accepted name if `API_GEMINI_TOKEN` is not set. |
| `GEMINI_MODEL` | AI analysis | Backend default applies when omitted; set it to a model available to your Gemini account. |
| `SINYALX_API_URL` | Dashboard-to-API connection | Python API URL used by frontend server functions. |
| `SINYALX_UI_URL` | Python root redirect | Defaults to `http://127.0.0.1:3000`. |
| `DATABASE_URL` | Hosted PostgreSQL | Optional. A PostgreSQL URL selects hosted storage; empty or unset uses SQLite. Use a pooled URL for Neon application traffic. |
| `DATABASE_URL_UNPOOLED` | SQLite data import | Direct PostgreSQL URL for `migrate_sqlite.py`; not needed for normal API requests. |
| `SINYALX_DB_PATH` | Local SQLite | Optional override for the local database file. Ignored when `DATABASE_URL` is set. |
| `PORT` | Hosted API | Default HTTP port when `--port` is omitted. |

With SQLite, the database is created at `social_listening.db` in the repository root. The API defaults to host `127.0.0.1` and port `8765`. You can change these at startup:

```bash
python app.py --host 127.0.0.1 --port 8765
```

If you choose a different API port, point `SINYALX_API_URL` at that address for the dashboard process. The Vite development server defaults to `127.0.0.1:3000`.

### Move existing SQLite data to PostgreSQL

Stop the local API while copying data so writes do not continue in SQLite after the snapshot. Set `DATABASE_URL_UNPOOLED` to the direct connection string for your chosen PostgreSQL database, then run:

```bash
python migrate_sqlite.py
```

The script creates a consistent SQLite backup in `output/backups/`, initializes the destination schema, and copies topics, posts, runs, analyses, deletion markers, and metadata in one transaction. It verifies every copied row and resets generated ID sequences. It does not delete or change the original SQLite file. A repeated import accepts identical data; a destination containing different data is rejected without overwriting it. Use `--source /path/to/database.db` for a different SQLite source.

After importing, set `DATABASE_URL` to the pooled application connection string and start the API. To return to local SQLite, explicitly set `DATABASE_URL=` in `.env` and remove any nonempty process-level `DATABASE_URL`. This switches back to the original local file; new PostgreSQL writes are not copied back automatically.

### Deploy the Python API on Render

After committing and pushing the backend changes, create a Python Web Service from the repository. Configure:

- Build command: `pip install -r requirements.txt`
- Start command: `python app.py --host 0.0.0.0 --port $PORT`
- Environment: `DATABASE_URL`, `APIFY_API_TOKEN`, `API_GEMINI_TOKEN`, optional `GEMINI_MODEL`, and `SINYALX_UI_URL` set to your frontend URL.

Set `SINYALX_API_URL` in Vercel to the Render HTTPS URL and redeploy the frontend. PostgreSQL schemas are initialized on API startup, without importing local data. New databases start empty. SQLite files on an ephemeral hosting filesystem do not provide durable storage.

Authentication and request controls are still required before exposing this API to untrusted users. Background collection and analysis run in Python threads and are not resumed automatically after a process restart.

## Using the dashboard

### Create a topic

Choose **Create Topic** and provide:

- **Topic name:** A short, descriptive label for identifying the search in the dashboard (2–60 characters).
- **X search query:** Search terms and supported X search operators (2–300 characters).
- **Language:** Indonesian (`id`), English (`en`), or all languages (`any`).
- **Lookback window:** 1–30 days. The UI offers common options such as 24 hours, 7 days, 14 days, and 30 days.
- **Maximum posts:** 20–1,000 posts per collection run. The UI starts with 100 by default.

### Collect and inspect

1. Select a topic and choose **Collect Posts**.
2. Confirm the collection. The app shows run progress and results when the background run completes.
3. Review the post feed and dashboard metrics. Re-run collection later to add newer posts; duplicate post IDs are not inserted again.
4. Use **Export CSV** to download posts for that topic.

### Generate an AI brief

Select **AI Analysis** after posts have been collected. The result includes an overall summary, positive and negative highlights, and key topics. New analyses are written in English; source posts retain their original language.

### Manage topics

Topics can be archived and restored so the active list stays focused. The dashboard also supports permanently deleting a topic and its associated posts.

## How AI analysis works

Gemini is called only when you request analysis. The backend selects up to 10 stored posts, ranking them by combined likes, reposts, replies, and quotes (with views as a tie-breaker). The posts are truncated before being included in the prompt, which also includes the topic name and query.

The prompt requests professional English and instructs Gemini to use only the supplied posts, avoid treating the sample as representative public opinion, and ignore instructions embedded in post text. The result contains `summary`, `positive_summary`, `negative_summary`, and `key_topics`.

The summary is based on a small, engagement-ranked sample rather than the complete dataset. Read it alongside the underlying posts and metrics.

## Metrics and interpretation

- **Volume and timeline:** Describe posts stored for the selected topic over time.
- **Engagement:** Likes, reposts, replies, quotes, and views help identify posts that drew visible interaction.
- **Authors and hashtags:** Show accounts and tags appearing in the collected sample.
- **Sentiment:** The current local classifier uses positive and negative word lists. It is an initial signal, not a nuanced understanding of context, irony, slang, or regional expressions.
- **AI highlights:** Gemini synthesizes the selected posts; it may omit minority viewpoints or misunderstand the context.

Collected posts depend on query wording, language, selected dates, the upstream Actor, and platform availability. Treat results as a query-defined sample of public posts—not a representative poll or a measure of public opinion.

## API reference

The local Python service exposes the following routes used by the dashboard:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/config` | Report credential readiness and configured Actor/model details. |
| `GET` | `/api/topics` | List active topics. |
| `GET` | `/api/topics/archived` | List archived topics. |
| `GET` | `/api/topics/{id}/dashboard` | Return a topic's metrics, posts, and analysis state. |
| `GET` | `/api/runs/{id}` | Return collection run status. |
| `GET` | `/api/topics/{id}/export.csv` | Export posts for a topic. |
| `POST` | `/api/topics` | Create a topic. |
| `POST` | `/api/topics/{id}/collect` | Start a collection run. |
| `POST` | `/api/topics/{id}/analyze` | Start an AI analysis. |
| `POST` | `/api/topics/{id}/archive` | Archive a topic. |
| `POST` | `/api/topics/{id}/restore` | Restore an archived topic. |

The API also provides endpoints for topic deletion and post management used by the dashboard. Requests are intended for the local frontend; the service does not implement user authentication.

## Project structure

| File / directory | Responsibility |
|---|---|
| `app.py` | Python HTTP API, schema initialization, input validation, collection and analysis jobs, and local sentiment classification. |
| `database.py` | Transaction and connection boundary for SQLite and PostgreSQL. |
| `apify_api.py` | Import-safe Apify API helpers and `.env` loading used by the backend. |
| `migrate_sqlite.py` | Verified, atomic import of a SQLite snapshot into PostgreSQL. |
| `tests/test_backend.py` | API workflows and data import tests. Set `TEST_DATABASE_URL` to a disposable direct PostgreSQL URL to include hosted tests. |
| `src/components/DashboardApp.tsx` | Main dashboard UI, topic workflows, controls, post feed, and metric panels. |
| `src/components/Charts.tsx` | Dashboard charts. |
| `src/server/api.ts` | Typed frontend server functions that call the Python API. |
| `src/routes/index.tsx` | Main dashboard route and bootstrap data loading. |
| `src/routes/__root.tsx` | Root document and application shell. |
| `src/styles.css` | Frontend styles. |
| `vite.config.ts` | Vite, TanStack Start, and development server configuration. |
| `.env.example` | Environment variable template with blank credentials. |
| `social_listening.db` | Local SQLite database created and maintained by the application. |

## Usage limits and costs

- A collection can request **20–1,000 posts per run**. The backend passes a maximum charge of **US$0.50 per Apify run** to the Actor API. Actual billing and available features remain subject to your Apify plan and the Actor's current pricing.
- Normal dashboard use and post collection do **not** call Gemini. Gemini is used when an AI analysis is requested.
- AI summaries use at most **10 engagement-ranked posts** in the current implementation (`GEMINI_SUMMARY_LIMIT` is currently a constant in `app.py`, not an environment setting).
- Provider quotas, pricing, model availability, and Actor behavior can change. Check the provider dashboards for current usage and billing details.

## Security and production considerations

- Keep `.env` private. Do not commit API tokens or paste them into issues, screenshots, or logs.
- The repository ignores `.env` and the local SQLite database. Back up the database separately if its contents matter.
- The app currently has no login, user roles, or multi-tenant separation. Keep it bound to localhost; do not expose the Python API directly to an untrusted network.
- Before public deployment, add authentication, HTTPS, request/rate controls, managed secret storage, and tested database backup and recovery.
- Follow X, Apify, and Google terms and applicable privacy requirements when collecting and processing public content.

## Troubleshooting

| Symptom | Checks |
|---|---|
| The dashboard does not load data | Confirm both the Python API and `npm run dev` are running. Verify the configured API URL and port. |
| Live collection fails | Confirm `APIFY_API_TOKEN` is in the root `.env`, the token is valid, and your Apify account/Actor can run. Check the collection run's error message. |
| AI analysis fails | Confirm `API_GEMINI_TOKEN` or `GEMINI_API_KEY` is set, the model is available to your account, and the topic already has posts. Check Gemini quota and provider errors. |
| Port `8765` is already in use | Start Python with a free `--port` and set `SINYALX_API_URL` to the matching API address. |
| Port `3000` is already in use | Stop the other process or adjust the Vite server port in `vite.config.ts`, then keep `SINYALX_UI_URL` aligned with the dashboard URL if using the Python redirect. |
| Posts do not match the intended topic | Simplify or broaden the query, check the language and lookback window, collect a small sample, then refine. Actor and platform search behavior affect results. |
