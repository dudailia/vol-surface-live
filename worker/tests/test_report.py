"""Daily report from stored bundles: units, signs, missing data and publishing."""

import copy
import json
from datetime import UTC, date, datetime, timedelta

import jsonschema
import numpy as np
import pytest

from volsurf.blob import Publisher
from volsurf.config import Settings
from volsurf.pipeline import _last_fit, process
from volsurf.report import Report, build_report, publish
from volsurf.snapshot import build_snapshot
from volsurf.store import Store

from .test_pipeline import SCHEMA

DAY = date(2026, 10, 18)
START = datetime(2026, 10, 18, tzinfo=UTC)


@pytest.fixture(scope="module")
def base_bundles(payload):
    out = {}
    for cur in ("BTC", "ETH"):
        p = payload[cur]
        df = build_snapshot(cur, p["instruments"], p["summaries"], p["server_us"])
        _last_fit.clear()
        b, _, _ = process(cur, df, Settings(), iv_gaps=[0.002])
        out[cur] = b.model_dump(mode="json")
    return out


def scaled(b, ts, theta_scale=1.0):
    """Same surface, re-stamped, with every θ scaled (so ATM vol scales by its root)."""
    x = copy.deepcopy(b)
    # The worker writes "Z" timestamps (pydantic's JSON mode); keep that form here.
    x["ts"] = ts.isoformat().replace("+00:00", "Z")
    for e in x["expiries"]:
        e["theta"] *= theta_scale
    for s in x["tenors"].values():
        s["atm"] *= np.sqrt(theta_scale)
    return x


@pytest.fixture
def store(tmp_path, base_bundles):
    st = Store(tmp_path)
    for cur, b in base_bundles.items():
        # 00:00 on the day, a few intraday snapshots, and 00:00 the next day (+10% var).
        for minutes in (0, 5, 600, 1435):
            ts = START + timedelta(minutes=minutes)
            st.write_bundle(cur, ts, scaled(b, ts))
        end = START + timedelta(days=1)
        st.write_bundle(cur, end, scaled(b, end, 1.1))
    return st


def test_report_changes_have_right_sign_and_units(store, base_bundles):
    r = build_report(store, DAY, now=START + timedelta(days=1, seconds=40))
    assert not r.late
    for cur, cr in r.currencies.items():
        assert cr.previous_ts == START
        assert cr.surface_ts == START + timedelta(days=1)
        assert cr.data.snapshots_received == 4
        base = base_bundles[cur]["tenors"]
        for row in cr.tenors:
            atm0 = base[row.tenor]["atm"]
            assert row.atm_chg == pytest.approx(atm0 * (np.sqrt(1.1) - 1), abs=1e-3)
            # RR and BF are not rescaled by the fake bump in the stored stats.
            assert row.rr25_chg == pytest.approx(0.0, abs=1e-9)
        assert len(cr.biggest_moves) == 5
        assert all(m.change > 0 for m in cr.biggest_moves)
        changes = [abs(m.change) for m in cr.biggest_moves]
        assert changes == sorted(changes, reverse=True)


def test_report_matches_schema_and_flags_late(store):
    r = build_report(store, DAY, now=START + timedelta(days=1, hours=3))
    assert r.late
    jsonschema.validate(json.loads(r.model_dump_json()),
                        json.loads((SCHEMA.parent / "report.schema.json").read_text()))
    assert Report.model_validate_json(r.model_dump_json()) == r


def test_first_day_has_no_changes(tmp_path, base_bundles):
    st = Store(tmp_path)
    b = base_bundles["BTC"]
    for minutes in (600, 1440):
        ts = START + timedelta(minutes=minutes)
        st.write_bundle("BTC", ts, scaled(b, ts))
    r = build_report(st, DAY)
    cr = r.currencies["BTC"]
    assert cr.previous_ts is None and cr.biggest_moves == []
    assert all(t.atm_chg is None for t in cr.tenors)
    assert "ETH" not in r.currencies


def test_publish_without_token_mirrors_locally(store, tmp_path):
    settings = Settings(data_dir=tmp_path)
    r = build_report(store, DAY)
    publish(settings, r, Publisher(tmp_path, token=""))
    pub = tmp_path / "publish"
    assert (pub / "reports" / "2026-10-18.json").exists()
    idx = json.loads((pub / "history" / "index.json").read_text())
    assert [d["date"] for d in idx["days"]["BTC"]] == ["2026-10-18"]
    assert [d["date"] for d in idx["days"]["ETH"]] == ["2026-10-18"]
    assert (pub / "history" / "BTC" / "2026-10-18.json").exists()
    assert json.loads((pub / "reports" / "index.json").read_text())["dates"] == ["2026-10-18"]
