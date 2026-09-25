"""
apify_pull.py
Narik data dari Apify actor (X/Twitter scraper), simpan ke data.json lokal.
Testing/dev script - belum ke database, cuma file JSON dulu.

Setup:
  pip install requests
  export APIFY_API_TOKEN="apify_api_xxx"   (Windows: set APIFY_API_TOKEN=...)

Run:
  python apify_pull.py

Lalu buka dashboard.html (serve lewat local server, misal:
  python -m http.server 8000    
lalu akses http://localhost:8000/dashboard.html)
"""

import os
import sys
import time
import json
import requests
from datetime import datetime, timezone, timedelta
from collections import Counter

APIFY_TOKEN = os.environ.get("APIFY_API_TOKEN")
if not APIFY_TOKEN:
    sys.exit("Set APIFY_API_TOKEN env var dulu.")

BASE_URL = "https://api.apify.com/v2"

# --- Actor: kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest ---
# Panggil API pakai "~" bukan "/" buat pisahin owner/actor-name.
ACTOR_ID = "kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest"


def last_24h_range():
    """since/until format actor ini: YYYY-MM-DD_HH:MM:SS_UTC"""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=1)
    fmt = "%Y-%m-%d_%H:%M:%S_UTC"
    return since.strftime(fmt), now.strftime(fmt)


SINCE, UNTIL = last_24h_range()

# --- Config: 2 run per hari, query beda. Ganti keyword/hashtag sesuai brand kamu ---
RUNS = [
    {
        "name": "keyword_tracking",
        "actor_id": ACTOR_ID,
        "run_input": {
            # searchTerms support syntax pencarian X: from:, OR, tanda kutip utk frasa, dll.
            # since/until ditempel langsung di string query (bukan field terpisah).
            "searchTerms": [
                f"(namabrand OR namaproduk) since:{SINCE} until:{UNTIL}"
            ],
            "maxItems": 200,
            "queryType": "Latest",  # opsi: Latest, Top, Photos, Videos
        },
    },
    {
        "name": "trending_discovery",
        "actor_id": ACTOR_ID,
        "run_input": {
            "searchTerms": [
                f"(#trending OR #viral) since:{SINCE} until:{UNTIL}"
            ],
            "maxItems": 500,
            "queryType": "Top",
        },
    },
]

# Alternatif kalau mau pakai field "Tweet Content" polos (tanpa searchTerms):
# "run_input": {"twitterContent": "namabrand", "since": SINCE, "until": UNTIL,
#               "maxItems": 200, "queryType": "Latest"}
#
# Alternatif ambil tweet spesifik by ID (field lain diabaikan kalau ini diisi):
# "run_input": {"tweetIDs": ["1846987139428634858"]}


def start_run(actor_id, run_input):
    url = f"{BASE_URL}/acts/{actor_id}/runs?token={APIFY_TOKEN}"
    resp = requests.post(url, json=run_input)
    resp.raise_for_status()
    return resp.json()["data"]["id"]


def wait_for_run(run_id, poll_interval=5, timeout=600):
    url = f"{BASE_URL}/actor-runs/{run_id}?token={APIFY_TOKEN}"
    elapsed = 0
    while elapsed < timeout:
        resp = requests.get(url)
        resp.raise_for_status()
        data = resp.json()["data"]
        status = data["status"]
        if status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            return data
        time.sleep(poll_interval)
        elapsed += poll_interval
    raise TimeoutError(f"Run {run_id} belum selesai dalam {timeout} detik")


def get_dataset_items(dataset_id):
    url = f"{BASE_URL}/datasets/{dataset_id}/items?token={APIFY_TOKEN}&format=json&clean=true"
    resp = requests.get(url)
    resp.raise_for_status()
    return resp.json()


def normalize_post(item):
    author = item.get("author") or {}
    return {
        "id": item.get("id") or item.get("url"),
        "text": item.get("fullText") or item.get("text") or "",
        "author": author.get("userName") if isinstance(author, dict) else str(author),
        "created_at": item.get("createdAt"),
        "hashtags": item.get("hashtags") or [],
        "like_count": item.get("likeCount", 0),
        "retweet_count": item.get("retweetCount", 0),
        "url": item.get("url"),
        "source_run": item.get("_source_run", ""),
    }


def main():
    all_posts = []
    for run_cfg in RUNS:
        print(f"[start] {run_cfg['name']} ({run_cfg['actor_id']})")
        run_id = start_run(run_cfg["actor_id"], run_cfg["run_input"])
        run_data = wait_for_run(run_id)
        if run_data["status"] != "SUCCEEDED":
            print(f"[warn] run {run_cfg['name']} status: {run_data['status']}, skip")
            continue
        items = get_dataset_items(run_data["defaultDatasetId"])
        print(f"[done] {run_cfg['name']}: {len(items)} item")
        for it in items:
            it["_source_run"] = run_cfg["name"]
        all_posts.extend(normalize_post(it) for it in items)

    hashtag_counts = Counter()
    for p in all_posts:
        for h in p["hashtags"]:
            h_clean = str(h).lstrip("#").lower()
            if h_clean:
                hashtag_counts[h_clean] += 1

    run_counts = Counter(p["source_run"] for p in all_posts)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_posts": len(all_posts),
        "hashtag_counts": dict(hashtag_counts.most_common(30)),
        "run_counts": dict(run_counts),
        "posts": sorted(all_posts, key=lambda p: p["like_count"], reverse=True)[:100],
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[saved] data.json ({len(all_posts)} post total)")


if __name__ == "__main__":
    main()