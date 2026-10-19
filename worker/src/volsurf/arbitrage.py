"""Static-arbitrage checks on raw quotes.

Every check runs twice:

* at mid prices, labelled a "mid-quote violation" (a sign the quotes are inconsistent);
* at executable prices (buy at the ask, sell at the bid), labelled "tradeable at quoted
  prices". This is the stricter test: it ignores fees, margin and size.

Put quotes are turned into call-equivalent prices by put-call parity on Deribit's
forward with zero rates (Deribit's own convention): C = P + F − K. All prices are in USD,
converted from coin with the expiry's forward.
"""

from __future__ import annotations

import itertools
from dataclasses import asdict, dataclass
from typing import cast

import numpy as np
import pandas as pd

from .black import black_greeks

# Flags stored per quote (bitmask).
VERTICAL = 1
BUTTERFLY = 2
CALENDAR = 4
TRADEABLE = 8

# Deribit's smallest option tick is 0.0001 coin. Mid-quote violations smaller than half a
# tick are rounding, not information, and are ignored.
MIN_TICK_COIN = 0.0001


@dataclass
class Violation:
    kind: str  # "vertical" | "butterfly" | "calendar"
    level: str  # "mid" | "tradeable"
    expiry: str
    instruments: list[str]
    size_usd: float  # how far the inequality is broken, in USD per option
    detail: str

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def call_equivalents(q: pd.DataFrame) -> pd.DataFrame:
    """Call-equivalent bid/ask/mid in USD for one expiry, sorted by strike."""
    F = q["F"].to_numpy()
    K = q["strike"].to_numpy()
    shift = np.where(q["is_call"].to_numpy(), 0.0, F - K)
    out = pd.DataFrame({
        "instrument": q["instrument"].to_numpy(),
        "K": K,
        "bid": q["bid"].to_numpy() * F + shift,
        "ask": q["ask"].to_numpy() * F + shift,
    }, index=q.index)
    out["mid"] = 0.5 * (out["bid"] + out["ask"])
    return out.sort_values("K")


def check_slice(q: pd.DataFrame, expiry: str) -> tuple[list[Violation], pd.Series]:
    """Vertical-spread and butterfly checks within one expiry."""
    c = call_equivalents(q)
    flags = pd.Series(0, index=q.index, dtype=np.int64)
    out: list[Violation] = []
    if len(c) < 2:
        return out, flags
    tol = 0.5 * MIN_TICK_COIN * float(q["F"].iloc[0])
    K, bid, ask, mid = (c[x].to_numpy() for x in ("K", "bid", "ask", "mid"))
    names, idx = c["instrument"].to_numpy(), c.index.to_numpy()

    for i in range(len(c) - 1):
        dK = K[i + 1] - K[i]
        if dK <= 0:
            continue
        pair = [str(names[i]), str(names[i + 1])]
        # Call prices must fall with strike: C(K2) ≤ C(K1).
        m_up = mid[i + 1] - mid[i]
        t_up = bid[i + 1] - ask[i]
        # ...but by no more than the strike gap: C(K1) − C(K2) ≤ K2 − K1.
        m_dn = (mid[i] - mid[i + 1]) - dK
        t_dn = (bid[i] - ask[i + 1]) - dK
        for size_m, size_t, what in ((m_up, t_up, "call price rises with strike"),
                                     (m_dn, t_dn, "call price falls faster than strike")):
            if size_m > tol:
                out.append(Violation("vertical", "mid", expiry, pair, float(size_m), what))
                flags[idx[i]] |= VERTICAL
                flags[idx[i + 1]] |= VERTICAL
            if size_t > 0:
                out.append(Violation("vertical", "tradeable", expiry, pair, float(size_t), what))
                flags[idx[i]] |= VERTICAL | TRADEABLE
                flags[idx[i + 1]] |= VERTICAL | TRADEABLE

    for i in range(1, len(c) - 1):
        k1, k2, k3 = K[i - 1], K[i], K[i + 1]
        lam = (k3 - k2) / (k3 - k1)
        # Convexity: C(K2) ≤ λ C(K1) + (1 − λ) C(K3).
        size_m = mid[i] - (lam * mid[i - 1] + (1 - lam) * mid[i + 1])
        size_t = bid[i] - (lam * ask[i - 1] + (1 - lam) * ask[i + 1])
        trio = [str(names[i - 1]), str(names[i]), str(names[i + 1])]
        if size_m > tol:
            out.append(Violation("butterfly", "mid", expiry, trio, float(size_m),
                                 "call price not convex in strike"))
            flags[idx[i]] |= BUTTERFLY
        if size_t > 0:
            out.append(Violation("butterfly", "tradeable", expiry, trio, float(size_t),
                                 "call price not convex in strike"))
            flags[idx[i]] |= BUTTERFLY | TRADEABLE
    return out, flags


