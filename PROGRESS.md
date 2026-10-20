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

**Worker deployed (2026-10-20 01:20 UTC)**
- Fly app vol-surface-live in lhr: shared-cpu-1x, 512 MB, 5 GB volume volsurf_data, shared IPv4 and dedicated IPv6.
- Secrets: BLOB_READ_WRITE_TOKEN, LATEST_TOKEN and BLOB_BASE_URL. `/latest.json` and `/history.json` need the bearer token; Vercel has it as LATEST_TOKEN. `/healthz` is public.
- Vercel has WORKER_URL=https://vol-surface-live.fly.dev.
- The laptop worker is stopped.
- Its bundles for 19 and 20 October, the 19 October report and the compacted raw file were copied onto the volume, so the next report can compare against the 00:00 surface of 20 October.
- The first daily report (19 October) was written by the laptop worker at 00:00 UTC. It came from the same code, with 62 BTC and 61 ETH snapshots; the laptop lost its network from about 17:34 to 18:45 UTC. It was published to the archive at 01:15 UTC, together with both end-of-day surfaces and the hourly raw Parquet.
- Bugs found and fixed while publishing:
  - The publisher matched end-of-day bundles by comparing timestamp strings ("Z" against "+00:00"), so the history index came out empty. It now compares instants, and a test uses the "Z" form.
  - A fresh volume would have rebuilt the archive's indexes from scratch. The worker now merges with the published ones.

## Phase 5: portfolio (done 2026-10-19 except the public repo)

- README (what, why, how it works, how to run, method, tests, limitations, independence), MIT licence.
- CI in `.github/workflows/ci.yml` (green on GitHub since run 4; Lighthouse uses the median of 3 runs):
  - worker job: ruff, mypy --strict, pytest offline, schema drift;
  - web job: zod schema drift, typecheck, lint, Vitest, build, copy check, Playwright, Lighthouse on recorded fixtures.
- The repository is private (`dudailia/vol-surface-live`) until the user reviews it.
- `paper/`: a draft page in the site's form (page.tsx, OG image, figure from the archived snapshot, registry and facts entries with sources), with a merge guide. iliaduda-site was not touched.
- `media/surface.mp4`: 1080x1080, 15.0 s, 30 fps, H.264. 450 frames were stepped deterministically from the live page in capture mode, with BTC morphing to ETH at 7 s.
- `docs/linkedin-post.md`: 131 words, one live number (BTC 30-day ATM 35.7% at 22:29 UTC, 19 October 2026), link in the first comment.

## Session 3 (2026-10-20, 01:10 to about 02:30 UTC)

### Fixes
- **Numbers rendered twice in the server HTML** ("35.7%35.7%"). The count-up is now one text node animated in place. An e2e test reads the server HTML and checks that each hero number appears once.
- **Staleness in the server HTML.** The cached fetch records when it ran. If the snapshot is more than 15 minutes old, the hero says "Latest snapshot ... more than 15 minutes old" in the server HTML, not after hydration. An e2e test checks the wording against the snapshot's age.
- **GitHub links hidden.** `REPO_PUBLIC = false` in `web/lib/site.ts` hides "Source on GitHub" and the "open source" wording. An e2e test checks that no github.com link is in the page. To publish, flip the flag; the paper README lists the links to add.
- **Methods table order.** Cleaning rules are now listed in the order they run, in sentence case.

### Extended SSVI
- `worker/src/volsurf/essvi.py`: per-expiry θ, ρ and ψ, fitted from the SSVI solution under these constraints:
  - butterflies: ψ(1+|ρ|) < 4 and ψ²(1+|ρ|) ≤ 4θ;
  - calendar: θ and ψ non-decreasing, and |Δ(ρψ)| ≤ Δψ.
  Between expiries ψ and ρψ are linear in θ. A grid check covers the in-between slices.
- **Model choice:** every snapshot both models are refitted with every fifth quote held out. The default is the model with the lower median hold-out error over the last 12 snapshots. The evidence is in each bundle's `selection` block, and the page has a Fit toggle.
- **Daily reports** use eSSVI only when both ends of the day carry it, and record the model.
- **Measured on all 129 archived snapshots of 19 October** (`paper/data/model-comparison-2026-10-19.json`, from `python -m volsurf.evaluate`):

