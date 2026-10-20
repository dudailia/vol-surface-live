"""Long-running worker: snapshots every 5 minutes, a daily report at 00:00 UTC, and a
small HTTP server that hands the latest bundles to the web app."""

from __future__ import annotations

import asyncio
import contextlib
import ctypes
import json
import logging
import os
import shutil
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pandas as pd
import pyarrow.parquet as pq
import uvicorn
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .blob import Publisher
from .config import CURRENCIES, Settings
from .deribit import DeribitClient
from .pipeline import run_once, seed_holdout
from .report import build_report, compact_surface, publish
from .store import Store, unified_schema, write_tables
from .vrp import compute as compute_vrp
from .vrp import ours_series

log = logging.getLogger(__name__)

STALE_AFTER = timedelta(minutes=15)
KEEP_BUNDLE_DAYS = 3
# Compacted raw quotes stay 14 days on the 1 GB volume; daily summaries live in the archive.
KEEP_RAW_DAYS = 14
# Safety net: above this share of the volume, the oldest compacted days go first.
MAX_DISK_USED = 0.8


class State:
    def __init__(self) -> None:
        self.last_ok: dict[str, datetime] = {}
        self.last_report: str | None = None


def compact_day(store: Store, cur: str, day: str) -> None:
    """Merge a finished day's 5-minute raw files into one Parquet file and delete them.

    Streams one snapshot at a time, one row group each, so it fits a 256 MB machine.
    """
    d = store.root / "raw" / cur / day
    if not d.is_dir():
        return
    files = store.raw_day_files(cur, day)
    if files:
        out = store.root / "raw-daily" / cur / f"{day}.parquet"
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp")
        write_tables((pq.read_table(f) for f in files), unified_schema(files), tmp)
        tmp.replace(out)
    shutil.rmtree(d)


def prune(store: Store, today: datetime, disk_usage: Any = None) -> None:
    for cur in CURRENCIES:
        for d in sorted((store.root / "bundles" / cur).glob("*")):
            if d.name < f"{today - timedelta(days=KEEP_BUNDLE_DAYS):%Y-%m-%d}":
                shutil.rmtree(d)
        for f in sorted((store.root / "raw-daily" / cur).glob("*.parquet")):
            if f.stem < f"{today - timedelta(days=KEEP_RAW_DAYS):%Y-%m-%d}":
                f.unlink()
    # The volume is 1 GB: if it is still over MAX_DISK_USED, drop the oldest compacted days.
    # Only where the data directory is its own volume, never on a shared laptop disk.
    if disk_usage is None:
        if not os.path.ismount(store.root):
            return
        disk_usage = shutil.disk_usage
    oldest = sorted((f for cur in CURRENCIES
                     for f in (store.root / "raw-daily" / cur).glob("*.parquet")),
                    key=lambda f: f.stem)
    while oldest:
        u = disk_usage(store.root)
        if u.used / u.total <= MAX_DISK_USED:
            break
        f = oldest.pop(0)
        log.warning("volume %.0f%% full: deleting %s", 100 * u.used / u.total, f)
        f.unlink()


_libc: Any = None


def trim_memory() -> None:
    """Hand memory freed by a job back to the OS (glibc only), so a 256 MB machine has room."""
    global _libc
    try:
        _libc = _libc or ctypes.CDLL("libc.so.6")
        _libc.malloc_trim(0)
    except (OSError, AttributeError):
        pass


