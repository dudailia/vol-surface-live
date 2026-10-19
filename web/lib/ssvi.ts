/**
 * SSVI (Gatheral and Jacquier, 2014) in TypeScript, matching worker/src/volsurf/ssvi.py and
 * derived.py. lib/ssvi.test.ts checks it against numbers exported from the Python code.
 *
 *   w(k, θ) = θ/2 · [1 + ρφk + √((φk + ρ)² + 1 − ρ²)],   φ(θ) = η θ^(−γ) (1 + θ)^(γ − 1)
 */

export type SSVIParams = { rho: number; eta: number; gamma: number }

/** What it takes to draw a surface: fitted θ per expiry plus the global parameters. */
export type Surface = { T: number[]; theta: number[]; params: SSVIParams }

export function phi(theta: number, p: SSVIParams): number {
  return p.eta * theta ** -p.gamma * (1 + theta) ** (p.gamma - 1)
}

export function totalVariance(k: number, theta: number, p: SSVIParams): number {
  const f = phi(theta, p)
  const z = f * k + p.rho
  return 0.5 * theta * (1 + p.rho * f * k + Math.sqrt(z * z + 1 - p.rho * p.rho))
}

/** Durrleman g(k): non-negative everywhere means no butterfly arbitrage in the slice. */
export function durrlemanG(k: number, theta: number, p: SSVIParams): number {
  const f = phi(theta, p)
  const z = f * k + p.rho
  const s = Math.sqrt(z * z + 1 - p.rho * p.rho)
  const w = 0.5 * theta * (1 + p.rho * f * k + s)
  const w1 = 0.5 * theta * (p.rho * f + (f * z) / s)
  const w2 = (0.5 * theta * f * f * (1 - p.rho * p.rho)) / s ** 3
  return (1 - (k * w1) / (2 * w)) ** 2 - ((w1 * w1) / 4) * (1 / w + 0.25) + w2 / 2
}

export function impliedVol(k: number, theta: number, T: number, p: SSVIParams): number {
  return Math.sqrt(totalVariance(k, theta, p) / T)
}

/**
 * Monotone cubic θ(T) through (0, 0) and the fitted points: SciPy's PchipInterpolator
 * (Fritsch–Butland derivatives, SciPy's end conditions). Returns NaN outside the knots.
 */
export function pchip(xs: number[], ys: number[]) {
  const n = xs.length
  const h = xs.slice(1).map((x, i) => x - xs[i])
  const delta = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi)
  const d = new Array<number>(n).fill(0)
  if (n === 2) {
    d[0] = d[1] = delta[0]
  } else {
    for (let i = 1; i < n - 1; i++) {
      const a = delta[i - 1]
      const b = delta[i]
      if (a === 0 || b === 0 || Math.sign(a) !== Math.sign(b)) continue
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      d[i] = (w1 + w2) / (w1 / a + w2 / b)
    }
    const edge = (h0: number, h1: number, m0: number, m1: number) => {
      let v = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1)
      if (Math.sign(v) !== Math.sign(m0)) v = 0
      else if (Math.sign(m0) !== Math.sign(m1) && Math.abs(v) > 3 * Math.abs(m0)) v = 3 * m0
      return v
    }
    d[0] = edge(h[0], h[1], delta[0], delta[1])
    d[n - 1] = edge(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3])
  }
  const locate = (x: number) => {
    if (!(x >= xs[0] && x <= xs[n - 1])) return -1
    let lo = 0
    let hi = n - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  return {
    value(x: number): number {
      const i = locate(x)
      if (i < 0) return NaN
      const t = (x - xs[i]) / h[i]
      const t2 = t * t
      const t3 = t2 * t
      return (
        (2 * t3 - 3 * t2 + 1) * ys[i] +
        (t3 - 2 * t2 + t) * h[i] * d[i] +
        (-2 * t3 + 3 * t2) * ys[i + 1] +
        (t3 - t2) * h[i] * d[i + 1]
      )
    },
    derivative(x: number): number {
      const i = locate(x)
      if (i < 0) return NaN
      const t = (x - xs[i]) / h[i]
      const t2 = t * t
      return (
        ((6 * t2 - 6 * t) * ys[i]) / h[i] +
        (3 * t2 - 4 * t + 1) * d[i] +
        ((-6 * t2 + 6 * t) * ys[i + 1]) / h[i] +
        (3 * t2 - 2 * t) * d[i + 1]
      )
    },
  }
}

