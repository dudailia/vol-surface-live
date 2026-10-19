"""HTTP endpoints, Blob publisher and retention."""

import json
from datetime import UTC, datetime, timedelta

import httpx
import pandas as pd
import pytest
from starlette.testclient import TestClient

from volsurf.blob import MONTHLY_BUDGET, BudgetExceededError, Publisher
from volsurf.config import Settings
from volsurf.service import State, build_app, compact_day, prune
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
