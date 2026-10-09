"""Copy a SQLite snapshot into an empty PostgreSQL database without deleting data."""

from __future__ import annotations

import argparse
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import app
from apify_api import load_env_file
from database import connect_db


TABLES = {
    "topics": "id",
    "app_meta": "key",
    "runs": "id",
    "posts": "id",
    "deleted_posts": "topic_id, tweet_id",
    "ai_analyses": "topic_id",
}


def import_sqlite(source: Path, database_url: str) -> dict[str, int]:
    """Import atomically; retries accept identical data and reject conflicting data."""
    if not source.is_file():
        raise RuntimeError("SQLite source file does not exist")
    if not database_url or not database_url.startswith(("postgres://", "postgresql://")):
        raise RuntimeError("Set DATABASE_URL_UNPOOLED to a direct PostgreSQL connection")
    if "-pooler" in (urlparse(database_url).hostname or ""):
        raise RuntimeError("Use DATABASE_URL_UNPOOLED for the migration, not the pooler URL")

    # A read transaction keeps all source tables in the same SQLite snapshot.
    source_db = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        source_db.execute("BEGIN")
        present = {row[0] for row in source_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )}
        if not {"topics", "posts"}.issubset(present):
            raise RuntimeError("Source is not a dashboard SQLite database")
        records = {}
        for table, order in TABLES.items():
            if table in present:
                cursor = source_db.execute(f'SELECT * FROM "{table}" ORDER BY {order}')
                records[table] = ([column[0] for column in cursor.description], cursor.fetchall())
    finally:
        source_db.close()

    with connect_db(database_url=database_url) as db:
        # Serialize imports and block writes for the duration of the copy.
        db.execute("LOCK TABLE " + ", ".join(TABLES) + " IN ACCESS EXCLUSIVE MODE")
        has_data = any(db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() for table in TABLES)
        if has_data:
            for table in TABLES:
                if table not in records:
                    if db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                        raise RuntimeError("Target already contains different data; nothing was overwritten")
                    continue
                columns, rows = records[table]
                names = ", ".join('"' + column.replace('"', '""') + '"' for column in columns)
                existing = db.execute(f'SELECT {names} FROM "{table}" ORDER BY {TABLES[table]}').fetchall()
                if [tuple(row[column] for column in columns) for row in existing] != rows:
                    raise RuntimeError("Target already contains different data; nothing was overwritten")
            return {table: len(rows) for table, (_, rows) in records.items()}

        for table, (columns, rows) in records.items():
            names = ", ".join('"' + column.replace('"', '""') + '"' for column in columns)
            placeholders = ", ".join("?" for _ in columns)
            for row in rows:
                db.execute(f'INSERT INTO "{table}" ({names}) VALUES ({placeholders})', row)
            copied = db.execute(f'SELECT {names} FROM "{table}" ORDER BY {TABLES[table]}').fetchall()
            if [tuple(row[column] for column in columns) for row in copied] != rows:
                raise RuntimeError(f"Verification failed for {table}; import rolled back")

        for table in ("topics", "posts"):
            db.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 1), EXISTS(SELECT 1 FROM {table}))"
            )
    return {table: len(rows) for table, (_, rows) in records.items()}


def main() -> int:
    load_env_file(app.ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=app.ROOT / "social_listening.db")
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error("SQLite source file does not exist")
    url = os.getenv("DATABASE_URL_UNPOOLED", "").strip()
    if not url:
        parser.error("Set DATABASE_URL_UNPOOLED in the environment or .env")

    backup_dir = app.ROOT / "output" / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = backup_dir / f"social-listening-{stamp}.db"
    source_db = sqlite3.connect(args.source.resolve().as_uri() + "?mode=ro", uri=True)
    target_db = sqlite3.connect(backup)
    try:
        source_db.backup(target_db)
    finally:
        target_db.close()
        source_db.close()
    print(f"SQLite backup: {backup}")

    os.environ["DATABASE_URL"] = url
    app.init_db()
    counts = import_sqlite(backup, url)
    for table, count in counts.items():
        print(f"Verified {table}: {count} rows")
    print("Import complete. Original SQLite file is unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
