"""One snapshot run: fetch, build, clean, fit, check, bundle, store."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from .arbitrage import check_quotes
from .bundle import Bundle, make_bundle
from .clean import classify, drop_counts
from .config import Settings
from .deribit import DeribitClient
from .model import build_slices
from .snapshot import build_snapshot
from .ssvi import SSVIFit, SSVIParams, fit_ssvi
from .store import Store
from .validate import compare_ticker, pick_sample

log = logging.getLogger(__name__)

# Previous fit per currency, by expiry code, for warm starts.
_last_fit: dict[str, tuple[dict[str, float], SSVIParams]] = {}


def _warm_start(currency: str, codes: list[str], T: np.ndarray,
                ) -> tuple[np.ndarray, SSVIParams] | None:
    prev = _last_fit.get(currency)
    if prev is None:
        return None
    by_code, params = prev
    known = [(t, by_code[c]) for c, t in zip(codes, T, strict=True) if c in by_code]
    if len(known) < 2:
        return None
    kt, kth = zip(*known, strict=True)
    # New expiries take θ by linear interpolation in T from the known ones.
    return np.interp(T, kt, kth), params


def process(
    currency: str,
    df: pd.DataFrame,
    settings: Settings,
    iv_gaps: list[float] | None = None,
) -> tuple[Bundle, pd.Series, SSVIFit]:
    """Pure part of a run: everything after the HTTP calls. Used by tests on fixtures."""
    reasons = classify(df, settings.clean)
    kept = df[reasons.isna()].copy()
    dropped = drop_counts(df[reasons.notna()].assign(reason=reasons[reasons.notna()]))
    slices, codes, skipped = build_slices(kept)
    start = _warm_start(currency, codes, np.array([s.T for s in slices]))
    fit = fit_ssvi(slices, start=start)
    _last_fit[currency] = (dict(zip(codes, map(float, fit.theta), strict=True)), fit.params)
    violations, flags = check_quotes(kept)
    ts: datetime = df["ts"].iloc[0].to_pydatetime()
    bundle = make_bundle(
        currency=currency, ts=ts, df=df, kept=kept, flags=flags, fit=fit, codes=codes,
        skipped=skipped, violations=violations, dropped=dropped, iv_gaps=iv_gaps or [],
        clean_cfg=settings.clean)
    return bundle, reasons, fit


async def snapshot_currency(dc: DeribitClient, settings: Settings, store: Store,
                            currency: str) -> dict[str, Any]:
    instruments = await dc.instruments(currency)
    summaries, server_us = await dc.book_summary(currency)
    df = build_snapshot(currency, instruments, summaries, server_us)
    reasons = classify(df, settings.clean)
    ts = df["ts"].iloc[0].to_pydatetime()

    # Cross-check our IV inversion against Deribit's own on a small sample.
    meta = {i["instrument_name"]: i for i in instruments}
    gaps: list[float] = []
    for name in pick_sample(df, reasons, settings.fetch.ticker_sample):
        m = meta[name]
        t = await dc.ticker(name)
        g = compare_ticker(t, float(m["strike"]), m["expiration_timestamp"],
                           m["option_type"] == "call")
        gaps.extend(g.values())

    store.write_raw(currency, ts, df, reasons)
    bundle, _, fit = process(currency, df, settings, gaps)
    store.write_bundle(currency, ts, bundle.model_dump(mode="json"))

    summary = {
        "currency": currency,
        "ts": ts.isoformat(),
        "n_raw": bundle.cleaning.n_raw,
        "n_kept": bundle.cleaning.n_kept,
        "expiries": len(bundle.expiries),
        "rho": round(fit.params.rho, 4),
        "rmse_max": round(float(fit.rmse_vol_pts.max()), 3),
        "arb": bundle.arbitrage.counts,
        "iv_check_max_gap_pts": bundle.iv_check.max_gap_pts,
    }
    log.info("%s %s: %d quotes, %d kept, %d expiries, max RMSE %.2f pts, IV gap %s pts",
             currency, ts, summary["n_raw"], summary["n_kept"], summary["expiries"],
             summary["rmse_max"], summary["iv_check_max_gap_pts"])
    return summary


async def run_once(settings: Settings, currencies: tuple[str, ...]) -> list[dict[str, Any]]:
    store = Store(settings.data_dir)
    out = []
    async with DeribitClient(settings.fetch) as dc:
        for c in currencies:
            try:
                out.append(await snapshot_currency(dc, settings, store, c))
            except Exception:
                # One currency failing must not stop the other.
                log.exception("snapshot failed for %s", c)
                out.append({"currency": c, "error": True})
    return out
