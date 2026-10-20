// Add these entries to `facts` in content/facts.ts. Every value is read from files archived in
// the vol-surface-live repository:
//   paper/data/snapshot-2026-10-20T0154Z.json: one live bundle (BTC at 01:54:59 UTC, ETH at
//     01:55:01 UTC, 20 October 2026), as served by the worker on Fly.io;
//   paper/data/model-comparison-2026-10-19.json: SSVI against eSSVI on every snapshot
//     archived on 19 October 2026 (65 BTC, 64 ETH), from `python -m volsurf.evaluate`.

const SNAP = 'vol-surface-live paper/data/snapshot-2026-10-20T0154Z.json'
const CMP = 'vol-surface-live paper/data/model-comparison-2026-10-19.json'
const VRP = 'vol-surface-live paper/data/vrp-2026-10-20T0223Z.json'

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
  // Implied against realized (generated 02:22 UTC, 20 October 2026).
  vsVrpBtcDvol: { value: 37.3, unit: 'none', label: 'BTC DVOL at 00:00 UTC, 20 October 2026', source: `${VRP}: currencies.BTC.latest.dvol (37.33)` },
  vsVrpBtcRealized: { value: 24.4, unit: 'none', label: 'BTC realized vol over the previous 30 days', source: `${VRP}: currencies.BTC.latest.realized_30d (24.431)` },
  vsVrpBtcDays: { value: 335, unit: 'count', label: 'Days with a forward gap, 21 Oct 2025 to 20 Sep 2026', source: `${VRP}: currencies.BTC.forward.days` },
  vsVrpBtcShare: { value: 89, unit: 'percent', label: 'Share of days DVOL exceeded the following 30 days realized vol, BTC', source: `${VRP}: currencies.BTC.forward.share_positive (0.8925)` },
  vsVrpBtcMedian: { value: 11.9, unit: 'none', label: 'Median forward gap, BTC, vol points', source: `${VRP}: currencies.BTC.forward.median_gap (11.889)` },
  vsVrpEthShare: { value: 90, unit: 'percent', label: 'Share of days DVOL exceeded the following 30 days realized vol, ETH', source: `${VRP}: currencies.ETH.forward.share_positive (0.8985)` },
  vsVrpEthMedian: { value: 17.7, unit: 'none', label: 'Median forward gap, ETH, vol points', source: `${VRP}: currencies.ETH.forward.median_gap (17.688)` },
  // Bitcoin against ether, eSSVI, same snapshot as above.
  vsEthRr30: { value: -3.46, unit: 'none', label: 'ETH 30-day 25-delta risk reversal, eSSVI', source: `${SNAP}: ETH.essvi.tenors.30d.rr25` },
  vsEthBf30: { value: 1.81, unit: 'none', label: 'ETH 30-day 25-delta butterfly, eSSVI', source: `${SNAP}: ETH.essvi.tenors.30d.bf25 (1.805)` },
  vsBtcBf30: { value: 1.05, unit: 'none', label: 'BTC 30-day 25-delta butterfly, eSSVI', source: `${SNAP}: BTC.essvi.tenors.30d.bf25 (1.0475)` },
  // Local volatility, eSSVI, same snapshot.
  vsBtcLvLo: { value: 30.3, unit: 'percent', label: 'Lowest BTC local vol on the grid', source: `${SNAP}: min BTC.essvi.local_vol.vol (30.28)` },
  vsBtcLvHi: { value: 79.1, unit: 'percent', label: 'Highest BTC local vol on the grid', source: `${SNAP}: max BTC.essvi.local_vol.vol (79.064)` },
  vsBtcLvBlank: { value: 434, unit: 'count', label: 'Blank BTC local vol cells (beyond 3 ATM standard deviations)', source: `${SNAP}: null cells in BTC.essvi.local_vol.vol` },
  vsLvCells: { value: 792, unit: 'count', label: 'Local vol grid cells (33 strikes by 24 maturities)', source: `${SNAP}: len(k) * len(T)` },
} as const
