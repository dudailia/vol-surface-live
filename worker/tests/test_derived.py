"""Term structure, 25-delta skew and Dupire local vol from SSVI."""

import numpy as np
import pytest
from scipy.special import ndtr

from volsurf.derived import at_tenors, forward_delta_k, local_vol_point, smile_stats
from volsurf.ssvi import SSVIParams, fit_ssvi, total_variance

from .synth import make_slices

FLAT = SSVIParams(rho=0.0, eta=0.0, gamma=0.5)   # φ = 0: w(k, θ) = θ, a flat smile


def test_delta_strikes_have_the_right_delta():
    p, th = SSVIParams(-0.3, 1.0, 0.4), 0.05
    for d in (0.25, 0.75):
        k = forward_delta_k(th, p, d)
        w = total_variance(k, th, p.rho, p.eta, p.gamma)
        assert ndtr(-k / np.sqrt(w) + np.sqrt(w) / 2) == pytest.approx(d, abs=1e-10)


def test_flat_smile_has_zero_skew():
    s = smile_stats(0.5**2 * 0.25, 0.25, FLAT)
    assert s["atm"] == pytest.approx(50.0)
    assert s["rr25"] == pytest.approx(0.0, abs=1e-10)
    assert s["bf25"] == pytest.approx(0.0, abs=1e-10)


def test_skew_sign_follows_rho():
    th, T = 0.05, 0.2
    assert smile_stats(th, T, SSVIParams(-0.4, 1.0, 0.4))["rr25"] < 0   # puts richer
    assert smile_stats(th, T, SSVIParams(0.4, 1.0, 0.4))["rr25"] > 0    # calls richer
    assert smile_stats(th, T, SSVIParams(0.0, 1.0, 0.4))["bf25"] > 0    # convex wings


def test_local_vol_equals_implied_vol_on_flat_surface():
    T = np.array([0.05, 0.1, 0.25, 0.5, 1.0])
    theta = 0.6**2 * T
    for k in (-0.3, 0.0, 0.2):
        for t in (0.07, 0.3, 0.8):
            assert local_vol_point(T, theta, FLAT, k, t) == pytest.approx(0.6, rel=1e-6)


def test_local_vol_matches_closed_form_time_dependent_atm():
    # θ(T) = aT + bT²  =>  σ_loc(T)² = a + 2bT on a flat smile.
    a, b = 0.25, 0.1
    T = np.linspace(0.02, 1.0, 400)
    theta = a * T + b * T**2
    for t in (0.1, 0.4, 0.9):
        assert local_vol_point(T, theta, FLAT, 0.0, t) == pytest.approx(
            np.sqrt(a + 2 * b * t), rel=1e-4)


def test_tenor_stats_from_fit_stay_inside_range():
    p = SSVIParams(-0.25, 1.1, 0.35)
    fit = fit_ssvi(make_slices(p)[0])
    tenors = at_tenors(fit)
    assert set(tenors) == {"7d", "30d", "60d", "90d", "180d"}
    # 7 days is inside the grid (first expiry 4 days); ATM vol rises with tenor here.
    atms = [tenors[t]["atm"] for t in ("7d", "30d", "60d", "90d", "180d")]
    assert np.all(np.diff(atms) > 0)
