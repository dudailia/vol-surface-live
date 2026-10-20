// Add these entries to `facts` in content/facts.ts. Every value is read from files archived in
// the vol-surface-live repository:
//   paper/data/snapshot-2026-10-20T0154Z.json: one live bundle (BTC at 01:54:59 UTC, ETH at
//     01:55:01 UTC, 20 October 2026), as served by the worker on Fly.io;
//   paper/data/model-comparison-2026-10-19.json: SSVI against eSSVI on every snapshot
//     archived on 19 October 2026 (65 BTC, 64 ETH), from `python -m volsurf.evaluate`.

const SNAP = 'vol-surface-live paper/data/snapshot-2026-10-20T0154Z.json'
const CMP = 'vol-surface-live paper/data/model-comparison-2026-10-19.json'

export const volSurfaceFacts = {
  // One live snapshot.
  vsBtcAtm30: { value: 36.51, unit: 'percent', label: 'BTC 30-day ATM implied vol, eSSVI', source: `${SNAP}: BTC.essvi.tenors.30d.atm` },
  vsBtcRr30: { value: -4.06, unit: 'none', label: 'BTC 30-day 25-delta risk reversal, eSSVI, vol points', source: `${SNAP}: BTC.essvi.tenors.30d.rr25` },
  vsBtcRr30Ssvi: { value: -3.66, unit: 'none', label: 'BTC 30-day 25-delta risk reversal, SSVI, vol points', source: `${SNAP}: BTC.tenors.30d.rr25` },
  vsEthAtm30: { value: 49.59, unit: 'percent', label: 'ETH 30-day ATM implied vol, eSSVI', source: `${SNAP}: ETH.essvi.tenors.30d.atm` },
  vsBtcRaw: { value: 884, unit: 'count', label: 'BTC option quotes in the snapshot', source: `${SNAP}: BTC.cleaning.n_raw` },
  vsBtcKept: { value: 328, unit: 'count', label: 'BTC quotes kept for the fit', source: `${SNAP}: BTC.cleaning.n_kept` },
  vsBtcExpiries: { value: 9, unit: 'count', label: 'BTC expiries fitted', source: `${SNAP}: BTC.expiries.length` },
  vsBtcRhoShort: { value: -0.24, unit: 'none', label: 'Most negative eSSVI rho across BTC expiries', source: `${SNAP}: min BTC.essvi.rho (-0.2396)` },
  vsBtcRhoLong: { value: -0.14, unit: 'none', label: 'Least negative eSSVI rho across BTC expiries', source: `${SNAP}: max BTC.essvi.rho (-0.1449)` },
  vsBtcEssviWorst: { value: 2.7, unit: 'none', label: 'Worst eSSVI expiry RMSE, vol points (25DEC26)', source: `${SNAP}: max BTC.essvi.expiries[].rmse_vol_pts (2.7032)` },
  vsBtcMinG: { value: 0.259, unit: 'none', label: 'Lowest Durrleman g(k) on the BTC eSSVI surface', source: `${SNAP}: BTC.essvi.min_g` },
  vsBtcIvGapMedian: { value: 0.0017, unit: 'none', label: 'Median |our IV − Deribit IV|, vol points, 20 comparisons', source: `${SNAP}: BTC.iv_check.median_gap_pts` },
  vsBtcArbMid: { value: 9, unit: 'count', label: 'BTC raw-quote butterfly failures at mid', source: `${SNAP}: BTC.arbitrage.counts.mid.butterfly` },
  vsBtcArbTrade: { value: 0, unit: 'count', label: 'BTC raw-quote failures tradeable at quoted prices', source: `${SNAP}: sum BTC.arbitrage.counts.tradeable` },
  // A day of snapshots.
  vsCmpBtcSnapshots: { value: 65, unit: 'count', label: 'BTC snapshots compared, 17:22 to 24:00 UTC, 19 October 2026', source: `${CMP}: [BTC].snapshots` },
  vsCmpBtcHoldoutEssvi: { value: 1.2, unit: 'none', label: 'Median held-out RMSE, eSSVI, BTC, vol points', source: `${CMP}: [BTC].median.essvi_holdout (1.2038)` },
  vsCmpBtcHoldoutSsvi: { value: 1.51, unit: 'none', label: 'Median held-out RMSE, SSVI, BTC, vol points', source: `${CMP}: [BTC].median.ssvi_holdout (1.5069)` },
  vsCmpEthHoldoutEssvi: { value: 1.42, unit: 'none', label: 'Median held-out RMSE, eSSVI, ETH, vol points', source: `${CMP}: [ETH].median.essvi_holdout (1.4247)` },
  vsCmpEthHoldoutSsvi: { value: 1.82, unit: 'none', label: 'Median held-out RMSE, SSVI, ETH, vol points', source: `${CMP}: [ETH].median.ssvi_holdout (1.8213)` },
  vsCmpBtcInsideEssvi: { value: 68, unit: 'percent', label: 'Median share of BTC quotes with the eSSVI fit inside bid/ask', source: `${CMP}: [BTC].median.essvi_inside_median (0.6842)` },
  vsCmpBtcInsideSsvi: { value: 40, unit: 'percent', label: 'Median share of BTC quotes with the SSVI fit inside bid/ask', source: `${CMP}: [BTC].median.ssvi_inside_median (0.4043)` },
  vsCmpEthRmseEssvi: { value: 1.53, unit: 'none', label: 'Median in-sample per-expiry RMSE, eSSVI, ETH', source: `${CMP}: [ETH].median.essvi_rmse_median (1.5338)` },
  vsCmpEthRmseSsvi: { value: 1.39, unit: 'none', label: 'Median in-sample per-expiry RMSE, SSVI, ETH', source: `${CMP}: [ETH].median.ssvi_rmse_median (1.3912)` },
  vsCmpMinG: { value: 0.2556, unit: 'none', label: 'Lowest eSSVI g(k) over all 129 snapshots', source: `${CMP}: min of [*].median.min_essvi_min_g` },
} as const
