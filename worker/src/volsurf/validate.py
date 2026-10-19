"""Cross-check our bid/ask IVs against Deribit's own, on a small random ticker sample."""

from __future__ import annotations

import random
from typing import Any

import numpy as np
import pandas as pd

from .black import implied_vol
from .config import YEAR_SECONDS


def compare_ticker(ticker: dict[str, Any], strike: float, expiry_ms: int,
                   is_call: bool) -> dict[str, float]:
    """Solve IV from a ticker's own prices and forward; return the gaps in vol points."""
    F = float(ticker["underlying_price"])
    T = (expiry_ms - ticker["timestamp"]) / 1e3 / YEAR_SECONDS
    out: dict[str, float] = {}
    for side in ("bid", "ask"):
        px = ticker.get(f"best_{side}_price") or 0.0
        theirs = ticker.get(f"{side}_iv") or 0.0
        if px <= 0 or theirs <= 0:
            continue
        ours = float(implied_vol(px * F, F, strike, T, is_call))
        if np.isfinite(ours):
            out[side] = (ours - theirs / 100.0) * 100.0
    return out


def pick_sample(df: pd.DataFrame, reasons: pd.Series, n: int,
                seed: int | None = None) -> list[str]:
    """Sample from the quotes the fit uses (they passed every cleaning rule)."""
    names = df.loc[reasons.isna(), "instrument"].tolist()
    return random.Random(seed).sample(names, min(n, len(names)))
