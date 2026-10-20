"""Daily report: the 24 hours to 00:00 UTC, built only from stored snapshot bundles."""

from __future__ import annotations

import io
import json
import logging
import os
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from .blob import Publisher
from .bundle import ViolationOut
from .clean import QUALITY_REASONS, SELECTION_REASONS
from .config import CURRENCIES, Settings
from .derived import TENORS_DAYS, delta_k, essvi_slice, ssvi_slice, theta_interpolator
from .essvi import interp_rho_psi, theta_curve
from .ssvi import SSVIParams
from .store import Store

log = logging.getLogger(__name__)

REPORT_VERSION = 1
SNAPSHOTS_PER_DAY = 288
# How far from the target time a snapshot may be and still stand in for it.
MATCH_WINDOW = timedelta(minutes=30)
# Points on the smile for "biggest moves": put deltas as call deltas (25P = 0.75).
GRID_POINTS: tuple[tuple[str, float | None], ...] = (
    ("10P", 0.90), ("25P", 0.75), ("ATM", None), ("25C", 0.25), ("10C", 0.10))


class TenorRow(BaseModel):
    tenor: str
    atm: float
    atm_chg: float | None
    rr25: float
    rr25_chg: float | None
    bf25: float
    bf25_chg: float | None


class Move(BaseModel):
    tenor: str
    point: str = Field(description="10P, 25P, ATM, 25C or 10C (forward delta)")
    vol: float
    change: float = Field(description="vol points over 24 hours")


class ArbExample(ViolationOut):
    ts: datetime


class ArbDay(BaseModel):
    snapshots_checked: int
    snapshots_with_mid: int
    snapshots_with_tradeable: int
    totals: dict[str, dict[str, int]]
    largest: list[ArbExample]


class FitDay(BaseModel):
    rmse_median: float
    rmse_max: float
    inside_spread_median: float | None
    worst_expiry: str
    worst_expiry_rmse: float


class DataDay(BaseModel):
    snapshots_expected: int
    snapshots_received: int
    quotes_raw_median: float
    quotes_kept_median: float
    dropped_total: dict[str, int]
    iv_check_max_gap_pts: float | None


class VrpAtReport(BaseModel):
    """Implied against realized at the report's end (00:00 UTC), from the worker's vrp.json."""

    date: str
    dvol: float
    realized_30d: float | None
    gap: float | None


class CurrencyReport(BaseModel):
    currency: str
    model: str = Field(default="ssvi", description="surface model behind the tenor stats, "
                                                    "moves and fit numbers")
    surface_ts: datetime
    previous_ts: datetime | None
    index_price: float
    index_change_pct: float | None
    rho: float
    tenors: list[TenorRow]
    biggest_moves: list[Move]
    arbitrage: ArbDay
    fit: FitDay
    data: DataDay
    vrp: VrpAtReport | None = None


class Report(BaseModel):
    version: int = REPORT_VERSION
    date: date
    period_start: datetime
    period_end: datetime
    generated_at: datetime
    late: bool
    currencies: dict[str, CurrencyReport]


def surface(b: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, SSVIParams]:
    T = np.array([e["T"] for e in b["expiries"]])
    th = np.array([e["theta"] for e in b["expiries"]])
    s = b["ssvi"]
    return T, th, SSVIParams(s["rho"], s["eta"], s["gamma"])


def report_model(start: dict[str, Any] | None, end: dict[str, Any]) -> str:
    """eSSVI when both ends of the day carry it, so changes compare like with like."""
    return "essvi" if end.get("essvi") and (start is None or start.get("essvi")) else "ssvi"


def tenors_of(b: dict[str, Any], model: str) -> dict[str, Any]:
    return dict(b["essvi"]["tenors"] if model == "essvi" else b["tenors"])