def hourly_history(store: Store, cur: str, hours: int = 48,
                   now: datetime | None = None) -> list[dict[str, Any]]:
    """One snapshot per hour for the last ``hours``: the one nearest the top of the hour.

    Snapshot files are named by Deribit's server time, which can read a second before the
    scheduled minute (01:19:59 for the 01:20 run), so names are matched by distance to the
    hour, not by a suffix. Only the chosen files are read.
    """
    now = now or datetime.now(UTC)
    best: dict[datetime, tuple[float, Any]] = {}
    for i in range(hours // 24 + 2):
        day = now - timedelta(days=i)
        for p in store.bundle_paths(cur, f"{day:%Y-%m-%d}"):
            try:
                t = datetime.strptime(f"{day:%Y-%m-%d}{p.stem}", "%Y-%m-%d%H%M").replace(
                    tzinfo=UTC)
            except ValueError:
                continue
            hour = (t + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)
            dist = abs((t - hour).total_seconds())
            if dist > 300 or now - hour > timedelta(hours=hours) or hour > now:
                continue
            if hour not in best or dist < best[hour][0]:
                best[hour] = (dist, p)
    return [compact_surface(store.read_bundle(best[h][1])) for h in sorted(best)]


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

    async def vrp(req: Request) -> Response:
        if not authorised(req):
            return JSONResponse({"error": "unauthorised"}, status_code=401)
        p = settings.data_dir / "vrp.json"
        if not p.exists():
            return JSONResponse({"error": "not computed yet"}, status_code=404)
        return Response(p.read_text(), media_type="application/json",
                        headers={"cache-control": "public, max-age=600"})

    async def health(_: Request) -> Response:
        now = datetime.now(UTC)
        ok = all(now - state.last_ok.get(c, datetime.min.replace(tzinfo=UTC)) < STALE_AFTER
                 for c in CURRENCIES)
        # After a restart the newest report on the volume stands in until tonight's is written.
        saved = sorted(p.stem for p in (settings.data_dir / "reports").glob("????-??-??.json"))
        body = {"ok": ok, "last_ok": {c: t.isoformat() for c, t in state.last_ok.items()},
                "last_report": state.last_report or (saved[-1] if saved else None)}
        return Response(json.dumps(body), status_code=200 if ok else 503,
                        media_type="application/json")

    # Gzip: the bundles are JSON, and outbound data from Fly is billed per GB.
    return Starlette(routes=[
        Route("/latest.json", latest),
        Route("/history.json", history),
        Route("/vrp.json", vrp),
        Route("/healthz", health),
    ], middleware=[Middleware(GZipMiddleware, minimum_size=1024)])


def serve(settings: Settings) -> None:
    state = State()
    store = Store(settings.data_dir)
    # Keep the model-selection window across restarts.
    seed_holdout(store, CURRENCIES)
    # Seed health from what is already on disk, so a restart is not reported as stale.
    for c in CURRENCIES:
        b = store.latest_bundle(c)
        if b:
            state.last_ok[c] = datetime.fromisoformat(b["ts"])

    async def snapshot_job() -> None:
        for r in await run_once(settings, CURRENCIES):
            if not r.get("error"):
                state.last_ok[r["currency"]] = datetime.fromisoformat(r["ts"])
        trim_memory()

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
        vrp_path = settings.data_dir / "vrp.json"
        if vrp_path.exists():
            # One upload a day keeps a copy in the archive for when the worker is down.
            await asyncio.to_thread(
                Publisher(settings.data_dir).put, "vrp.json", vrp_path.read_bytes(),
                "application/json", 3600)
        for c in CURRENCIES:
            await asyncio.to_thread(compact_day, store, c, f"{day}")
        await asyncio.to_thread(prune, store, now)
        trim_memory()
        log.info("daily report for %s published", day)

    async def vrp_job() -> None:
        """Implied against realized vol, hourly (about six Deribit requests)."""
        now = datetime.now(UTC)
        ours = {}
        for c in CURRENCIES:
            compact = hourly_history(store, c, hours=72)
            latest = store.latest_bundle(c)
            if latest:
                compact.append(compact_surface(latest))
            ours[c] = ours_series(compact)
        try:
            async with DeribitClient(settings.fetch) as dc:
                report = await compute_vrp(dc, CURRENCIES, ours, now)
        except Exception:
            log.exception("vrp job failed")
            return
        path = settings.data_dir / "vrp.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(report.model_dump_json())
        tmp.replace(path)
        trim_memory()
        log.info("vrp written")

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
        sched.add_job(vrp_job, "cron", minute=7, second=0, max_instances=1, coalesce=True,
                      misfire_grace_time=600)
        sched.start()
        asyncio.get_running_loop().create_task(catch_up())
        asyncio.get_running_loop().create_task(vrp_job())
        yield
        sched.shutdown(wait=False)

    app = build_app(settings, state)
    app.router.lifespan_context = lifespan
    pd.set_option("future.no_silent_downcasting", True)
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
                log_level="info")
