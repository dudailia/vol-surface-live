// SSVI and eSSVI slices, as in vol-surface-live web/lib/ssvi.ts (tested there against the
// Python worker to twelve places).
export type Slice = { theta: number; rho: number; phi: number }

export function sliceVol(k: number, s: Slice, T: number): number {
  const z = s.phi * k + s.rho
  const w = 0.5 * s.theta * (1 + s.rho * s.phi * k + Math.sqrt(z * z + 1 - s.rho * s.rho))
  return Math.sqrt(w / T)
}

export function ssviSlice(theta: number, rho: number, eta: number, gamma: number): Slice {
  return { theta, rho, phi: eta * theta ** -gamma * (1 + theta) ** (gamma - 1) }
}

export function essviSlice(theta: number, rho: number, psi: number): Slice {
  return { theta, rho, phi: psi / theta }
}
