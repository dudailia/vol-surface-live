"""SSVI: self-consistency, parameter recovery, constraints and arbitrage-free output."""

import numpy as np
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from volsurf.ssvi import (
    SSVIParams,
    durrleman_g,
    fit_ssvi,
    thm42_margins,
    total_variance,
    w_derivatives,
)

from .synth import make_slices

KNOWN = [
    SSVIParams(rho=-0.25, eta=1.1, gamma=0.35),
    SSVIParams(rho=0.15, eta=0.9, gamma=0.45),   # call skew, as crypto often shows
    SSVIParams(rho=-0.6, eta=1.2, gamma=0.25),   # near the η(1+|ρ|) ≤ 2 boundary
]


def test_atm_total_variance_is_theta():
    for p in KNOWN:
        th = np.array([0.001, 0.05, 0.4])
        np.testing.assert_allclose(total_variance(0.0, th, p.rho, p.eta, p.gamma), th)


def test_analytic_derivatives_match_finite_differences():
    p = KNOWN[0]
    k, th, h = np.linspace(-1, 1, 41), 0.08, 1e-5
    w, w1, w2, wt = w_derivatives(k, th, p.rho, p.eta, p.gamma)
    f = lambda kk, tt: total_variance(kk, tt, p.rho, p.eta, p.gamma)  # noqa: E731
    np.testing.assert_allclose(w1, (f(k + h, th) - f(k - h, th)) / (2 * h), rtol=1e-6)
    np.testing.assert_allclose(w2, (f(k + h, th) - 2 * w + f(k - h, th)) / h**2,
                               rtol=1e-4, atol=1e-7)
    np.testing.assert_allclose(wt, (f(k, th + h) - f(k, th - h)) / (2 * h), rtol=1e-6)


@pytest.mark.parametrize("p", KNOWN)
def test_fit_reproduces_known_parameters(p):
    slices, theta = make_slices(p)
    fit = fit_ssvi(slices)
    assert fit.success
    assert fit.params.rho == pytest.approx(p.rho, abs=1e-4)
    assert fit.params.eta == pytest.approx(p.eta, abs=1e-4)
    assert fit.params.gamma == pytest.approx(p.gamma, abs=1e-4)
    np.testing.assert_allclose(fit.theta, theta, rtol=1e-4)
    assert fit.rmse_vol_pts.max() < 0.01


def test_fit_with_bid_ask_noise_stays_close():
    p = KNOWN[0]
    slices, theta = make_slices(p, noise=0.003, seed=3)   # 0.3 vol pt quote noise
    fit = fit_ssvi(slices)
    assert fit.params.rho == pytest.approx(p.rho, abs=0.05)
    np.testing.assert_allclose(fit.theta, theta, rtol=0.03)
    assert fit.rmse_vol_pts.max() < 0.5


def test_warm_start_converges_to_same_answer():
    p = KNOWN[1]
    slices, _ = make_slices(p)
    cold = fit_ssvi(slices)
    warm = fit_ssvi(slices, start=(cold.theta * 1.02, SSVIParams(0.1, 0.8, 0.4)))
    np.testing.assert_allclose(warm.theta, cold.theta, rtol=1e-4)
    assert warm.params.rho == pytest.approx(cold.params.rho, abs=1e-4)


params_st = st.builds(
    lambda r, e, g: SSVIParams(r, e, g),
    st.floats(-0.8, 0.8), st.floats(0.2, 3.0), st.floats(0.05, 0.5))


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(params_st, st.integers(0, 10_000))
def test_constraints_hold_after_fitting_any_surface(p, seed):
    """Even when the true surface breaks η(1+|ρ|) ≤ 2, the fit must satisfy it."""
    slices, _ = make_slices(p, noise=0.002, seed=seed)
    fit = fit_ssvi(slices)
    q = fit.params
    assert q.butterfly_margin() >= -1e-9
    assert 0 < q.gamma <= 0.5 and abs(q.rho) < 1
    a, b = thm42_margins(fit.theta, q)
    assert (a > 0).all() and (b >= -1e-9).all()
    assert np.all(np.diff(fit.theta) >= -1e-12)
    assert fit.min_g >= -1e-9
    assert fit.min_dw_dT >= -1e-12


def test_durrleman_g_is_negative_on_a_broken_slice():
    # θφ(1+|ρ|) > 4 breaks the necessary condition (the left wing slope exceeds Roger
    # Lee's bound of 2), so this deliberately broken slice must show g(k) < 0.
    p = SSVIParams(rho=-0.4, eta=8.0, gamma=0.5)
    th = 1.0
    a, _ = thm42_margins(th, p)
    assert a < 0
    k = np.linspace(-4, 4, 1601)
    w, w1, w2, _ = w_derivatives(k, th, p.rho, p.eta, p.gamma)
    assert durrleman_g(k, w, w1, w2).min() < 0
