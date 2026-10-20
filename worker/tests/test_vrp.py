"""Realized vol and the implied-minus-realized gap."""

import math

import numpy as np
import pytest

from volsurf.vrp import DAY_MS, build_currency, realized_vol

H6 = 6 * 3600 * 1000
T0 = 1_760_000_000_000 - (1_760_000_000_000 % DAY_MS)  # a midnight


def alternating(days: int, a: float = 0.01) -> tuple[np.ndarray, np.ndarray]:
    """Log returns of exactly ±a every six hours."""
    n = days * 4 + 1
    t = T0 + H6 * np.arange(n)
    logp = np.cumsum(np.r_[0.0, a * (-1.0) ** np.arange(n - 1)])
    return t.astype(float), 100.0 * np.exp(logp)


def test_realized_vol_of_known_returns():
    t, p = alternating(60)
    rv = realized_vol(t, p, T0, T0 + 30 * DAY_MS)
    # Σr² = 120 a² over 30 days: σ = a √(4 · 365) exactly.
    assert rv == pytest.approx(0.01 * math.sqrt(4 * 365) * 100, rel=1e-9)


def test_realized_vol_needs_coverage():
    t, p = alternating(60)
    keep = np.ones_like(t, dtype=bool)
    keep[10:40] = False  # drop a week of samples
    assert realized_vol(t[keep], p[keep], T0, T0 + 30 * DAY_MS) is None


def test_gbm_estimate_is_close():
    rng = np.random.default_rng(1)
    sigma, n = 0.6, 400 * 4
    dt = 0.25 / 365
    logp = np.cumsum(np.r_[0.0, sigma * math.sqrt(dt) * rng.standard_normal(n)])
    t = (T0 + H6 * np.arange(n + 1)).astype(float)
    rv = realized_vol(t, 100 * np.exp(logp), T0 + 100 * DAY_MS, T0 + 130 * DAY_MS)
    assert rv == pytest.approx(60.0, rel=0.15)


def test_gaps_and_forward_window():
    t, p = alternating(120)
    index = [[float(a), float(b)] for a, b in zip(t, p, strict=True)]
    days = [T0 + d * DAY_MS for d in range(0, 121)]
    dvol = [[d, 70.0, 71.0, 69.0, 70.5] for d in days]
    now = T0 + 120 * DAY_MS
    c = build_currency("BTC", index, dvol, [[now, 40.0]], [("2026-10-20T01:00Z", 55.0)], now)
    rv = 0.01 * math.sqrt(4 * 365) * 100
    # Trailing realized needs 30 days of history; the gap is DVOL (the open) minus it.
    assert len(c.realized_30d.v) == 121 - 30
    assert c.gap_trailing.v[0] == pytest.approx(70.0 - rv, abs=1e-3)
    # Forward gaps only for days at least 30 days before now.
    assert len(c.gap_forward.v) == 121 - 30
    assert c.forward is not None and c.forward.share_positive == 1.0
    assert c.latest is not None and c.latest.ours_atm30 == 55.0
    assert c.latest.gap == pytest.approx(70.0 - rv, abs=1e-3)