| | Median hold-out error, eSSVI / SSVI | Median share inside bid-ask, eSSVI / SSVI |
|---|---|---|
| BTC | 1.20 / 1.51 vol pts | 68% / 40% |
| ETH | 1.42 / 1.82 vol pts | 73% / 37% |

  eSSVI had the lower hold-out error in every snapshot. ETH's unweighted in-sample median error was higher with eSSVI (1.53 against 1.39). Both models passed the grid checks in every snapshot (lowest g(k) 0.2556, no negative ∂w/∂T).
- **Tests:**
  - worker 59, including eSSVI recovering known per-expiry skews to 1e-3, constraints after random fits, a crossing pair caught by the grid check, never worse than SSVI on real quotes, and the offline evaluator;
  - Vitest 12, including eSSVI parity with Python to 12 places and blends keeping the calendar condition;
  - Playwright 16.
- **Morphs** now mix (θ, ψ, ρψ) per expiry, which keeps the calendar condition on every frame, including SSVI to eSSVI.

### History
- The hourly picker in the worker matched file names ending in "00". Deribit's server time can read a second early (01:19:59 for the 01:20 run), so almost no snapshot matched. It now takes the snapshot nearest each hour, within 5 minutes; a test covers it.
- `/history.json` now returns one surface per hour (8 per currency at 02:00 UTC, growing to 48).
- "What moved" shows the first report's levels when there is no earlier day, and says which model the report used.
- e2e tests drive the history slider by keyboard and check the What moved section.

### Paper
- `paper/` is rewritten around the two models and the deployed setup.
- Fig. 1: one expiry with both fits. Fig. 2: hold-out error over the day.
- Facts come from `paper/data/snapshot-2026-10-20T0154Z.json` and the comparison file.
- Repo links were left out of the Meta table while the repo is private.

### Performance
- After the eSSVI fields were added, CI's two-core runner scored mobile performance 87 to 92 (median 89) on the home page.
- Fixes:
  - the browser now gets a slimmed bundle (instrument names and mids rebuilt client-side, unused fields dropped, local vol at 0.1 point; about 40% smaller);
  - zod is out of the browser (the server still validates);
  - Motion loads through LazyMotion with DOM features only;
  - the count-up uses requestAnimationFrame.
- The page chunk went from 109 KB to 68 KB gzipped.
- Local mobile Lighthouse is now 95 to 96, and 95 to 98 with the CPU throttled 6x.

### Video
- `media/surface.mp4` was re-recorded from the current page: eSSVI default with its evidence sentence, BTC morphing to ETH.

### Questions for the owner
1. **Repo public?** Say "repo public" and I will set `REPO_PUBLIC = true`, make the GitHub repo public, and add the links to the paper's Meta table and the LinkedIn first comment.
2. **Default model rule.** The default is the lower median hold-out error over the last hour. Keep it, or always show eSSVI now that it has won every snapshot measured so far?
3. **Fly cost.** About $3 to $4 a month for an always-on machine and the 5 GB volume. Full five-minute raw data is kept 180 days on the volume (about 26 MB a day), and bundles 3 days. Fine as is?

## Session 4 (from 02:17 UTC, 2026-10-20)

### 02:35 UTC: A. Implied against realized (done)
- **Worker** (`worker/src/volsurf/vrp.py`, hourly at :07, `/vrp.json`, a daily copy to Blob).
  - Realized vol: annualized root mean square of six-hour log returns of Deribit's index over 30 days. A window counts only if the data reaches both of its ends and 90% of its samples are present.
  - DVOL is read at 00:00 UTC each day.
  - Our 30-day ATM vol comes from the stored hourly surfaces.
  - Deribit's published historical volatility is included as a labelled reference; its window is not documented.
  - Tests: an exact case, the coverage rule, a GBM estimate, and gap alignment.
