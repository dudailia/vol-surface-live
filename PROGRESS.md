# Progress

## Phase 1: data (done 2026-10-19)

- `worker/src/volsurf/deribit.py`: public REST client with a token bucket (5 req/s), retries with backoff on HTTP 429, 5xx, Deribit error 10028 and transport errors. Each run makes about 24 requests per currency (2 data calls plus a 10-ticker IV check, with instruments re-fetched every run).
- `snapshot.py`: joins `get_instruments` and `get_book_summary_by_currency`. IVs come from Black-76 on Deribit's forward with r = 0. Coin prices are converted to USD with that forward, which is Deribit's own convention.
- `black.py`: vectorised safeguarded Newton inversion. In-the-money quotes are inverted through their out-of-the-money twin, because direct inversion was ill-conditioned (found by a property test).
- `clean.py`: rules run in order. Selection rules come first (`short_expiry` < 2 days, `itm`), then quality rules (`no_bid`, `no_ask`, `crossed`, `below_intrinsic`, `iv_fail`, `wide_spread` > 15 vol pts or > 50% of mid). Every dropped row keeps its reason, and the counts are published.
- `store.py`: zstd Parquet per currency per snapshot, with the drop reason as a column.

**Verification**
- Our bid/ask IVs match Deribit's ticker `bid_iv`/`ask_iv` to within 0.005 vol pt, which is Deribit's 2-decimal rounding.
- In a live sample of 60 clean BTC quotes, 59 matched that closely. One (BTC-25DEC26-72000-P) differed by 0.44 pt: Deribit's own `ask_iv` disagreed with its own ask price and forward. The bundle reports median, max and the count above 0.1 pt, so outliers are visible.

**Measured sizes**
- About 47 KB of Parquet per currency per snapshot. At full resolution that is about 26 MB a day for both currencies after daily compaction; hourly-thinned it is about 2.2 MB a day.

**Live run**
- 12 snapshots were scheduled over an hour. Between 13:34 and 14:45 local time the laptop's network dropped (`httpx.ConnectTimeout`). Retries worked, one currency failing did not stop the other, and runs recovered when the network came back.

## Phase 2: model (done 2026-10-19)

- `ssvi.py`: SSVI with power-law φ.
  - θ is fitted as cumulative non-negative increments, so there is no calendar arbitrage (Thm 4.1). The second condition of Thm 4.1 holds automatically for the power law; the proof is in the docstring.
  - SLSQP enforces η(1+|ρ|) ≤ 2 and γ ∈ (0, 0.5] (Cor. 4.1), plus both Thm 4.2 inequalities at every fitted θ.
  - The objective is IV error against the bid/ask mid, weighted by vega over spread with each expiry counting equally. It never fits Deribit's `mark_iv`.
  - Each fit warm-starts from the previous one, with three cold starts as fallback.
  - After fitting, Durrleman g(k) and ∂w/∂T are checked on a grid.
- `arbitrage.py`: raw-quote checks for vertical spreads, butterflies and calendars, each at mid ("mid-quote violation") and at executable bid/ask ("tradeable at quoted prices"). Results are stored as per-quote bit flags and a list of violations.
- `derived.py`:
  - ATM term structure √(θ/T);
  - 25-delta RR and BF using forward delta (not premium-adjusted);
  - fixed tenors from a PCHIP θ(T), with no extrapolation;
  - Dupire local vol from analytic SSVI derivatives, blank beyond 3 ATM standard deviations.
- `bundle.py`: a pydantic bundle, with JSON Schema exported to `schema/bundle.schema.json`.

**Live result, BTC 2026-10-19 17:21 UTC**
- 9 expiries; ρ = −0.20, η = 0.92, γ = 0.49.
- RMSE by expiry was 0.5 to 3.5 vol pts. Every expiry has its RMSE published.
- The fit runs in under 0.1 s per currency.
- **Open issue:** a single global ρ underfits the deep put wing on some expiries (up to about 16 vol pts at k = −0.86 on 25DEC26). Extended SSVI (ρ per expiry, Hendriks and Martini 2019) would fix this while keeping the no-arbitrage conditions. It is not done, because the brief specifies SSVI; it is listed as a limitation.

## Phase 3: daily report (code done 2026-10-19; first real report after deploy)

- `report.py` covers the 24 hours to 00:00 UTC:
  - ATM, RR and BF at 7/30/60/90/180 days with 24h changes;
  - the five biggest moves on a tenor x {10P, 25P, ATM, 25C, 10C} grid;
  - an arbitrage tally across the day's snapshots;
  - fit quality and data counts.
  It is marked `late` if written more than 15 minutes after midnight.
- `blob.py`: Vercel Blob HTTP API, with headers matching `@vercel/blob` 2.8.2. It keeps a monthly budget of 600 uploads, against Hobby's 2,000 limit and its 30-day lockout.
- `service.py`:
  - APScheduler runs snapshots at every :00/:05 and the daily job at 00:00:40.
  - A catch-up job writes any missed report on start.
  - Starlette serves `/latest.json`, `/history.json` (hourly for the last 48h) and `/healthz` (503 if data is older than 15 minutes).
- Retention:
  - Fly volume: full 5-minute raw compacted daily, kept 180 days; per-snapshot bundles kept 3 days.
  - Blob: daily report, full end-of-day bundle, history index, and hourly-thinned raw Parquet. That is about 7 uploads a day.
- `Dockerfile` and `fly.toml` are written (lhr, shared-cpu-1x, 512 MB, volume at /data, never auto-stopped).

**Tests:** 52 passing. They cover:
- Black-76 vs QuantLib to 1e-10, plus Hull and finite differences;
- SSVI parameter recovery to 1e-4;
- constraints holding on random surfaces;
- arbitrage checks firing on broken inputs;
- local vol in the flat and closed-form cases;
- report signs and units;
- schemas, endpoints, Blob headers and budget, and retention.

ruff and mypy --strict are clean.

## Phase 4: front end (in progress)
