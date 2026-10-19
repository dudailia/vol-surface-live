"""Parquet archive on local disk (the Fly volume in production)."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


class Store:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _stamp_dir(self, kind: str, currency: str, ts: datetime) -> Path:
        d = self.root / kind / currency / ts.strftime("%Y-%m-%d")
        d.mkdir(parents=True, exist_ok=True)
        return d

    def write_raw(self, currency: str, ts: datetime, df: pd.DataFrame,
                  reasons: pd.Series) -> Path:
        """One file per currency per snapshot: every quote, with its drop reason (or null)."""
        out = df.copy()
        out["drop_reason"] = reasons.astype("string")
        path = self._stamp_dir("raw", currency, ts) / f"{ts:%H%M}.parquet"
        out.to_parquet(path, compression="zstd", index=False)
        return path

    def write_bundle(self, currency: str, ts: datetime, bundle: dict[str, Any]) -> Path:
        """The JSON bundle the page reads. Kept per snapshot for history and reports."""
        path = self._stamp_dir("bundles", currency, ts) / f"{ts:%H%M}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(bundle, separators=(",", ":")))
        tmp.replace(path)
        latest = self.root / "latest" / f"{currency}.json"
        latest.parent.mkdir(parents=True, exist_ok=True)
        tmp = latest.with_suffix(".tmp")
        tmp.write_text(json.dumps(bundle, separators=(",", ":")))
        tmp.replace(latest)
        return path

    def read_raw_day(self, currency: str, day: str) -> pd.DataFrame:
        d = self.root / "raw" / currency / day
        files = sorted(d.glob("*.parquet"))
        if not files:
            return pd.DataFrame()
        return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)

    def bundle_paths(self, currency: str, day: str) -> list[Path]:
        return sorted((self.root / "bundles" / currency / day).glob("*.json"))

    def read_bundle(self, path: Path) -> dict[str, Any]:
        data: dict[str, Any] = json.loads(path.read_text())
        return data

    def latest_bundle(self, currency: str) -> dict[str, Any] | None:
        p = self.root / "latest" / f"{currency}.json"
        return self.read_bundle(p) if p.exists() else None
