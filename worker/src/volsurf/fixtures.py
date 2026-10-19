"""Record live Deribit payloads to a gzipped JSON fixture for offline tests."""

from __future__ import annotations

import gzip
import json
import random
from pathlib import Path
from typing import Any

from .deribit import DeribitClient


async def record(path: Path, currencies: tuple[str, ...], n_tickers: int = 30) -> None:
    data: dict[str, Any] = {}
    async with DeribitClient() as dc:
        for cur in currencies:
            instruments = await dc.instruments(cur)
            summaries, us = await dc.book_summary(cur)
            quoted = [s["instrument_name"] for s in summaries
                      if s.get("bid_price") and s.get("ask_price")]
            sample = random.Random(0).sample(quoted, min(n_tickers, len(quoted)))
            tickers = [await dc.ticker(n) for n in sample]
            data[cur] = {"instruments": instruments, "summaries": summaries,
                         "server_us": us, "tickers": tickers}
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt") as f:
        json.dump(data, f)


def load(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt") as f:
        out: dict[str, Any] = json.load(f)
    return out
