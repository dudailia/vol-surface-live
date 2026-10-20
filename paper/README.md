# Paper draft for iliaduda.com

A page for the site in the same form as the other papers: `app/(pages)/<slug>/page.tsx`, a registry entry, sourced facts and two figures. Nothing here has been copied into the iliaduda.com repository; that is for its own session.

## Files and where they go

| Here | In iliaduda-site |
|---|---|
| `app/(pages)/vol-surface/page.tsx` | same path |
| `app/(pages)/vol-surface/opengraph-image.tsx` | same path (needs a `thumbFor('vol-surface')` entry in `lib/thumbs.ts`) |
| `components/figures/VolSurfaceSmile.tsx` | same path. Fig. 1: one expiry, quotes with both fits |
| `components/figures/VolSurfaceHoldout.tsx` | same path. Fig. 2: held-out error over a day, both models |
| `lib/volsurface/ssvi.ts`, `lib/volsurface/snapshot.json`, `lib/volsurface/holdout.json` | same paths |
| `content/papers.entry.ts` | merge the object into `papers` in `content/papers.ts` |
| `content/facts.entry.ts` | merge the entries into `facts` in `content/facts.ts` |

## Things to check when merging

- `tests/figures.test.ts` rejects numeric literals in figure components. The two figures have layout constants (sizes, paddings, tick steps) that may need to move to wherever the other figures keep theirs.
- `TITLE_PHRASES` in `content/papers.ts` needs the title split into phrases; a likely split is `['A live implied-volatility surface', 'for bitcoin and ether']`.
- `status` is `'pending'` until the page is reviewed.
- The Meta table has no repository links while the repository is private. Once it is public, add rows for `worker/src/volsurf/essvi.py`, `worker/src/volsurf/ssvi.py`, `worker/src/volsurf/arbitrage.py` and `worker/tests`.

## Where the numbers come from

Every number is read from two archived files:

- `data/snapshot-2026-10-20T0154Z.json`: one live bundle as served by the worker on Fly.io (BTC at 01:54:59 UTC, ETH at 01:55:01 UTC, 20 October 2026). It contains both fits.
- `data/model-comparison-2026-10-19.json`: SSVI against eSSVI on every snapshot archived on 19 October 2026 (65 BTC, 64 ETH, 17:22 to 24:00 UTC). The worker's laptop run lost its network from about 17:34 to 18:45 UTC, so that stretch has no snapshots.

To regenerate the comparison from the archive's raw Parquet:

```sh
cd worker && uv run python -m volsurf.evaluate <raw/BTC/2026-10-19.parquet> <raw/ETH/2026-10-19.parquet> --out ../paper/data/model-comparison-2026-10-19.json
```

The hourly-thinned raw files are public in the archive at `raw/{BTC,ETH}/2026-10-19.parquet`; the full five-minute files live on the worker's volume.
