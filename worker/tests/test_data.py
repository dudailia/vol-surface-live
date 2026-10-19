"""Snapshot building, cleaning rules and the IV cross-check against Deribit's tickers."""

import numpy as np
import pandas as pd
import pytest

from volsurf.black import black_price
from volsurf.clean import classify, clean, drop_counts
from volsurf.config import CleanConfig
from volsurf.snapshot import build_snapshot
from volsurf.validate import compare_ticker


def row(**kw):
    base = dict(instrument="X", expiry_code="E", strike=100.0, is_call=True, F=90.0, T=0.25,
                bid=0.02, ask=0.022, bid_iv=0.50, ask_iv=0.52)
    base.update(kw)
    return base


def reasons(*rows):
    return classify(pd.DataFrame(list(rows))).tolist()


def test_each_rule_fires():
    assert reasons(
        row(),                                    # OTM call, fine
        row(T=1 / 365),                           # short expiry
        row(strike=80.0),                         # ITM call
        row(is_call=False, strike=100.0),         # ITM put (K > F)
        row(bid=0.0),                             # no bid
        row(bid=np.nan),                          # no bid
        row(ask=0.0),                             # no ask
        row(bid=0.03, ask=0.03),                  # crossed (equal)
        row(bid_iv=np.nan),                       # iv fail
        row(bid_iv=0.40, ask_iv=0.60),            # wide in vol
        row(bid=0.01, ask=0.03, bid_iv=0.5, ask_iv=0.55),  # wide in price (100% of mid)
    ) == [None, "short_expiry", "itm", "itm", "no_bid", "no_bid", "no_ask", "crossed",
          "iv_fail", "wide_spread", "wide_spread"]


def test_first_matching_reason_wins():
    # Short expiry and no bid: reported once, as the first rule.
    assert reasons(row(T=0.001, bid=0.0)) == ["short_expiry"]


def test_thresholds_come_from_config():
    df = pd.DataFrame([row(bid_iv=0.40, ask_iv=0.50)])
    assert classify(df, CleanConfig(max_iv_spread=0.15)).tolist() == [None]
    assert classify(df, CleanConfig(max_iv_spread=0.05)).tolist() == ["wide_spread"]


def test_drop_log_and_counts():
    df = pd.DataFrame([row(), row(bid=0.0), row(strike=80.0)])
    kept, dropped = clean(df)
    assert len(kept) == 1
    assert dropped["reason"].tolist() == ["no_bid", "itm"]
    assert dropped["kind"].tolist() == ["quality", "selection"]
    counts = drop_counts(dropped)
    assert counts["no_bid"] == 1 and counts["itm"] == 1 and counts["crossed"] == 0


@pytest.mark.parametrize("cur", ["BTC", "ETH"])
def test_snapshot_from_fixture(payload, cur):
    p = payload[cur]
    df = build_snapshot(cur, p["instruments"], p["summaries"], p["server_us"])
    assert len(df) == len(p["summaries"])
    assert (df["T"] > 0).all()
    assert np.allclose(df["k"], np.log(df["strike"] / df["F"]))
    q = df[(df["bid"] > 0) & (df["T"] > 2 / 365)]
    # Our bid IV reprices the coin bid on the forward.
    ok = q["bid_iv"].notna()
    back = black_price(q.F[ok], q.strike[ok], q["T"][ok], q.bid_iv[ok], q.is_call[ok]) / q.F[ok]
    np.testing.assert_allclose(back, q.bid[ok], rtol=1e-7)
    kept, _ = clean(df)
    assert len(kept) > 100
    assert ((kept.ask_iv - kept.bid_iv) <= 0.15).all()


@pytest.mark.parametrize("cur", ["BTC", "ETH"])
def test_iv_matches_deribit_tickers(payload, cur):
    """Our Black-76 inversion reproduces Deribit's published bid/ask IV to 0.1 vol pt.

    Only quotes that pass our spread rule are compared. One- and two-tick quotes far out
    of the money (e.g. 0.0001/0.0002 ETH) can differ by several vol points, because a
    sliver of price moves the IV a lot there; the cleaning step drops those anyway.
    """
    p = payload[cur]
    meta = {i["instrument_name"]: i for i in p["instruments"]}
    gaps = []
    for t in p["tickers"]:
        b, a = t["best_bid_price"], t["best_ask_price"]
        if not (b and a) or (a - b) / (0.5 * (a + b)) > CleanConfig().max_rel_spread:
            continue
        m = meta[t["instrument_name"]]
        gaps += compare_ticker(t, float(m["strike"]), m["expiration_timestamp"],
                               m["option_type"] == "call").values()
    assert len(gaps) >= 15
    assert max(abs(g) for g in gaps) < 0.1
