"""Command line entry point: ``volsurf <command>``."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path

from .config import CURRENCIES, Settings


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="volsurf")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot", help="take one snapshot of every currency and exit")
    s.add_argument("--currency", choices=CURRENCIES, action="append")
    f = sub.add_parser("record-fixture", help="save live payloads for offline tests")
    f.add_argument("path", type=Path)
    sub.add_parser("serve", help="run the scheduler and HTTP server")
    v = sub.add_parser("vrp", help="compute implied against realized vol and print it")
    v.add_argument("--out", type=Path)
    sub.add_parser("publish-latest",
                   help="upload the latest bundles to Blob as latest.json (one upload; the "
                        "page falls back to it when the worker is unreachable)")
    r = sub.add_parser("report", help="write the daily report for a UTC date")
    r.add_argument("--date", required=True)
    r.add_argument("--publish", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = Settings()

    if args.cmd == "snapshot":
        from .pipeline import run_once
        results = asyncio.run(run_once(settings, tuple(args.currency or CURRENCIES)))
        print(json.dumps(results, indent=1, default=str))
    elif args.cmd == "record-fixture":
        from .fixtures import record
        asyncio.run(record(args.path, CURRENCIES))
    elif args.cmd == "serve":
        from .service import serve
        serve(settings)
    elif args.cmd == "vrp":
        from datetime import UTC, datetime

        from .deribit import DeribitClient
        from .store import Store
        from .vrp import compute, ours_series

        async def go() -> str:
            store = Store(settings.data_dir)
            ours = {}
            for c in CURRENCIES:
                b = store.latest_bundle(c)
                from .report import compact_surface
                ours[c] = ours_series([compact_surface(b)] if b else [])
            async with DeribitClient(settings.fetch) as dc:
                rep = await compute(dc, CURRENCIES, ours, datetime.now(UTC))
            return rep.model_dump_json()

        body = asyncio.run(go())
        if args.out:
            args.out.write_text(body)
        print(body[:400])
    elif args.cmd == "publish-latest":
        from .blob import Publisher
        from .store import Store
        store = Store(settings.data_dir)
        latest = {c: store.latest_bundle(c) for c in CURRENCIES}
        print(Publisher(settings.data_dir).put_json("latest.json", latest, max_age=300))
    elif args.cmd == "report":
        from .report import run_report
        rep = run_report(settings, args.date, publish_it=args.publish)
        print(rep.model_dump_json(indent=1))
