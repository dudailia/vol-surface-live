"""Synthetic SSVI surfaces for tests."""

import numpy as np

from volsurf.ssvi import SliceData, SSVIParams, total_variance

T_GRID = np.array([4, 11, 25, 53, 88, 151, 249, 340]) / 365.0


def theta_curve(T, atm=(0.55, 0.62)):
    """ATM vol rising from atm[0] to atm[1] across the grid; θ = σ²T is increasing."""
    sig = np.interp(T, [T.min(), T.max()], atm)
    return sig**2 * T


def make_slices(params: SSVIParams, T=T_GRID, n_k=25, noise=0.0, spread=0.01, seed=0):
    rng = np.random.default_rng(seed)
    theta = theta_curve(T)
    slices = []
    for t, th in zip(T, theta, strict=True):
        half = 2.5 * np.sqrt(th)
        k = np.linspace(-half, half, n_k)
        iv = np.sqrt(total_variance(k, th, params.rho, params.eta, params.gamma) / t)
        iv_obs = iv + noise * rng.standard_normal(n_k)
        slices.append(SliceData(T=float(t), k=k, iv=iv_obs, weight=np.ones(n_k),
                                bid_iv=iv_obs - spread / 2, ask_iv=iv_obs + spread / 2))
    return slices, theta
