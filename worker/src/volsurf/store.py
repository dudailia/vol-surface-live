"""Parquet archive on local disk (the Fly volume in production)."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


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

    def raw_day_files(self, currency: str, day: str) -> list[Path]:
        """The day's five-minute raw files, oldest first."""
        return sorted((self.root / "raw" / currency / day).glob("*.parquet"))

    def read_raw_day(self, currency: str, day: str) -> pd.DataFrame:
        files = self.raw_day_files(currency, day)
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


def unified_schema(files: Sequence[Path]) -> pa.Schema:
    """One schema for files written snapshot by snapshot (an all-null column reads as null)."""
    return pa.unify_schemas([pq.read_schema(f).remove_metadata() for f in files])


def row_groups(path: Path) -> Iterable[pa.Table]:
    pf = pq.ParquetFile(path)
    for i in range(pf.num_row_groups):
        yield pf.read_row_group(i)


def write_tables(tables: Iterable[pa.Table], schema: pa.Schema, sink: str | Path | pa.NativeFile,
                 keep: Callable[[pd.DataFrame], pd.DataFrame] | None = None) -> int:
    """Write tables one after another into one zstd Parquet file; returns the row count.

    Only one table is in memory at a time, so a day of five-minute files fits a small machine.
    """
    rows = 0
    with pq.ParquetWriter(sink, schema, compression="zstd") as w:
        for t in tables:
            if keep is not None:
                t = pa.Table.from_pandas(keep(t.to_pandas()), preserve_index=False)
            if t.num_rows == 0:
                continue
            cols = [t.column(f.name).cast(f.type) if f.name in t.column_names
                    else pa.nulls(t.num_rows, f.type) for f in schema]
            w.write_table(pa.Table.from_arrays(cols, schema=schema))
            rows += t.num_rows
    return rows
