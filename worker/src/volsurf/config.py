"""All tunable numbers in one place. The methods section on the page prints these."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

CURRENCIES: tuple[str, ...] = ("BTC", "ETH")
YEAR_SECONDS = 365.0 * 24 * 3600


@dataclass(frozen=True)
class CleanConfig:
    # Expiries closer than this are dropped: total variance is tiny and quotes are noisy.
    min_days: float = 2.0
    # Bid/ask IV spread above this (in vol, 0.15 = 15 vol points) is "wide".
    max_iv_spread: float = 0.15
    # Price spread above this fraction of the mid is "wide".
    max_rel_spread: float = 0.5


@dataclass(frozen=True)
class FetchConfig:
    base_url: str = "https://www.deribit.com/api/v2/public/"
    # Well under Deribit's public limits; we make about 25 requests per 5-minute run.
    rate_per_s: float = 5.0
    burst: int = 5
    timeout_s: float = 10.0
    max_retries: int = 5
    ticker_sample: int = 10


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("VOLSURF_DATA", "data")))
    clean: CleanConfig = field(default_factory=CleanConfig)
    fetch: FetchConfig = field(default_factory=FetchConfig)
