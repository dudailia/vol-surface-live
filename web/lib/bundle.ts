import type { Bundle } from './generated/bundle'
import type { PosterQuote } from './poster'
import type { Surface } from './ssvi'

export const FLAG = { vertical: 1, butterfly: 2, calendar: 4, tradeable: 8 } as const

export function surfaceOf(b: Pick<Bundle, 'expiries' | 'ssvi'>): Surface {
  return {
    T: b.expiries.map((e) => e.T),
    theta: b.expiries.map((e) => e.theta),
    params: { rho: b.ssvi.rho, eta: b.ssvi.eta, gamma: b.ssvi.gamma },
  }
}

export type Quote = {
  instrument: string
  expiry: string
  T: number
  strike: number
  isCall: boolean
  k: number
  bid: number
  ask: number
  mid: number
  flags: number
}

export function quotesOf(b: Bundle): Quote[] {
  const out: Quote[] = []
  for (const e of b.expiries) {
    const q = e.quotes
    for (let i = 0; i < q.k.length; i++) {
      out.push({
        instrument: q.instrument[i],
        expiry: e.code,
        T: e.T,
        strike: q.strike[i],
        isCall: q.is_call[i],
        k: q.k[i],
        bid: q.bid_iv[i],
        ask: q.ask_iv[i],
        mid: q.mid_iv[i],
        flags: q.flags[i],
      })
    }
  }
  return out
}

export function posterQuotes(b: Bundle): PosterQuote[] {
  const sqrtTheta = new Map(b.expiries.map((e) => [e.code, Math.sqrt(e.theta)]))
  return quotesOf(b).map((q) => ({
    u: q.k / (sqrtTheta.get(q.expiry) ?? 1),
    T: q.T,
    vol: q.mid,
    flagged: q.flags !== 0,
  }))
}

/** The fitted expiry nearest to `days`, for the explainer's single-slice views. */
export function nearestExpiry(b: Bundle, days = 30) {
  return b.expiries.reduce((best, e) =>
    Math.abs(e.T * 365 - days) < Math.abs(best.T * 365 - days) ? e : best,
  )
}

export function arbCounts(b: Bundle) {
  const c = b.arbitrage.counts
  const sum = (lvl: string) => Object.values(c[lvl] ?? {}).reduce((a, x) => a + x, 0)
  return { mid: sum('mid'), tradeable: sum('tradeable') }
}

export function flaggedQuotes(b: Bundle): number {
  return quotesOf(b).filter((q) => q.flags !== 0).length
}
