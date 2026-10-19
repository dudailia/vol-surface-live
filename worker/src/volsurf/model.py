"""Glue between a cleaned snapshot and the SSVI fit."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .black import black_greeks
from .ssvi import SliceData

MIN_QUOTES = 5
# Spreads tighter than this do not earn extra weight (0.5 vol pt).
MIN_SPREAD = 0.005


def quote_weights(g: pd.DataFrame) -> np.ndarray:
    """Vega over spread: tight, at-the-money quotes count most."""
    vega = black_greeks(g["F"], g["strike"], g["T"], g["mid_iv"], g["is_call"])["vega"]
    spread = np.maximum((g["ask_iv"] - g["bid_iv"]).to_numpy(), MIN_SPREAD)
    w = np.asarray(vega / vega.max() / spread, dtype=float)
    return w


def build_slices(kept: pd.DataFrame) -> tuple[list[SliceData], list[str], list[str]]:
    """One slice per expiry with enough quotes on both sides of the money.

    Returns the slices, their expiry codes and the codes skipped (too few quotes).
    """
    slices, codes, skipped = [], [], []
    for code, g in kept.groupby("expiry_code", sort=False):
        g = g.sort_values("k")
        k = g["k"].to_numpy()
        if len(g) < MIN_QUOTES or k.min() >= 0 or k.max() <= 0:
            skipped.append(str(code))
            continue
        slices.append(SliceData(
            T=float(g["T"].mean()), k=k, iv=g["mid_iv"].to_numpy(), weight=quote_weights(g),
            bid_iv=g["bid_iv"].to_numpy(), ask_iv=g["ask_iv"].to_numpy()))
        codes.append(str(code))
    order = np.argsort([s.T for s in slices])
    return [slices[i] for i in order], [codes[i] for i in order], skipped
