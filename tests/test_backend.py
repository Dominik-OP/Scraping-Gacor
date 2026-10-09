"""Run against SQLite, or a disposable Postgres schema via TEST_DATABASE_URL."""

import json
import io
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import app
import vercel_api
from apify_api import get_all_dataset_items, load_env_file
from database import connect_db
from migrate_sqlite import import_sqlite


class BackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.source = Path(cls.temp.name) / "source.db"
        cls.admin_url = os.getenv("TEST_DATABASE_URL", "")
        cls.schema = "test_backend_" + uuid.uuid4().hex
        cls.environment = patch.dict(os.environ, {"DATABASE_URL": "", "SINYALX_DB_PATH": str(cls.source)})
        cls.environment.start()
        cls.addClassCleanup(cls.environment.stop)
        cls.addClassCleanup(cls.temp.cleanup)
        app.init_db()
        if app.topic_list():
            raise AssertionError("A new database must start empty")
        # Synthetic fixtures exist only in this temporary test database.
        with connect_db() as db:
            cls.fixture_id = db.execute(
                "INSERT INTO topics(name, query, created_at) VALUES ('Test topic', 'transit', ?) RETURNING id",
                (app.utc_now(),),
            ).fetchone()["id"]
            for index in range(12):
                db.execute(
                    "INSERT INTO posts(topic_id, tweet_id, text, created_at, sentiment, raw_json, collected_at) "
                    "VALUES (?, ?, 'Test post', ?, 'neutral', '{}', ?)",
                    (cls.fixture_id, f"fixture-{index}", app.utc_now(), app.utc_now()),
                )
            db.execute(
                "INSERT INTO runs(id, topic_id, status, requested_at) VALUES ('fixture-run', ?, 'succeeded', ?)",
                (cls.fixture_id, app.utc_now()),
            )
            db.execute("INSERT INTO deleted_posts VALUES (?, ?, ?)", (cls.fixture_id, "removed", app.utc_now()))
            db.execute(
                "INSERT INTO ai_analyses(topic_id, status, model, summary) VALUES (?, 'succeeded', 'test', 'Brief')",
                (cls.fixture_id,),
            )
        if cls.admin_url:
            with connect_db(database_url=cls.admin_url) as db:
                db.execute(f"CREATE SCHEMA {cls.schema}")
            cls.addClassCleanup(cls.drop_schema)
            parsed = urlsplit(cls.admin_url)
            query = dict(parse_qsl(parsed.query))
            query["options"] = f"-csearch_path={cls.schema}"
            cls.url = urlunsplit(parsed._replace(query=urlencode(query)))
            os.environ["DATABASE_URL"] = cls.url
            app.init_db()
            counts = import_sqlite(cls.source, cls.url)
            if counts["posts"] != 12:
                raise AssertionError("Test posts were not preserved")
            # Repeating the import must preserve rows and IDs.
            if import_sqlite(cls.source, cls.url) != counts:
                raise AssertionError("Migration retry was not idempotent")
            with connect_db() as db:
                migrated = app.dashboard_data(cls.fixture_id)
                if migrated["ai_analysis"]["summary"] != "Brief":
                    raise AssertionError("AI analysis was not preserved")
        cls.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.DashboardHandler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.addClassCleanup(cls.stop_server)

    @classmethod
    def drop_schema(cls):
        with connect_db(database_url=cls.admin_url) as db:
            db.execute(f"DROP SCHEMA {cls.schema} CASCADE")

    @classmethod
    def stop_server(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def request(self, method, path, payload=None):
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.base + path, data=body, method=method,
                                         headers={"Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read()
            if "application/json" in response.headers.get("Content-Type", ""):
                content = json.loads(content)
            return response.status, content

    def test_restart_preserves_data_without_seeding(self):
        before = app.topic_list()
        app.init_db()
        self.assertEqual(app.topic_list(), before)
        status, data = self.request("GET", f'/api/topics/{self.fixture_id}/dashboard')
        self.assertEqual(status, 200)
        self.assertEqual(data["summary"]["mentions"], 12)
        self.assertEqual(sum(data["sentiment"].values()), 12)

    def test_legacy_demo_is_hidden_without_deleting_records(self):
        with connect_db() as db:
            topic_id = db.execute(
                "INSERT INTO topics(name, query, is_demo, created_at) VALUES ('Old demo', 'demo', 1, ?) RETURNING id",
                (app.utc_now(),),
            ).fetchone()["id"]
        try:
            self.assertFalse(any(topic["id"] == topic_id for topic in app.topic_list()))
            self.assertEqual(self.request("GET", f"/api/topics/{topic_id}/dashboard")[0], 404)
            with connect_db() as db:
                self.assertIsNotNone(db.execute("SELECT id FROM topics WHERE id = ?", (topic_id,)).fetchone())
        finally:
            with connect_db() as db:
                db.execute("DELETE FROM topics WHERE id = ?", (topic_id,))

    def test_workflow_duplicate_collection_analysis_export_and_delete(self):
        status, topic = self.request("POST", "/api/topics", {
            "name": "Test transport", "query": "KRL", "max_items": 20,
        })
        self.assertEqual(status, 201)
        topic_id = topic["id"]
        items = [{"id": "fixture", "text": "bagus #KRL", "createdAt": app.utc_now(),
                  "likeCount": 3, "viewCount": 5_000_000_000,
                  "author": {"userName": "tester", "name": "Test"}}]
        with patch.object(app, "require_token", return_value="test"), patch.object(
            app, "api_request", return_value={"data": {
                "id": "actor", "defaultDatasetId": "dataset", "status": "SUCCEEDED",
            }}
        ) as actor_call, patch.object(app, "get_all_dataset_items", return_value=items):
            for expected in (1, 0):
                self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/collect")[0], 400)
                status, started = self.request("POST", f"/api/topics/{topic_id}/collect", {"confirmed": True})
                self.assertEqual(status, 202)
                self.assertEqual(actor_call.call_args.kwargs["query"]["waitForFinish"], 0)
                run_id = started["run_id"]
                self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/collect", {"confirmed": True})[0], 409)
                # Reloading the database cannot lose the upstream run ID.
                app.init_db()
                with ThreadPoolExecutor(max_workers=2) as workers:
                    responses = list(workers.map(lambda _: self.request("GET", f"/api/runs/{run_id}"), range(2)))
                status, run = responses[0]
                self.assertEqual(responses[1][1]["items_new"], expected)
                self.assertEqual(status, 200)
                self.assertEqual(run["status"], "succeeded", run.get("error"))
                self.assertEqual(run["items_new"], expected)
                self.assertEqual(app.dashboard_data(topic_id)["last_run"]["id"], run_id)
                calls = actor_call.call_count
                self.assertEqual(self.request("GET", f"/api/runs/{run_id}")[1]["items_new"], expected)
                self.assertEqual(actor_call.call_count, calls)
        status, data = self.request("GET", f"/api/topics/{topic_id}/dashboard")
        self.assertEqual(status, 200)
        self.assertEqual(data["summary"]["views"], 5_000_000_000)
        self.assertEqual(data["top_authors"][0]["engagement"], 3)
        with patch.object(app, "require_gemini_token", return_value=("test", "test")), patch.object(
            app, "gemini_json", return_value={"summary": "Brief", "key_topics": ["KRL"]}
        ) as analysis_call:
            self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/analyze")[0], 200)
            self.assertIn("professional English", analysis_call.call_args.args[0])
            self.assertIn("untrusted data", analysis_call.call_args.args[0])
        self.assertEqual(app.dashboard_data(topic_id)["ai_analysis"]["status"], "succeeded")
        status, csv = self.request("GET", f"/api/topics/{topic_id}/export.csv")
        self.assertEqual(status, 200)
        self.assertIn("fixture", csv.decode("utf-8-sig"))
        self.assertEqual(self.request("DELETE", f"/api/topics/{topic_id}")[0], 409)
        self.assertEqual(self.request("DELETE", f"/api/topics/{topic_id}/posts/fixture")[0], 200)
        # A manually removed post must not be resurrected by collection.
        with patch.object(app, "require_token", return_value="test"), patch.object(
            app, "api_request", return_value={"data": {
                "id": "actor", "defaultDatasetId": "dataset", "status": "SUCCEEDED",
            }}
        ), patch.object(app, "get_all_dataset_items", return_value=items):
            started = self.request("POST", f"/api/topics/{topic_id}/collect", {"confirmed": True})[1]
            self.assertEqual(self.request("GET", f"/api/runs/{started['run_id']}")[1]["items_new"], 0)
        self.assertEqual(app.dashboard_data(topic_id)["summary"]["mentions"], 0)
        self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/archive")[0], 200)
        self.assertTrue(any(row["id"] == topic_id for row in app.topic_list(archived=True)))
        self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/restore")[0], 200)
        self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/archive")[0], 200)
        self.assertEqual(self.request("DELETE", f"/api/topics/{topic_id}")[0], 200)
        with connect_db() as db:
            for table in ("posts", "runs", "ai_analyses", "deleted_posts"):
                self.assertIsNone(db.execute(f"SELECT 1 FROM {table} WHERE topic_id = ?", (topic_id,)).fetchone())

    def test_serverless_failures_and_interrupted_request_recovery(self):
        topic_id = self.request("POST", "/api/topics", {"name": "Recovery", "query": "transit"})[1]["id"]
        try:
            with patch.object(app, "require_token", return_value="test"), patch.object(
                app, "api_request", side_effect=RuntimeError("Apify unavailable")
            ):
                self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/collect", {"confirmed": True})[0], 502)
            self.assertEqual(app.dashboard_data(topic_id)["last_run"]["status"], "failed")
            run_id = str(uuid.uuid4())
            with connect_db() as db:
                db.execute("INSERT INTO runs(id, topic_id, status, requested_at, apify_run_id) "
                           "VALUES (?, ?, 'running', ?, 'upstream')", (run_id, topic_id, app.utc_now()))
            with patch.object(app, "require_token", return_value="test"), patch.object(app, "api_request") as remote:
                remote.side_effect = RuntimeError("Temporary outage")
                self.assertEqual(self.request("GET", f"/api/runs/{run_id}")[0], 503)
                with connect_db() as db:
                    self.assertEqual(db.execute("SELECT status FROM runs WHERE id = ?", (run_id,)).fetchone()["status"],
                                     "running")
                remote.side_effect = None
                remote.return_value = {"data": {"status": "RUNNING"}}
                self.assertEqual(self.request("GET", f"/api/runs/{run_id}")[1]["status"], "running")
                remote.return_value = {"data": {"status": "FAILED"}}
                self.assertEqual(self.request("GET", f"/api/runs/{run_id}")[1]["status"], "failed")
            with connect_db() as db:
                interrupted_id = str(uuid.uuid4())
                db.execute("INSERT INTO runs(id, topic_id, status, requested_at) "
                           "VALUES (?, ?, 'queued', '2020-01-01T00:00:00+00:00')", (interrupted_id, topic_id))
                db.execute("INSERT INTO posts(topic_id, tweet_id, text, sentiment, raw_json, collected_at) "
                           "VALUES (?, 'recovery-post', 'Test post', 'neutral', '{}', ?)", (topic_id, app.utc_now()))
                db.execute("INSERT INTO ai_analyses(topic_id, status, model, analyzed_at) "
                           "VALUES (?, 'running', 'test', '2020-01-01T00:00:00+00:00')", (topic_id,))
            self.assertEqual(self.request("GET", f"/api/runs/{interrupted_id}")[1]["status"], "failed")
            self.assertEqual(app.dashboard_data(topic_id)["ai_analysis"]["status"], "failed")
            with patch.object(app, "require_gemini_token", return_value=("test", "test")), patch.object(
                app, "gemini_json", side_effect=RuntimeError("Gemini unavailable")
            ):
                self.assertEqual(self.request("POST", f"/api/topics/{topic_id}/analyze")[0], 502)
            self.assertEqual(app.dashboard_data(topic_id)["ai_analysis"]["status"], "failed")
        finally:
            with connect_db() as db:
                db.execute("DELETE FROM topics WHERE id = ?", (topic_id,))

    def test_wsgi_routes_and_safe_errors(self):
        def request(method, path, body=None):
            raw = json.dumps(body).encode() if body is not None else b""
            result = {}
            def start_response(status, headers):
                result["status"] = int(status.split()[0])
                result["headers"] = dict(headers)
            content = b"".join(vercel_api.app({
                "REQUEST_METHOD": method, "PATH_INFO": path, "wsgi.input": io.BytesIO(raw),
                "CONTENT_LENGTH": str(len(raw)), "CONTENT_TYPE": "application/json",
            }, start_response))
            return result["status"], json.loads(content)
        with patch.object(vercel_api, "_initialized", True):
            status, data = request("POST", "/api/topics", {"name": "WSGI test", "query": "transport"})
            self.assertEqual(status, 201)
            topic_id = data["id"]
            try:
                self.assertEqual(request("GET", f"/api/topics/{topic_id}/dashboard")[0], 200)
                self.assertEqual(request("PUT", "/api/topics")[0], 405)
                self.assertEqual(request("POST", "/api/topics", ["invalid"])[0], 400)
                with patch("app.connect_db", side_effect=RuntimeError("secret connection data")):
                    status, data = request("GET", "/api/topics")
                    self.assertEqual(status, 503)
                    self.assertNotIn("secret", data["error"])
            finally:
                request("POST", f"/api/topics/{topic_id}/archive")
                self.assertEqual(request("DELETE", f"/api/topics/{topic_id}")[0], 200)
        with patch.object(vercel_api, "_initialized", False), patch.object(
            vercel_api, "init_db", side_effect=RuntimeError("secret database data")
        ):
            self.assertEqual(request("GET", "/api/topics")[0], 503)
            self.assertFalse(vercel_api._initialized)
        with patch.dict(os.environ, {"VERCEL": "1", "DATABASE_URL": ""}), patch.object(vercel_api, "init_db") as init:
            self.assertEqual(request("GET", "/api/topics")[0], 503)
            init.assert_not_called()

    def test_rollback_and_invalid_topic(self):
        with self.assertRaisesRegex(RuntimeError, "rollback"):
            with connect_db() as db:
                db.execute("INSERT INTO app_meta(key, value) VALUES ('rollback-test', 'x')")
                raise RuntimeError("rollback")
        with connect_db() as db:
            self.assertIsNone(db.execute("SELECT 1 FROM app_meta WHERE key = 'rollback-test'").fetchone())
        self.assertEqual(self.request("POST", "/api/topics", {"name": "x"})[0], 400)

    @unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "PostgreSQL import verification")
    def test_import_refuses_different_target_without_overwrite(self):
        with connect_db() as db:
            db.execute("INSERT INTO app_meta(key, value) VALUES ('different-target', 'preserve')")
        with self.assertRaisesRegex(RuntimeError, "different data"):
            import_sqlite(self.source, self.url)
        with connect_db() as db:
            self.assertEqual(db.execute("SELECT value FROM app_meta WHERE key = 'different-target'").fetchone()["value"],
                             "preserve")


class HelperTests(unittest.TestCase):
    def test_legacy_sqlite_columns_preserve_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            connection = sqlite3.connect(path)
            try:
                connection.executescript("""
                    CREATE TABLE topics(id INTEGER PRIMARY KEY, name TEXT, query TEXT);
                    INSERT INTO topics VALUES (7, 'Existing topic', 'KRL');
                    CREATE TABLE posts(id INTEGER PRIMARY KEY, topic_id INTEGER, created_at TEXT);
                    INSERT INTO posts VALUES (11, 7, '2026-01-01');
                """)
            finally:
                connection.close()
            with patch.dict(os.environ, {"DATABASE_URL": "", "SINYALX_DB_PATH": str(path)}):
                app.init_db()
                with connect_db() as db:
                    topic = db.execute("SELECT * FROM topics WHERE id = 7").fetchone()
                    post = db.execute("SELECT * FROM posts WHERE id = 11").fetchone()
                    self.assertEqual(topic["name"], "Existing topic")
                    self.assertEqual(topic["is_demo"], 0)
                    self.assertIsNone(topic["archived_at"])
                    self.assertEqual(post["sentiment_source"], "lexicon")

    def test_env_preserves_existing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text('DATABASE_URL=ignored\nTEST_VALUE="value"\n', encoding="utf-8")
            with patch.dict(os.environ, {"DATABASE_URL": "existing"}):
                load_env_file(path)
                self.assertEqual(os.getenv("DATABASE_URL"), "existing")
                self.assertEqual(os.getenv("TEST_VALUE"), "value")

    def test_dataset_pagination(self):
        with patch("apify_api.api_request", side_effect=[[{"id": str(i)} for i in range(1000)], [{"id": "last"}]]) as call:
            self.assertEqual(len(get_all_dataset_items("test", "dataset")), 1001)
            self.assertEqual(call.call_args.kwargs["query"]["offset"], 1000)


if __name__ == "__main__":
    unittest.main()
