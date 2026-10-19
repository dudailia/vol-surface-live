"""Publish files to a public Vercel Blob store over its HTTP API.

The Hobby plan includes 2,000 uploads a month and locks the store for 30 days past that,
so this module counts uploads and refuses to go above a monthly budget well under it.
Without a token (local development) files are mirrored to ``<data>/publish`` instead.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

API_URL = "https://vercel.com/api/blob/"
API_VERSION = "13"
MONTHLY_BUDGET = 600


class BudgetExceededError(RuntimeError):
    pass


class Publisher:
    def __init__(self, data_dir: Path, token: str | None = None,
                 client: httpx.Client | None = None) -> None:
        self.token = token if token is not None else os.environ.get("BLOB_READ_WRITE_TOKEN")
        self.mirror = Path(data_dir) / "publish"
        self.ledger = Path(data_dir) / "blob-uploads.json"
        self._client = client

    def _count(self, month: str) -> int:
        if not self.ledger.exists():
            return 0
        return int(json.loads(self.ledger.read_text()).get(month, 0))

    def _bump(self, month: str) -> None:
        data = json.loads(self.ledger.read_text()) if self.ledger.exists() else {}
        data[month] = int(data.get(month, 0)) + 1
        self.ledger.parent.mkdir(parents=True, exist_ok=True)
        self.ledger.write_text(json.dumps(data))

    def put(self, pathname: str, body: bytes, content_type: str,
            max_age: int = 3600) -> str:
        """Upload (overwriting) and return the public URL, or the local mirror path."""
        local = self.mirror / pathname
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(body)
        if not self.token:
            return str(local)
        month = datetime.now(UTC).strftime("%Y-%m")
        if self._count(month) >= MONTHLY_BUDGET:
            raise BudgetExceededError(f"Blob upload budget of {MONTHLY_BUDGET} for {month} used")
        headers = {
            "authorization": f"Bearer {self.token}",
            "x-api-version": API_VERSION,
            "x-vercel-blob-access": "public",
            "x-add-random-suffix": "0",
            "x-allow-overwrite": "1",
            "x-content-type": content_type,
            "x-cache-control-max-age": str(max_age),
        }
        client = self._client or httpx.Client(timeout=60)
        try:
            r = client.put(API_URL, params={"pathname": pathname}, content=body,
                           headers=headers)
        finally:
            if self._client is None:
                client.close()
        self._bump(month)
        if r.status_code != 200:
            raise RuntimeError(f"Blob upload of {pathname} failed: {r.status_code} {r.text}")
        url = str(r.json()["url"])
        log.info("published %s (%d bytes)", url, len(body))
        return url

    def put_json(self, pathname: str, obj: object, max_age: int = 3600) -> str:
        body = json.dumps(obj, separators=(",", ":")).encode()
        return self.put(pathname, body, "application/json", max_age)
