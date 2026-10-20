"""End to end on the recorded fixture: snapshot -> clean -> fit -> checks -> bundle."""

import itertools
import json
from pathlib import Path

import jsonschema
import pytest

from volsurf.bundle import Bundle
from volsurf.config import Settings
from volsurf.pipeline import _last_fit, process
from volsurf.snapshot import build_snapshot

SCHEMA = Path(__file__).parents[2] / "schema" / "bundle.schema.json"


@pytest.fixture(params=["BTC", "ETH"])
def bundle(request, payload):
    cur = request.param
    p = payload[cur]
    df = build_snapshot(cur, p["instruments"], p["summaries"], p["server_us"])
    _last_fit.clear()
    b, _, fit = process(cur, df, Settings(), iv_gaps=[0.001, -0.004])
    return b, fit


def test_bundle_is_consistent(bundle):
    b, _fit = bundle
    assert b.ssvi.success and b.ssvi.butterfly_margin >= -1e-9
    assert b.ssvi.min_g >= 0 and b.ssvi.min_dw_dT >= 0
    assert len(b.expiries) >= 6
    Ts = [e.T for e in b.expiries]
    assert Ts == sorted(Ts)
    thetas = [e.theta for e in b.expiries]
    assert all(b2 >= a2 for a2, b2 in itertools.pairwise(thetas))
    assert sum(e.n for e in b.expiries) <= b.cleaning.n_kept
    for e in b.expiries:
        q = e.quotes
        assert len(q.k) == len(q.bid_iv) == len(q.flags) == e.n
        assert all(lo <= hi for lo, hi in zip(q.bid_iv, q.ask_iv, strict=True))
        assert 5 < e.stats.atm < 300
    assert b.iv_check.n == 2 and b.iv_check.max_gap_pts == 0.004
    # eSSVI alongside SSVI, with the evidence for the default.
    e = b.essvi
    assert e is not None and len(e.expiries) == len(b.expiries)
    assert e.min_g >= -1e-9 and e.min_dw_dT >= -1e-12
    assert b.selection is not None and b.selection.selected in ("ssvi", "essvi")
    assert b.selection.selected == ("essvi" if b.selection.essvi < b.selection.ssvi else "ssvi")
    assert {"7d", "30d"} <= set(e.tenors)


def test_bundle_round_trips_and_matches_schema(bundle):
    b, _ = bundle
    data = json.loads(b.model_dump_json())
    assert Bundle.model_validate(data) == b
    jsonschema.validate(data, json.loads(SCHEMA.read_text()))


def test_warm_start_reproduces_cold_fit(payload):
    p = payload["BTC"]
    df = build_snapshot("BTC", p["instruments"], p["summaries"], p["server_us"])
    _last_fit.clear()
    _, _, cold = process("BTC", df, Settings())
    _, _, warm = process("BTC", df, Settings())
    assert warm.objective == pytest.approx(cold.objective, rel=1e-3, abs=1e-9)


def test_holdout_window_is_seeded_from_stored_bundles(tmp_path):
    from datetime import UTC, datetime, timedelta

    from volsurf.pipeline import _holdout, seed_holdout
    from volsurf.store import Store

    st = Store(tmp_path)
    now = datetime.now(UTC)
    for i in range(15):
        ts = now - timedelta(minutes=5 * (15 - i))
        st.write_bundle("BTC", ts, {"ts": ts.isoformat(),
                                    "selection": {"last_ssvi": 1.5 + i, "last_essvi": 1.2 + i}})
    _holdout.clear()
    seed_holdout(st, ("BTC", "ETH"))
    got = list(_holdout["BTC"])
    assert len(got) == 12 and got[-1] == (15.5, 15.2)
    assert len(_holdout["ETH"]) == 0