- **Page:** the section "Implied against realized" has two panels (levels; DVOL minus the realized vol of the following 30 days), hover, a legend, a screen-reader table and an e2e test.
- **Measured, live at 00:00 UTC on 20 October:**
  - BTC: DVOL 37.3, realized 24.4, our ATM 36.1.
  - ETH: DVOL 51.9, realized 32.7, our ATM 49.0.
  - From 21 Oct 2025 to 20 Sep 2026, DVOL exceeded the following 30 days' realized vol on 89% of 335 days for BTC (median 11.9 points) and 90% for ETH (median 17.7).
- **Quality:** 17 e2e tests; mobile Lighthouse 94 to 95; desktop 100.

### 02:55 UTC: B, C, D done; F under way
- **B. Bitcoin against ether**: three panels on shared axes (ATM vol, 25-delta RR, 25-delta BF by expiry, days on a square-root scale), redrawn every snapshot from the fit on screen.
  - Colours are BTC #6f7cf0 and ETH #3aa98a, validated with the dataviz script against the dark background. The pair's tritan separation is in the floor band, so BTC also has circles and solid lines and ETH squares and dashed lines, all directly labelled.
  - A sentence of live numbers sits above the panels, with a screen-reader table and an e2e test.
- **C. Local volatility**: a Dupire heatmap from the fit on screen, with hover readouts and a plain explanation.
  - The grid limits are stated from the data: strikes 45% to 223% of the forward, first to last expiry. Blank cells are counted and explained (beyond three ATM standard deviations).
  - e2e test.
- **CI variance**: CI's Lighthouse mobile run on the implied-vs-realized commit failed (median 79, one run with 3.7 s of blocking time; DOM about 1,500 elements). The heavy below-the-fold charts now mount only near the viewport, with their space reserved per breakpoint so nothing shifts; text and screen-reader tables stay in the server HTML. CI has been green since.
- **D. Paper**: Fig. 3 (DVOL against realized and the forward gap) plus sections on implied against realized, bitcoin against ether and local volatility. Facts come from `paper/data/vrp-2026-10-20T0223Z.json` and the 01:54 snapshot. "Ether dearer at every maturity" was checked against all nine expiries.
- **F so far**:
  - a "What this is" block under the hero (what the system does, the live hold-out result, an index of sections, with a test that every link resolves);
  - a README Mermaid diagram;
  - worker tests for `/vrp.json` (token, 404 before the first computation) and for the ATM series.
- **Counts**: worker 65 tests; Vitest 13; Playwright 20. Lighthouse mobile 94 to 95, desktop 100.

### 03:20 UTC: F continues
- **CI Lighthouse flakiness diagnosed.** The runner's CPU speed varies about 2x between runs (benchmark index 1,236 to 2,345), which moved the home page's mobile score from 67 to 94 on unchanged code. Two changes:
  - Real: page sections hydrate as separate Suspense boundaries. The longest task under 8x throttling fell from 200 to 304 ms down to 172 to 196 ms.
  - CI: the mobile Lighthouse run takes the median of 5. CI has been green since.
- **Explainer step 1** draws both fits on one expiry (chosen fit solid, the other dashed). On 27 Nov 2026 SSVI tracks the call wing slightly better and both miss the deepest puts; the page says what it shows.
- **"What moved"** gives failures by kind: on 19 October BTC had 575 mid-quote failures, 574 butterflies and 1 vertical spread.
- **Methods** has a "Tests" block saying what the code is checked against, with no tolerance numbers on the page.
- **Share image**: the whole surface is in frame, quote dots are smaller, and the fit is named in the subtitle.
- **Tests**:
  - axe also runs after scrolling, with every deferred chart mounted;
  - the poster renderer has unit tests (quad count, finite coordinates, a ring for every flagged quote, labels);
  - the quality script frees ports 3200 and 3300 first. A stale server had produced a false console-error failure locally.
- **Reports page**: shows the fit behind each report.
- **Worker on Fly**: the risk-premium job runs at :07; memory is 191 MB of 470 MB; the volume holds about 15 MB.
- **Counts**: worker 65, Vitest 15, Playwright 21. Lighthouse mobile 94 to 97, desktop 100, all other categories 100.

