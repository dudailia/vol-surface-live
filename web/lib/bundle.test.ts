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
