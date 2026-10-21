# LinkedIn post (draft)

Attach `media/linkedin-square.mp4` (1080 x 1080) or `media/linkedin-vertical.mp4` (1080 x 1920), 34.5 s each, no audio, with `media/linkedin-cover.png` as the cover. Both videos were recorded from the live page on the snapshot of 23:59 UTC, 20 October 2026, the same snapshot the post quotes.

Sources for every number:

- Live: `docs/data/linkedin-video-2026-10-20T2359Z.json`, taken from `https://vol.iliaduda.com/api/latest?full=1` and the page during the recording. Bitcoin snapshot at 23:59:59 UTC, 20 October 2026, extended SSVI fit (the page's default at that time): 30-day ATM 35.33, `rr25` −3.86.
- Archived: `paper/data/model-comparison-2026-10-19.json`, 65 bitcoin snapshots on 19 October 2026: median hold-out error 1.20 (eSSVI) against 1.51 (SSVI) vol points.

If you post later, swap in that moment's number and time from the live page, and keep the archived comparison as it is.

## Post

I built a live implied-volatility surface for bitcoin and ether options.

Every five minutes a small Python worker pulls every listed option from Deribit's public API, drops quotes it cannot trust, and fits two surface models that rule out static arbitrage: SSVI, and extended SSVI, which gives each expiry its own skew. It checks the raw quotes for arbitrage separately, at mid and at prices you could actually trade.

At 23:59 UTC on 20 October, bitcoin's 30-day at-the-money vol was 35.3%, with 25-delta puts 3.9 vol points over calls.

To compare the models fairly, every fifth quote is held out of the fit. Across 65 bitcoin snapshots on 19 October, extended SSVI missed those quotes by a median 1.20 vol points, against 1.51 for SSVI.

It describes one venue's quotes. It is not a trading signal.

Link in the first comment.

## First comment

Live surface, methods and daily reports: https://vol.iliaduda.com

Code, tests and data: https://github.com/dudailia/vol-surface-live
