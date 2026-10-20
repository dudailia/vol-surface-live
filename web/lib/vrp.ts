import type { Vrp } from './generated/vrp'

/** Implied against realized vol for one currency, on one daily grid, for the browser. */
export type VrpView = {
  currency: string
  days: string[] // YYYY-MM-DD, 00:00 UTC
  dvol: (number | null)[]
  realized: (number | null)[]
  gapForward: (number | null)[]
  hv: { t: string; v: number }[] // Deribit's published figure, six-hourly
  ours: { t: string; v: number }[] // our 30-day ATM vol
  latest: Vrp['currencies'][string]['latest']
  forward: Vrp['currencies'][string]['forward']
  generatedAt: string
  method: Record<string, string>
}

const day = (iso: string) => iso.slice(0, 10)

export function vrpView(r: Vrp, currency: string): VrpView | null {
  const c = r.currencies[currency]
  if (!c) return null
  const days = c.dvol.t.map(day)
  const at = (s: { t: string[]; v: number[] }) => {
    const m = new Map(s.t.map((t, i) => [day(t), s.v[i]]))
    return days.map((d) => (m.has(d) ? Math.round(m.get(d)! * 10) / 10 : null))
  }
  // Deribit's hourly figure, thinned to every six hours.
  const hv = c.deribit_hv.t
    .map((t, i) => ({ t, v: Math.round(c.deribit_hv.v[i] * 10) / 10 }))
    .filter((p) => Number(p.t.slice(11, 13)) % 6 === 0)
  const dvol = c.dvol.v.map((v) => Math.round(v * 10) / 10)
  const realized = at(c.realized_30d)
  const gapForward = at(c.gap_forward)
  // Start where there is something to compare: the first day with a realized value or gap.
  const first = days.findIndex((_, i) => realized[i] != null || gapForward[i] != null)
  const from = first < 0 ? 0 : first
  return {
    currency,
    days: days.slice(from),
    dvol: dvol.slice(from),
    realized: realized.slice(from),
    gapForward: gapForward.slice(from),
    hv,
    ours: c.ours_atm30.t.map((t, i) => ({ t, v: Math.round(c.ours_atm30.v[i] * 10) / 10 })),
    latest: c.latest,
    forward: c.forward,
    generatedAt: typeof r.generated_at === 'string' ? r.generated_at : String(r.generated_at),
    method: r.method,
  }
}
