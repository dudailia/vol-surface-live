import { describe, expect, it } from 'vitest'
import fx from './__fixtures__/ssvi-parity.json'
import ex from './__fixtures__/essvi-parity.json'
import {
  blendSurfaces,
  durrlemanG,
  forwardDeltaK,
  normCdf,
  sliceAt,
  sliceG,
  sliceOf,
  sliceStats,
  sliceW,
  smileStats,
  thetaCurve,
  totalVariance,
  type Surface,
} from './ssvi'

const s: Surface = { T: fx.T, theta: fx.theta, params: fx.params }

describe('SSVI matches the Python worker', () => {
  it('total variance and g(k)', () => {
    fx.theta.forEach((th, i) => {
      fx.k.forEach((k, j) => {
        expect(totalVariance(k, th, s.params)).toBeCloseTo(fx.w[i][j], 12)
        expect(durrlemanG(k, th, s.params)).toBeCloseTo(fx.g[i][j], 10)
      })
    })
  })

  it('PCHIP θ(T) and its derivative', () => {
    const c = thetaCurve(s)
    fx.Tq.forEach((t, i) => {
      expect(c.value(t)).toBeCloseTo(fx.thetaQ[i], 12)
      expect(c.derivative(t)).toBeCloseTo(fx.dthetaQ[i], 10)
    })
    expect(Number.isNaN(c.value(2))).toBe(true)
  })

  it('25-delta stats to 0.001 vol pt', () => {
    fx.theta.forEach((th, i) => {
      const got = smileStats(th, fx.T[i], s.params)
      const want = fx.stats[i]
      for (const key of ['atm', 'rr25', 'bf25'] as const) {
        expect(Math.abs(got[key] - want[key])).toBeLessThan(1e-3)
      }
    })
  })
})

describe('helpers', () => {
  it('normCdf is accurate', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 9)
    expect(normCdf(1.959963985)).toBeCloseTo(0.975, 6)
    expect(normCdf(-1)).toBeCloseTo(0.158655254, 6)
  })

  it('delta strike has the requested delta', () => {
    const k = forwardDeltaK(0.05, s.params, 0.25)
    const sw = Math.sqrt(totalVariance(k, 0.05, s.params))
    expect(normCdf(-k / sw + sw / 2)).toBeCloseTo(0.25, 6)
  })

  it('blend starts at a, ends at b, and keeps the calendar and wing conditions', () => {
    const b: Surface = { T: fx.T.map((t) => t * 1.1), theta: fx.theta.map((x) => x * 1.3),
      params: { rho: 0.6, eta: 1.2, gamma: 0.3 } }
    const a: Surface = { ...s, params: { rho: -0.6, eta: 1.25, gamma: 0.5 } }
    const grid = [0.02, 0.05, 0.1, 0.3, 0.6, 0.9]
    const ca = thetaCurve(a)
    const m0 = blendSurfaces(a, b, 0, grid)
    grid.forEach((t, i) => expect(m0.theta[i]).toBeCloseTo(ca.value(t), 12))
    for (const t of [0.25, 0.5, 0.75]) {
      const m = blendSurfaces(a, b, t, grid)
      for (let i = 1; i < m.theta.length; i++) {
        expect(m.theta[i]).toBeGreaterThanOrEqual(m.theta[i - 1])
        const dpsi = m.psi![i] - m.psi![i - 1]
        const dp = m.psi![i] * m.rho![i] - m.psi![i - 1] * m.rho![i - 1]
        expect(Math.abs(dp)).toBeLessThanOrEqual(dpsi + 1e-12)
      }
      m.psi!.forEach((ps, i) => expect(ps * (1 + Math.abs(m.rho![i]))).toBeLessThan(4))
    }
    const m1 = blendSurfaces(a, b, 1, grid)
    expect(m1.rho![2]).toBeCloseTo(0.6, 12)

  })
})

describe('eSSVI matches the Python worker', () => {
  const e: Surface = { T: ex.T, theta: ex.theta, rho: ex.rho, psi: ex.psi, params: { rho: 0, eta: 1, gamma: 0.5 } }
  it('interpolated slices, w and g', () => {
    ex.Tq.forEach((t, i) => {
      const sl = sliceAt(e, t)
      const [th, rho, psi] = ex.sliceQ[i]
      expect(sl.theta).toBeCloseTo(th, 12)
      expect(sl.rho).toBeCloseTo(rho, 12)
      expect(sl.phi * sl.theta).toBeCloseTo(psi, 12)
      ex.k.forEach((k, j) => {
        expect(sliceW(k, sl)).toBeCloseTo(ex.wQ[i][j], 12)
        expect(sliceG(k, sl)).toBeCloseTo(ex.gQ[i][j], 9)
      })
    })
  })
  it('per-expiry and tenor stats to 0.001 vol pt', () => {
    ex.stats.forEach((want, i) => {
      const got = sliceStats(sliceOf(e, i), ex.T[i])
      for (const key of ['atm', 'rr25', 'bf25'] as const) expect(Math.abs(got[key] - want[key])).toBeLessThan(1e-3)
    })
    for (const [tenor, want] of Object.entries(ex.tenors)) {
      const T = Number(tenor.replace('d', '')) / 365
      const got = sliceStats(sliceAt(e, T), T)
      for (const key of ['atm', 'rr25', 'bf25'] as const) expect(Math.abs(got[key] - want[key])).toBeLessThan(1e-3)
    }
  })
})
