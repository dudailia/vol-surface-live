"""Black-76 pricing, Greeks and implied volatility on a forward, vectorised.

Deribit quotes option prices in coin. The USD premium is the coin price times the
forward of that expiry (Deribit's ``underlying_price``), and Deribit computes its own
implied vols from Black-76 on that forward with zero rates. We do the same so our bid
and ask IVs line up with theirs.
"""

from __future__ import annotations

from typing import cast

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.special import ndtr

F64 = NDArray[np.float64]

_SQRT_2PI = np.sqrt(2.0 * np.pi)


def _arr(x: ArrayLike) -> F64:
    return cast(F64, np.asarray(x, dtype=np.float64))


def norm_pdf(x: ArrayLike) -> F64:
    x = _arr(x)
    return cast(F64, np.exp(-0.5 * x * x) / _SQRT_2PI)


def _d1_d2(F: F64, K: F64, T: F64, sigma: F64) -> tuple[F64, F64]:
    s = sigma * np.sqrt(T)
    d1 = (np.log(F / K) + 0.5 * s * s) / s
    return d1, d1 - s


def black_price(
    F: ArrayLike,
    K: ArrayLike,
    T: ArrayLike,
    sigma: ArrayLike,
    is_call: ArrayLike,
    df: ArrayLike = 1.0,
) -> F64:
    """Undiscounted Black-76 price times the discount factor ``df``."""
    F_, K_, T_, s_ = _arr(F), _arr(K), _arr(T), _arr(sigma)
    call = np.asarray(is_call, dtype=bool)
    d1, d2 = _d1_d2(F_, K_, T_, s_)
    c = F_ * ndtr(d1) - K_ * ndtr(d2)
    p = K_ * ndtr(-d2) - F_ * ndtr(-d1)
    return cast(F64, _arr(df) * np.where(call, c, p))


def black_greeks(
    F: ArrayLike,
    K: ArrayLike,
    T: ArrayLike,
    sigma: ArrayLike,
    is_call: ArrayLike,
    df: ArrayLike = 1.0,
) -> dict[str, F64]:
    """Greeks of the Black-76 price with respect to the forward.

    delta and gamma are with respect to F, vega is per unit of vol (not per vol point),
    theta is dV/dt with calendar time running forward (so -dV/dT) per year, holding df
    fixed.
    """
    F_, K_, T_, s_, D = _arr(F), _arr(K), _arr(T), _arr(sigma), _arr(df)
    call = np.asarray(is_call, dtype=bool)
    d1, _ = _d1_d2(F_, K_, T_, s_)
    sqrtT = np.sqrt(T_)
    pdf = norm_pdf(d1)
    delta = D * np.where(call, ndtr(d1), ndtr(d1) - 1.0)
    gamma = D * pdf / (F_ * s_ * sqrtT)
    vega = D * F_ * pdf * sqrtT
    theta = -D * F_ * pdf * s_ / (2.0 * sqrtT)
    return {"delta": delta, "gamma": gamma, "vega": vega, "theta": theta}


def implied_vol(
    price: ArrayLike,
    F: ArrayLike,
    K: ArrayLike,
    T: ArrayLike,
    is_call: ArrayLike,
    *,
    lo: float = 1e-4,
    hi: float = 10.0,
    tol: float = 1e-10,
    max_iter: int = 100,
) -> F64:
    """Implied vol from an undiscounted Black-76 price.

    Safeguarded Newton: each step keeps a bracket [lo, hi] that contains the root and
    falls back to bisection whenever Newton would leave it. Prices outside the
    no-arbitrage bounds (below intrinsic, above the upper bound) return NaN.
    """
    P, F_, K_, T_ = np.broadcast_arrays(_arr(price), _arr(F), _arr(K), _arr(T))
    call = np.broadcast_to(np.asarray(is_call, dtype=bool), P.shape)
    P, F_, K_, T_ = (a.astype(np.float64).copy() for a in (P, F_, K_, T_))

    intrinsic = np.where(call, np.maximum(F_ - K_, 0.0), np.maximum(K_ - F_, 0.0))
    upper = np.where(call, F_, K_)
    valid = (
        np.isfinite(P) & (intrinsic < P) & (upper > P) & (T_ > 0) & (F_ > 0) & (K_ > 0)
    )

    out = np.full(P.shape, np.nan)
    if not valid.any():
        return out

    p, f, k, t, c = P[valid], F_[valid], K_[valid], T_[valid], call[valid]
    # Invert the out-of-the-money twin (same vol by put-call parity). Deep in-the-money
    # prices are mostly intrinsic value, which makes the inversion ill-conditioned.
    itm = np.where(c, k < f, k > f)
    p = np.where(itm, p - intrinsic[valid], p)
    c = np.where(itm, ~c, c)
    a = np.full(p.shape, lo)
    b = np.full(p.shape, hi)
    # Below lo or above hi there is no root in the bracket we accept.
    f_lo = black_price(f, k, t, a, c) - p
    f_hi = black_price(f, k, t, b, c) - p
    inside = (f_lo < 0) & (f_hi > 0)

    # Starting point: Brenner-Subrahmanyam style ATM guess, clipped to the bracket.
    x = np.clip(np.sqrt(2.0 * np.pi / t) * p / f, 0.05, 2.0)
    done = ~inside
    for _ in range(max_iter):
        if done.all():
            break
        val = black_price(f, k, t, x, c) - p
        # Exact price match: stop before a zero Newton step lands on the bracket edge.
        done |= val == 0
        neg = val < 0
        a = np.where(neg & ~done, x, a)
        b = np.where(~neg & ~done, x, b)
        vega = black_greeks(f, k, t, x, c)["vega"]
        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            step = val / vega
        x_new = x - step
        bad = ~np.isfinite(x_new) | (x_new <= a) | (x_new >= b)
        x_new = np.where(bad, 0.5 * (a + b), x_new)
        conv = (np.abs(x_new - x) < tol) | (b - a < tol)
        x = np.where(done, x, x_new)
        done |= conv

    res = np.where(inside, x, np.nan)
    out[valid] = res
    return out
