# vol-surface-live

A live implied-volatility surface for Bitcoin and Ether options, built from Deribit's free public API. Every five minutes a worker pulls every listed option, cleans the quotes, fits an SSVI surface under no-arbitrage constraints, checks the raw quotes for static arbitrage, and publishes the result. Each day at 00:00 UTC it writes a JSON report of what changed.

Live page: https://vol.iliaduda.com

## Why

An implied-volatility surface is the standard way to read an options market: one picture of how much movement is priced, at which strikes and for which dates. Building one from real quotes means dealing with stale and crossed markets, solving implied vols correctly, fitting a model that cannot produce arbitrage, and being clear about where the model does not fit. This project does all of that in the open, with tests, on data anyone can check.

## How it works

```
Deribit public REST ──► worker (Python, Fly.io, London)
                          every 5 min: fetch → clean → implied vol → SSVI fit → arbitrage checks → bundle
                          Parquet archive on a volume; /latest.json and /history.json over HTTP
                          00:00 UTC: daily report, end-of-day surface and raw quotes ──► Vercel Blob
web (Next.js, Vercel) ──► reads the worker through a 60-second cache, and the archive from Blob
```

### Data

- `get_book_summary_by_currency` (one call per currency) gives bid, ask and mark price, mark IV, the forward for each expiry, open interest and volume for every option. `get_instruments` gives strikes and exact expiry times.
- Implied vols are solved from bid and ask prices with Black-76 on Deribit's forward at zero rates, which is Deribit's own convention. Coin prices are converted to USD with that forward.
- Each run also fetches ten `ticker` responses and compares our IVs with Deribit's published `bid_iv` and `ask_iv`. They agree to Deribit's two-decimal rounding (0.005 vol points), apart from the occasional ticker whose IV disagrees with its own price; those are counted in every bundle.
- About two dozen requests per currency per run, with a 5 requests per second token bucket and backoff on rate-limit errors.

### Cleaning

Each quote gets the first reason that applies, and every dropped quote keeps its reason:

| Rule | Kind |
|---|---|
| Expiry less than 2 days away | selection |
| In the money (the fit uses out-of-the-money options) | selection |
| No bid / no ask | quality |
| Bid at or above ask | quality |
| Bid at or below intrinsic value | quality |
| Implied vol could not be solved | quality |
| Spread wider than 15 vol points or 50% of mid | quality |

Thresholds live in `worker/src/volsurf/config.py`, and the page prints them from the data.

### Model

SSVI (Gatheral and Jacquier, 2014) with a power-law φ:

```
w(k, θ) = θ/2 · [1 + ρφk + √((φk + ρ)² + 1 − ρ²)]
φ(θ)    = η θ^(−γ) (1 + θ)^(γ − 1)
```

`w` is total implied variance σ²T at log-moneyness k = ln(K/F). Each expiry has its own θ (its at-the-money total variance); ρ, η and γ are shared.

- **No calendar arbitrage:** θ is fitted as cumulative non-negative increments, so it never falls with expiry (Theorem 4.1). For the power-law φ with 0 < γ < 1 the theorem's second condition holds automatically; the proof is in the `ssvi.py` docstring.
- **No butterfly arbitrage:** η(1 + |ρ|) ≤ 2 with 0 < γ ≤ ½ (Corollary 4.1), plus both inequalities of Theorem 4.2 at every fitted θ, as SLSQP constraints.
- **Objective:** squared error in implied vol against the bid-ask mid, weighted by vega over spread, each expiry counting equally. The fit never targets Deribit's mark IV, which is itself a model.
- After every fit the surface is checked on a grid: Durrleman's g(k) ≥ 0 and ∂w/∂T ≥ 0.
- Fit error is reported per expiry as RMSE in vol points and as the share of quotes where the fit sits inside the bid-ask spread.

### Checks on raw quotes

Vertical spreads (call prices fall with strike, by no more than the strike gap), butterflies (call prices convex in strike) and calendar spreads (total variance rises with expiry at fixed k). Puts become call-equivalents by put-call parity on the forward. Each check runs twice: at mid prices ("mid-quote violation") and at executable prices, buying at the ask and selling at the bid ("tradeable at quoted prices").

### Derived quantities

At-the-money term structure √(θ/T); 25-delta risk reversal and butterfly per expiry and at 7, 30, 60, 90 and 180 days, using forward (not premium-adjusted) delta; Dupire local vol from analytic SSVI derivatives and a monotone cubic θ(T).

### Daily report

At 00:00 UTC: ATM vol, risk reversal and butterfly by tenor with 24-hour changes, the five biggest moves on a tenor × delta grid, arbitrage counts across the day's snapshots, fit quality, and data completeness. The schema is in `schema/report.schema.json`.

## Run it

Worker (Python 3.12+, [uv](https://docs.astral.sh/uv/)):

```sh
cd worker
uv sync
uv run volsurf snapshot          # one snapshot of BTC and ETH into ./data
uv run volsurf serve             # scheduler + HTTP server on :8080
uv run volsurf report --date 2026-10-19
uv run pytest                    # 52 tests, offline
```

Web (Node 22, pnpm):

```sh
cd web
cp .env.example .env.local       # point WORKER_URL at the worker
pnpm install
pnpm dev
pnpm test && pnpm build && pnpm e2e && pnpm lhci
```

## Tests

- **Worker (pytest + hypothesis):**
  - Black-76 prices and Greeks against QuantLib to 1e-10, plus a textbook value and finite differences.
  - Implied-vol round trips.
  - SSVI with known parameters recovers them to 1e-4.
  - The constraints hold after fitting random surfaces.
  - The arbitrage checks fire on deliberately broken inputs (concave prices, slopes below −1, total variance falling with expiry, a slice with g(k) < 0) and stay quiet on clean ones.
  - Local vol equals implied vol on a flat surface and matches a closed form for a time-dependent one.
  - Report units and signs, schema validation, endpoints, Blob upload headers and budget.
- **Web (Vitest):** the TypeScript SSVI matches the Python implementation to 12 decimal places.
- **Web (Playwright):** zero console errors; axe with no violations; keyboard use; reduced motion; the fallback when WebGL is unavailable; no horizontal scroll at 375, 768, 1440 and 2560 px.
- **Lighthouse CI:** 90 or more in every category, mobile and desktop.
- **Copy:** a copy check fails the build on em dashes or hype words.

## Limitations

- Deribit quotes only. This describes one venue's order book; it is not a trading signal.
- One ρ for all expiries cannot follow skew that changes with maturity, so the deep put wing of some expiries fits worse than the money. Extended SSVI (ρ per expiry, Hendriks and Martini 2019) would fix this while keeping the no-arbitrage conditions.
- "Tradeable at quoted prices" ignores fees, margin and size.
- Snapshots are five minutes apart; nothing in between is seen.

## Independence

Built independently from public data. No proprietary code, data or parameters were used.

## Licence

MIT. Deribit data is used under Deribit's public API terms.
