"""Location resolution, social network analysis, and the insights endpoint."""

import csv
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import app
import geo
import network
from database import connect_db


class GeoTests(unittest.TestCase):
    def test_profile_locations_resolve_to_regions(self):
        cases = {
            "Kota Surabaya, Jawa Timur": ("city", "JATIM", "Surabaya"),
            "Jaksel": ("city", "DKI", "Jakarta Selatan"),
            "Bandung, Indonesia": ("city", "JABAR", "Bandung"),
            "Central Java, Indonesia": ("province", "JATENG", None),
            "Jogja": ("province", "DIY", None),
            "Solo, Jalan Kutai Utara No 1": ("city", "JATENG", "Surakarta"),
            "Tanah Abang, Indonesia": ("city", "DKI", "Jakarta Pusat"),
            "ÜT: -6.1805,106.884": ("city", "DKI", "Jakarta Utara"),
        }
        for text, (kind, province, city) in cases.items():
            with self.subTest(text=text):
                location = geo.resolve_location(text)
                self.assertEqual((location.kind, location.province_code, location.city), (kind, province, city))

    def test_country_foreign_and_unknown_profiles(self):
        self.assertEqual(geo.resolve_location("🇮🇩").kind, "country")
        self.assertEqual(geo.resolve_location("+62").country, "Indonesia")
        self.assertEqual(geo.resolve_location("Bumi Nusantara").country, "Indonesia")
        self.assertEqual(geo.resolve_location("Kuala Lumpur").country, "Malaysia")
        self.assertEqual(geo.resolve_location("Barcelona, Cataluña").country, "Spain")
        self.assertEqual(geo.resolve_location("🇯🇵").country, "Japan")
        self.assertEqual(geo.resolve_location("Neverland").kind, "unknown")
        self.assertEqual(geo.resolve_location("").kind, "unknown")
        self.assertEqual(geo.resolve_location("", place_country="ID").country, "Indonesia")
        # A geotagged place takes precedence over the profile.
        self.assertEqual(geo.resolve_location("Medan", place="Denpasar, Bali").province_code, "BALI")
        self.assertEqual(geo.locate_coordinates(48.85, 2.35).kind, "foreign")

    def test_text_mentions_require_place_context(self):
        labels = lambda text: [location.label for location in geo.find_text_mentions(text)]
        self.assertEqual(labels("Keracunan MBG di Lampung Tengah dan Batang"),
                         ["Lampung Tengah, Lampung", "Batang, Jawa Tengah"])
        # Ambiguous words only count when capitalized as place names.
        self.assertEqual(labels("nasib malang sekali, batang pohon"), [])
        self.assertEqual(labels("Banjir di Malang"), ["Malang, Jawa Timur"])
        self.assertEqual(labels("Dari Sabang sampai Merauke @jakarta https://x.com/bali"), [])
        # One mention per province, keeping the most specific place.
        self.assertEqual(labels("Jawa Timur, tepatnya Surabaya"), ["Surabaya, Jawa Timur"])

    def test_region_summary_heat_and_trend(self):
        latest = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)

        def post(user, location, hours_ago, likes=0, text="update", sentiment="neutral"):
            return {"author_username": user, "author_location": location, "text": text, "sentiment": sentiment,
                    "created_at": (latest - timedelta(hours=hours_ago)).isoformat(), "like_count": likes,
                    "hashtags_json": json.dumps(["mbg"])}

        posts = [post(f"jkt{i}", "Jakarta", 72 + i, likes=10) for i in range(5)]
        posts += [post(f"sby{i}", "Surabaya", i, sentiment="negative") for i in range(4)]
        posts += [post("ln", "Neverland", 1, text="Banjir di Kota Medan"), post("my", "Kuala Lumpur", 2)]
        summary = geo.summarize_regions(posts)
        provinces = {row["code"]: row for row in summary["provinces"]}
        self.assertEqual(len(summary["provinces"]), len(geo.PROVINCES))
        self.assertEqual(summary["coverage"]["province"], 9)
        self.assertEqual(summary["coverage"]["foreign"], 1)
        self.assertEqual(summary["coverage"]["unknown"], 1)
        self.assertEqual(provinces["DKI"]["heat"], 100)
        self.assertEqual(provinces["DKI"]["trend"], "cooling")
        self.assertEqual(provinces["JATIM"]["trend"], "rising")
        self.assertEqual(provinces["JATIM"]["net_sentiment"], -100)
        self.assertEqual(provinces["JATIM"]["top_cities"], [{"name": "Surabaya", "posts": 4}])
        self.assertEqual(provinces["ACEH"]["heat"], 0)
        self.assertEqual(summary["cities"][0], {"name": "Surabaya", "province_code": "JATIM",
                                                "province": "Jawa Timur", "posts": 4, "authors": 4,
                                                "engagement": 0, "net_sentiment": -100})
        self.assertEqual(summary["foreign"], [{"country": "Malaysia", "posts": 1}])
        self.assertEqual(summary["mentions"][0]["code"], "SUMUT")
        self.assertEqual(provinces["SUMUT"]["mention_heat"], 100)

    def test_gazetteer_has_every_province(self):
        self.assertEqual(len(geo.PROVINCES), 38)
        covered = {city.province for city, _ in geo.CITIES}
        self.assertEqual(covered, set(geo.PROVINCE_BY_CODE))
        positions = [(province.col, province.row) for province in geo.PROVINCES]
        self.assertEqual(len(positions), len(set(positions)), "Tile map positions must be unique")

    def test_multiple_profile_regions_are_not_assigned_arbitrarily(self):
        self.assertEqual(geo.resolve_location("Jakarta / Bandung").kind, "unknown")
        self.assertEqual(geo.resolve_location("London / Jakarta").kind, "unknown")
        location = geo.resolve_location("Bandung / Bekasi")
        self.assertEqual((location.kind, location.province_code, location.city), ("province", "JABAR", None))

    def test_thread_counts_deduplicate_within_each_region(self):
        posts = [{"author_location": location, "conversation_id": thread}
                 for location, thread in [("Bandung", "1"), ("Bandung", "1"),
                                          ("Bekasi", "2"), ("Surabaya", "1"), ("", "")]]
        result = geo.summarize_regions(posts)
        regions = {row["code"]: row for row in result["provinces"]}
        self.assertEqual(result["coverage"]["threads"], 2)
        self.assertEqual(result["coverage"]["posts_with_thread"], 4)
        self.assertEqual((regions["JABAR"]["threads"], regions["JATIM"]["threads"]), (2, 1))

    def test_regional_details_include_locations_beyond_the_top_lists(self):
        posts = [{"author_location": city.name, "text": ""} for city, _ in geo.CITIES[:20]]
        result = geo.summarize_regions(posts)
        self.assertEqual(len(result["cities"]), 20)
        mentions = geo.summarize_regions([{"text": f"Laporan di {province.name}"}
                                          for province in geo.PROVINCES])["mentions"]
        self.assertEqual({row["code"] for row in mentions}, set(geo.PROVINCE_BY_CODE))


