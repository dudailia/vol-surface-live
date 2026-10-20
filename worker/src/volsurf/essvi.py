"""Extended SSVI (Hendriks and Martini, 2019): SSVI with its own skew ρ for each expiry.

Each expiry i has three numbers: θ_i (at-the-money total variance), ρ_i (skew) and
ψ_i = θ_i φ_i (the at-the-money slope scale). Its slice is the SSVI slice

    w(k) = θ/2 · [1 + ρφk + √((φk + ρ)² + 1 − ρ²)],   φ = ψ/θ

Conditions enforced in the fit:

* Butterflies, per slice (Gatheral and Jacquier 2014, Thm 4.2, written in ψ):
  ψ(1 + |ρ|) < 4 and ψ²(1 + |ρ|) ≤ 4θ.
* Calendar spreads, between consecutive slices: θ and ψ never fall, and
  |ρ_{i+1}ψ_{i+1} − ρ_iψ_i| ≤ ψ_{i+1} − ψ_i. The last says both wings' asymptotic slopes,
  ψ(1 ± ρ)/2, are non-decreasing in maturity; with θ non-decreasing it is the condition
  Hendriks and Martini give for consecutive eSSVI slices not to cross.

Between expiries, θ follows a monotone cubic in T and ψ and p = ρψ are interpolated
linearly in θ. Linear interpolation keeps the calendar condition (it is preserved by
convex combinations), and every fit is also checked numerically on a grid.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import PchipInterpolator
from scipy.optimize import minimize

from .ssvi import RHO_MAX, THETA_MIN, SliceData, SSVIFit, durrleman_g, phi

F64 = NDArray[np.float64]


def slice_w(k: Any, theta: float, rho: float, psi: float) -> F64:
    k_ = np.asarray(k, dtype=np.float64)
    f = psi / theta
    z = f * k_ + rho
    return cast(F64, 0.5 * theta * (1.0 + rho * f * k_ + np.sqrt(z * z + 1.0 - rho * rho)))


def slice_derivs(k: Any, theta: float, rho: float, psi: float) -> tuple[F64, F64, F64]:
    k_ = np.asarray(k, dtype=np.float64)
    f = psi / theta
    z = f * k_ + rho
    s = np.sqrt(z * z + 1.0 - rho * rho)
    w = 0.5 * theta * (1.0 + rho * f * k_ + s)
    w1 = 0.5 * theta * (rho * f + f * z / s)
    w2 = 0.5 * theta * f * f * (1.0 - rho * rho) / s**3
    return cast(F64, w), cast(F64, w1), cast(F64, w2)


def butterfly_margins(theta: F64, rho: F64, psi: F64) -> tuple[F64, F64]:
    """4 − ψ(1+|ρ|) and 4θ − ψ²(1+|ρ|): both must be ≥ 0 (the first strictly)."""
    a = 1.0 + np.abs(rho)
    return cast(F64, 4.0 - psi * a), cast(F64, 4.0 * theta - psi * psi * a)


def calendar_margins(theta: F64, rho: F64, psi: F64) -> tuple[F64, F64, F64]:
    """Δθ, Δψ − (Δ ρψ) and Δψ + (Δ ρψ) between consecutive slices: all must be ≥ 0."""
    p = rho * psi
    dpsi, dp = np.diff(psi), np.diff(p)
    return cast(F64, np.diff(theta)), cast(F64, dpsi - dp), cast(F64, dpsi + dp)


@dataclass
class ESSVIFit:
    T: F64
    theta: F64
    rho: F64
    psi: F64
    rmse_vol_pts: F64
    inside_spread: F64
    n: NDArray[np.int64]
    success: bool
    message: str
    objective: float
    min_g: float = float("nan")
    min_dw_dT: float = float("nan")
    extra: dict[str, Any] = field(default_factory=dict)

    def w(self, k: Any, i: int) -> F64:
        return slice_w(k, float(self.theta[i]), float(self.rho[i]), float(self.psi[i]))

    def iv(self, k: Any, i: int) -> F64:
        return cast(F64, np.sqrt(self.w(k, i) / self.T[i]))

    def slice_at(self, T: float) -> tuple[float, float, float]:
        """(θ, ρ, ψ) at any T inside the fitted range."""
        th = float(theta_curve(self.T, self.theta)(T))
        return (th, *interp_rho_psi(self.theta, self.rho, self.psi, th))


def theta_curve(T: F64, theta: F64) -> PchipInterpolator:
    return PchipInterpolator(np.concatenate([[0.0], T]), np.concatenate([[0.0], theta]),
                             extrapolate=False)


def interp_rho_psi(theta: F64, rho: F64, psi: F64, th: float) -> tuple[float, float]:
    """ψ and p = ρψ linear in θ between knots (flat outside); returns (ρ, ψ)."""
    p = rho * psi
    ps = float(np.interp(th, theta, psi))
    pp = float(np.interp(th, theta, p))
    return pp / ps, ps


def from_ssvi(fit: SSVIFit) -> ESSVIFit:
    """An SSVI fit written as eSSVI slices (same ρ everywhere, ψ = θφ(θ))."""
    p = fit.params
    psi = fit.theta * phi(fit.theta, p.eta, p.gamma)
    return ESSVIFit(T=fit.T, theta=fit.theta, rho=np.full_like(fit.theta, p.rho), psi=psi,
                    rmse_vol_pts=fit.rmse_vol_pts, inside_spread=fit.inside_spread, n=fit.n,
                    success=fit.success, message=fit.message, objective=fit.objective,
                    min_g=fit.min_g, min_dw_dT=fit.min_dw_dT)


def _unpack(x: F64, n: int) -> tuple[F64, F64, F64]:
    theta = np.cumsum(x[:n])
    psi = np.cumsum(x[n:2 * n])
    rho = x[2 * n:3 * n]
    return cast(F64, theta), cast(F64, rho), cast(F64, psi)


def fit_essvi(slices: list[SliceData], start: ESSVIFit, max_iter: int = 500) -> ESSVIFit:
    """Fit θ_i, ρ_i, ψ_i under the conditions above, starting from ``start``.

    Start from the SSVI fit (``from_ssvi``): it satisfies every eSSVI condition, so the
    eSSVI objective can only be lower or equal.
    """
    n = len(slices)
    T = np.array([s.T for s in slices])
    ks = [s.k for s in slices]
    ws = [s.weight / s.weight.sum() for s in slices]
    sizes = np.array([len(k) for k in ks])
    k_all = np.concatenate(ks)
    iv_all = np.concatenate([s.iv for s in slices])
    wt_all = np.concatenate(ws) / n
    idx = np.repeat(np.arange(n), sizes)
    T_all = T[idx]

    def objective(x: F64) -> float:
        theta, rho, psi = _unpack(x, n)
        f = psi[idx] / theta[idx]
        r = rho[idx]
        z = f * k_all + r
        w = 0.5 * theta[idx] * (1.0 + r * f * k_all + np.sqrt(z * z + 1.0 - r * r))
        model = np.sqrt(np.maximum(w, 1e-12) / T_all)
        d = model - iv_all
        return float(np.sum(wt_all * d * d))

    def constraints(x: F64) -> F64:
        theta, rho, psi = _unpack(x, n)
        a = 1.0 + rho
        b = 1.0 - rho
        _, c1, c2 = calendar_margins(theta, rho, psi)
        return cast(F64, np.concatenate([
            4.0 - psi * a - 1e-9, 4.0 - psi * b - 1e-9,          # ψ(1+|ρ|) < 4
            4.0 * theta - psi * psi * a, 4.0 * theta - psi * psi * b,  # ψ²(1+|ρ|) ≤ 4θ
            c1, c2,                                              # wing slopes never fall
        ]))

    th0 = np.maximum.accumulate(np.maximum(start.theta, THETA_MIN))
    ps0 = np.maximum.accumulate(np.maximum(start.psi, 1e-6))
    x0 = np.concatenate([np.diff(th0, prepend=0.0), np.diff(ps0, prepend=0.0), start.rho])
    bounds = ([(THETA_MIN, None)] + [(0.0, None)] * (n - 1)
              + [(1e-6, None)] + [(0.0, None)] * (n - 1)
              + [(-RHO_MAX, RHO_MAX)] * n)
    res = minimize(objective, x0, method="SLSQP", bounds=bounds,
                   constraints=[{"type": "ineq", "fun": constraints}],
                   options={"maxiter": max_iter, "ftol": 1e-14})
    x = res.x if np.all(constraints(res.x) >= -1e-9) and res.fun <= objective(x0) else x0
    theta, rho, psi = _unpack(x, n)

    rmse = np.empty(n)
    inside = np.full(n, np.nan)
    for i, s in enumerate(slices):
        model = np.sqrt(slice_w(s.k, theta[i], rho[i], psi[i]) / s.T)
        rmse[i] = np.sqrt(np.mean((model - s.iv) ** 2)) * 100.0
        if s.bid_iv is not None and s.ask_iv is not None:
            inside[i] = float(np.mean((model >= s.bid_iv) & (model <= s.ask_iv)))
    fit = ESSVIFit(T=T, theta=theta, rho=rho, psi=psi, rmse_vol_pts=cast(F64, rmse),
                   inside_spread=cast(F64, inside), n=sizes.astype(np.int64),
                   success=bool(res.success), message=str(res.message),
                   objective=float(objective(x)))
    fit.min_g, fit.min_dw_dT = surface_checks(fit)
    return fit


def surface_checks(fit: ESSVIFit, k_max: float = 1.5, n_k: int = 301,
                   n_T: int = 60) -> tuple[float, float]:
    """Min Durrleman g(k) and min ∂w/∂T over a grid that includes interpolated slices."""
    k = np.linspace(-k_max, k_max, n_k)
    Ts = np.unique(np.concatenate([fit.T, np.geomspace(fit.T[0], fit.T[-1], n_T)]))
    g_min = np.inf
    W = []
    for T in Ts:
        th, rho, psi = fit.slice_at(float(T))
        w, w1, w2 = slice_derivs(k, th, rho, psi)
        g_min = min(g_min, float(durrleman_g(k, w, w1, w2).min()))
        W.append(w)
    dW = np.diff(np.array(W), axis=0)
    return g_min, float(dW.min()) if len(dW) else 0.0
