import json
import time

import network

posts = []
def p(author, mentions=(), reply=None, tags=()):
    posts.append({"author_username": author, "mentions_json": json.dumps(list(mentions)), "reply_to": reply,
                  "hashtags_json": json.dumps(list(tags)), "sentiment": "neutral", "author_location": "Bandung"})

for a in "abcd":
    for b in "abcd":
        if a != b:
            p(a, [b], tags=["x", "y"])
for a in "efgh":
    for b in "efgh":
        if a != b:
            p(a, [b], tags=["z"])
p("d", reply="e")
p("loner")
start = time.time()
result = network.analyze_network(posts)
print(time.time() - start)
print(json.dumps(result["stats"], indent=1))
print([(a["username"], a["role"], a["community"], a["betweenness"]) for a in result["actors"]])
print(json.dumps(result["communities"], indent=1)[:1500])
print(result["graph"]["nodes"][0])

# Scale test
import random
rng = random.Random(1)
big = []
for i in range(1000):
    big.append({"author_username": f"u{rng.randint(0, 700)}", "mentions_json": json.dumps([f"u{rng.randint(0, 900)}" for _ in range(rng.randint(0, 3))]),
                "reply_to": f"u{rng.randint(0, 50)}" if rng.random() < 0.4 else None, "hashtags_json": "[]", "sentiment": "neutral"})
start = time.time()
r = network.analyze_network(big)
print("big", time.time() - start, r["stats"])
