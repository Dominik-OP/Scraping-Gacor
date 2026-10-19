import json
import os
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path

tmp = Path(tempfile.mkdtemp()) / "copy.db"
src = sqlite3.connect("social_listening.db")
dst = sqlite3.connect(tmp)
src.backup(dst)
src.close()
dst.close()
os.environ["DATABASE_URL"] = ""
os.environ["SINYALX_DB_PATH"] = str(tmp)

import app

start = time.time()
app.init_db()
print("init+backfill", round(time.time() - start, 2))
with app.connect_db() as db:
    print(db.execute("select count(*) c, sum(details_version) v, sum(reply_to <> '') r, "
                     "sum(mentions_json <> '[]') m, sum(author_location <> '') l from posts").fetchone())
    topic_ids = [row["id"] for row in db.execute("select id from topics").fetchall()]
for topic_id in topic_ids:
    start = time.time()
    data = app.insights_data(topic_id)
    if not data:
        continue
    print("topic", topic_id, "insights", round(time.time() - start, 2), "posts", data["posts_analyzed"])
    g = data["geo"]
    print(" coverage", g["coverage"])
    print(" top provinces", [(p["name"], p["posts"], p["heat"], p["trend"]) for p in
                             sorted(g["provinces"], key=lambda p: -p["posts"])[:6]])
    print(" cities", [(c["name"], c["posts"]) for c in g["cities"][:6]])
    print(" mentions", [(m["name"], m["posts"], m["top_cities"]) for m in g["mentions"][:6]])
    n = data["network"]
    print(" stats", n["stats"])
    print(" actors", [(a["username"], a["role"], a["influence"], a["community"]) for a in n["actors"][:8]])
    print(" communities", [(c["label"], c["size"], c["top_region"]) for c in n["communities"]])
    print(" graph", len(n["graph"]["nodes"]), len(n["graph"]["edges"]), n["graph"]["truncated"])
    dash = app.dashboard_data(topic_id)
    print(" dash post region", [(p["author_location"], p["region"]) for p in dash["posts"][:5]])
    print(" json bytes", len(json.dumps(data)))
shutil.rmtree(tmp.parent, ignore_errors=True)
