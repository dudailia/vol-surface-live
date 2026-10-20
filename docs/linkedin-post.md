# LinkedIn post (draft)

Attach `media/surface.mp4` (1080 x 1080, 15 s, recorded from the live page at 04:34 UTC on 20 October 2026; it shows the same 36.0% as the post).

Sources for every number:

- Live: `docs/data/live-2026-10-20T0439Z.json`, taken from `https://vol.iliaduda.com/api/latest?full=1`. Bitcoin snapshot at 04:39:59 UTC, 20 October 2026, extended SSVI fit (the page's default at that time): `tenor_30d.essvi.atm` = 36.03, `rr25` = −4.14.
- Archived: `paper/data/model-comparison-2026-10-19.json`, 65 bitcoin snapshots on 19 October 2026: median hold-out error 1.20 (eSSVI) against 1.51 (SSVI) vol points.

If you post later, swap in that moment's number and time from the live page, and keep the archived comparison as it is.

## Post

I built a live implied-volatility surface for bitcoin and ether options.

Every five minutes a small Python worker pulls every listed option from Deribit's public API, drops quotes it cannot trust, and fits two surface models that rule out static arbitrage: SSVI, and extended SSVI, which gives each expiry its own skew. It checks the raw quotes for arbitrage separately, at mid and at prices you could actually trade.

At 04:39 UTC on 20 October, bitcoin's 30-day at-the-money vol was 36.0%, with 25-delta puts 4.1 vol points over calls.

To compare the models fairly, every fifth quote is held out of the fit. Across 65 bitcoin snapshots on 19 October, extended SSVI missed those quotes by a median 1.20 vol points, against 1.51 for SSVI.

It describes one venue's quotes. It is not a trading signal.

Link in the first comment.

## First comment

Live surface, methods and daily reports: https://vol.iliaduda.com

(Add the GitHub link, https://github.com/dudailia/vol-surface-live, once the repository is public.)
