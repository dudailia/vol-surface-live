"""SSVI (Gatheral and Jacquier, 2014) with a power-law phi, fitted under no-arbitrage constraints.

    w(k, θ) = θ/2 · [1 + ρ φ(θ) k + sqrt((φ(θ) k + ρ)² + 1 − ρ²)]
    φ(θ)    = η θ^(−γ) (1 + θ)^(γ − 1)

w is total implied variance σ²T at log-moneyness k = ln(K/F), and θ_t = w(0, θ_t) is the
at-the-money total variance of expiry t.

No-arbitrage conditions enforced in the fit:

* Calendar spreads (Thm 4.1): θ_t must not fall with t. We fit θ as cumulative sums of
  non-negative increments. For the power-law φ with 0 < γ < 1 the second condition of
  Thm 4.1, 0 ≤ ∂θ(θφ) ≤ (1 + sqrt(1 − ρ²)) φ / ρ², holds automatically: ∂θ(θφ) =
  (1 − γ) η θ^(−γ) (1 + θ)^(γ − 2), which is positive and below φ.
* Butterflies (Thm 4.2, sufficient): θφ(θ)(1 + |ρ|) < 4 and θφ(θ)²(1 + |ρ|) ≤ 4 for all θ.
  For the power law with γ ∈ (0, 1/2], η(1 + |ρ|) ≤ 2 is enough (Remark 4.4 / Cor. 4.1);
  we impose that and the two Thm 4.2 inequalities at every fitted θ.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, cast

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.optimize import minimize

F64 = NDArray[np.float64]

GAMMA_MAX = 0.5
GAMMA_MIN = 1e-3
RHO_MAX = 0.999
THETA_MIN = 1e-6


def _a(x: ArrayLike) -> F64:
    return cast(F64, np.asarray(x, dtype=np.float64))


def phi(theta: ArrayLike, eta: float, gamma: float) -> F64:
    t = _a(theta)
    return cast(F64, eta * t ** (-gamma) * (1.0 + t) ** (gamma - 1.0))


def dphi_dtheta(theta: ArrayLike, eta: float, gamma: float) -> F64:
    t = _a(theta)
    return cast(F64, phi(t, eta, gamma) * (-gamma / t + (gamma - 1.0) / (1.0 + t)))


def total_variance(k: ArrayLike, theta: ArrayLike, rho: float, eta: float, gamma: float) -> F64:
    k_, t = _a(k), _a(theta)
    p = phi(t, eta, gamma)
    z = p * k_ + rho
    return 0.5 * t * (1.0 + rho * p * k_ + np.sqrt(z * z + 1.0 - rho * rho))


def w_derivatives(
    k: ArrayLike, theta: ArrayLike, rho: float, eta: float, gamma: float
) -> tuple[F64, F64, F64, F64]:
    """w, ∂w/∂k, ∂²w/∂k² and ∂w/∂θ (at fixed k), all analytic."""
    k_, t = _a(k), _a(theta)
    p = phi(t, eta, gamma)
    z = p * k_ + rho
    s = np.sqrt(z * z + 1.0 - rho * rho)
    w = 0.5 * t * (1.0 + rho * p * k_ + s)
    w1 = 0.5 * t * (rho * p + p * z / s)
    w2 = 0.5 * t * p * p * (1.0 - rho * rho) / s**3
    dp = dphi_dtheta(t, eta, gamma)
    wt = w / t + 0.5 * t * (rho * k_ * dp + z * k_ * dp / s)
    return w, w1, w2, wt


def durrleman_g(k: ArrayLike, w: ArrayLike, w1: ArrayLike, w2: ArrayLike) -> F64:
    """g(k) ≥ 0 everywhere is equivalent to no butterfly arbitrage in one slice."""
    k_, w_, a, b = _a(k), _a(w), _a(w1), _a(w2)
    return cast(F64, (1.0 - k_ * a / (2.0 * w_)) ** 2 - a * a / 4.0 * (1.0 / w_ + 0.25) + b / 2.0)


@dataclass(frozen=True)
class SSVIParams:
    rho: float
    eta: float
    gamma: float

    def butterfly_margin(self) -> float:
        """2 − η(1 + |ρ|): non-negative means the power-law corollary holds."""
        return 2.0 - self.eta * (1.0 + abs(self.rho))


def thm42_margins(theta: ArrayLike, p: SSVIParams) -> tuple[F64, F64]:
    """4 − θφ(1+|ρ|) and 4 − θφ²(1+|ρ|), each must be ≥ 0 (first strictly)."""
    t = _a(theta)
    ph = phi(t, p.eta, p.gamma)
    a = 1.0 + abs(p.rho)
    return 4.0 - t * ph * a, 4.0 - t * ph * ph * a


@dataclass
class SliceData:
    """Market quotes for one expiry, in the units the fit uses."""

    T: float
    k: F64
    iv: F64  # mid implied vol
    weight: F64  # relative weights within the slice (normalised inside the fit)
    bid_iv: F64 | None = None
    ask_iv: F64 | None = None


@dataclass
class SSVIFit:
    T: F64
    theta: F64
    params: SSVIParams
    rmse_vol_pts: F64
    inside_spread: F64  # share of quotes where the fit lies within bid/ask IV
    n: NDArray[np.int64]
    success: bool
    message: str
    objective: float
    min_g: float = float("nan")
    min_dw_dT: float = float("nan")
    extra: dict[str, Any] = field(default_factory=dict)

    def w(self, k: ArrayLike, i: int) -> F64:
        p = self.params
        return total_variance(k, self.theta[i], p.rho, p.eta, p.gamma)

    def iv(self, k: ArrayLike, i: int) -> F64:
        return cast(F64, np.sqrt(self.w(k, i) / self.T[i]))


def atm_total_variance(sl: SliceData) -> float:
    """Market ATM total variance by linear interpolation of mid IV in k at k = 0."""
    order = np.argsort(sl.k)
    k, iv = sl.k[order], sl.iv[order]
    s = float(np.interp(0.0, k, iv)) if k[0] <= 0 <= k[-1] else float(iv[np.argmin(np.abs(k))])
    return s * s * sl.T


def _unpack(x: F64, n: int) -> tuple[F64, SSVIParams]:
    theta = np.cumsum(x[:n])
    return cast(F64, theta), SSVIParams(rho=float(x[n]), eta=float(x[n + 1]),
                                        gamma=float(x[n + 2]))


def fit_ssvi(
    slices: list[SliceData],
    *,
    start: tuple[F64, SSVIParams] | None = None,
    max_iter: int = 500,
) -> SSVIFit:
    """Fit θ per expiry plus global (ρ, η, γ) by weighted least squares in implied vol.

    ``slices`` must be sorted by T. ``start`` warm-starts from a previous fit (θ per
    slice and params); otherwise we try a few cold starts from market ATM variance.
    """
    if not slices:
        raise ValueError("no slices to fit")
    n = len(slices)
    T = np.array([s.T for s in slices])
    if np.any(np.diff(T) <= 0):
        raise ValueError("slices must be sorted by strictly increasing T")

    ks = [s.k for s in slices]
    ivs = [s.iv for s in slices]
    ws = [s.weight / s.weight.sum() for s in slices]
    # Each slice counts equally; within a slice, quotes count by their weight.
    sizes = np.array([len(k) for k in ks])
    k_all = np.concatenate(ks)
    iv_all = np.concatenate(ivs)
    wt_all = np.concatenate(ws) / n
    idx = np.repeat(np.arange(n), sizes)
    T_all = T[idx]

    def objective(x: F64) -> float:
        theta, p = _unpack(x, n)
        w = total_variance(k_all, theta[idx], p.rho, p.eta, p.gamma)
        model = np.sqrt(np.maximum(w, 1e-12) / T_all)
        r = model - iv_all
        return float(np.sum(wt_all * r * r))

    def constraints(x: F64) -> F64:
        theta, p = _unpack(x, n)
        a, b = thm42_margins(theta, p)
        return cast(F64, np.concatenate([
            [2.0 - p.eta * (1.0 + p.rho), 2.0 - p.eta * (1.0 - p.rho)],
            a - 1e-9,
            b,
        ]))

    bounds = [(THETA_MIN, None)] + [(0.0, None)] * (n - 1) + [
        (-RHO_MAX, RHO_MAX), (1e-6, 2.0), (GAMMA_MIN, GAMMA_MAX)]

    starts: list[F64] = []
    if start is not None:
        th0, p0 = start
        th0 = np.maximum.accumulate(np.maximum(_a(th0), THETA_MIN))
        starts.append(np.concatenate([np.diff(th0, prepend=0.0),
                                      [p0.rho, p0.eta, p0.gamma]]))
    th_mkt = np.maximum.accumulate(np.maximum([atm_total_variance(s) for s in slices],
                                              THETA_MIN))
    d0 = np.diff(th_mkt, prepend=0.0)
    for rho0 in (0.0, -0.3, 0.3):
        starts.append(np.concatenate([d0, [rho0, 0.8, 0.4]]))

    best = None
    for x0 in starts:
        res = minimize(objective, x0, method="SLSQP", bounds=bounds,
                       constraints=[{"type": "ineq", "fun": constraints}],
                       options={"maxiter": max_iter, "ftol": 1e-14})
        feasible = bool(np.all(constraints(res.x) >= -1e-9))
        if feasible and (best is None or res.fun < best.fun):
            best = res
        if start is not None and res.success and feasible:
            break  # a good warm start is enough
    if best is None:
        raise RuntimeError("SSVI fit found no feasible solution")

    theta, p = _unpack(best.x, n)
    rmse = np.empty(n)
    inside = np.full(n, np.nan)
    for i, s in enumerate(slices):
        model = np.sqrt(total_variance(s.k, theta[i], p.rho, p.eta, p.gamma) / s.T)
        rmse[i] = np.sqrt(np.mean((model - s.iv) ** 2)) * 100.0
        if s.bid_iv is not None and s.ask_iv is not None:
            inside[i] = float(np.mean((model >= s.bid_iv) & (model <= s.ask_iv)))
    fit = SSVIFit(T=T, theta=theta, params=p, rmse_vol_pts=cast(F64, rmse),
                  inside_spread=cast(F64, inside),
                  n=sizes.astype(np.int64), success=bool(best.success),
                  message=str(best.message), objective=float(best.fun))
    fit.min_g, fit.min_dw_dT = surface_checks(fit)
    return fit


def surface_checks(fit: SSVIFit, k_max: float = 1.5, n_k: int = 301) -> tuple[float, float]:
    """Numerical check of the fitted surface on a grid: min g(k) and min ∂w/∂T."""
    k = np.linspace(-k_max, k_max, n_k)
    p = fit.params
    g_min = np.inf
    for th in fit.theta:
        w, w1, w2, _ = w_derivatives(k, th, p.rho, p.eta, p.gamma)
        g_min = min(g_min, float(durrleman_g(k, w, w1, w2).min()))
    W = np.array([total_variance(k, th, p.rho, p.eta, p.gamma) for th in fit.theta])
    dW = np.diff(W, axis=0) if len(fit.theta) > 1 else np.zeros((1, n_k))
    return g_min, float(dW.min())
