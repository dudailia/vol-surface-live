"""Quote filters. Every dropped row keeps a reason code so the drop log can be published."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .config import CleanConfig

# Order matters: a row gets the first reason that applies. Selection rules run first, so
# the quality counts describe only the quotes the fit would otherwise use.
SELECTION_REASONS = ("short_expiry", "itm")
QUALITY_REASONS = (
    "no_bid",
    "no_ask",
    "crossed",
    "below_intrinsic",
    "iv_fail",
    "wide_spread",
)

REASON_TEXT = {
    "short_expiry": "expiry less than {min_days:g} days away",
    "no_bid": "no bid",
    "no_ask": "no ask",
    "crossed": "bid at or above ask",
    "below_intrinsic": "bid at or below intrinsic value",
    "iv_fail": "implied vol could not be solved",
    "wide_spread": "bid/ask spread above {max_iv_spread_pts:g} vol points or "
                   "{max_rel_spread_pct:g}% of mid",
    "itm": "in the money (the fit uses out-of-the-money options only)",
}


def reason_text(cfg: CleanConfig) -> dict[str, str]:
    fmt = {
        "min_days": cfg.min_days,
        "max_iv_spread_pts": cfg.max_iv_spread * 100,
        "max_rel_spread_pct": cfg.max_rel_spread * 100,
    }
    return {k: v.format(**fmt) for k, v in REASON_TEXT.items()}


def classify(df: pd.DataFrame, cfg: CleanConfig | None = None) -> pd.Series:
    """Return a Series of reason codes (None for rows kept for the fit)."""
    cfg = cfg or CleanConfig()
    bid, ask, F, K = df["bid"], df["ask"], df["F"], df["strike"]
    is_call = df["is_call"].astype(bool)
    mid = 0.5 * (bid + ask)
    intrinsic_coin = np.where(is_call, np.maximum(F - K, 0), np.maximum(K - F, 0)) / F

    rules: list[tuple[str, Any]] = [
        ("short_expiry", df["T"] < cfg.min_days / 365.0),
        ("itm", np.where(is_call, K < F, K > F)),
        ("no_bid", ~(bid > 0)),
        ("no_ask", ~(ask > 0)),
        ("crossed", bid >= ask),
        ("below_intrinsic", bid <= intrinsic_coin),
        ("iv_fail", df["bid_iv"].isna() | df["ask_iv"].isna()),
        ("wide_spread", ((df["ask_iv"] - df["bid_iv"]) > cfg.max_iv_spread)
         | ((ask - bid) / mid > cfg.max_rel_spread)),
    ]
    reason = pd.Series([None] * len(df), index=df.index, dtype=object)
    for code, mask in rules:
        m = pd.Series(np.asarray(mask, dtype=bool), index=df.index) & reason.isna()
        reason[m] = code
    return reason


def clean(df: pd.DataFrame, cfg: CleanConfig | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split a snapshot into rows kept for the fit and a drop log."""
    reason = classify(df, cfg)
    kept = df[reason.isna()].copy()
    dropped = df[reason.notna()][["instrument", "expiry_code", "strike", "is_call"]].copy()
    dropped["reason"] = reason[reason.notna()]
    dropped["kind"] = np.where(dropped["reason"].isin(SELECTION_REASONS), "selection", "quality")
    return kept, dropped


def drop_counts(dropped: pd.DataFrame) -> dict[str, int]:
    counts = dropped["reason"].value_counts().to_dict()
    return {r: int(counts.get(r, 0)) for r in (*SELECTION_REASONS, *QUALITY_REASONS)}
