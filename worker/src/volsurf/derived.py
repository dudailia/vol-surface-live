"""Quantities derived from a fitted SSVI surface: term structure, skew and local vol."""

from __future__ import annotations

from collections.abc import Callable
from typing import cast

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import PchipInterpolator
from scipy.optimize import brentq
from scipy.special import ndtr

from .ssvi import SSVIFit, SSVIParams, durrleman_g, total_variance, w_derivatives

F64 = NDArray[np.float64]

_brentq: Callable[..., float] = brentq

TENORS_DAYS = (7, 30, 60, 90, 180)


def theta_interpolator(T: F64, theta: F64) -> PchipInterpolator:
    """Monotone cubic θ(T) through (0, 0) and the fitted points.

    PCHIP keeps θ non-decreasing between expiries, so interpolated slices stay free of
    calendar arbitrage, and its derivative is continuous, which local vol needs.
    """
    return PchipInterpolator(np.concatenate([[0.0], T]), np.concatenate([[0.0], theta]),
                             extrapolate=False)


def forward_delta_k(theta: float, p: SSVIParams, delta: float) -> float:
    """Log-moneyness where the forward (not premium-adjusted) call delta equals ``delta``.

    Call delta N(d1) with d1 = −k/√w + √w/2 falls monotonically in k on an arbitrage-free
    slice. A put delta of −0.25 is a call delta of 0.75.
    """
    def f(k: float) -> float:
        w = float(total_variance(k, theta, p.rho, p.eta, p.gamma))
        sw = np.sqrt(w)
        return float(ndtr(-k / sw + 0.5 * sw)) - delta

    span = 8.0 * np.sqrt(theta) + 0.5
    return float(_brentq(f, -span, span, xtol=1e-12))


def smile_stats(theta: float, T: float, p: SSVIParams) -> dict[str, float]:
    """ATM vol, 25-delta risk reversal and butterfly for one slice, in vol points."""
    def vol(k: float) -> float:
        return float(np.sqrt(total_variance(k, theta, p.rho, p.eta, p.gamma) / T))

    k_c = forward_delta_k(theta, p, 0.25)
    k_p = forward_delta_k(theta, p, 0.75)
    atm, c25, p25 = vol(0.0), vol(k_c), vol(k_p)
    return {
        "atm": atm * 100,
        "rr25": (c25 - p25) * 100,
        "bf25": (0.5 * (c25 + p25) - atm) * 100,
        "call25": c25 * 100,
        "put25": p25 * 100,
        "k_call25": k_c,
        "k_put25": k_p,
    }


def per_expiry(fit: SSVIFit) -> list[dict[str, float]]:
    return [smile_stats(float(th), float(T), fit.params) for th, T in
            zip(fit.theta, fit.T, strict=True)]


def at_tenors(fit: SSVIFit, days: tuple[int, ...] = TENORS_DAYS) -> dict[str, dict[str, float]]:
    """Stats at fixed tenors, with θ interpolated monotonically in T.

    Tenors outside the fitted expiry range are left out rather than extrapolated.
    """
    th = theta_interpolator(fit.T, fit.theta)
    out: dict[str, dict[str, float]] = {}
    for d in days:
        T = d / 365.0
        if fit.T[0] > T or fit.T[-1] < T:
            continue
        out[f"{d}d"] = smile_stats(float(th(T)), T, fit.params)
    return out


def local_vol_grid(
    fit: SSVIFit,
    k: F64 | None = None,
    n_T: int = 24,
    sd_limit: float = 3.0,
) -> dict[str, list[float] | list[list[float | None]]]:
    """Dupire local vol from the SSVI total variance w(k, T):

        σ²_loc(k, T) = ∂w/∂T / g(k),   ∂w/∂T = ∂w/∂θ · θ'(T)

    with g the Durrleman function. Points further than ``sd_limit`` ATM standard
    deviations from the money are left empty: they are extrapolation, not data.
    """
    if k is None:
        k = np.linspace(-0.8, 0.8, 33)
    T = np.geomspace(fit.T[0], fit.T[-1], n_T)
    th_i = theta_interpolator(fit.T, fit.theta)
    th, dth = th_i(T), th_i.derivative()(T)
    p = fit.params
    grid: list[list[float | None]] = []
    for _t, theta, dtheta in zip(T, th, dth, strict=True):
        w, w1, w2, wt = w_derivatives(k, theta, p.rho, p.eta, p.gamma)
        g = durrleman_g(k, w, w1, w2)
        lv2 = wt * dtheta / g
        row: list[float | None] = []
        for kk, v in zip(k, lv2, strict=True):
            ok = np.isfinite(v) and v > 0 and abs(kk) <= sd_limit * np.sqrt(theta)
            row.append(round(float(np.sqrt(v)) * 100, 3) if ok else None)
        grid.append(row)
    return {"k": [round(float(x), 4) for x in k], "T": [round(float(x), 6) for x in T],
            "vol": grid}


def local_vol_point(T_knots: F64, theta_knots: F64, p: SSVIParams, k: float, T: float) -> float:
    """Single local-vol value (in vol units), used by tests."""
    th_i = theta_interpolator(T_knots, theta_knots)
    theta, dtheta = float(th_i(T)), float(th_i.derivative()(T))
    w, w1, w2, wt = w_derivatives(k, theta, p.rho, p.eta, p.gamma)
    g = durrleman_g(k, w, w1, w2)
    return float(np.sqrt(cast(F64, wt * dtheta / g)))
