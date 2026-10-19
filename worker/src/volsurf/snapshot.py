"""Turn Deribit instrument and book-summary payloads into one tidy table per currency."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd

from .black import implied_vol
from .config import YEAR_SECONDS

COLUMNS = [
    "ts", "currency", "instrument", "expiry", "expiry_code", "T", "strike", "is_call",
    "bid", "ask", "mark", "F", "index", "underlying_index", "oi", "volume",
    "mark_iv", "bid_iv", "ask_iv", "mid_iv", "k",
]


def _num(x: Any) -> float:
    try:
        return float(x) if x is not None else np.nan
    except (TypeError, ValueError):
        return np.nan


def build_snapshot(
    currency: str,
    instruments: list[dict[str, Any]],
    summaries: list[dict[str, Any]],
    server_us: int,
) -> pd.DataFrame:
    """Join book summaries to instrument metadata and compute bid/ask IVs.

    Time to expiry uses each row's own ``creation_timestamp`` when present, so the
    small lag between rows in one response is respected. Prices are converted from
    coin to USD with the expiry's forward (``underlying_price``), matching Deribit.
    """
    meta = {i["instrument_name"]: i for i in instruments}
    ts = datetime.fromtimestamp(server_us / 1e6, tz=UTC)
    rows = []
    for s in summaries:
        name = s["instrument_name"]
        m = meta.get(name)
        if m is None:
            continue
        row_ms = s.get("creation_timestamp") or server_us / 1e3
        exp_ms = m["expiration_timestamp"]
        rows.append({
            "ts": ts,
            "currency": currency,
            "instrument": name,
            "expiry": datetime.fromtimestamp(exp_ms / 1e3, tz=UTC),
            "expiry_code": name.split("-")[1],
            "T": (exp_ms - row_ms) / 1e3 / YEAR_SECONDS,
            "strike": float(m["strike"]),
            "is_call": m["option_type"] == "call",
            "bid": _num(s.get("bid_price")),
            "ask": _num(s.get("ask_price")),
            "mark": _num(s.get("mark_price")),
            "F": _num(s.get("underlying_price")),
            "index": _num(s.get("estimated_delivery_price")),
            "underlying_index": s.get("underlying_index"),
            "oi": _num(s.get("open_interest")),
            "volume": _num(s.get("volume")),
            "mark_iv": _num(s.get("mark_iv")) / 100.0,
        })
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=COLUMNS)
    F, K, T, c = df["F"].to_numpy(), df["strike"].to_numpy(), df["T"].to_numpy(), df["is_call"]
    bid = df["bid"].where(df["bid"] > 0).to_numpy()
    ask = df["ask"].where(df["ask"] > 0).to_numpy()
    df["bid_iv"] = implied_vol(bid * F, F, K, T, c)
    df["ask_iv"] = implied_vol(ask * F, F, K, T, c)
    df["mid_iv"] = 0.5 * (df["bid_iv"] + df["ask_iv"])
    df["k"] = np.log(K / F)
    return df[COLUMNS].sort_values(["expiry", "strike", "is_call"]).reset_index(drop=True)
