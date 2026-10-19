# LinkedIn post (draft)

Attach `media/surface.mp4` (1080 x 1080, 15 s). The one live number is from the archived snapshot `paper/data/snapshot-2026-10-19T2229Z.json` (`BTC.tenors.30d.atm` = 35.69). If you post on another day, swap in that day's number and time from the live page.

## Post

I built a live implied-volatility surface for bitcoin and ether options.

Every five minutes a small Python worker pulls every listed option from Deribit's public API, drops quotes with no bid, crossed markets or wide spreads, and fits an SSVI surface that cannot contain static arbitrage. It then checks the raw quotes for arbitrage separately, at mid and at prices you could actually trade, and publishes both.

At 22:29 UTC on 19 October, bitcoin's 30-day at-the-money vol was 35.7%.

The page shows where the model fits and where it does not: one skew parameter for every expiry misses the deep put wing, and the error is printed for each expiry.

It is tested against QuantLib and describes one venue's quotes. It is not a trading signal.

Link in the first comment.

## First comment

Live surface, methods and daily reports: https://vol.iliaduda.com

(Add the GitHub link, https://github.com/dudailia/vol-surface-live, once the repository is public.)
