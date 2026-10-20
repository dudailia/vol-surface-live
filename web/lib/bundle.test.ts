import { describe, expect, it } from 'vitest'
import latest from '../e2e/fixtures/worker/latest.json'
import { bundleSchema } from './generated/bundle'
import { expandForClient, slimForClient } from './bundle'

describe('client bundle', () => {
  const full = bundleSchema.parse(latest.BTC)
  const slim = slimForClient(full)
  it('is smaller and still matches the schema', () => {
    expect(JSON.stringify(slim).length).toBeLessThan(0.7 * JSON.stringify(full).length)
    expect(bundleSchema.safeParse(slim).success).toBe(true)
  })
  it('expands back to the same instruments and mids', () => {
    const back = expandForClient(slim)
    full.expiries.forEach((e, i) => {
      expect(back.expiries[i].quotes.instrument).toEqual(e.quotes.instrument)
      back.expiries[i].quotes.mid_iv.forEach((m, j) => expect(m).toBeCloseTo(e.quotes.mid_iv[j], 4))
    })
  })
})

import vrpFixture from '../e2e/fixtures/worker/vrp.json'
import { vrpSchema } from './generated/vrp'
import { vrpView } from './vrp'

describe('implied against realized view', () => {
  const r = vrpSchema.parse(vrpFixture)
  it('aligns series on one daily grid starting where comparisons exist', () => {
    const v = vrpView(r, 'BTC')!
    expect(v.days.length).toBe(v.dvol.length)
    expect(v.realized.length).toBe(v.days.length)
    expect(v.realized[0] != null || v.gapForward[0] != null).toBe(true)
    // The forward gap is DVOL minus the realized vol of the following 30 days, so the last
    // 30 days have none yet.
    expect(v.gapForward.slice(-29).every((g) => g == null)).toBe(true)
    expect(v.latest?.gap).toBeCloseTo((v.latest?.dvol ?? 0) - (v.latest?.realized_30d ?? 0), 2)
  })
})
