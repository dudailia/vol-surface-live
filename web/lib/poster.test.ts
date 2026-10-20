import { describe, expect, it } from 'vitest'
import latest from '../e2e/fixtures/worker/latest.json'
import { posterQuotes, surfaceOf } from './bundle'
import { bundleSchema } from './generated/bundle'
import { makeFrame } from './geometry'
import { posterSvg } from './poster'

describe('poster', () => {
  const b = bundleSchema.parse(latest.BTC)
  const s = surfaceOf(b, 'essvi')
  it('draws one shaded quad per grid cell, all coordinates finite', () => {
    const svg = posterSvg(s, { width: 800, height: 500, nu: 20, nt: 12, detail: false })
    const quads = svg.match(/<path d="M[^"]*Z"/g) ?? []
    expect(quads.length).toBe(19 * 11)
    expect(svg).not.toMatch(/NaN|Infinity/)
  })
  it('rings every flagged quote inside the drawn range and labels the axes', () => {
    const quotes = posterQuotes(b, 'essvi')
    const svg = posterSvg(s, {
      width: 800,
      height: 500,
      quotes,
      expiries: b.expiries.map((e) => e.T),
      frame: makeFrame(s),
      labels: { volTicks: [0.4, 0.6], fontSize: 12, expiries: [{ T: b.expiries[0].T, label: 'first' }] },
    })
    const inRange = quotes.filter((q) => Math.abs(q.u) <= 2.6)
    const rings = (svg.match(/stroke="#e8b45a"/g) ?? []).length
    expect(rings).toBe(inRange.filter((q) => q.flagged).length)
    expect(svg).toContain('>40%<')
    expect(svg).toContain('>first<')
  })
})