def slice_fn(b: dict[str, Any], model: str, t: float) -> tuple[float, Any]:
    """θ at T and the slice w(k) of the chosen model."""
    T, th, p = surface(b)
    if model == "essvi":
        e = b["essvi"]
        theta_e = np.array(e["theta"])
        theta = float(theta_curve(T, theta_e)(t))
        rho, psi = interp_rho_psi(theta_e, np.array(e["rho"]), np.array(e["psi"]), theta)
        return theta, essvi_slice(theta, rho, psi)
    theta = float(theta_interpolator(T, th)(t))
    return theta, ssvi_slice(theta, p)


def grid_vols(b: dict[str, Any], model: str = "ssvi") -> dict[tuple[str, str], float]:
    """Vol (points) at each fixed tenor x delta point covered by the bundle's expiries."""
    T, _, _ = surface(b)
    out: dict[tuple[str, str], float] = {}
    for d in TENORS_DAYS:
        t = d / 365.0
        if t < T[0] or t > T[-1]:
            continue
        theta, w = slice_fn(b, model, t)
        for name, delta in GRID_POINTS:
            k = 0.0 if delta is None else delta_k(w, theta, delta)
            out[(f"{d}d", name)] = float(np.sqrt(w(k) / t)) * 100
    return out


def _pick(bundles: list[dict[str, Any]], target: datetime) -> dict[str, Any] | None:
    best = min(bundles, key=lambda b: abs(_ts(b) - target), default=None)
    if best is None or abs(_ts(best) - target) > MATCH_WINDOW:
        return None
    return best


