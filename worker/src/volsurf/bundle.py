"""The per-snapshot JSON bundle the page reads. Its JSON Schema is exported to /schema."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from .arbitrage import Violation, summarise
from .clean import reason_text
from .config import CleanConfig
from .derived import at_tenors, local_vol_grid, per_expiry
from .ssvi import SSVIFit

SCHEMA_VERSION = 1


class QuoteColumns(BaseModel):
    """Cleaned quotes used in the fit, column-wise to keep the JSON small."""

    instrument: list[str]
    strike: list[float]
    is_call: list[bool]
    k: list[float] = Field(description="log-moneyness ln(K/F)")
    bid_iv: list[float] = Field(description="implied vol, fraction (0.5 = 50%)")
    ask_iv: list[float]
    mid_iv: list[float]
    oi: list[float]
    flags: list[int] = Field(description="bitmask: 1 vertical, 2 butterfly, 4 calendar, "
                                         "8 tradeable at quoted prices")


class SmileStats(BaseModel):
    atm: float = Field(description="ATM vol, vol points")
    rr25: float = Field(description="25-delta risk reversal, call minus put, vol points")
    bf25: float = Field(description="25-delta butterfly, vol points")
    call25: float
    put25: float


class Expiry(BaseModel):
    code: str
    expiry: datetime
    T: float = Field(description="years to expiry, ACT/365")
    F: float = Field(description="Deribit forward (underlying_price), USD")
    theta: float = Field(description="fitted ATM total variance")
    stats: SmileStats
    rmse_vol_pts: float
    inside_spread: float | None = Field(description="share of quotes with the fit inside "
                                                    "bid/ask IV")
    n: int
    quotes: QuoteColumns


class SSVIBlock(BaseModel):
    rho: float
    eta: float
    gamma: float
    butterfly_margin: float = Field(description="2 - eta(1+|rho|); >= 0 means no butterfly "
                                                "arbitrage by Gatheral-Jacquier Cor. 4.1")
    min_g: float = Field(description="min Durrleman g(k) on a grid over fitted slices")
    min_dw_dT: float = Field(description="min increase in total variance between expiries")
    success: bool
    message: str


class ViolationOut(BaseModel):
    kind: Literal["vertical", "butterfly", "calendar"]
    level: Literal["mid", "tradeable"]
    expiry: str
    instruments: list[str]
    size_usd: float
    detail: str


class ArbBlock(BaseModel):
    counts: dict[str, dict[str, int]]
    violations: list[ViolationOut] = Field(description="largest first, at most 50")


class LocalVol(BaseModel):
    k: list[float]
    T: list[float]
    vol: list[list[float | None]] = Field(description="vol points; null outside 3 ATM "
                                                      "standard deviations")


class Cleaning(BaseModel):
    n_raw: int
    n_kept: int
    dropped: dict[str, int]
    rules: dict[str, str]
    skipped_expiries: list[str]


class IVCheck(BaseModel):
    """Our IVs against Deribit's own bid_iv/ask_iv on a random sample of clean quotes.

    Deribit rounds IVs to 0.01, so gaps up to 0.005 are rounding. Now and then a ticker's
    IV disagrees with its own price by more (it appears to be computed at a slightly
    different moment); those are counted, not hidden.
    """

    n: int
    median_gap_pts: float | None
    max_gap_pts: float | None
    n_over_0_1_pts: int


class Bundle(BaseModel):
    version: int = SCHEMA_VERSION
    currency: Literal["BTC", "ETH"]
    ts: datetime
    index_price: float
    source: str = "Deribit public API (get_book_summary_by_currency, ticker)"
    ssvi: SSVIBlock
    expiries: list[Expiry]
    tenors: dict[str, SmileStats]
    arbitrage: ArbBlock
    local_vol: LocalVol
    cleaning: Cleaning
    iv_check: IVCheck


def _r(x: object, nd: int) -> list[float]:
    return [round(float(v), nd) for v in np.asarray(x, dtype=float)]


def _stats(d: dict[str, float]) -> SmileStats:
    return SmileStats(**{k: round(d[k], 4) for k in ("atm", "rr25", "bf25", "call25", "put25")})


def _iv_check(gaps: list[float]) -> IVCheck:
    a = np.abs(np.asarray(gaps, dtype=float))
    if a.size == 0:
        return IVCheck(n=0, median_gap_pts=None, max_gap_pts=None, n_over_0_1_pts=0)
    return IVCheck(n=int(a.size), median_gap_pts=round(float(np.median(a)), 4),
                   max_gap_pts=round(float(a.max()), 4), n_over_0_1_pts=int((a > 0.1).sum()))


def make_bundle(
    *,
    currency: str,
    ts: datetime,
    df: pd.DataFrame,
    kept: pd.DataFrame,
    flags: pd.Series,
    fit: SSVIFit,
    codes: list[str],
    skipped: list[str],
    violations: list[Violation],
    dropped: dict[str, int],
    iv_gaps: list[float],
    clean_cfg: CleanConfig,
) -> Bundle:
    stats = per_expiry(fit)
    expiries = []
    for i, code in enumerate(codes):
        g = kept[kept["expiry_code"] == code].sort_values("k")
        expiries.append(Expiry(
            code=code,
            expiry=g["expiry"].iloc[0].to_pydatetime(),
            T=round(float(fit.T[i]), 8),
            F=round(float(g["F"].iloc[0]), 4),
            theta=round(float(fit.theta[i]), 8),
            stats=_stats(stats[i]),
            rmse_vol_pts=round(float(fit.rmse_vol_pts[i]), 4),
            inside_spread=(None if np.isnan(fit.inside_spread[i])
                           else round(float(fit.inside_spread[i]), 4)),
            n=int(fit.n[i]),
            quotes=QuoteColumns(
                instrument=g["instrument"].tolist(),
                strike=_r(g["strike"], 2),
                is_call=g["is_call"].astype(bool).tolist(),
                k=_r(g["k"], 5),
                bid_iv=_r(g["bid_iv"], 5),
                ask_iv=_r(g["ask_iv"], 5),
                mid_iv=_r(g["mid_iv"], 5),
                oi=_r(g["oi"].fillna(0), 2),
                flags=[int(f) for f in flags.loc[g.index]],
            ),
        ))
    top = sorted(violations, key=lambda v: (v.level != "tradeable", -v.size_usd))[:50]
    p = fit.params
    lv = local_vol_grid(fit)
    return Bundle(
        currency=currency,
        ts=ts,
        index_price=round(float(df["index"].median()), 4),
        ssvi=SSVIBlock(rho=p.rho, eta=p.eta, gamma=p.gamma,
                       butterfly_margin=p.butterfly_margin(), min_g=fit.min_g,
                       min_dw_dT=fit.min_dw_dT, success=fit.success, message=fit.message),
        expiries=expiries,
        tenors={k: _stats(v) for k, v in at_tenors(fit).items()},
        arbitrage=ArbBlock(
            counts=summarise(violations),
            violations=[ViolationOut(**{**v.as_dict(), "size_usd": round(v.size_usd, 2)})
                        for v in top]),
        local_vol=LocalVol(**lv),
        cleaning=Cleaning(n_raw=len(df), n_kept=len(kept), dropped=dropped,
                          rules=reason_text(clean_cfg), skipped_expiries=skipped),
        iv_check=_iv_check(iv_gaps),
    )
