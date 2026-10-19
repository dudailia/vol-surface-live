/**
 * World geometry of the surface, shared by the WebGL hero, the SVG poster and the share
 * image so all three draw the same thing.
 *
 * Axes: x is standardised moneyness u = k / √θ(T), log-moneyness in ATM standard
 * deviations, so every expiry spans the same width; z is time to expiry on a square-root
 * scale, short expiries at the front; y is implied vol. The mesh covers |u| ≤ C, where
 * nearly all quotes sit; quotes further out are not drawn in 3D (the charts show them).
 */

import { thetaCurve, totalVariance, type Surface } from './ssvi'

export const SPREAD_SD = 2.6
export const HALF_WIDTH = 1.45
export const DEPTH = 2.5
export const HEIGHT = 1.4

export type Frame = {
  sqrtTMin: number
  sqrtTMax: number
  volLo: number
  volHi: number
}

/** Fix the frame from one snapshot; later snapshots morph inside it without rescaling. */
export function makeFrame(s: Surface, volRange?: [number, number]): Frame {
  let lo: number
  let hi: number
  if (volRange) {
    ;[lo, hi] = volRange
  } else {
    const g = surfaceGrid(s, 16, 12, {
      sqrtTMin: Math.sqrt(s.T[0]),
      sqrtTMax: Math.sqrt(s.T[s.T.length - 1]),
      volLo: 0,
      volHi: 1,
    })
    lo = Math.floor((Math.min(...g.vol) * 100) / 10) * 10
    hi = Math.ceil((Math.max(...g.vol) * 100) / 10) * 10
  }
  return {
    sqrtTMin: Math.sqrt(s.T[0]),
    sqrtTMax: Math.sqrt(s.T[s.T.length - 1]),
    volLo: lo / 100,
    volHi: hi / 100,
  }
}

/** u is k / √θ(T): log-moneyness in ATM standard deviations. */
/** One frame for several surfaces (both currencies), so switching morphs inside it. */
export function sharedFrame(surfaces: Surface[]): Frame {
  const fs = surfaces.map((s) => makeFrame(s))
  return {
    sqrtTMin: Math.min(...fs.map((f) => f.sqrtTMin)),
    sqrtTMax: Math.max(...fs.map((f) => f.sqrtTMax)),
    volLo: Math.min(...fs.map((f) => f.volLo)),
    volHi: Math.max(...fs.map((f) => f.volHi)),
  }
}

export function toWorld(f: Frame, u: number, T: number, vol: number): [number, number, number] {
  const x = (u / SPREAD_SD) * HALF_WIDTH
  const z = DEPTH / 2 - ((Math.sqrt(T) - f.sqrtTMin) / (f.sqrtTMax - f.sqrtTMin)) * DEPTH
  const y = ((vol - f.volLo) / (f.volHi - f.volLo)) * HEIGHT
  return [x, y, z]
}

export type Grid = {
  nu: number
  nt: number
  /** xyz per vertex, row-major by T then k */
  positions: Float32Array
  /** implied vol (fraction) per vertex */
  vol: number[]
  /** T per row */
  T: number[]
}

/** Mesh vertices on the fixed (u, √T) grid; u ∈ [−1, 1] scales to ±C·√θ(T) in k. */
export function surfaceGrid(s: Surface, nu: number, nt: number, f: Frame): Grid {
  const curve = thetaCurve(s)
  const t0 = Math.sqrt(s.T[0])
  const t1 = Math.sqrt(s.T[s.T.length - 1])
  const positions = new Float32Array(nu * nt * 3)
  const vol: number[] = new Array(nu * nt)
  const Ts: number[] = []
  for (let j = 0; j < nt; j++) {
    const sq = t0 + ((t1 - t0) * j) / (nt - 1)
    const T = Math.min(Math.max(sq * sq, s.T[0]), s.T[s.T.length - 1])
    Ts.push(T)
    const theta = curve.value(T)
    const half = SPREAD_SD * Math.sqrt(theta)
    for (let i = 0; i < nu; i++) {
      const u = (-1 + (2 * i) / (nu - 1)) * SPREAD_SD
      const v = Math.sqrt(totalVariance(u * half / SPREAD_SD, theta, s.params) / T)
      const [x, y, z] = toWorld(f, u, T, v)
      const o = (j * nu + i) * 3
      positions[o] = x
      positions[o + 1] = y
      positions[o + 2] = z
      vol[j * nu + i] = v
    }
  }
  return { nu, nt, positions, vol, T: Ts }
}

