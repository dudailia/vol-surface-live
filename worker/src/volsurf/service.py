"""Long-running worker: snapshots every 5 minutes, a daily report at 00:00 UTC, and a
small HTTP server that hands the latest bundles to the web app."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import shutil
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pandas as pd
import uvicorn
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .config import CURRENCIES, Settings
from .pipeline import run_once
from .report import build_report, compact_surface, publish
from .store import Store

log = logging.getLogger(__name__)

STALE_AFTER = timedelta(minutes=15)
KEEP_BUNDLE_DAYS = 3
KEEP_RAW_DAYS = 180


class State:
    def __init__(self) -> None:
        self.last_ok: dict[str, datetime] = {}
        self.last_report: str | None = None


def compact_day(store: Store, cur: str, day: str) -> None:
    """Merge a finished day's 5-minute raw files into one Parquet file and delete them."""
    d = store.root / "raw" / cur / day
    if not d.is_dir():
        return
    df = store.read_raw_day(cur, day)
    out = store.root / "raw-daily" / cur / f"{day}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, compression="zstd", index=False)
    shutil.rmtree(d)


def prune(store: Store, today: datetime) -> None:
    for cur in CURRENCIES:
        for d in sorted((store.root / "bundles" / cur).glob("*")):
            if d.name < f"{today - timedelta(days=KEEP_BUNDLE_DAYS):%Y-%m-%d}":
                shutil.rmtree(d)
        for f in sorted((store.root / "raw-daily" / cur).glob("*.parquet")):
            if f.stem < f"{today - timedelta(days=KEEP_RAW_DAYS):%Y-%m-%d}":
                f.unlink()


def hourly_history(store: Store, cur: str, hours: int = 48) -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    days = {f"{now - timedelta(days=i):%Y-%m-%d}" for i in range(hours // 24 + 2)}
    out = []
    for day in sorted(days):
        for p in store.bundle_paths(cur, day):
            if p.stem.endswith("00"):  # on the hour
                b = store.read_bundle(p)
                if now - datetime.fromisoformat(b["ts"]) <= timedelta(hours=hours):
                    out.append(compact_surface(b))
    return out


def build_app(settings: Settings, state: State) -> Starlette:
    store = Store(settings.data_dir)
    token = os.environ.get("LATEST_TOKEN")

    def authorised(req: Request) -> bool:
        return not token or req.headers.get("authorization") == f"Bearer {token}"

    async def latest(req: Request) -> Response:
        if not authorised(req):
            return JSONResponse({"error": "unauthorised"}, status_code=401)
        body = {c: store.latest_bundle(c) for c in CURRENCIES}
        return JSONResponse(body, headers={"cache-control": "public, max-age=30"})

    async def history(req: Request) -> Response:
        if not authorised(req):
            return JSONResponse({"error": "unauthorised"}, status_code=401)
        body = {c: hourly_history(store, c) for c in CURRENCIES}
        return JSONResponse(body, headers={"cache-control": "public, max-age=300"})

    async def health(_: Request) -> Response:
        now = datetime.now(UTC)
        ok = all(now - state.last_ok.get(c, datetime.min.replace(tzinfo=UTC)) < STALE_AFTER
                 for c in CURRENCIES)
        body = {"ok": ok, "last_ok": {c: t.isoformat() for c, t in state.last_ok.items()},
                "last_report": state.last_report}
        return Response(json.dumps(body), status_code=200 if ok else 503,
                        media_type="application/json")

    return Starlette(routes=[
        Route("/latest.json", latest),
        Route("/history.json", history),
        Route("/healthz", health),
    ])


def serve(settings: Settings) -> None:
    state = State()
    store = Store(settings.data_dir)
    # Seed health from what is already on disk, so a restart is not reported as stale.
    for c in CURRENCIES:
        b = store.latest_bundle(c)
        if b:
            state.last_ok[c] = datetime.fromisoformat(b["ts"])

    async def snapshot_job() -> None:
        for r in await run_once(settings, CURRENCIES):
            if not r.get("error"):
                state.last_ok[r["currency"]] = datetime.fromisoformat(r["ts"])

    async def daily_job() -> None:
        now = datetime.now(UTC)
        day = (now - timedelta(days=1)).date()
        # Give the 00:00 snapshot time to land; it is scheduled 40 s earlier.
        for _ in range(12):
            if all(store.bundle_paths(c, f"{now:%Y-%m-%d}") for c in CURRENCIES):
                break
            await asyncio.sleep(10)
        report = await asyncio.to_thread(build_report, store, day)
        await asyncio.to_thread(publish, settings, report)
        state.last_report = f"{day}"
        for c in CURRENCIES:
            await asyncio.to_thread(compact_day, store, c, f"{day}")
        await asyncio.to_thread(prune, store, now)
        log.info("daily report for %s published", day)

    async def catch_up() -> None:
        """If the worker was down at midnight, write any missing report (marked late)."""
        y = (datetime.now(UTC) - timedelta(days=1)).date()
        if not (settings.data_dir / "reports" / f"{y}.json").exists() and \
                store.bundle_paths(CURRENCIES[0], f"{y}"):
            log.info("writing missed report for %s", y)
            report = await asyncio.to_thread(build_report, store, y)
            if report.currencies:
                await asyncio.to_thread(publish, settings, report)
                state.last_report = f"{y}"

    @contextlib.asynccontextmanager
    async def lifespan(_: Starlette) -> AsyncIterator[None]:
        sched = AsyncIOScheduler(timezone="UTC")
        sched.add_job(snapshot_job, "cron", minute="*/5", second=0, max_instances=1,
                      coalesce=True, misfire_grace_time=120)
        sched.add_job(daily_job, "cron", hour=0, minute=0, second=40, max_instances=1,
                      misfire_grace_time=3600)
        sched.start()
        asyncio.get_running_loop().create_task(catch_up())
        yield
        sched.shutdown(wait=False)

    app = build_app(settings, state)
    app.router.lifespan_context = lifespan
    pd.set_option("future.no_silent_downcasting", True)
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
                log_level="info")
