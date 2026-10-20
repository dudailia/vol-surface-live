import { describe, expect, it } from 'vitest'
import { expiryLabel, expiryShort, signed, utcStamp } from './format'

describe('format', () => {
  it('signs with a true minus and no negative zero', () => {
    expect(signed(1.234)).toBe('+1.2')
    expect(signed(-0.04)).toBe('0.0')
    expect(signed(-2.5, 2)).toBe('−2.50')
  })
  it('labels expiries and UTC stamps', () => {
    expect(expiryLabel('6NOV26')).toBe('6 Nov 2026')
    expect(expiryShort('24SEP27')).toBe('24 Sep \u201927')
    expect(utcStamp('2026-10-19T18:51:36Z')).toBe('18:51 UTC, 19 October 2026')
  })
})
