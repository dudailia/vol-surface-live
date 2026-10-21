/**
 * The film's data: one JSON file written by scripts/prepare.py from the worker's archive
 * (sources in media/film-data/). Geometry comes from the site's own lib/ssvi.ts and
 * lib/geometry.ts, so the film draws exactly what vol.iliaduda.com draws.
 */
import raw from '../public/data.json'
import { sharedFrame, surfaceGrid, toWorld, SPREAD_SD, type Frame } from '../../web/lib/geometry'
import { thetaCurve, sliceAt, sliceW, type Surface } from '../../web/lib/ssvi'

type Key = Surface & { ts: string }
export type FilmData = {
  snapshot: { BTC: string; ETH: string }
  model: { BTC: string; ETH: string }
  listed: number
  quoted: number
  latest: { BTC: Surface; ETH: Surface }
  latestSsvi: { BTC: Surface; ETH: Surface }
  points: [number, number, number, number][]
  rings: [number, number, number][]
  arbMid: number
  timelapse: { first: string; last: string; hours: number; keys: Key[]; atm30: [string, number][] }
  term: { BTC: { code: string; days: number; atm: number }[]; ETH: { code: string; days: number; atm: number }[] }
  atm30: { BTC: number; ETH: number }
  rr25_30: { BTC: number; ETH: number }
  localVol: { k: number[]; T: number[]; vol: (number | null)[][]; lo: number; hi: number }
  holdout: { date: string; snapshots: number; essvi: number; ssvi: number }
}

export const D = raw as unknown as FilmData

export const NU = 72
export const NT = 48

// One frame for every surface the film shows, so morphs never rescale.
export const FRAME: Frame = sharedFrame([D.latest.BTC, D.latest.ETH, ...D.timelapse.keys])

export type Grid = { pos: Float32Array; vol: Float32Array }
const grid = (s: Surface): Grid => {
  const g = surfaceGrid(s, NU, NT, FRAME)
  return { pos: g.positions, vol: Float32Array.from(g.vol) }
}
export const G = {
  btc: grid(D.latest.BTC),
  eth: grid(D.latest.ETH),
  keys: D.timelapse.keys.map(grid),
}
export const KEY_MS = D.timelapse.keys.map((k) => Date.parse(k.ts))
export const T0 = Date.parse(D.timelapse.first)
export const T1 = Date.parse(D.timelapse.last)

/** World position of a quote, placed as the site places them: u = k / √θ(T). */
function place(s: Surface, k: number, T: number, vol: number): [number, number, number] | null {
  if (T < s.T[0] || T > s.T[s.T.length - 1]) return null
  const u = k / Math.sqrt(thetaCurve(s).value(T))
  if (Math.abs(u) > SPREAD_SD || vol < FRAME.volLo || vol > FRAME.volHi) return null
  return toWorld(FRAME, u, T, vol)
}

// The latest snapshot's quotes: every listed bitcoin option with a bid and an ask, both vols.
export const POINTS = D.points
  .map(([k, T, iv, fitted]) => ({ p: place(D.latest.BTC, k, T, iv), fitted }))
  .filter((x): x is { p: [number, number, number]; fitted: number } => x.p !== null)
export const RINGS = D.rings
  .map(([k, T, mid]) => place(D.latest.BTC, k, T, mid))
  .filter((p): p is [number, number, number] => p !== null)

/** Fitted smile of the latest bitcoin surface at expiry index i, as [strike % of forward, vol %]. */
export function smile(i: number, n = 80): [number, number][] {
  const s = D.latest.BTC
  const T = s.T[i]
  const sl = sliceAt(s, T)
  const out: [number, number][] = []
  for (let j = 0; j <= n; j++) {
    const k = Math.log(0.6) + (Math.log(1.65) - Math.log(0.6)) * (j / n)
    out.push([100 * Math.exp(k), 100 * Math.sqrt(sliceW(k, sl) / T)])
  }
  return out
}

/** The 5-minute snapshot nearest a moment: what the clock and the rolling number show. */
export function nearestSnap(ms: number): [string, number] {
  let best = D.timelapse.atm30[0]
  for (const s of D.timelapse.atm30) if (Math.abs(Date.parse(s[0]) - ms) < Math.abs(Date.parse(best[0]) - ms)) best = s
  return best
}
