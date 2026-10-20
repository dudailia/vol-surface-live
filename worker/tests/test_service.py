"""HTTP endpoints, Blob publisher and retention."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import pandas as pd
import pytest
from starlette.testclient import TestClient

from volsurf.blob import MONTHLY_BUDGET, BudgetExceededError, Publisher
from volsurf.config import Settings
from volsurf.service import State, build_app, compact_day, hourly_history, prune
from volsurf.store import Store


def test_latest_and_health(tmp_path, monkeypatch):
    monkeypatch.delenv("LATEST_TOKEN", raising=False)
    st = Store(tmp_path)
    now = datetime.now(UTC)
    for c in ("BTC", "ETH"):
        st.write_bundle(c, now, {"ts": now.isoformat(), "currency": c})
    state = State()
    client = TestClient(build_app(Settings(data_dir=tmp_path), state))
    r = client.get("/latest.json")
    assert r.status_code == 200 and r.json()["ETH"]["currency"] == "ETH"
    assert client.get("/healthz").status_code == 503       # nothing recorded yet
    state.last_ok = {"BTC": now, "ETH": now}
    assert client.get("/healthz").json()["ok"] is True
    state.last_ok["ETH"] = now - timedelta(minutes=20)
    assert client.get("/healthz").status_code == 503
    # A restart forgets the in-memory report date; the newest report on disk stands in.
    assert client.get("/healthz").json()["last_report"] is None
    (tmp_path / "reports").mkdir()
    for d in ("2026-10-18", "2026-10-19"):
        (tmp_path / "reports" / f"{d}.json").write_text("{}")
    (tmp_path / "reports" / "index.json").write_text("{}")
    assert client.get("/healthz").json()["last_report"] == "2026-10-19"


def test_token_is_enforced_when_set(tmp_path, monkeypatch):
    monkeypatch.setenv("LATEST_TOKEN", "s3cret")
    client = TestClient(build_app(Settings(data_dir=tmp_path), State()))
    assert client.get("/latest.json").status_code == 401
    ok = client.get("/latest.json", headers={"authorization": "Bearer s3cret"})
    assert ok.status_code == 200


def test_publisher_sends_overwrite_headers_and_respects_budget(tmp_path):
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"url": f"https://x.blob/{req.url.params['pathname']}"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    pub = Publisher(tmp_path, token="tok", client=client)
    url = pub.put_json("reports/a.json", {"a": 1})
    assert url == "https://x.blob/reports/a.json"
    h = seen[0].headers
    assert h["authorization"] == "Bearer tok"
    assert h["x-add-random-suffix"] == "0" and h["x-allow-overwrite"] == "1"
    assert h["x-vercel-blob-access"] == "public"
    month = datetime.now(UTC).strftime("%Y-%m")
    (tmp_path / "blob-uploads.json").write_text(json.dumps({month: MONTHLY_BUDGET}))
    with pytest.raises(BudgetExceededError):
        pub.put_json("reports/b.json", {})
    assert len(seen) == 1


def test_compaction_and_pruning(tmp_path):
    st = Store(tmp_path)
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    df = pd.DataFrame({"ts": [ts], "instrument": ["X"], "bid": [1.0]})
    for m in (0, 5):
        st.write_raw("BTC", ts + timedelta(minutes=m), df, pd.Series([None]))
    compact_day(st, "BTC", "2026-01-01")
    assert not (tmp_path / "raw" / "BTC" / "2026-01-01").exists()
    assert len(pd.read_parquet(tmp_path / "raw-daily" / "BTC" / "2026-01-01.parquet")) == 2
    st.write_bundle("BTC", ts, {"ts": ts.isoformat()})
    prune(st, ts + timedelta(days=200))
    assert not (tmp_path / "bundles" / "BTC" / "2026-01-01").exists()
    assert not (tmp_path / "raw-daily" / "BTC" / "2026-01-01.parquet").exists()


def test_compaction_streams_and_unifies_schemas(tmp_path):
    """A column that is all null in one snapshot and numeric in the next still compacts."""
    st = Store(tmp_path)
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    a = pd.DataFrame({"ts": [ts.isoformat()] * 2, "bid": [None, None], "k": [0.1, 0.2]})
    b = pd.DataFrame({"ts": [(ts + timedelta(hours=1)).isoformat()] * 3, "bid": [1.0, 2.0, None],
                      "k": [0.1, 0.2, 0.3]})
    st.write_raw("BTC", ts, a, pd.Series([None, "no_bid"]))
    st.write_raw("BTC", ts + timedelta(hours=1), b, pd.Series([None, None, None]))
    compact_day(st, "BTC", "2026-01-01")
    out = pd.read_parquet(tmp_path / "raw-daily" / "BTC" / "2026-01-01.parquet")
    assert len(out) == 5 and out["bid"].tolist()[2:4] == [1.0, 2.0]
    assert out["drop_reason"].tolist()[1] == "no_bid"


def test_raw_kept_14_days_and_disk_guard(tmp_path):
    st = Store(tmp_path)
    d = tmp_path / "raw-daily" / "BTC"
    d.mkdir(parents=True)
    today = datetime(2026, 3, 1, tzinfo=UTC)
    for back in (1, 13, 15, 30):
        (d / f"{today - timedelta(days=back):%Y-%m-%d}.parquet").write_bytes(b"x")
    prune(st, today)                      # tmp_path is not a mount point: no disk guard
    assert sorted(p.stem for p in d.glob("*.parquet")) == ["2026-02-16", "2026-02-28"]

    # Over 80% full: the oldest compacted day goes first, until usage is back under.
    usage = iter([(90, 100), (70, 100)])

    class U:
        def __init__(self, used: int, total: int) -> None:
            self.used, self.total = used, total

    prune(st, today, disk_usage=lambda _: U(*next(usage)))
    assert [p.stem for p in d.glob("*.parquet")] == ["2026-02-28"]


def test_hourly_history_picks_the_snapshot_nearest_each_hour(tmp_path):
    st = Store(tmp_path)
    now = datetime(2026, 10, 20, 3, 7, tzinfo=UTC)
    base = {"index_price": 1.0, "ssvi": {"rho": 0.0, "eta": 1.0, "gamma": 0.5}, "expiries": []}
    # Server time can read a second early: 00:59:59 stands for the 01:00 run.
    stamps = ["2026-10-20T00:54:59", "2026-10-20T00:59:59", "2026-10-20T01:04:59",
              "2026-10-20T01:59:58", "2026-10-20T02:31:00", "2026-10-19T23:59:59"]
    for s in stamps:
        ts = datetime.fromisoformat(s).replace(tzinfo=UTC)
        st.write_bundle("BTC", ts, {**base, "ts": ts.isoformat()})
    got = [h["ts"][:19] for h in hourly_history(st, "BTC", now=now)]
    # 00:00 from 23:59:59, 01:00 from 00:59:59, 02:00 from 01:59:58; 02:31 is no hour's.
    assert got == ["2026-10-19T23:59:59", "2026-10-20T00:59:59", "2026-10-20T01:59:58"]


def test_vrp_route_needs_token_and_a_computed_file(tmp_path, monkeypatch):
    monkeypatch.setenv("LATEST_TOKEN", "s3cret")
    client = TestClient(build_app(Settings(data_dir=tmp_path), State()))
    auth = {"authorization": "Bearer s3cret"}
    assert client.get("/vrp.json").status_code == 401
    assert client.get("/vrp.json", headers=auth).status_code == 404
    (tmp_path / "vrp.json").write_text(json.dumps({"version": 1, "currencies": {}}))
    r = client.get("/vrp.json", headers=auth)
    assert r.status_code == 200 and r.json()["version"] == 1


def test_ours_series_reads_30_day_atm_from_saved_surfaces():
    from volsurf.vrp import ours_series

    theta = [0.36**2 * t for t in (0.02, 0.05, 0.1, 0.3)]
    Ts = (0.02, 0.05, 0.1, 0.3)
    c = {"ts": "2026-10-20T01:59:58.1Z",
         "expiries": [{"T": t, "theta": th} for t, th in zip(Ts, theta, strict=True)]}
    [(ts, v)] = ours_series([c])
    assert ts == "2026-10-20T01:59Z"
    assert v == pytest.approx(36.0, abs=0.05)  # flat ATM vol: θ = σ²T throughout


def test_hourly_raw_keeps_on_the_hour_snapshots(tmp_path):
    import io

    from volsurf.report import hourly_raw
    st = Store(tmp_path)
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    for m in (0, 5, 60, 124):
        t = ts + timedelta(minutes=m)
        df = pd.DataFrame({"ts": [t.isoformat()], "k": [float(m)]})
        st.write_raw("BTC", t, df, pd.Series([None]))
    got = pd.read_parquet(io.BytesIO(hourly_raw(st, "BTC", "2026-01-01") or b""))
    assert got["k"].tolist() == [0.0, 60.0, 124.0]      # 02:04 is in the hour's first 5 minutes
    compact_day(st, "BTC", "2026-01-01")                       # and the same from the compacted day
    again = pd.read_parquet(io.BytesIO(hourly_raw(st, "BTC", "2026-01-01") or b""))
    assert again["k"].tolist() == [0.0, 60.0, 124.0]
