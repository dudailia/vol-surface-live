// SSVI total variance, as in vol-surface-live web/lib/ssvi.ts (tested there against the
// Python worker to twelve places).
export type SSVIParams = { rho: number; eta: number; gamma: number }

export function impliedVol(k: number, theta: number, T: number, p: SSVIParams): number {
  const phi = p.eta * theta ** -p.gamma * (1 + theta) ** (p.gamma - 1)
  const z = phi * k + p.rho
  const w = 0.5 * theta * (1 + p.rho * phi * k + Math.sqrt(z * z + 1 - p.rho * p.rho))
  return Math.sqrt(w / T)
}
