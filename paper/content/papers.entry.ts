// Add this object to `papers` in content/papers.ts (above 'market', so the real-data paper
// sits next to the simulated one). Numbers come from facts.entry.ts.
import { fact } from './facts'

export const volSurfacePaper = {
  slug: 'vol-surface',
  href: '/vol-surface',
  title: 'A live implied-volatility surface for bitcoin and ether',
  abstract: `Every listed BTC and ETH option on Deribit, refitted every five minutes with SSVI and extended SSVI under no-arbitrage constraints, with the raw quotes checked for static arbitrage. Across ${fact('vsCmpBtcSnapshots').value} bitcoin snapshots, extended SSVI's error on quotes held out of the fit was ${fact('vsCmpBtcHoldoutEssvi').value} vol points against ${fact('vsCmpBtcHoldoutSsvi').value}, and it lay inside the bid-ask spread for ${fact('vsCmpBtcInsideEssvi').value}% of quotes against ${fact('vsCmpBtcInsideSsvi').value}%.`,
  standfirst:
    'The real-data counterpart to One market, three views: a surface fitted to every BTC and ETH option on Deribit every five minutes, two models side by side, with the arbitrage checks and the misfits published alongside them.',
  dek: `Every BTC and ETH option on Deribit, refitted every five minutes with SSVI and extended SSVI under no-arbitrage constraints, the better model chosen on held-out quotes.`,
  description: 'Every BTC and ETH option on Deribit, refitted every five minutes with SSVI and extended SSVI under no-arbitrage constraints, chosen on held-out quotes.',
  cv: 'A live implied-volatility surface for BTC and ETH from Deribit public data, SSVI and extended SSVI under no-arbitrage constraints: Python worker on Fly.io, Next.js and WebGL on Vercel.',
  byline: 'Independent work · October 2026 · Deribit public data',
  status: 'pending',
} as const