def check_calendar(kept: pd.DataFrame, n_k: int = 41) -> tuple[list[Violation], pd.Series]:
    """Total variance σ²T must not fall with T at fixed log-moneyness k.

    Quotes sit at different k in each expiry, so each slice's total variance is linearly
    interpolated in k and compared on the k range both slices cover. The flag goes on the
    later expiry's quote nearest to the offending k.
    """
    flags = pd.Series(0, index=kept.index, dtype=np.int64)
    out: list[Violation] = []
    slices = [g.sort_values("k") for _, g in kept.groupby("expiry", sort=True)]
    for a, b in itertools.pairwise(slices):
        lo = max(a["k"].min(), b["k"].min())
        hi = min(a["k"].max(), b["k"].max())
        if hi <= lo or len(a) < 2 or len(b) < 2:
            continue
        kk = np.linspace(lo, hi, n_k)

        def tv(g: pd.DataFrame, col: str, kk: np.ndarray = kk) -> np.ndarray:
            return np.asarray(np.interp(kk, g["k"], g[col] ** 2 * g["T"]), dtype=float)

        size_m = tv(a, "mid_iv") - tv(b, "mid_iv")
        size_t = tv(a, "bid_iv") - tv(b, "ask_iv")
        for level, size in (("mid", size_m), ("tradeable", size_t)):
            bad = size > (1e-6 if level == "mid" else 0.0)
            if not bad.any():
                continue
            j = int(np.argmax(size))
            near_a = a.iloc[int(np.argmin(np.abs(a["k"].to_numpy() - kk[j])))]
            near_b = b.iloc[int(np.argmin(np.abs(b["k"].to_numpy() - kk[j])))]
            # Express the size in USD on the later expiry via vega: ΔP ≈ vega·Δσ.
            T_b, F_b = float(near_b["T"]), float(near_b["F"])
            sig_b = float(near_b["mid_iv"])
            d_sig = float(np.sqrt(max(sig_b**2 * T_b + size[j], 0) / T_b) - sig_b)
            vega = float(black_greeks(F_b, float(near_b["strike"]), T_b, sig_b, True)["vega"])
            out.append(Violation(
                "calendar", level, str(near_b["expiry_code"]),
                [str(near_a["instrument"]), str(near_b["instrument"])],
                abs(d_sig) * vega,
                f"total variance falls from {near_a['expiry_code']} to "
                f"{near_b['expiry_code']} near k={kk[j]:+.3f}",
            ))
            bit = CALENDAR | (TRADEABLE if level == "tradeable" else 0)
            flags.loc[[cast(int, near_b.name)]] |= bit
    return out, flags


def check_quotes(kept: pd.DataFrame) -> tuple[list[Violation], pd.Series]:
    """All raw-quote checks over a cleaned snapshot. Returns violations and per-row flags."""
    flags = pd.Series(0, index=kept.index, dtype=np.int64)
    out: list[Violation] = []
    for code, g in kept.groupby("expiry_code", sort=False):
        v, f = check_slice(g, str(code))
        out += v
        flags.loc[f.index] |= f
    v, f = check_calendar(kept)
    out += v
    flags |= f
    return out, flags


def summarise(violations: list[Violation]) -> dict[str, dict[str, int]]:
    s: dict[str, dict[str, int]] = {
        lvl: {"vertical": 0, "butterfly": 0, "calendar": 0} for lvl in ("mid", "tradeable")}
    for v in violations:
        s[v.level][v.kind] += 1
    return s
