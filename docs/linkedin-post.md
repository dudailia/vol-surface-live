# LinkedIn post (draft)

Attach `media/film-square.mp4` (1080 x 1080) or `media/film-vertical.mp4` (1080 x 1920), 25 s, no audio, with `media/film-cover.png` as the cover. The videos are kept locally in `media/` and published as assets of the release [v1.0-film](https://github.com/dudailia/vol-surface-live/releases/tag/v1.0-film); they are not in git. The film shows the snapshot of 00:29 UTC, 21 October 2026, the same snapshot the post quotes.

Sources for every number:

- Live: `media/film-data/latest-BTC-2026-10-21T0029Z.json`, the bitcoin snapshot at 00:29:59 UTC, 21 October 2026, extended SSVI fit (the page's default at that time): `essvi.tenors.30d.atm` = 35.4853, `essvi.tenors.30d.rr25` = −4.0046.
- Archived: `paper/data/model-comparison-2026-10-19.json`, 65 bitcoin snapshots on 19 October 2026: median hold-out error 1.20 (eSSVI) against 1.51 (SSVI) vol points.

If you post later, swap in that moment's number and time from the live page, and keep the archived comparison as it is.

## Post

I built a live implied-volatility surface for bitcoin and ether options.

Every five minutes a small Python worker pulls every listed option from Deribit's public API, drops quotes it cannot trust, and fits two surface models that rule out static arbitrage: SSVI, and extended SSVI, which gives each expiry its own skew. It checks the raw quotes for arbitrage separately, at mid and at prices you could actually trade.

At 00:29 UTC on 21 October, bitcoin's 30-day at-the-money vol was 35.5%, with 25-delta puts 4.0 vol points over calls.

To compare the models fairly, every fifth quote is held out of the fit. Across 65 bitcoin snapshots on 19 October, extended SSVI missed those quotes by a median 1.20 vol points, against 1.51 for SSVI.

It describes one venue's quotes. It is not a trading signal.

Link in the first comment.

## First comment

Live surface, methods and daily reports: https://vol.iliaduda.com

Code, tests and data: https://github.com/dudailia/vol-surface-live
