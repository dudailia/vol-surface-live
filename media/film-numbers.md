# Numbers in the film

Every number on screen in `film-square.mp4`, `film-vertical.mp4`, `film-wide.mp4`, `film-hook-square.mp4` and `film-cover.png`, with the file it comes from. All source files are in `media/film-data/`. `film-data-2026-10-21T0029Z.json` is what the film reads; `film/scripts/prepare.py` writes it from the other files there, and the film computes surfaces from it with the site's own `web/lib/ssvi.ts` and `web/lib/geometry.ts`.

Count-ups and the rolling clock pass through intermediate values on the way; every value they settle on, and every value the time-lapse readout shows, is listed here.

## Hook, 0 to 2 s

| On screen | Value | Source |
|---|---|---|
| Points streaming in | 1,346 points: the bid and ask vol of each of the 673 options with both quotes | `raw-BTC-2026-10-21T0029Z.parquet` (`bid_iv`, `ask_iv`, `k`, `T`) |
| "886 listed" | 886 | `raw-BTC-2026-10-21T0029Z.parquet`, row count (also `cleaning.n_raw` in `latest-BTC-2026-10-21T0029Z.json`) |
| "21 Oct 2026, 00:29 UTC" | 2026-10-21T00:29:59Z | `latest-BTC-2026-10-21T0029Z.json`, `ts` |

## The surface, 2 to 7 s

| On screen | Value | Source |
|---|---|---|
| The mesh | extended SSVI fit (the page's default at that time) | `latest-BTC-2026-10-21T0029Z.json`, `essvi.theta`, `essvi.rho`, `essvi.psi`; `expiries[].T` |
| Red rings | the 7 quotes flagged by the raw-quote arbitrage checks | same file, `expiries[].quotes.flags` |
| Contour lines | every 5 vol points of the fitted surface | computed from the fit above |

## Time-lapse, 7 to 14 s

| On screen | Value | Source |
|---|---|---|
| "29 hours of the real market." | 29 (19 Oct 18:51:36 to 21 Oct 00:29:59 UTC, rounded down) | `bundles-BTC-5min-2026-10-19T1851Z-2026-10-21T0029Z.tar.gz`, first and last `ts` |
| Clock | the timestamp of the five-minute snapshot nearest the moment shown, from 19 Oct 2026, 18:51 UTC to 21 Oct 2026, 00:29 UTC | same archive, `ts` of each of the 356 snapshots |
| Rolling number | that snapshot's 30-day ATM vol, SSVI fit; from 35.9% at the start to 35.2% at the end, within 35.0% to 36.7% | same archive, `tenors.30d.atm` of each snapshot (34.95 to 36.69) |
| Sparkline | all 356 values above | same |
| The morphing mesh | SSVI fits of the snapshot nearest each hour (32 keyframes), interpolated between keyframes for smooth motion | same archive, `ssvi`, `expiries[].theta`, `expiries[].T` |

The time-lapse uses SSVI because it is the one model every snapshot in the window carries; extended SSVI was added to the worker during it. The label on screen says "SSVI fit".

## Bitcoin against ether, 14 to 18 s

| On screen | Value | Source |
|---|---|---|
| Bitcoin 30-day ATM vol | 35.5% | `latest-BTC-2026-10-21T0029Z.json`, `essvi.tenors.30d.atm` = 35.4853 |
| Ether 30-day ATM vol | 49.1% | `latest-ETH-2026-10-21T0030Z.json`, `essvi.tenors.30d.atm` = 49.0573 |
| Bitcoin term structure | 28.9, 29.6, 31.2, 35.5, 35.4, 35.8, 37.2, 38.4, 38.8 (23 Oct 2026 to 24 Sep 2027) | `latest-BTC-...json`, `essvi.expiries[].stats.atm`; days from `expiries[].T` |
| Ether term structure | 40.0, 42.6, 45.7, 49.2, 49.0, 49.7, 51.7, 52.7, 53.4 (same expiries) | `latest-ETH-...json`, same fields |
| Axis labels | 25%, 40%, 55%; 7d, 30d, 90d, 180d | scale only |

## Inside the model, 18 to 22 s

| On screen | Value | Source |
|---|---|---|
| Smiles | extended SSVI slices at 30 Oct, 27 Nov, 25 Dec 2026, 26 Mar and 24 Sep 2027 (the expiries nearest 7, 30, 90, 180 and 330 days) | `latest-BTC-...json`, `essvi.*`, `expiries[].code` |
| "−4.0", 30-day risk reversal | −4.0046 | `latest-BTC-...json`, `essvi.tenors.30d.rr25` |
| Local volatility "27.2% to 75.6%" | 27.23 to 75.61 | `latest-BTC-...json`, `essvi.local_vol.vol`, smallest and largest cell |
| Heatmap axes | 45%, 100%, 223% of the forward; 2d, 338d | `essvi.local_vol.k` (as e^k) and `essvi.local_vol.T` |
| Extended SSVI error | 1.20 vol points | `model-comparison-2026-10-19.json`, BTC, `median.essvi_holdout` = 1.2038 |
| SSVI error | 1.51 vol points | same, `median.ssvi_holdout` = 1.5069 |
| "median of 65 snapshots, 19 October" | 65; 2026-10-19 | same, `snapshots`; file date |

## End card, 22 to 25 s

No numbers. "vol.iliaduda.com", "Open source · live · tested". The surface is the same extended SSVI bitcoin fit as at 2 s.
