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

## Phase 4: front end (done 2026-10-19, live at https://vol.iliaduda.com)

**Design system**
- iliaduda.com's dark tokens: paper #111316, ink #e9e6df, graphite #9ea3ab, rule #2b2e34, indigo #a3adf5 for measurements only, amber #e8b45a for arbitrage flags (always with a ring and a label).
- Source Serif 4 and Source Code Pro, self-hosted, with tabular figures for every number.
- The site's type scale, 240px rail and 710px measure.
- Motion tokens: 120/240/700/900 ms, plus the site's ease-out and ease-in-out curves.
- The colour palette was checked with the dataviz validator: colour-blind ΔE 22 between quotes and flags.

**Hero**
- Plain three.js, with no react-three-fiber.
- Surface on standardised moneyness k/√θ, a square-root time axis and iso-vol contours.
- Quotes are ringed dots, with a faint pass through the surface so quotes below the fit stay visible. Flags are amber rings.
- A slow sway around the default view, drag to turn, and a cursor tilt.
- New snapshots and currency switches morph in parameter space. Every frame satisfies the no-arbitrage conditions: θ is kept monotone and η is clamped back onto η(1+|ρ|) ≤ 2. Quotes and expiry lines fade in once the surface arrives.
- The server-rendered SVG poster is the first paint. It is also the whole figure on phones and touch screens until "Turn it in 3D" is pressed, and when WebGL fails or the context is lost.

**Sections**
- "What moved": sentences built only from the daily report JSON. A missing number hides its sentence.
- A seven-step scroll explainer with a sticky live figure: quotes, total variance, SSVI fit, g(k), skew, term structure, Dupire local vol. Each chart has a screen-reader table.
- A history slider, morphing to daily and hourly snapshots.
- Methods, with cleaning rules and counts read from the bundle.
- A /reports page, 404 page, sitemap and robots.

**Share image and icons:** drawn from the real surface with satori.

**Quality gates**

| Gate | Result |
|---|---|
| Lighthouse, live, mobile | 94 / 100 / 100 / 100 (LCP 3.0 s, TBT 30 ms, CLS 0) |
| Lighthouse, live, desktop | 99 / 100 / 100 / 100 |
| Lighthouse, /reports, mobile | 99 / 100 / 100 / 100 |
| Median frame time, real GPU (MacBook, headed Chromium) | 8.3 ms |
| Playwright e2e | 13 passing |
| `tsc` strict, ESLint, Vitest | clean |
| Copy check | passing |

The 13 e2e tests cover: zero console errors, axe with no violations, keyboard use, reduced motion, the WebGL fallback, phone tap-to-load, no horizontal scroll at 375/768/1440/2560, reports and 404, and the share image and icon.

**Issues found by the gates and fixed**
- On CI's GPU-less runner, software WebGL caused 6.3 s of blocking time on desktop. The canvas now detects software renderers, and a frame-time watchdog catches anything else slow; in both cases it draws only on change (drag, morph, resize) with no auto-rotation. CI desktop is now 94 to 100.
- A hydration mismatch under reduced motion.
- A duplicated hero intro (two h1 elements with the same id).
- Screen-reader tables widening the page by 44px.
- three.js blocking the main thread on mobile (Lighthouse 55 before deferring WebGL).

**Deploy**
- Vercel project vol-surface-live (Root Directory web, framework pinned in vercel.json).
- Blob store vol-surface-archive (public, lhr1).
- Domain vol.iliaduda.com, served by Vercel DNS, so no record was needed.

**Open**
- The Fly worker is not deployed yet: the user skipped Fly login on 2026-10-19.
- Until it is, the page shows one real snapshot uploaded to Blob as latest.json (22:29 UTC, 19 October 2026), with its timestamp and a stale-data notice. One Blob upload was used.
- Deploying the worker: `fly auth login`, then `cd worker && fly launch --no-deploy --copy-config`, `fly volumes create volsurf_data --region lhr --size 5`, `fly secrets set BLOB_READ_WRITE_TOKEN=...`, `fly deploy`. Then set WORKER_URL on Vercel and redeploy.

## Phase 5: portfolio (done 2026-10-19 except the public repo)

- README (what, why, how it works, how to run, method, tests, limitations, independence), MIT licence.
- CI in `.github/workflows/ci.yml` (green on GitHub since run 4; Lighthouse uses the median of 3 runs):
  - worker job: ruff, mypy --strict, pytest offline, schema drift;
  - web job: zod schema drift, typecheck, lint, Vitest, build, copy check, Playwright, Lighthouse on recorded fixtures.
- The repository is private (`dudailia/vol-surface-live`) until the user reviews it.
- `paper/`: a draft page in the site's form (page.tsx, OG image, figure from the archived snapshot, registry and facts entries with sources), with a merge guide. iliaduda-site was not touched.
- `media/surface.mp4`: 1080x1080, 15.0 s, 30 fps, H.264. 450 frames were stepped deterministically from the live page in capture mode, with BTC morphing to ETH at 7 s.
- `docs/linkedin-post.md`: 131 words, one live number (BTC 30-day ATM 35.7% at 22:29 UTC, 19 October 2026), link in the first comment.
