import { Easing } from 'remotion'

/** The strong curves from the site's motion tokens. */
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1)
export const easeInOut = Easing.bezier(0.77, 0, 0.175, 1)

export const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)
/** Progress of t through [a, b], eased. */
export const prog = (t: number, a: number, b: number, ease: (x: number) => number = easeOut) => ease(clamp01((t - a) / (b - a)))
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x

/** Story sections, in seconds of the full film. */
export const S = {
  hook: [0, 2],
  surface: [2, 7],
  lapse: [7, 14],
  versus: [14, 18],
  model: [18, 22],
  end: [22, 25],
} as const

export type Variant = 'full' | 'hook'
export const DURATION = { full: 25, hook: 12 }

/**
 * Story time for a moment of the composition. The hook cut plays the first two sections,
 * then the end card (held for five seconds instead of three).
 */
export function storyTime(t: number, v: Variant): number {
  if (v === 'full') return t
  return t < 7 ? t : 22 + (t - 7)
}

/** Catmull-Rom through keyframes: a smooth path with no stops between keys. */
export function spline(keys: number[][], t: number): number[] {
  if (t <= keys[0][0]) return keys[0].slice(1)
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1].slice(1)
  let i = 0
  while (keys[i + 1][0] < t) i++
  const p0 = keys[Math.max(i - 1, 0)]
  const p1 = keys[i]
  const p2 = keys[i + 1]
  const p3 = keys[Math.min(i + 2, keys.length - 1)]
  const u = (t - p1[0]) / (p2[0] - p1[0])
  const out: number[] = []
  for (let c = 1; c < p1.length; c++) {
    // Tangents scaled to the actual key spacing, so unevenly timed keys stay smooth.
    const m1 = ((p2[c] - p0[c]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0])
    const m2 = ((p3[c] - p1[c]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0])
    const u2 = u * u
    const u3 = u2 * u
    out.push((2 * u3 - 3 * u2 + 1) * p1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[c] + (u3 - u2) * m2)
  }
  return out
}