export function thetaCurve(s: Surface) {
  return pchip([0, ...s.T], [0, ...s.theta])
}

/** Standard normal CDF, Hart's algorithm as given by West (2005); double precision. */
export function normCdf(x: number): number {
  const z = Math.abs(x)
  let c: number
  if (z > 37) {
    c = 0
  } else {
    const e = Math.exp(-(z * z) / 2)
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688
      n = n * z + 6.37396220353165
      n = n * z + 33.912866078383
      n = n * z + 112.079291497871
      n = n * z + 221.213596169931
      n = n * z + 220.206867912376
      let d = 8.83883476483184e-2 * z + 1.75566716318264
      d = d * z + 16.064177579207
      d = d * z + 86.7807322029461
      d = d * z + 296.564248779674
      d = d * z + 637.333633378831
      d = d * z + 793.826512519948
      d = d * z + 440.413735824752
      c = (e * n) / d
    } else {
      const d = z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65))))
      c = e / d / 2.506628274631
    }
  }
  return x > 0 ? 1 - c : c
}

/** Log-moneyness where the forward call delta N(d1) equals `delta` (0.75 = a 25-delta put). */
export function forwardDeltaK(theta: number, p: SSVIParams, delta: number): number {
  const f = (k: number) => {
    const sw = Math.sqrt(totalVariance(k, theta, p))
    return normCdf(-k / sw + 0.5 * sw) - delta
  }
  let lo = -(8 * Math.sqrt(theta) + 0.5)
  let hi = -lo
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi)
    if (f(mid) > 0) lo = mid
    else hi = mid
  }
  return 0.5 * (lo + hi)
}

export function smileStats(theta: number, T: number, p: SSVIParams) {
  const vol = (k: number) => impliedVol(k, theta, T, p) * 100
  const atm = vol(0)
  const c25 = vol(forwardDeltaK(theta, p, 0.25))
  const p25 = vol(forwardDeltaK(theta, p, 0.75))
  return { atm, rr25: c25 - p25, bf25: 0.5 * (c25 + p25) - atm, call25: c25, put25: p25 }
}

/**
 * Blend two surfaces in parameter space so a change of snapshot morphs instead of jumping.
 * Both θ curves are resampled onto one T grid (expiries differ between snapshots), then θ,
 * ρ, η and γ are mixed linearly. θ is kept non-decreasing in T. The set η(1+|ρ|) ≤ 2 is not
 * convex, so a straight mix can leave it; η is then pulled back onto the boundary. Every
 * in-between frame therefore satisfies the same no-arbitrage conditions as the fits.
 */
export function blendSurfaces(a: Surface, b: Surface, t: number, grid: number[]): Surface {
  const ca = thetaCurve(a)
  const cb = thetaCurve(b)
  const clampT = (s: Surface, x: number) => Math.min(Math.max(x, s.T[0]), s.T[s.T.length - 1])
  const theta = grid.map((x) => {
    const va = ca.value(clampT(a, x))
    const vb = cb.value(clampT(b, x))
    return va + (vb - va) * t
  })
  for (let i = 1; i < theta.length; i++) theta[i] = Math.max(theta[i], theta[i - 1])
  const mix = (x: number, y: number) => x + (y - x) * t
  const rho = mix(a.params.rho, b.params.rho)
  const eta = Math.min(mix(a.params.eta, b.params.eta), 2 / (1 + Math.abs(rho)))
  return { T: grid, theta, params: { rho, eta, gamma: mix(a.params.gamma, b.params.gamma) } }
}