def _ts(b: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(b["ts"])


def _chg(a: float, b: float | None) -> float | None:
    return None if b is None else round(a - b, 4)


def currency_report(
    currency: str,
    day: list[dict[str, Any]],
    end: dict[str, Any],
    start: dict[str, Any] | None,
) -> CurrencyReport:
    """``day``: every bundle in the period; ``end``/``start``: surfaces at its two ends."""
    model = report_model(start, end)
    rows = []
    for tenor, s in tenors_of(end, model).items():
        prev = tenors_of(start, model).get(tenor) if start else None
        rows.append(TenorRow(
            tenor=tenor,
            atm=round(s["atm"], 4), atm_chg=_chg(s["atm"], prev and prev["atm"]),
            rr25=round(s["rr25"], 4), rr25_chg=_chg(s["rr25"], prev and prev["rr25"]),
            bf25=round(s["bf25"], 4), bf25_chg=_chg(s["bf25"], prev and prev["bf25"]),
        ))

    moves: list[Move] = []
    if start is not None:
        g1, g0 = grid_vols(end, model), grid_vols(start, model)
        for key in g1.keys() & g0.keys():
            moves.append(Move(tenor=key[0], point=key[1], vol=round(g1[key], 4),
                              change=round(g1[key] - g0[key], 4)))
        moves.sort(key=lambda m: -abs(m.change))
        moves = moves[:5]

    totals = {lvl: {"vertical": 0, "butterfly": 0, "calendar": 0}
              for lvl in ("mid", "tradeable")}
    examples: list[ArbExample] = []
    with_mid = with_trade = 0
    for b in day:
        c = b["arbitrage"]["counts"]
        for lvl in totals:
            for kind in totals[lvl]:
                totals[lvl][kind] += c[lvl][kind]
        with_mid += any(c["mid"].values())
        with_trade += any(c["tradeable"].values())
        examples += [ArbExample(**v, ts=_ts(b)) for v in b["arbitrage"]["violations"]]
    examples.sort(key=lambda v: (v.level != "tradeable", -v.size_usd))

    def fitted(b: dict[str, Any]) -> list[dict[str, Any]]:
        return list(b["essvi"]["expiries"] if model == "essvi" and b.get("essvi")
                    else b["expiries"])

    rmse = [(e["rmse_vol_pts"], e["code"]) for e in fitted(end)]
    all_rmse = [e["rmse_vol_pts"] for b in day for e in fitted(b)]
    inside = [e["inside_spread"] for b in day for e in fitted(b)
              if e["inside_spread"] is not None]
    worst = max(rmse)
    dropped = {r: sum(b["cleaning"]["dropped"].get(r, 0) for b in day)
               for r in (*SELECTION_REASONS, *QUALITY_REASONS)}
    gaps = [b["iv_check"]["max_gap_pts"] for b in day if b["iv_check"]["max_gap_pts"] is not None]

    return CurrencyReport(
        currency=currency,
        model=model,
        surface_ts=_ts(end),
        previous_ts=_ts(start) if start else None,
        index_price=end["index_price"],
        index_change_pct=(round((end["index_price"] / start["index_price"] - 1) * 100, 4)
                          if start else None),
        rho=round(end["ssvi"]["rho"], 4),
        tenors=rows,
        biggest_moves=moves,
        arbitrage=ArbDay(snapshots_checked=len(day), snapshots_with_mid=with_mid,
                         snapshots_with_tradeable=with_trade, totals=totals,
                         largest=examples[:10]),
        fit=FitDay(rmse_median=round(float(np.median(all_rmse)), 4),
                   rmse_max=round(float(np.max(all_rmse)), 4),
                   inside_spread_median=(round(float(np.median(inside)), 4) if inside
                                         else None),
                   worst_expiry=worst[1], worst_expiry_rmse=round(worst[0], 4)),
        data=DataDay(
            snapshots_expected=SNAPSHOTS_PER_DAY, snapshots_received=len(day),
            quotes_raw_median=float(np.median([b["cleaning"]["n_raw"] for b in day])),
            quotes_kept_median=float(np.median([b["cleaning"]["n_kept"] for b in day])),
            dropped_total=dropped,
            iv_check_max_gap_pts=round(max(gaps), 4) if gaps else None),
    )


def vrp_at(store: Store, currency: str, at: datetime) -> VrpAtReport | None:
    """DVOL and trailing realized vol at ``at`` from the worker's hourly vrp.json, if kept."""
    p = store.root / "vrp.json"
    if not p.exists():
        return None
    c = json.loads(p.read_text()).get("currencies", {}).get(currency)
    if not c:
        return None
    key = at.strftime("%Y-%m-%dT%H:%MZ")
    dv = dict(zip(c["dvol"]["t"], c["dvol"]["v"], strict=False))
    rv = dict(zip(c["realized_30d"]["t"], c["realized_30d"]["v"], strict=False))
    if key not in dv:
        return None
    r = rv.get(key)
    return VrpAtReport(date=key, dvol=round(dv[key], 3),
                       realized_30d=None if r is None else round(r, 3),
                       gap=None if r is None else round(dv[key] - r, 3))


def build_report(store: Store, day: date, now: datetime | None = None) -> Report:
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    end = start + timedelta(days=1)
    now = now or datetime.now(UTC)
    out: dict[str, CurrencyReport] = {}
    for cur in CURRENCIES:
        paths = [*store.bundle_paths(cur, f"{start:%Y-%m-%d}"),
                 *store.bundle_paths(cur, f"{end:%Y-%m-%d}")]
        bundles = [store.read_bundle(p) for p in paths]
        in_day = [b for b in bundles if start <= _ts(b) < end]
        b_end = _pick(bundles, end)
        if b_end is None or not in_day:
            log.warning("no bundles to report for %s on %s", cur, day)
            continue
        # The previous day's end-of-day surface may live in yesterday's folder.
        prev = bundles + [store.read_bundle(p) for p in
                          store.bundle_paths(cur, f"{start - timedelta(days=1):%Y-%m-%d}")]
        out[cur] = currency_report(cur, in_day, b_end, _pick(prev, start))
        out[cur].vrp = vrp_at(store, cur, end)
    return Report(date=day, period_start=start, period_end=end, generated_at=now,
                  late=now - end > timedelta(minutes=15), currencies=out)


def compact_surface(b: dict[str, Any]) -> dict[str, Any]:
    """What the history slider needs to draw and morph a past surface (about 1 KB)."""
    return {
        "ts": b["ts"],
        "index_price": b["index_price"],
        "ssvi": {k: b["ssvi"][k] for k in ("rho", "eta", "gamma")},
        "expiries": [{"code": e["code"], "T": e["T"], "theta": e["theta"],
                      "atm": e["stats"]["atm"]} for e in b["expiries"]],
        **({"essvi": {k: b["essvi"][k] for k in ("theta", "rho", "psi")},
            "selected": b["selection"]["selected"]} if b.get("essvi") and b.get("selection")
           else {}),
    }


def hourly_raw(store: Store, cur: str, day: str) -> bytes | None:
    """The day's raw quotes thinned to the on-the-hour snapshots, as zstd Parquet."""
    df = store.read_raw_day(cur, day)
    compacted = store.root / "raw-daily" / cur / f"{day}.parquet"
    if df.empty and compacted.exists():
        df = pd.read_parquet(compacted)
    if df.empty:
        return None
    ts = pd.to_datetime(df["ts"], utc=True)
    keep = df[ts.dt.minute < 5]
    buf = io.BytesIO()
    keep.to_parquet(buf, compression="zstd", index=False)
    return buf.getvalue()


def _remote(rel: str) -> dict[str, Any] | None:
    """A published JSON file from the archive (BLOB_BASE_URL), or None."""
    base = os.environ.get("BLOB_BASE_URL")
    if not base:
        return None
    try:
        r = httpx.get(f"{base.rstrip('/')}/{rel}", timeout=10)
        data: dict[str, Any] | None = r.json() if r.status_code == 200 else None
        return data
    except (httpx.HTTPError, ValueError):
        return None


def publish(settings: Settings, report: Report, pub: Publisher | None = None) -> None:
    """About 7 uploads a day: report, report index, per-currency history and raw files."""
    store = Store(settings.data_dir)
    pub = pub or Publisher(settings.data_dir)
    day = f"{report.date:%Y-%m-%d}"
    data = report.model_dump(mode="json")
    local = settings.data_dir / "reports" / f"{day}.json"
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_text(json.dumps(data, indent=1))
    pub.put_json(f"reports/{day}.json", data, max_age=86400)

    idx_path = settings.data_dir / "publish" / "history" / "index.json"
    # A fresh volume has no local copy of the archive's indexes: start from the published
    # ones so earlier days are never dropped.
    index: dict[str, Any] = (json.loads(idx_path.read_text()) if idx_path.exists()
                             else _remote("history/index.json")
                             or {"version": 1, "days": {c: [] for c in CURRENCIES}})
    for cur, cr in report.currencies.items():
        end_day = f"{cr.surface_ts:%Y-%m-%d}"
        p = store.bundle_paths(cur, end_day)
        # Compare instants, not strings: bundles write "Z", parsed reports "+00:00".
        target = next((x for x in p if _ts(store.read_bundle(x)) == cr.surface_ts), None)
        if target is None:
            continue
        b = store.read_bundle(target)
        pub.put_json(f"history/{cur}/{day}.json", b, max_age=86400)
        days = [d for d in index["days"].get(cur, []) if d["date"] != day]
        days.append({"date": day, **compact_surface(b)})
        index["days"][cur] = sorted(days, key=lambda d: d["date"])
        raw = hourly_raw(store, cur, day)
        if raw is not None:
            pub.put(f"raw/{cur}/{day}.parquet", raw, "application/vnd.apache.parquet",
                    max_age=86400)
    pub.put_json("history/index.json", index, max_age=300)

    remote = _remote("reports/index.json") or {}
    reports = sorted({p.stem for p in (settings.data_dir / "reports").glob("*.json")}
                     | set(remote.get("dates", [])))
    pub.put_json("reports/index.json", {"version": 1, "dates": reports}, max_age=300)


def run_report(settings: Settings, day_str: str, publish_it: bool = False) -> Report:
    report = build_report(Store(settings.data_dir), date.fromisoformat(day_str))
    if publish_it:
        publish(settings, report)
    return report
