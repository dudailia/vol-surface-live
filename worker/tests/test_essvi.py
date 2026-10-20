"""Extended SSVI: recovery of known parameters and no-arbitrage on a grid."""

import numpy as np
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from volsurf.essvi import (
    ESSVIFit,
    butterfly_margins,
    calendar_margins,
    fit_essvi,
    from_ssvi,
    slice_w,
    surface_checks,
)
from volsurf.ssvi import SliceData, fit_ssvi

from .synth import T_GRID, theta_curve


def essvi_truth(rho_short=-0.45, rho_long=-0.1, psi_scale=0.55):
    """Skew that flattens with maturity, the shape one global ρ cannot follow."""
    theta = theta_curve(T_GRID)
    u = np.sqrt(T_GRID / T_GRID[-1])
    rho = rho_short + (rho_long - rho_short) * u
    psi = psi_scale * np.sqrt(theta)
    a, b = butterfly_margins(theta, rho, psi)
    c0, c1, c2 = calendar_margins(theta, rho, psi)
    assert (a > 0).all() and (b > 0).all()
    assert (c0 >= 0).all() and (c1 >= 0).all() and (c2 >= 0).all()
    return theta, rho, psi


def slices_from(theta, rho, psi, noise=0.0, seed=0, n_k=25):
    rng = np.random.default_rng(seed)
    out = []
    for t, th, r, ps in zip(T_GRID, theta, rho, psi, strict=True):
        half = 2.5 * np.sqrt(th)
        k = np.linspace(-half, half, n_k)
        iv = np.sqrt(slice_w(k, th, r, ps) / t) + noise * rng.standard_normal(n_k)
        out.append(SliceData(T=float(t), k=k, iv=iv, weight=np.ones(n_k),
                             bid_iv=iv - 0.005, ask_iv=iv + 0.005))
    return out


def test_recovers_known_parameters():
    theta, rho, psi = essvi_truth()
    slices = slices_from(theta, rho, psi)
    ssvi = fit_ssvi(slices)
    fit = fit_essvi(slices, from_ssvi(ssvi))
    np.testing.assert_allclose(fit.theta, theta, rtol=1e-4)
    np.testing.assert_allclose(fit.rho, rho, atol=1e-3)
    np.testing.assert_allclose(fit.psi, psi, rtol=1e-3)
    assert fit.rmse_vol_pts.max() < 0.01
    # The same quotes need a per-expiry skew: SSVI cannot match them.
    assert ssvi.rmse_vol_pts.max() > 10 * fit.rmse_vol_pts.max()


def test_never_worse_than_ssvi_on_real_quotes(payload):
    from volsurf.clean import clean
    from volsurf.model import build_slices
    from volsurf.snapshot import build_snapshot

    for cur in ("BTC", "ETH"):
        p = payload[cur]
        df = build_snapshot(cur, p["instruments"], p["summaries"], p["server_us"])
        kept, _ = clean(df)
        slices, _, _ = build_slices(kept)
        ssvi = fit_ssvi(slices)
        fit = fit_essvi(slices, from_ssvi(ssvi))
        assert fit.objective <= ssvi.objective + 1e-12
        assert fit.min_g >= -1e-9 and fit.min_dw_dT >= -1e-12


rho_st = st.floats(-0.7, 0.3)


@settings(max_examples=20, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(rho_st, rho_st, st.floats(0.3, 1.2), st.integers(0, 10_000))
def test_conditions_hold_on_a_grid_after_fitting(r0, r1, scale, seed):
    """Fit noisy quotes from a surface that may itself break the conditions."""
    theta = theta_curve(T_GRID)
    u = np.sqrt(T_GRID / T_GRID[-1])
    rho = r0 + (r1 - r0) * u
    psi = scale * np.sqrt(theta)
    slices = slices_from(theta, rho, psi, noise=0.003, seed=seed)
    fit = fit_essvi(slices, from_ssvi(fit_ssvi(slices)))
    a, b = butterfly_margins(fit.theta, fit.rho, fit.psi)
    c0, c1, c2 = calendar_margins(fit.theta, fit.rho, fit.psi)
    assert (a > 0).all() and (b >= -1e-9).all()
    assert (c0 >= -1e-12).all() and (c1 >= -1e-9).all() and (c2 >= -1e-9).all()
    assert fit.min_g >= -1e-9
    assert fit.min_dw_dT >= -1e-12


def test_grid_check_catches_crossing_slices():
    # Second slice: more variance at the money but a far flatter wing than the first:
    # Δψ < |Δρψ| breaks the calendar condition and the slices cross out in the wing.
    T = np.array([0.1, 0.2])
    theta = np.array([0.02, 0.03])
    rho = np.array([-0.9, 0.0])
    psi = np.array([0.30, 0.31])
    _, c1, c2 = calendar_margins(theta, rho, psi)
    assert min(c1.min(), c2.min()) < 0
    bad = ESSVIFit(T=T, theta=theta, rho=rho, psi=psi, rmse_vol_pts=np.zeros(2),
                   inside_spread=np.zeros(2), n=np.array([1, 1]), success=True, message="",
                   objective=0.0)
    _, min_dw = surface_checks(bad, k_max=4.0)
    assert min_dw < 0


def test_ssvi_as_essvi_is_identical():
    from volsurf.ssvi import SSVIParams

    from .synth import make_slices

    slices, _ = make_slices(SSVIParams(-0.25, 1.1, 0.35))
    s = fit_ssvi(slices)
    e = from_ssvi(s)
    k = np.linspace(-0.8, 0.8, 17)
    for i in range(len(s.T)):
        np.testing.assert_allclose(e.w(k, i), s.w(k, i), rtol=1e-12)
