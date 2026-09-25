# IndonesiaBerkumpul

**A local-first social listening dashboard for public conversations on X.** Track topics, collect posts through Apify, explore engagement and sentiment signals, and request concise AI summaries with Google Gemini.

> **Status:** Local development application. It is not designed as a public, multi-user service without additional authentication and deployment hardening.

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Using the dashboard](#using-the-dashboard)
- [Data and API](#data-and-api)
- [Project structure](#project-structure)
- [Limits and interpretation](#limits-and-interpretation)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## What it does

- Create and manage topic searches with a query, language, collection window, and result limit.
- Collect recent public X posts using an Apify Actor; collection runs in the background and records run status.
- Review post volume, engagement, authors, hashtags, and indicative sentiment in the dashboard.
- Request an on-demand Gemini summary with key topics and positive and negative conversation highlights.
- Archive and restore topics, remove posts, and export a topic's posts as CSV.
- Explore seeded demo data before connecting an Apify account.

## How it works

```text
Browser (TanStack Start / React, :3000)
             │ server functions
             ▼
Python API (:8765) ───── Apify X scraper
       │                 Gemini API (on demand)
       ▼
SQLite (social_listening.db)
```

The browser UI uses TanStack Start and React. Its server functions call the local Python API, which validates requests, runs collection and analysis tasks, and reads or writes the SQLite database. Apify collection and Gemini analysis are separate actions: Gemini is only called when an analysis is explicitly requested.

## Quick start

### Requirements

- Python 3.10 or newer
- Node.js and npm (or pnpm)
- An Apify API token for live collection
- A Google Gemini API token for AI analysis (optional until analysis is requested)

### Install

From the repository root, install the frontend dependencies:

```bash
npm install
```

The Python backend uses the Python standard library; no `pip install` step is required.

### Configure credentials

Copy `.env.example` to `.env`, then add your credentials:

```dotenv
APIFY_API_TOKEN=apify_api_your_token_here
API_GEMINI_TOKEN=your_gemini_api_token_here
GEMINI_MODEL=gemini-3.5-flash
```

`API_GEMINI_TOKEN` is the variable shown in `.env.example`. The backend also accepts `GEMINI_API_KEY` for compatibility. The configured model may be changed with `GEMINI_MODEL`. Keep real credentials in `.env`; do not commit them.

### Start the app

Open two terminal windows in the repository root.

Terminal 1 — Python API:

```bash
python app.py
```

Terminal 2 — dashboard:

```bash
npm run dev
```

Open **http://127.0.0.1:3000**. The API listens on **http://127.0.0.1:8765** by default. Stop either process with `Ctrl+C`.

To change the API bind address or port, run `python app.py --host 127.0.0.1 --port 8765`. The dashboard's backend URL can be configured with `SINYALX_API_URL`; the Python server's redirect target can be configured with `SINYALX_UI_URL`.

## Configuration

| Variable | Required | Purpose |
|---|---:|---|
| `APIFY_API_TOKEN` | For live collection | Authenticates requests to Apify. |
| `API_GEMINI_TOKEN` or `GEMINI_API_KEY` | For AI analysis | Authenticates Gemini requests. |
| `GEMINI_MODEL` | No | Gemini model identifier; defaults in the backend if omitted. |
| `SINYALX_API_URL` | No | Python API URL used by the dashboard server functions. |
| `SINYALX_UI_URL` | No | URL used by Python's root/dashboard redirect. |

The database is created as `social_listening.db` in the repository root. Topic collection accepts 20–1,000 posts per run and a lookback window of 1–30 days. The Apify run is capped at **US$0.50** per execution by the backend.

## Using the dashboard

1. Open the dashboard and select a topic. A demo topic is seeded locally on first startup so you can inspect the interface without collecting live data.
2. Create a topic with a name, X search query, language (`id`, `en`, or `any`), lookback window, and maximum post count.
3. Start collection. The run executes in the background; its status and number of newly saved posts appear in the dashboard.
4. Explore the topic's posts, engagement metrics, timeline, authors, hashtags, and sentiment distribution.
5. Choose **AI analysis** to summarize the conversation. The analysis uses up to 10 posts ranked by likes, reposts, replies, and quotes.
6. Export posts as CSV, or archive and restore topics as needed.

## Data and API

The Python service exposes the application's local JSON API, including:

| Route | Purpose |
|---|---|
| `GET /api/config` | Reports credential readiness and configured service details. |
| `GET /api/topics` | Lists active topics. |
| `GET /api/topics/archived` | Lists archived topics. |
| `GET /api/topics/{id}/dashboard` | Returns topic metrics, posts, and analysis state. |
| `GET /api/runs/{id}` | Returns collection run status. |
| `GET /api/topics/{id}/export.csv` | Exports a topic's posts. |
| `POST /api/topics` | Creates a topic. |
| `POST /api/topics/{id}/collect` | Starts an Apify collection run. |
| `POST /api/topics/{id}/analyze` | Starts Gemini analysis. |
| `POST /api/topics/{id}/archive` or `/restore` | Changes topic archive state. |

The SQLite database stores topics, posts, collection runs, AI analyses, and app metadata. Collection avoids duplicate post records. The database is local application data and is not automatically synchronized or backed up.

## Project structure

| Path | Responsibility |
|---|---|
| `app.py` | Python HTTP API, SQLite schema and queries, validation, collection, sentiment, and Gemini analysis. |
| `apify_pull.py` | Shared Apify API helpers and `.env` loading used by the backend. |
| `src/components/DashboardApp.tsx` | Main dashboard interface and topic workflows. |
| `src/components/Charts.tsx` | Dashboard chart components. |
| `src/server/api.ts` | TanStack server functions and typed calls to the Python API. |
| `src/routes/index.tsx` | Dashboard route and initial data loading. |
| `src/routes/__root.tsx` | Root document and application shell. |
| `src/styles.css` | Frontend styling. |
| `.env.example` | Credential and configuration template. |

## Limits and interpretation

- Results depend on the search query, language, time window, Actor behavior, and collection limit. They are not a representative survey of Indonesian public opinion.
- Sentiment labels are lightweight, rule-based indicators. They can misread sarcasm, context, slang, and regional language.
- Gemini analysis is based on a small engagement-ranked sample (up to 10 posts), not every stored post. Treat it as a reading aid, not a definitive account of the conversation.
- Public posts may contain misleading content or instructions. The analysis prompt treats post text as untrusted input, but AI output can still be incomplete or wrong.
- Apify and Gemini usage may incur charges under your providers' current plans. The backend caps each Apify run at US$0.50; Gemini calls happen only when requested.

## Security

- Never commit or share `.env` or API tokens. The repository ignores `.env` and the local SQLite database.
- The local API does not provide user authentication or multi-tenant isolation. Keep it bound to localhost unless you add appropriate access controls.
- Before exposing the app to a network or deploying it, add authentication, HTTPS, rate limits, secret management, and a database backup/restore process.
- Follow X, Apify, and Google terms and applicable privacy requirements when collecting or processing public content.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Dashboard cannot load data | Confirm both the Python API and frontend dev server are running, and that the API URL is correct. |
| Collection cannot start | Check `APIFY_API_TOKEN`, network access, Apify account limits, and the collection run status/error. |
| AI analysis fails | Check `API_GEMINI_TOKEN` (or `GEMINI_API_KEY`), `GEMINI_MODEL`, provider quota, and that the topic has collected posts. |
| Port is already in use | Start Python with another `--port` and set `SINYALX_API_URL` to that API address. |

