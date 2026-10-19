// Add this object to `papers` in content/papers.ts (above 'market', so the real-data paper
// sits next to the simulated one). Numbers come from facts.entry.ts.
import { fact } from './facts'

export const volSurfacePaper = {
  slug: 'vol-surface',
  href: '/vol-surface',
  title: 'A live implied-volatility surface for bitcoin and ether',
  abstract: `Every listed BTC and ETH option on Deribit, refitted every five minutes with SSVI under no-arbitrage constraints and checked for static arbitrage in the raw quotes. In the snapshot this page describes, ${fact('vsBtcKept').value} of ${fact('vsBtcRaw').value} BTC quotes passed the cleaning rules, the fit error ran from ${fact('vsBtcRmseMin').value} to ${fact('vsBtcRmseMax').value} vol points by expiry, and none of the raw-quote failures could be traded at quoted prices.`,
  standfirst:
    'The real-data counterpart to One market, three views: a surface fitted to every BTC and ETH option on Deribit every five minutes, with the arbitrage checks and the misfits published alongside it.',
  dek: `Every BTC and ETH option on Deribit, refitted with SSVI every five minutes under no-arbitrage constraints, with raw quotes checked for static arbitrage and fit error published by expiry.`,
  description: 'Every BTC and ETH option on Deribit, refitted with SSVI every five minutes under no-arbitrage constraints, with fit error and arbitrage checks published.',
  cv: 'A live SSVI implied-volatility surface for BTC and ETH from Deribit public data: Python worker on Fly.io, Next.js and WebGL on Vercel, tested against QuantLib.',
  byline: 'Independent work · October 2026 · Deribit public data',
  status: 'pending',
} as const