class PostDetailsTests(unittest.TestCase):
    def test_metadata_keeps_ids_places_coordinates_and_all_mentions(self):
        item = {"conversationId": "2103321597440618636", "inReplyToId": "8", "inReplyToUserId": "9",
                "inReplyToUsername": "@parent", "isReply": True,
                "author": {"id": "2103321597440618637", "location": "Jakarta"},
                "quoted_tweet": {"id": "10", "author": {"userName": "quoted"}},
                "retweeted_tweet": {"id": "11", "author": {"userName": "reposted"}},
                "place": {"id": "place-id", "full_name": "Bandung, Jawa Barat", "country_code": "ID",
                          "bounding_box": {"coordinates": [[[107.6, -6.9]]]}},
                "coordinates": {"type": "Point", "coordinates": [107.6, -6.9]},
                "entities": {"user_mentions": [{"id_str": str(i), "screen_name": f"account{i}"}
                                               for i in range(25)]}}
        details = app.post_details(item)
        self.assertEqual(details["author_id"], item["author"]["id"])
        self.assertEqual(details["conversation_id"], item["conversationId"])
        self.assertEqual((details["reply_to_post_id"], details["reply_to_user_id"], details["reply_to"]),
                         ("8", "9", "parent"))
        self.assertEqual((details["quoted_post_id"], details["retweeted_post_id"]), ("10", "11"))
        self.assertEqual(json.loads(details["place_json"]), item["place"])
        self.assertEqual(json.loads(details["post_coordinates_json"])["coordinates"], item["coordinates"])
        mentions = json.loads(details["mentions_json"])
        self.assertEqual(len(mentions), 25)
        self.assertEqual(mentions[-1]["id"], "24")
        self.assertEqual(app.post_details({})["conversation_id"], "")