/** Polyline along one expiry, for the lines that mark where real expiries sit. */
export function expiryLine(s: Surface, f: Frame, T: number, n = 48): [number, number, number][] {
  const theta = thetaCurve(s).value(T)
  const half = SPREAD_SD * Math.sqrt(theta)
  const out: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    const u = (-1 + (2 * i) / (n - 1)) * SPREAD_SD
    const k = (u * half) / SPREAD_SD
    out.push(toWorld(f, u, T, Math.sqrt(totalVariance(k, theta, s.params) / T)))
  }
  return out
}

/** Sequential ramp, low vol to high: the --color-ramp-* tokens, mixed in linear RGB. */
export const RAMP: [number, number, number][] = [
  [0x26, 0x2b, 0x4c],
  [0x4b, 0x55, 0xa8],
  [0xa3, 0xad, 0xf5],
  [0xd9, 0xc9, 0xff],
]

const toLin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(Math.min(Math.max(c, 0), 1) * 255)
}

/** Colour for a position t ∈ [0, 1] on the ramp, as sRGB 0..255 or linear 0..1. */
export function rampColor(t: number, linear = false): [number, number, number] {
  const x = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1)
  const i = Math.min(Math.floor(x), RAMP.length - 2)
  const a = RAMP[i].map(toLin)
  const b = RAMP[i + 1].map(toLin)
  const f = x - i
  const lin = [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * f) as [number, number, number]
  return linear ? lin : (lin.map(toSrgb) as [number, number, number])
}

// ---------------------------------------------------------------------------------------
// A small camera for the static renderings (the WebGL view uses three.js with the same
// numbers, so the poster and the first WebGL frame line up).

export const CAMERA = {
  /** spherical position around the target */
  azimuth: -0.55,
  elevation: 0.4,
  distance: 5.9,
  target: [0, 0.45, 0] as [number, number, number],
  fov: 30,
}

/**
 * Vertical field of view for an aspect ratio. Wide screens use CAMERA.fov; narrower ones
 * keep the horizontal field of view a 1.6:1 screen has, so the surface is never cropped
 * at the sides on a phone.
 */
export function fovFor(aspect: number): number {
  const ref = 1.6
  if (aspect >= ref) return CAMERA.fov
  // Phones look at the surface more head-on (see viewFor), which needs less width.
  const margin = aspect < NARROW ? 0.98 : 1
  const half = Math.tan((CAMERA.fov * Math.PI) / 360) * ref * margin
  return (2 * Math.atan(half / aspect) * 180) / Math.PI
}

/** Below this aspect ratio (a phone held upright) the camera looks more head-on. */
export const NARROW = 1.2

export function viewFor(aspect: number): { azimuth: number; elevation: number } {
  return aspect < NARROW
    ? { azimuth: -0.3, elevation: 0.55 }
    : { azimuth: CAMERA.azimuth, elevation: CAMERA.elevation }
}

export function cameraPosition(az = CAMERA.azimuth, el = CAMERA.elevation, d = CAMERA.distance) {
  const [tx, ty, tz] = CAMERA.target
  return [
    tx + d * Math.cos(el) * Math.sin(az),
    ty + d * Math.sin(el),
    tz + d * Math.cos(el) * Math.cos(az),
  ] as [number, number, number]
}

/** Perspective projection to pixel coordinates; returns [x, y, depth]. */
export function projector(width: number, height: number) {
  const v = viewFor(width / height)
  const eye = cameraPosition(v.azimuth, v.elevation)
  const t = CAMERA.target
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const norm = (a: number[]) => {
    const l = Math.hypot(a[0], a[1], a[2])
    return [a[0] / l, a[1] / l, a[2] / l]
  }
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const fwd = norm(sub(t, eye))
  const right = norm(cross(fwd, [0, 1, 0]))
  const up = cross(right, fwd)
  const aspect = width / height
  const f = 1 / Math.tan((fovFor(aspect) * Math.PI) / 360)
  return (p: [number, number, number]): [number, number, number] => {
    const d = sub(p, eye)
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2]
    const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2]
    const z = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2]
    return [width / 2 + ((f * x) / z / aspect) * (width / 2), height / 2 - ((f * y) / z) * (height / 2), z]
  }
}

/** Direction of the key light (unit vector), shared by the shader and the poster. */
export const LIGHT: [number, number, number] = (() => {
  const v = [-0.45, 0.85, 0.55]
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l] as [number, number, number]
})()
