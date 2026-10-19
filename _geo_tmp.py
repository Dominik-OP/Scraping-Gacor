import sqlite3
from collections import Counter

import geo

c = sqlite3.connect("social_listening.db")
rows = c.execute("select json_extract(raw_json, '$.author.location'), text from posts").fetchall()
kinds = Counter()
for loc, text in rows:
    r = geo.resolve_location(loc or "")
    kinds[r.kind] += 1
    if loc:
        print(repr(loc), "->", r.kind, r.label)
print(kinds)
for loc, text in rows:
    m = geo.find_text_mentions(text)
    if m:
        print([x.label for x in m], "|", text[:100].replace("\n", " "))