class NetworkTests(unittest.TestCase):
    @staticmethod
    def post(author, mentions=(), reply_to="", quoted="", tags=(), location=""):
        return {
            "author_username": author, "author_name": author.title(), "author_location": location,
            "mentions_json": json.dumps([{"username": name, "name": name.title()} for name in mentions]),
            "reply_to": reply_to, "quoted_user": quoted, "retweeted_user": "",
            "hashtags_json": json.dumps(list(tags)), "sentiment": "neutral", "like_count": 1,
        }

    def test_interactions_skip_self_and_duplicate_reply_mentions(self):
        interactions = network.post_interactions(self.post("ana", mentions=["ana", "budi", "Budi"], reply_to="budi",
                                                           quoted="cici"))
        self.assertEqual([(target, kind) for target, _, kind in interactions],
                         [("budi", "reply"), ("cici", "quote")])

    def test_communities_bridges_and_influencers(self):
        posts = []
        for group, tag in (("abcd", "west"), ("efgh", "east")):
            for author in group:
                posts += [self.post(author, mentions=[other], tags=[tag], location="Bandung")
                          for other in group if other != author]
        posts.append(self.post("d", reply_to="e"))
        posts += [self.post(fan, mentions=["star"]) for fan in ("f1", "f2", "f3", "f4")]
        posts.append(self.post("solo"))
        result = network.analyze_network(posts)
        stats = result["stats"]
        # 8 clustered authors, 4 fans, and one account with no interactions; "star" never posts.
        self.assertEqual(stats["authors"], 13)
        self.assertEqual(stats["isolated_authors"], 1)
        self.assertEqual(stats["referenced_accounts"], 1)
        self.assertEqual(stats["components"], 2)
        self.assertEqual(stats["interaction_types"]["reply"], 1)
        self.assertGreater(stats["modularity"], 0.3)
        actors = {actor["username"]: actor for actor in result["actors"]}
        # PageRank favours accounts inside active loops over a hub reached only by one-off fans.
        self.assertEqual(result["actors"][0]["username"], "e")
        self.assertEqual(actors["e"]["role"], "influencer")
        self.assertEqual(actors["star"]["in_degree"], 4)
        self.assertEqual(actors["star"]["role"], "referenced")
        self.assertIn(result["brokers"][0]["username"], {"d", "e"})
        self.assertIn("bridge", {actors["d"]["role"], actors["e"]["role"]})
        self.assertNotEqual(actors["a"]["community"], actors["h"]["community"])
        self.assertEqual(actors["a"]["community"], actors["b"]["community"])
        west = next(group for group in result["communities"] if "west" in group["top_hashtags"])
        self.assertEqual(west["top_region"], "Jawa Barat")
        self.assertEqual(result["hashtag_pairs"], [])
        nodes = result["graph"]["nodes"]
        self.assertEqual(len(nodes), stats["nodes"])
        self.assertTrue(all(0 <= node["x"] <= 1 and 0 <= node["y"] <= 1 for node in nodes))
        self.assertFalse(result["graph"]["truncated"])

    def test_empty_and_large_samples(self):
        empty = network.analyze_network([])
        self.assertEqual(empty["stats"]["nodes"], 0)
        self.assertEqual(empty["graph"]["nodes"], [])
        posts = [self.post(f"user{i}", mentions=[f"user{(i * 7) % 900}", f"hub{i % 5}"]) for i in range(900)]
        result = network.analyze_network(posts)
        self.assertTrue(result["stats"]["betweenness_sampled"])
        self.assertLessEqual(len(result["graph"]["nodes"]), network.GRAPH_NODE_LIMIT)
        self.assertTrue(result["graph"]["truncated"])
        self.assertTrue(all(actor["username"].startswith("hub") for actor in result["actors"][:5]))

    def test_pagerank_sums_to_one(self):
        ranks = network.pagerank({"a": {"b": 1.0}, "b": {"c": 1.0}}, ["a", "b", "c"])
        self.assertAlmostEqual(sum(ranks.values()), 1.0, places=6)
        self.assertGreater(ranks["c"], ranks["a"])


class InsightsApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        environment = patch.dict(os.environ, {"DATABASE_URL": "",
                                              "SINYALX_DB_PATH": str(Path(cls.temp.name) / "insights.db")})
        environment.start()
        cls.addClassCleanup(environment.stop)
        app.init_db()
        cls.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.DashboardHandler)
        worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        worker.start()
        cls.addClassCleanup(worker.join)
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    def get(self, path):
        try:
            response = urllib.request.urlopen(self.base + path, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_collected_posts_feed_location_network_and_export(self):
        with connect_db() as db:
            topic_id = db.execute("INSERT INTO topics(name, query, created_at) VALUES ('MBG', 'mbg', ?) RETURNING id",
                                  (app.utc_now(),)).fetchone()["id"]
        items = [
            {"id": "1", "text": "Keracunan MBG di Batang @kemenkes", "createdAt": app.utc_now(),
             "conversationId": "9", "inReplyToUserId": "99",
             "isReply": True, "inReplyToId": "9", "inReplyToUsername": "bgn_ri",
             "author": {"id": "1234567890123456789", "userName": "warga", "name": "=1+1", "location": "Kota Surabaya, Jawa Timur",
                        "isBlueVerified": True},
             "entities": {"user_mentions": [{"screen_name": "bgn_ri", "name": "BGN"},
                                            {"screen_name": "kemenkes", "name": "Kemenkes"}]}},
            {"id": "2", "text": "Setuju", "createdAt": app.utc_now(), "place": {"full_name": "Denpasar, Bali",
                                                                              "country_code": "ID"},
             "author": {"userName": "bali_news", "location": "Neverland"},
             "quoted_tweet": {"author": {"userName": "warga"}}},
        ]
        with connect_db() as db:
            for item in items:
                tweet = app.normalize_tweet(item)
                columns = ", ".join(["topic_id", *tweet])
                db.execute(f"INSERT INTO posts ({columns}) VALUES ({', '.join('?' for _ in range(len(tweet) + 1))})",
                           [topic_id, *tweet.values()])
            # Posts stored before this feature have only raw_json; init_db must backfill them.
            db.execute("INSERT INTO posts(topic_id, tweet_id, text, sentiment, raw_json, collected_at) "
                       "VALUES (?, '3', 'Lama', 'neutral', ?, ?)",
                       (topic_id, json.dumps({"author": {"userName": "lama", "location": "Makassar"},
                                              "isReply": True, "inReplyToUsername": "warga"}), app.utc_now()))
        app.init_db()
        # Version-one rows must also acquire newly extracted fields without losing raw data.
        with connect_db() as db:
            db.execute("UPDATE posts SET details_version = 1, conversation_id = '' WHERE tweet_id = '1'")
        app.init_db()
        with connect_db() as db:
            legacy = db.execute("SELECT * FROM posts WHERE tweet_id = '3'").fetchone()
        self.assertEqual((legacy["author_location"], legacy["reply_to"], legacy["details_version"]),
                         ("Makassar", "warga", app.DETAILS_VERSION))

        status, body = self.get(f"/api/topics/{topic_id}/insights")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["posts_analyzed"], 3)
        provinces = {row["code"]: row["posts"] for row in data["geo"]["provinces"] if row["posts"]}
        self.assertEqual(provinces, {"JATIM": 1, "BALI": 1, "SULSEL": 1})
        self.assertEqual(data["geo"]["coverage"]["sources"], {"profile": 2, "place": 1})
        self.assertEqual(data["geo"]["coverage"]["threads"], 1)
        self.assertEqual(data["geo"]["mentions"][0]["code"], "JATENG")
        stats = data["network"]["stats"]
        self.assertEqual(stats["interaction_types"], {"reply": 2, "mention": 1, "quote": 1, "retweet": 0})
        actors = {actor["username"]: actor for actor in data["network"]["actors"]}
        self.assertEqual(actors["warga"]["in_degree"], 2)
        self.assertTrue(actors["warga"]["verified"])
        self.assertEqual(actors["warga"]["province_code"], "JATIM")

        dashboard = app.dashboard_data(topic_id)
        regions = {post["tweet_id"]: post["region"] for post in dashboard["posts"]}
        self.assertEqual(regions["1"], "Surabaya, Jawa Timur")
        self.assertEqual(regions["2"], "Denpasar, Bali")
        first = next(post for post in dashboard["posts"] if post["tweet_id"] == "1")
        self.assertEqual((first["conversation_id"], first["region_source"]), ("9", "profile"))

        with patch.object(app, "INSIGHTS_POST_LIMIT", 1):
            limited = app.insights_data(topic_id)
        self.assertEqual(limited["posts_analyzed"], 1)
        self.assertEqual(limited["geo"]["coverage"]["posts"], 3)

        status, csv_body = self.get(f"/api/topics/{topic_id}/export.csv")
        self.assertEqual(status, 200)
        export = csv_body.decode("utf-8-sig")
        self.assertIn("region_province", export.splitlines()[0])
        self.assertIn("@bgn_ri @kemenkes", export)
        self.assertIn("Jawa Timur", export)
        rows = list(csv.DictReader(io.StringIO(export)))
        first = next(row for row in rows if row["tweet_id"] == "1")
        self.assertEqual(first["author_id"], "1234567890123456789")
        self.assertEqual((first["conversation_id"], first["reply_to_post_id"], first["reply_to_user_id"]),
                         ("9", "9", "99"))
        self.assertEqual(first["author_name"], "'=1+1")
        self.assertEqual(json.loads(first["raw_json"]), items[0])
        self.assertEqual(first["region_resolution"], "city")
        second = next(row for row in rows if row["tweet_id"] == "2")
        self.assertEqual(json.loads(second["place_json"]), items[1]["place"])

        self.assertEqual(self.get("/api/topics/999999/insights")[0], 404)

    def test_empty_export_keeps_complete_headers(self):
        with connect_db() as db:
            topic_id = db.execute("INSERT INTO topics(name, query, created_at) VALUES ('Empty', 'empty', ?) RETURNING id",
                                  (app.utc_now(),)).fetchone()["id"]
        status, body = self.get(f"/api/topics/{topic_id}/export.csv")
        self.assertEqual(status, 200)
        reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
        self.assertIn("conversation_id", reader.fieldnames)
        self.assertIn("region_source", reader.fieldnames)
        self.assertIn("raw_json", reader.fieldnames)
        self.assertEqual(list(reader), [])


if __name__ == "__main__":
    unittest.main()
