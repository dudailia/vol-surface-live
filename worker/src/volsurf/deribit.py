"""Minimal client for Deribit's public REST API (no authentication)."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from .config import FetchConfig

log = logging.getLogger(__name__)

# Deribit error code for "too_many_requests".
RATE_LIMIT_CODE = 10028


class DeribitError(RuntimeError):
    pass


class TokenBucket:
    def __init__(self, rate: float, burst: int) -> None:
        self.rate = rate
        self.capacity = float(burst)
        self.tokens = float(burst)
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    return
                await asyncio.sleep((1.0 - self.tokens) / self.rate)


class DeribitClient:
    def __init__(self, cfg: FetchConfig | None = None, client: httpx.AsyncClient | None = None):
        self.cfg = cfg or FetchConfig()
        self._own = client is None
        self._client = client or httpx.AsyncClient(
            base_url=self.cfg.base_url,
            timeout=self.cfg.timeout_s,
            headers={"User-Agent": "vol-surface-live (public data research project)"},
        )
        self._bucket = TokenBucket(self.cfg.rate_per_s, self.cfg.burst)

    async def __aenter__(self) -> DeribitClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._own:
            await self._client.aclose()

    async def get(self, method: str, **params: Any) -> tuple[Any, int]:
        """Call a public method. Returns (result, server time in microseconds)."""
        delay = 0.5
        for attempt in range(self.cfg.max_retries + 1):
            await self._bucket.acquire()
            try:
                r = await self._client.get(method, params=params)
            except httpx.TransportError as e:
                if attempt == self.cfg.max_retries:
                    raise DeribitError(f"{method}: {e}") from e
                log.warning("transport error on %s (%s), retrying", method, e)
            else:
                body = r.json() if r.content else {}
                err = body.get("error") if isinstance(body, dict) else None
                limited = r.status_code == 429 or (err and err.get("code") == RATE_LIMIT_CODE)
                if r.status_code == 200 and not err:
                    return body["result"], int(body.get("usOut", time.time() * 1e6))
                if not (limited or r.status_code >= 500) or attempt == self.cfg.max_retries:
                    raise DeribitError(f"{method}: HTTP {r.status_code} {err}")
                log.warning("%s on %s, backing off %.1fs", "rate limit" if limited else
                            f"HTTP {r.status_code}", method, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)
        raise DeribitError(f"{method}: retries exhausted")  # pragma: no cover

    async def instruments(self, currency: str) -> list[dict[str, Any]]:
        res, _ = await self.get("get_instruments", currency=currency, kind="option",
                                expired="false")
        return list(res)

    async def book_summary(self, currency: str) -> tuple[list[dict[str, Any]], int]:
        res, us = await self.get("get_book_summary_by_currency", currency=currency,
                                 kind="option")
        return list(res), us

    async def ticker(self, instrument: str) -> dict[str, Any]:
        res, _ = await self.get("ticker", instrument_name=instrument)
        return dict(res)
