/**
 * Static SVG rendering of a surface: the hero's first paint, the no-WebGL and reduced-motion
 * view, and the base of the share image and favicon. Painter's algorithm over shaded quads.
 */

import {
  DEPTH,
  HALF_WIDTH,
  HEIGHT,
  LIGHT,
  SPREAD_SD,
  expiryLine,
  makeFrame,
  projector,
  rampColor,
  surfaceGrid,
  toWorld,
  type Frame,
} from './geometry'
import type { Surface } from './ssvi'

/** u = k / √θ at the quote's expiry */
export type PosterQuote = { u: number; T: number; vol: number; flagged: boolean }

export type PosterOptions = {
  width: number
  height: number
  nu?: number
  nt?: number
  quotes?: PosterQuote[]
  expiries?: number[]
  frame?: Frame
  background?: string
  /** draw quotes and lines; off for the favicon */
  detail?: boolean
  /** axis labels, for the still view on phones and when WebGL is unavailable */
  labels?: { expiries: { T: number; label: string }[]; volTicks: number[]; fontSize: number }
}

const hex = (c: [number, number, number]) =>
  `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

export function posterSvg(s: Surface, o: PosterOptions): string {
  const { width: W, height: H } = o
  const nu = o.nu ?? 44
  const nt = o.nt ?? 30
  const f = o.frame ?? makeFrame(s)
  const g = surfaceGrid(s, nu, nt, f)
  const project = projector(W, H)
  const P = g.positions
  const pts: [number, number, number][] = []
  for (let i = 0; i < nu * nt; i++) pts.push(project([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]))

  type Quad = { d: string; depth: number; fill: string }
  const quads: Quad[] = []
  const v = (i: number) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]
  for (let j = 0; j < nt - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i
      const b = a + 1
      const c = a + nu + 1
      const d = a + nu
      const [pa, pb, pc, pd] = [v(a), v(b), v(c), v(d)]
      // Normal from the diagonals, turned to face up.
      const e1 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]
      const e2 = [pd[0] - pb[0], pd[1] - pb[1], pd[2] - pb[2]]
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      const len = Math.hypot(n[0], n[1], n[2]) || 1
      n = n.map((x) => x / len)
      if (n[1] < 0) n = n.map((x) => -x)
      const lambert = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])
      const vol = (g.vol[a] + g.vol[b] + g.vol[c] + g.vol[d]) / 4
      const base = rampColor((vol - f.volLo) / (f.volHi - f.volLo))
      const shade = 0.52 + 0.48 * lambert
      const fill = hex(base.map((x) => Math.round(x * shade)) as [number, number, number])
      const q = [pts[a], pts[b], pts[c], pts[d]]
      quads.push({
        d: `M${q.map((p) => `${Math.round(p[0])} ${Math.round(p[1])}`).join('L')}Z`,
        depth: (q[0][2] + q[1][2] + q[2][2] + q[3][2]) / 4,
        fill,
      })
    }
  }
  quads.sort((x, y) => y.depth - x.depth)

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`)
  if (o.background) parts.push(`<rect width="${W}" height="${H}" fill="${o.background}"/>`)
  // Hairline seams in the fill colour hide the anti-aliasing gaps between quads.
  parts.push('<g stroke-width="0.8" stroke-linejoin="round">')
  for (const q of quads) parts.push(`<path d="${q.d}" fill="${q.fill}" stroke="${q.fill}"/>`)
  parts.push('</g>')

  if (o.detail !== false) {
    for (const T of o.expiries ?? []) {
      const line = expiryLine(s, f, T, 32).map(project)
      parts.push(
        `<path d="M${line.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}" fill="none" stroke="#e9e6df" stroke-opacity="0.28" stroke-width="1"/>`,
      )
    }
    const r = Math.max(1.4, W / 300)
    for (const q of o.quotes ?? []) {
      if (Math.abs(q.u) > SPREAD_SD) continue
      const [x, y] = project(toWorld(f, q.u, q.T, q.vol))
      if (q.flagged) {
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 3).toFixed(1)}" fill="none" stroke="#e8b45a" stroke-width="${(r * 0.9).toFixed(1)}"/>`)
      }
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#eef0ff" fill-opacity="0.9"/>`)
    }
  }
  if (o.labels) {
    const L = o.labels
    const fz = DEPTH / 2
    const text = (p: [number, number, number], str: string, anchor: string, dx = 0) => {
      const [x, y] = project(p)
      parts.push(`<text x="${(x + dx).toFixed(0)}" y="${y.toFixed(0)}" dy="0.32em" text-anchor="${anchor}" font-family="ui-monospace, Menlo, monospace" font-size="${L.fontSize}" fill="#9ea3ab">${str}</text>`)
    }
    const axis = [[-HALF_WIDTH, 0, fz], [HALF_WIDTH, 0, fz], [-HALF_WIDTH, 0, fz], [-HALF_WIDTH, 0, -fz], [HALF_WIDTH + 0.22, 0, -fz], [HALF_WIDTH + 0.22, HEIGHT, -fz]].map((p) => project(p as [number, number, number]))
    for (let i = 0; i < axis.length; i += 2) {
      parts.push(`<line x1="${axis[i][0].toFixed(0)}" y1="${axis[i][1].toFixed(0)}" x2="${axis[i + 1][0].toFixed(0)}" y2="${axis[i + 1][1].toFixed(0)}" stroke="#9ea3ab" stroke-opacity="0.35"/>`)
    }
    for (const v of L.volTicks) text([HALF_WIDTH + 0.26, toWorld(f, 0, s.T[0], v)[1], -fz], `${Math.round(v * 100)}%`, 'start', 6)
    for (const e of L.expiries) text([-HALF_WIDTH - 0.08, 0, toWorld(f, 0, e.T, f.volLo)[2]], e.label, 'end', -6)
    for (const u of [-2, 0, 2]) text([(u / SPREAD_SD) * HALF_WIDTH, 0, fz + 0.14], u === 0 ? 'ATM' : u > 0 ? `+${u}` : `\u2212${-u}`, 'middle')
  }
  parts.push('</svg>')
  return parts.join('')
}
