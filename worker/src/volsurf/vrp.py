"""Implied against realized volatility, from Deribit's public data.

* Realized vol: from Deribit's index (``get_index_chart_data``, one price every six hours,
  one year). For each day at 00:00 UTC, the annualized root mean square of six-hour log
  returns over the 30 days before it (trailing) or after it (forward):
  σ = √(Σ r² / years spanned). Zero mean, no overlap correction.
* Implied vol: DVOL, Deribit's 30-day implied volatility index (``get_volatility_index_data``,
  daily), read at 00:00 UTC (the daily candle's open); and our own 30-day at-the-money vol
  from the fitted surface, for the snapshots the worker has kept.
* The gap: DVOL minus trailing realized vol (what the market pays now against what the
  index just did), and DVOL minus forward realized vol (the volatility risk premium as it
  turned out), which exists only for days at least 30 days old.
* Deribit's own published historical volatility (``get_historical_volatility``, hourly,
  last ~16 days) is included as a reference; its window is not documented in the API.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
from pydantic import BaseModel, Field

from .deribit import DeribitClient

log = logging.getLogger(__name__)

YEAR_MS = 365.0 * 24 * 3600 * 1000
DAY_MS = 24 * 3600 * 1000
WINDOW_DAYS = 30
# A window needs at least this share of its expected six-hour returns to count.
MIN_COVERAGE = 0.9

METHOD = {
    "realized": "Annualized root mean square of six-hour log returns of Deribit's index over "
                "30 days, zero mean: sqrt(sum r^2 / years spanned).",
    "dvol": "DVOL, Deribit's 30-day implied volatility index, read at 00:00 UTC each day.",
    "ours": "30-day at-the-money vol from our fitted surface: sqrt(theta(30d) / T), with "
            "theta interpolated monotonically between expiries.",
    "gap_trailing": "DVOL minus realized vol over the previous 30 days.",
    "gap_forward": "DVOL minus realized vol over the following 30 days (the volatility risk "
                   "premium as it turned out); only for days at least 30 days old.",
    "deribit_hv": "Deribit's published historical volatility (get_historical_volatility); "
                  "its window is not documented in the API.",
}


class Series(BaseModel):
    t: list[str] = Field(description="ISO timestamps, UTC")
    v: list[float] = Field(description="vol points")


class VrpLatest(BaseModel):
    date: str
    dvol: float
    realized_30d: float
    gap: float
    ours_atm30: float | None
    ours_ts: str | None


class VrpForward(BaseModel):
    days: int
    start: str
    end: str
    share_positive: float = Field(description="share of days DVOL exceeded the realized "
                                              "vol of the following 30 days")
    median_gap: float
    mean_gap: float


class VrpCurrency(BaseModel):
    currency: str
    dvol: Series
    realized_30d: Series
    gap_trailing: Series
    gap_forward: Series
    deribit_hv: Series
    ours_atm30: Series
    latest: VrpLatest | None
    forward: VrpForward | None


class VrpReport(BaseModel):
    version: int = 1
    generated_at: datetime
    method: dict[str, str]
    currencies: dict[str, VrpCurrency]


def _iso(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=UTC).strftime("%Y-%m-%dT%H:%MZ")


def realized_vol(t_ms: np.ndarray, price: np.ndarray, start_ms: float, end_ms: float,
                 step_ms: float = 6 * 3600 * 1000) -> float | None:
    """Annualized realized vol from log returns of samples in (start, end]."""
    mask = (t_ms >= start_ms) & (t_ms <= end_ms)
    tt, pp = t_ms[mask], price[mask]
    if len(tt) < 2:
        return None
    # The data must reach both ends of the window, not just fill most of it.
    if tt[0] - start_ms > 1.5 * step_ms or end_ms - tt[-1] > 1.5 * step_ms:
        return None
    r = np.diff(np.log(pp))
    expected = (end_ms - start_ms) / step_ms
    if len(r) < MIN_COVERAGE * expected:
        return None
    years = (tt[-1] - tt[0]) / YEAR_MS
    return float(np.sqrt(np.sum(r * r) / years) * 100.0)


def daily_realized(t_ms: np.ndarray, price: np.ndarray, days_ms: np.ndarray,
                   forward: bool = False) -> list[float | None]:
    w = WINDOW_DAYS * DAY_MS
    return [realized_vol(t_ms, price, d, d + w) if forward else
            realized_vol(t_ms, price, d - w, d) for d in days_ms]


def build_currency(currency: str, index: list[list[float]], dvol: list[list[float]],
                   hv: list[list[float]], ours: list[tuple[str, float]],
                   now_ms: float) -> VrpCurrency:
    ix = np.array(index, dtype=float)
    t_ms, price = ix[:, 0], ix[:, 1]
    # DVOL candles start at 00:00 UTC; the open is the value at that instant.
    dv = {int(c[0]): float(c[1]) for c in dvol}
    days = np.array(sorted(dv), dtype=float)
    trail = daily_realized(t_ms, price, days)
    fwd = daily_realized(t_ms, price, days, forward=True)

    def series(pairs: list[tuple[float, float | None]]) -> Series:
        keep = [(t, v) for t, v in pairs if v is not None]
        return Series(t=[_iso(t) for t, _ in keep], v=[round(v, 3) for _, v in keep])

    dvol_s = series([(d, dv[int(d)]) for d in days])
    rv_s = series(list(zip(days, trail, strict=True)))
    gap_t = series([(d, dv[int(d)] - r if r is not None else None)
                    for d, r in zip(days, trail, strict=True)])
    gap_f = series([(d, dv[int(d)] - r if r is not None and d + WINDOW_DAYS * DAY_MS <= now_ms
                     else None) for d, r in zip(days, fwd, strict=True)])

    latest = None
    have = [(d, dv[int(d)], r) for d, r in zip(days, trail, strict=True) if r is not None]
    if have:
        d, v, r = have[-1]
        o = ours[-1] if ours else None
        latest = VrpLatest(date=_iso(d), dvol=round(v, 3), realized_30d=round(r, 3),
                           gap=round(v - r, 3), ours_atm30=round(o[1], 3) if o else None,
                           ours_ts=o[0] if o else None)
    forward = None
    if gap_f.v:
        g = np.array(gap_f.v)
        forward = VrpForward(days=len(g), start=gap_f.t[0], end=gap_f.t[-1],
                             share_positive=round(float((g > 0).mean()), 4),
                             median_gap=round(float(np.median(g)), 3),
                             mean_gap=round(float(g.mean()), 3))
    return VrpCurrency(
        currency=currency, dvol=dvol_s, realized_30d=rv_s, gap_trailing=gap_t,
        gap_forward=gap_f,
        deribit_hv=Series(t=[_iso(t) for t, _ in hv], v=[round(float(v), 3) for _, v in hv]),
        ours_atm30=Series(t=[t for t, _ in ours], v=[round(v, 3) for _, v in ours]),
        latest=latest, forward=forward)


async def fetch(dc: DeribitClient, currency: str, now: datetime) -> dict[str, Any]:
    index, _ = await dc.get("get_index_chart_data", index_name=f"{currency.lower()}_usd",
                            range="1y")
    end = int(now.timestamp() * 1000)
    start = int((now - timedelta(days=400)).timestamp() * 1000)
    dvol, _ = await dc.get("get_volatility_index_data", currency=currency,
                           start_timestamp=start, end_timestamp=end, resolution="1D")
    hv, _ = await dc.get("get_historical_volatility", currency=currency)
    return {"index": index, "dvol": dvol["data"], "hv": hv}


def ours_series(compact: list[dict[str, Any]]) -> list[tuple[str, float]]:
    """30-day ATM vol, √(θ(30d)/T), from saved surfaces (compact form, SSVI θ)."""
    from .derived import theta_interpolator

    out: list[tuple[str, float]] = []
    t = 30 / 365
    for c in compact:
        T = np.array([e["T"] for e in c["expiries"]])
        th = np.array([e["theta"] for e in c["expiries"]])
        if len(T) < 2 or t < T[0] or t > T[-1]:
            continue
        th30 = float(theta_interpolator(T, th)(t))
        ts = datetime.fromisoformat(c["ts"].replace("Z", "+00:00"))
        out.append((ts.strftime("%Y-%m-%dT%H:%MZ"), float(np.sqrt(th30 / t) * 100)))
    return out


async def compute(dc: DeribitClient, currencies: tuple[str, ...],
                  ours: dict[str, list[tuple[str, float]]], now: datetime) -> VrpReport:
    out = {}
    now_ms = now.timestamp() * 1000
    for c in currencies:
        raw = await fetch(dc, c, now)
        out[c] = build_currency(c, raw["index"], raw["dvol"], raw["hv"], ours.get(c, []), now_ms)
    return VrpReport(generated_at=now, method=METHOD, currencies=out)
