"""Black-76 prices and Greeks against QuantLib, textbook values and finite differences."""

import math

import numpy as np
import pytest
import QuantLib as ql
from hypothesis import given, settings
from hypothesis import strategies as st

from volsurf.black import black_greeks, black_price, implied_vol


def ql_black(F: float, K: float, T: float, sigma: float, is_call: bool, df: float = 1.0):
    opt = ql.Option.Call if is_call else ql.Option.Put
    calc = ql.BlackCalculator(ql.PlainVanillaPayoff(opt, K), F, sigma * math.sqrt(T), df)
    return {
        "price": calc.value(),
        "delta": calc.deltaForward(),
        "gamma": calc.gammaForward(),
        "vega": calc.vega(T),
        "theta": None,
    }


cases = st.tuples(
    st.floats(1_000, 150_000),     # F
    st.floats(0.3, 2.5),           # K / F
    st.floats(2 / 365, 3.0),       # T
    st.floats(0.05, 2.0),          # sigma
    st.booleans(),
    st.floats(0.9, 1.0),           # discount factor
)


@settings(max_examples=300, deadline=None)
@given(cases)
def test_price_and_greeks_match_quantlib(c):
    F, m, T, s, call, df = c
    K = F * m
    ref = ql_black(F, K, T, s, call, df)
    assert black_price(F, K, T, s, call, df) == pytest.approx(ref["price"], rel=1e-10, abs=1e-8)
    g = black_greeks(F, K, T, s, call, df)
    assert g["delta"] == pytest.approx(ref["delta"], rel=1e-9, abs=1e-12)
    assert g["gamma"] == pytest.approx(ref["gamma"], rel=1e-9, abs=1e-15)
    assert g["vega"] == pytest.approx(ref["vega"], rel=1e-9, abs=1e-8)


def test_textbook_value_hull():
    # Hull, Options, Futures and Other Derivatives, Example 18.x (Black's model on futures):
    # F=20, K=20, r=9%, T=4/12, sigma=25%: European put on futures = 1.12.
    T = 4 / 12
    df = math.exp(-0.09 * T)
    assert float(black_price(20.0, 20.0, T, 0.25, False, df)) == pytest.approx(1.1166, abs=1e-4)


def test_put_call_parity():
    F, K, T, s = 80_000.0, 95_000.0, 0.4, 0.55
    c = black_price(F, K, T, s, True)
    p = black_price(F, K, T, s, False)
    assert float(c - p) == pytest.approx(F - K, abs=1e-8)


@pytest.mark.parametrize("call", [True, False])
def test_greeks_match_finite_differences(call):
    F, K, T, s = 3_000.0, 3_400.0, 0.25, 0.7
    h = 1e-3
    g = black_greeks(F, K, T, s, call)

    def dP(**kw):
        args = {"F": F, "K": K, "T": T, "sigma": s, "is_call": call, **kw}
        return float(black_price(**args))

    assert g["delta"] == pytest.approx((dP(F=F + h) - dP(F=F - h)) / (2 * h), rel=1e-6)
    assert g["gamma"] == pytest.approx((dP(F=F + 1) - 2 * dP() + dP(F=F - 1)) / 1.0, rel=1e-4)
    assert g["vega"] == pytest.approx((dP(sigma=s + 1e-6) - dP(sigma=s - 1e-6)) / 2e-6, rel=1e-6)
    assert g["theta"] == pytest.approx(-(dP(T=T + 1e-6) - dP(T=T - 1e-6)) / 2e-6, rel=1e-5)


@settings(max_examples=300, deadline=None)
@given(cases)
def test_implied_vol_round_trip(c):
    F, m, T, s, call, _ = c
    K = F * m
    p = float(black_price(F, K, T, s, call))
    intrinsic = max(F - K, 0) if call else max(K - F, 0)
    # Skip cases where the time value is below double precision: no vol is recoverable.
    if p - intrinsic < 1e-9 * F:
        return
    assert float(implied_vol(p, F, K, T, call)) == pytest.approx(s, abs=1e-7)


def test_implied_vol_rejects_out_of_bounds():
    F, K, T = 100.0, 90.0, 0.5
    below = implied_vol(9.0, F, K, T, True)      # below intrinsic of 10
    above = implied_vol(101.0, F, K, T, True)    # above the forward
    assert np.isnan(below) and np.isnan(above)


def test_implied_vol_vectorised_shapes():
    F = np.full(5, 100.0)
    K = np.array([80, 90, 100, 110, 120.0])
    s = np.array([0.6, 0.5, 0.45, 0.5, 0.65])
    calls = K >= F
    p = black_price(F, K, 0.3, s, calls)
    np.testing.assert_allclose(implied_vol(p, F, K, 0.3, calls), s, atol=1e-8)
