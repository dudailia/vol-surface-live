"""Collect the real data the film draws, and keep the exact source files beside it.

    cd worker && uv run python ../film/scripts/prepare.py <archive-dir>

<archive-dir> holds what was copied from the worker's volume: bundles/{BTC,ETH}/<day>/*.json
(every five-minute snapshot, three days kept), latest/{BTC,ETH}.json and raw/BTC/<day>/*.parquet.
Writes film/public/data.json (what the film reads) and copies every source file it used into
media/film-data/, named with its timestamp.
"""

from __future__ import annotations

import json
import shutil
import sys
import tarfile
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(sys.argv[1])
OUT = ROOT / "media" / "film-data"
OUT.mkdir(parents=True, exist_ok=True)


def ts(b: dict) -> datetime:
    return datetime.fromisoformat(b["ts"].replace("Z", "+00:00"))


def stamp(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H%MZ")


def r(x: float, n: int = 5) -> float:
    return round(float(x), n)


def surface(b: dict, model: str) -> dict:
    """The parameters the site's lib/ssvi.ts draws a surface from."""
    s = {"T": [r(e["T"], 7) for e in b["expiries"]],
         "theta": [r(e["theta"], 7) for e in b["expiries"]],
         "params": {k: r(b["ssvi"][k], 6) for k in ("rho", "eta", "gamma")}}
    if model == "essvi":
        s["theta"] = [r(x, 7) for x in b["essvi"]["theta"]]
        s["rho"] = [r(x, 6) for x in b["essvi"]["rho"]]
        s["psi"] = [r(x, 6) for x in b["essvi"]["psi"]]
    return s


latest = {c: json.loads((SRC / "latest" / f"{c}.json").read_text()) for c in ("BTC", "ETH")}
btc, eth = latest["BTC"], latest["ETH"]
sel = {c: latest[c]["selection"]["selected"] for c in latest}

# Every five-minute BTC snapshot up to the latest one.
paths = sorted((SRC / "bundles" / "BTC").glob("*/*.json"))
snaps = [json.loads(p.read_text()) for p in paths]
snaps = [s for s in snaps if ts(s) <= ts(btc)]
snaps.sort(key=ts)
first, last = ts(snaps[0]), ts(snaps[-1])
assert last == ts(btc), (last, ts(btc))

# Hourly keyframes for the morph (the snapshot nearest each hour, plus both ends); the
# time-lapse uses SSVI, the one model every snapshot in the window carries.
hours: dict[datetime, dict] = {}
for s in snaps:
    t = ts(s)
    h = t.replace(minute=0, second=0, microsecond=0)
    if t.minute >= 30:
        h = h.replace(hour=h.hour) + pd.Timedelta(hours=1)
    if h not in hours or abs((ts(hours[h]) - h).total_seconds()) > abs((t - h).total_seconds()):
        hours[h] = s
keys = sorted({id(s): s for s in [snaps[0], *hours.values(), snaps[-1]]}.values(), key=ts)

# Raw quotes of the latest snapshot: every listed option, its bid and ask vol.
raw_path = SRC / "raw" / "BTC" / last.strftime("%Y-%m-%d") / f"{last:%H%M}.parquet"
raw = pd.read_parquet(raw_path)
assert pd.Timestamp(raw["ts"].iloc[0]).to_pydatetime() == last
quoted = raw[raw["bid_iv"].notna() & raw["ask_iv"].notna()]
flagged = {q for e in btc["expiries"] for q, f in zip(e["quotes"]["instrument"], e["quotes"]["flags"],
                                                         strict=True) if f}
points = []
for row in quoted.itertuples():
    for iv in (row.bid_iv, row.ask_iv):
        points.append([r(row.k), r(row.T, 7), r(iv), 1 if pd.isna(row.drop_reason) else 0])
rings = [[r(k), r(e["T"], 7), r(m)] for e in btc["expiries"]
         for k, m, f in zip(e["quotes"]["k"], e["quotes"]["mid_iv"], e["quotes"]["flags"], strict=True) if f]


def term(b: dict, model: str) -> list[dict]:
    fits = b["essvi"]["expiries"] if model == "essvi" else b["expiries"]
    return [{"code": e["code"], "days": r(b["expiries"][i]["T"] * 365, 2), "atm": r(f["stats"]["atm"], 2)}
            for i, (e, f) in enumerate(zip(b["expiries"], fits, strict=True))]


def tenors(b: dict, model: str) -> dict:
    return b["essvi"]["tenors"] if model == "essvi" else b["tenors"]


lv = btc["essvi"]["local_vol"] if sel["BTC"] == "essvi" else btc["local_vol"]
lv_vals = [v for row in lv["vol"] for v in row if v is not None]
cmp_path = ROOT / "paper" / "data" / "model-comparison-2026-10-19.json"
cmp = next(x for x in json.loads(cmp_path.read_text()) if x["currency"] == "BTC")

data = {
    "snapshot": {"BTC": btc["ts"], "ETH": eth["ts"]},
    "model": sel,
    "listed": int(len(raw)),
    "quoted": int(len(quoted)),
    "latest": {c: surface(latest[c], sel[c]) for c in latest},
    "latestSsvi": {c: surface(latest[c], "ssvi") for c in latest},
    "points": points,
    "rings": rings,
    "arbMid": sum(btc["arbitrage"]["counts"]["mid"].values()),
    "timelapse": {
        "first": snaps[0]["ts"], "last": snaps[-1]["ts"], "hours": int((last - first).total_seconds() // 3600),
        "keys": [{"ts": s["ts"], **surface(s, "ssvi")} for s in keys],
        "atm30": [[s["ts"], r(s["tenors"]["30d"]["atm"], 2)] for s in snaps],
    },
    "term": {c: term(latest[c], sel[c]) for c in latest},
    "atm30": {c: r(tenors(latest[c], sel[c])["30d"]["atm"], 2) for c in latest},
    "rr25_30": {c: r(tenors(latest[c], sel[c])["30d"]["rr25"], 2) for c in latest},
    "localVol": {"k": lv["k"], "T": lv["T"], "vol": lv["vol"], "lo": r(min(lv_vals), 2), "hi": r(max(lv_vals), 2)},
    "holdout": {"date": "2026-10-19", "snapshots": cmp["snapshots"],
                "essvi": r(cmp["median"]["essvi_holdout"], 4), "ssvi": r(cmp["median"]["ssvi_holdout"], 4)},
}
(ROOT / "film" / "public").mkdir(parents=True, exist_ok=True)
(ROOT / "film" / "public" / "data.json").write_text(json.dumps(data, separators=(",", ":")))

# The exact source files, named by their timestamps.
for c in latest:
    shutil.copy(SRC / "latest" / f"{c}.json", OUT / f"latest-{c}-{stamp(ts(latest[c]))}.json")
shutil.copy(raw_path, OUT / f"raw-BTC-{stamp(last)}.parquet")
shutil.copy(cmp_path, OUT / cmp_path.name)
tar_name = OUT / f"bundles-BTC-5min-{stamp(first)}-{stamp(last)}.tar.gz"
with tarfile.open(tar_name, "w:gz") as tar:
    for p in paths:
        if ts(json.loads(p.read_text())) <= last:
            tar.add(p, arcname=f"bundles/BTC/{p.parent.name}/{p.name}")
shutil.copy(ROOT / "film" / "public" / "data.json", OUT / f"film-data-{stamp(last)}.json")

print(json.dumps({"snapshots": len(snaps), "keys": len(keys), "first": snaps[0]["ts"], "last": snaps[-1]["ts"],
                  "hours": data["timelapse"]["hours"], "points": len(points), "rings": len(rings),
                  "listed": data["listed"], "quoted": data["quoted"], "atm30": data["atm30"],
                  "rr25_30": data["rr25_30"], "lv": [data["localVol"]["lo"], data["localVol"]["hi"]],
                  "holdout": data["holdout"], "arbMid": data["arbMid"], "model": sel}, indent=1))
