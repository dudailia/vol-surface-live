# Paper draft for iliaduda.com

A page for the site in the same form as the other papers (`app/(pages)/<slug>/page.tsx`, a registry entry, sourced facts, one figure). Nothing here has been copied into the iliaduda.com repository; that is for its own session.

## Files and where they go

| Here | In iliaduda-site |
|---|---|
| `app/(pages)/vol-surface/page.tsx` | same path |
| `app/(pages)/vol-surface/opengraph-image.tsx` | same path (needs a `thumbFor('vol-surface')` entry in `lib/thumbs.ts`) |
| `components/figures/VolSurfaceSmile.tsx` | same path |
| `lib/volsurface/ssvi.ts`, `lib/volsurface/snapshot.json` | same paths |
| `content/papers.entry.ts` | merge the object into `papers` in `content/papers.ts` |
| `content/facts.entry.ts` | merge the entries into `facts` in `content/facts.ts` |

## Things to check when merging

- `tests/figures.test.ts` rejects numeric literals in figure components. `VolSurfaceSmile.tsx` has layout constants (640 × 360, paddings, 5-point ticks) that may need to move to wherever the other figures keep theirs.
- `TITLE_PHRASES` in `content/papers.ts` needs the title split into phrases; a likely split is `['A live implied-volatility surface', 'for bitcoin and ether']`.
- `status` is `'pending'` until the page is reviewed.
- The byline uses middle dots like the site's other bylines.

## Where the numbers come from

Every number is read from `data/snapshot-2026-10-19T2229Z.json`, a real snapshot archived by the worker (BTC at 22:29:59 UTC, ETH at 22:30:03 UTC, 19 October 2026). To re-derive the facts from a newer snapshot:

```sh
python3 -c "import json;b=json.load(open('data/snapshot-2026-10-19T2229Z.json'))['BTC'];print(b['tenors']['30d'], b['cleaning']['n_kept'], [e['rmse_vol_pts'] for e in b['expiries']])"
```
