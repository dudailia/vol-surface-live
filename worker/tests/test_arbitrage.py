"""Raw-quote arbitrage checks fire on broken inputs and stay quiet on clean ones."""

import numpy as np
import pandas as pd

from volsurf.arbitrage import (
    BUTTERFLY,
    CALENDAR,
    TRADEABLE,
    VERTICAL,
    check_calendar,
    check_quotes,
    check_slice,
)
from volsurf.black import black_price
from volsurf.ssvi import SSVIParams, total_variance

F = 80_000.0
P = SSVIParams(rho=-0.2, eta=1.0, gamma=0.4)


def clean_slice(T=0.1, theta=None, strikes=None, code="E1", half_spread=0.0002):
    """OTM quotes in coin from an arbitrage-free SSVI slice."""
    theta = theta if theta is not None else 0.55**2 * T
    strikes = np.arange(60_000, 104_000, 4_000.0) if strikes is None else strikes
    k = np.log(strikes / F)
    iv = np.sqrt(total_variance(k, theta, P.rho, P.eta, P.gamma) / T)
    is_call = strikes >= F
    px = black_price(F, strikes, T, iv, is_call) / F
    df = pd.DataFrame({
        "instrument": [f"BTC-{code}-{int(K)}-{'C' if c else 'P'}" for K, c in
                       zip(strikes, is_call, strict=True)],
        "expiry_code": code, "expiry": pd.Timestamp("2027-01-01") + pd.Timedelta(days=T * 365),
        "strike": strikes, "is_call": is_call, "F": F, "T": T, "k": k,
        "bid": px - half_spread, "ask": px + half_spread,
        "mid_iv": iv, "bid_iv": iv - 0.005, "ask_iv": iv + 0.005,
    })
    return df


def test_clean_slice_has_no_violations():
    v, flags = check_slice(clean_slice(), "E1")
    assert v == [] and (flags == 0).all()


def test_concave_prices_fire_butterfly():
    q = clean_slice()
    i = 5
    q.loc[i, ["bid", "ask"]] += 0.004   # lift one strike well above its neighbours' chord
    v, flags = check_slice(q, "E1")
    kinds = {(x.kind, x.level) for x in v}
    assert ("butterfly", "mid") in kinds and ("butterfly", "tradeable") in kinds
    assert flags[i] & BUTTERFLY and flags[i] & TRADEABLE


def test_call_price_rising_with_strike_fires_vertical():
    q = clean_slice()
    calls = q.index[q.is_call]
    q.loc[calls[2], ["bid", "ask"]] = q.loc[calls[1], ["bid", "ask"]].to_numpy() + 0.002
    v, flags = check_slice(q, "E1")
    assert any(x.kind == "vertical" and "rises" in x.detail for x in v)
    assert flags[calls[1]] & VERTICAL and flags[calls[2]] & VERTICAL


def test_slope_below_minus_one_fires_vertical():
    q = clean_slice(strikes=np.array([70_000.0, 72_000.0, 84_000.0, 86_000.0]))
    # A 70k put far dearer than the 72k put: the put spread is worth more than the
    # 2000 strike gap, so in call terms C(70k) − C(72k) > 2000.
    q.loc[0, ["bid", "ask"]] = [0.03, 0.0302]
    q.loc[1, ["bid", "ask"]] = [0.0001, 0.0002]
    v, _ = check_slice(q, "E1")
    assert any(x.kind == "vertical" and "faster" in x.detail for x in v)


def test_mid_violation_without_tradeable_one():
    # A kink inside a wide market. The ATM butterfly slack here is about $230 per option;
    # a $320 lift breaks convexity at mid, but a $480 spread keeps it untradeable.
    q = clean_slice(half_spread=0.003)
    q.loc[5, ["bid", "ask"]] += 0.004
    v, _ = check_slice(q, "E1")
    levels = {x.level for x in v if x.kind == "butterfly"}
    assert levels == {"mid"}


def test_total_variance_falling_with_T_fires_calendar():
    near = clean_slice(T=0.10, theta=0.60**2 * 0.10, code="E1")
    far = clean_slice(T=0.12, theta=0.40**2 * 0.12, code="E2")   # less total variance
    kept = pd.concat([near, far], ignore_index=True)
    v, flags = check_calendar(kept)
    assert {x.level for x in v} == {"mid", "tradeable"}
    assert (flags[kept.expiry_code == "E2"] & CALENDAR).any()


def test_consistent_term_structure_has_no_calendar_flags():
    near = clean_slice(T=0.10, code="E1")
    far = clean_slice(T=0.25, code="E2")
    v, flags = check_calendar(pd.concat([near, far], ignore_index=True))
    assert v == [] and (flags == 0).all()


def test_check_quotes_combines_everything():
    near = clean_slice(T=0.10, code="E1")
    far = clean_slice(T=0.25, code="E2")
    kept = pd.concat([near, far], ignore_index=True)
    kept.loc[3, ["bid", "ask"]] += 0.004
    v, flags = check_quotes(kept)
    assert len(v) > 0 and flags.loc[3] & BUTTERFLY
