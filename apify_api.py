"""Import-safe Apify helpers for the dashboard, using the Python standard library."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlencode


TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}
BASE_URL = "https://api.apify.com/v2"


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:]
        key, separator, value = line.partition("=")
        if separator:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ.setdefault(key.strip(), value)


def require_token() -> str:
    load_env_file(Path(__file__).resolve().parent / ".env")
    token = os.getenv("APIFY_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Post collection is not configured. Contact your administrator.")
    return token


def api_request(
    token: str, method: str, path: str, *, query: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None, timeout: int = 90,
) -> Any:
    url = BASE_URL + path
    if query:
        url += "?" + urlencode(query)
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never include request URLs or provider bodies that could contain credentials.
        raise RuntimeError(f"Apify returned HTTP {error.code}. Try the collection again later.") from None
    except urllib.error.URLError:
        raise RuntimeError("Unable to connect to Apify. Try again later.") from None


def get_all_dataset_items(token: str, dataset_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    limit = 1_000
    while True:
        page = api_request(token, "GET", f"/datasets/{dataset_id}/items", query={
            "format": "json", "clean": "true", "offset": len(items), "limit": limit,
        })
        if not isinstance(page, list):
            raise RuntimeError("Apify returned an unexpected dataset format.")
        items.extend(page)
        if len(page) < limit:
            return items
