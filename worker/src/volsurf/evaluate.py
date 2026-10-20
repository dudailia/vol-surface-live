"""Offline comparison of SSVI and eSSVI on archived raw snapshots.

    uv run python -m volsurf.evaluate <raw-daily.parquet> [...] --out results.json

For every snapshot in the files: rebuild the cleaned slices from the stored drop reasons,
fit both models on all quotes (in-sample error, share inside bid-ask) and again with every
fifth quote held out (out-of-sample error).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .essvi import fit_essvi, from_ssvi
from .model import build_slices, holdout_rmse, split_holdout
from .ssvi import fit_ssvi


def evaluate_snapshot(kept: pd.DataFrame) -> dict[str, float]:
    slices, _, _ = build_slices(kept)
    s = fit_ssvi(slices)
    e = fit_essvi(slices, from_ssvi(s))
    train, test = split_holdout(slices)
    hs = fit_ssvi(train, start=(s.theta, s.params))
    he = fit_essvi(train, from_ssvi(hs))
    return {
        "ssvi_holdout": holdout_rmse(hs.iv, test),
        "essvi_holdout": holdout_rmse(he.iv, test),
        "ssvi_rmse_median": float(np.median(s.rmse_vol_pts)),
        "essvi_rmse_median": float(np.median(e.rmse_vol_pts)),
        "ssvi_inside_median": float(np.nanmedian(s.inside_spread)),
        "essvi_inside_median": float(np.nanmedian(e.inside_spread)),
        "essvi_min_g": e.min_g,
        "essvi_min_dw_dT": e.min_dw_dT,
    }


def evaluate_file(path: Path) -> dict[str, Any]:
    raw = pd.read_parquet(path)
    rows: list[dict[str, Any]] = []
    for ts, snap in raw.groupby("ts"):
        kept = snap[snap["drop_reason"].isna()]
        r: dict[str, Any] = dict(evaluate_snapshot(kept))
        r["ts"] = pd.Timestamp(str(ts)).isoformat()
        rows.append(r)
    df = pd.DataFrame(rows)
    summary = {k: round(float(df[k].median()), 4) for k in df.columns if k != "ts"}
    summary["essvi_better_holdout_share"] = round(
        float((df["essvi_holdout"] < df["ssvi_holdout"]).mean()), 4)
    summary["min_essvi_min_g"] = round(float(df["essvi_min_g"].min()), 4)
    summary["min_essvi_min_dw_dT"] = float(df["essvi_min_dw_dT"].min())
    return {"file": path.name, "currency": str(raw["currency"].iloc[0]), "snapshots": len(df),
            "first": rows[0]["ts"], "last": rows[-1]["ts"], "median": summary, "rows": rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    results = [evaluate_file(f) for f in args.files]
    args.out.write_text(json.dumps(results, indent=1))
    for r in results:
        print(r["currency"], r["snapshots"], r["first"], r["last"], json.dumps(r["median"]))


if __name__ == "__main__":
    main()
