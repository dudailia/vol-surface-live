import type { Bundle } from './generated/bundle'
import type { PosterQuote } from './poster'
import type { Surface } from './ssvi'

export const FLAG = { vertical: 1, butterfly: 2, calendar: 4, tradeable: 8 } as const

export type Model = 'ssvi' | 'essvi'

/** The model the page shows for a bundle: the reader's choice, else the bundle's default. */
export function modelFor(b: Bundle | undefined, choice: Model | null): Model {
  if (choice === 'essvi' && b?.essvi) return 'essvi'
  if (choice === 'ssvi') return 'ssvi'
  return b?.selection?.selected === 'essvi' && b.essvi ? 'essvi' : 'ssvi'
}

export function surfaceOf(b: Pick<Bundle, 'expiries' | 'ssvi'> & Partial<Pick<Bundle, 'essvi'>>, model: Model = 'ssvi'): Surface {
  const base: Surface = {
    T: b.expiries.map((e) => e.T),
    theta: b.expiries.map((e) => e.theta),
    params: { rho: b.ssvi.rho, eta: b.ssvi.eta, gamma: b.ssvi.gamma },
  }
  if (model === 'essvi' && b.essvi) return { ...base, theta: b.essvi.theta, rho: b.essvi.rho, psi: b.essvi.psi }
  return base
}

/** Per-expiry stats and fit quality for one model, in expiry order. */
export function fitsOf(b: Bundle, model: Model) {
  if (model === 'essvi' && b.essvi) {
    return b.essvi.expiries.map((e, i) => ({ ...e, T: b.expiries[i].T, n: b.expiries[i].n }))
  }
  return b.expiries.map((e) => ({ code: e.code, stats: e.stats, rmse_vol_pts: e.rmse_vol_pts, inside_spread: e.inside_spread, T: e.T, n: e.n }))
}

export function tenorsOf(b: Bundle, model: Model) {
  return model === 'essvi' && b.essvi ? b.essvi.tenors : b.tenors
}

export function localVolOf(b: Bundle, model: Model) {
  return model === 'essvi' && b.essvi ? b.essvi.local_vol : b.local_vol
}

export function checksOf(b: Bundle, model: Model) {
  return model === 'essvi' && b.essvi ? { min_g: b.essvi.min_g, min_dw_dT: b.essvi.min_dw_dT } : { min_g: b.ssvi.min_g, min_dw_dT: b.ssvi.min_dw_dT }
}

export const MODEL_NAME: Record<Model, string> = { ssvi: 'SSVI', essvi: 'eSSVI' }

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

export function posterQuotes(b: Bundle, model: Model = 'ssvi'): PosterQuote[] {
  const thetas = model === 'essvi' && b.essvi ? b.essvi.theta : b.expiries.map((e) => e.theta)
  const sqrtTheta = new Map(b.expiries.map((e, i) => [e.code, Math.sqrt(thetas[i])]))
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


/** Every surface either model would draw, so one frame holds them all and switching morphs. */
export function allSurfaces(latest: Partial<Record<'BTC' | 'ETH', Bundle>>): Surface[] {
  return [latest.BTC, latest.ETH]
    .filter((b): b is Bundle => b != null)
    .flatMap((b) => (b.essvi ? [surfaceOf(b, 'ssvi'), surfaceOf(b, 'essvi')] : [surfaceOf(b, 'ssvi')]))
}
