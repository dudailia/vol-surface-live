// Add these entries to `facts` in content/facts.ts. Every value is read from one archived
// snapshot, committed in the vol-surface-live repository as
// paper/data/snapshot-2026-10-19T2229Z.json (BTC at 22:29:59 UTC, ETH at 22:30:03 UTC,
// 19 October 2026). Re-derive them with paper/README.md's one-liner if the snapshot changes.

const SRC = 'vol-surface-live paper/data/snapshot-2026-10-19T2229Z.json'

export const volSurfaceFacts = {
  vsBtcAtm30: { value: 35.69, unit: 'percent', label: 'BTC 30-day ATM implied vol', source: `${SRC}: BTC.tenors.30d.atm` },
  vsBtcRr30: { value: -3.71, unit: 'none', label: 'BTC 30-day 25-delta risk reversal, vol points', source: `${SRC}: BTC.tenors.30d.rr25` },
  vsBtcBf30: { value: 1.38, unit: 'none', label: 'BTC 30-day 25-delta butterfly, vol points', source: `${SRC}: BTC.tenors.30d.bf25` },
  vsEthAtm30: { value: 48.6, unit: 'percent', label: 'ETH 30-day ATM implied vol', source: `${SRC}: ETH.tenors.30d.atm` },
  vsBtcRaw: { value: 884, unit: 'count', label: 'BTC option quotes in the snapshot', source: `${SRC}: BTC.cleaning.n_raw` },
  vsBtcKept: { value: 326, unit: 'count', label: 'BTC quotes kept for the fit', source: `${SRC}: BTC.cleaning.n_kept` },
  vsBtcExpiries: { value: 9, unit: 'count', label: 'BTC expiries fitted', source: `${SRC}: BTC.expiries.length` },
  vsBtcRmseMin: { value: 0.5, unit: 'none', label: 'Lowest per-expiry fit RMSE, vol points (24SEP27)', source: `${SRC}: min BTC.expiries[].rmse_vol_pts` },
  vsBtcRmseMax: { value: 3.59, unit: 'none', label: 'Highest per-expiry fit RMSE, vol points (25DEC26)', source: `${SRC}: max BTC.expiries[].rmse_vol_pts` },
  vsBtcInsideMedian: { value: 39, unit: 'percent', label: 'Median share of quotes with the fit inside bid/ask, by expiry', source: `${SRC}: median BTC.expiries[].inside_spread (0.3871)` },
  vsBtcIvGapMedian: { value: 0.0031, unit: 'none', label: 'Median |our IV − Deribit IV|, vol points, 20 comparisons', source: `${SRC}: BTC.iv_check.median_gap_pts` },
  vsBtcArbMid: { value: 9, unit: 'count', label: 'BTC raw-quote butterfly failures at mid', source: `${SRC}: BTC.arbitrage.counts.mid.butterfly` },
  vsBtcArbTrade: { value: 0, unit: 'count', label: 'BTC raw-quote failures tradeable at quoted prices', source: `${SRC}: sum BTC.arbitrage.counts.tradeable` },
  vsBtcMinG: { value: 0.257, unit: 'none', label: 'Lowest Durrleman g(k) on the fitted BTC slices', source: `${SRC}: BTC.ssvi.min_g` },
  vsBtcRho: { value: -0.198, unit: 'none', label: 'Fitted SSVI rho, BTC', source: `${SRC}: BTC.ssvi.rho` },
  vsBtcGamma: { value: 0.5, unit: 'none', label: 'Fitted SSVI gamma, BTC (at its upper bound)', source: `${SRC}: BTC.ssvi.gamma` },
  vsBtcAtmFirst: { value: 29.22, unit: 'percent', label: 'BTC ATM vol, 22OCT26 expiry', source: `${SRC}: BTC.expiries[0].stats.atm` },
  vsBtcAtmLast: { value: 38.94, unit: 'percent', label: 'BTC ATM vol, 24SEP27 expiry', source: `${SRC}: BTC.expiries[8].stats.atm` },
} as const
