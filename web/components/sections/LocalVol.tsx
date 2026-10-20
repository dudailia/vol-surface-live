'use client'

/**
 * Dupire local volatility from the fit on screen, as a heatmap over log-moneyness and time,
 * with the grid's limits stated from the data and blank cells explained.
 */

import { scaleLinear } from 'd3-scale'
import { useMemo, useState } from 'react'
import { DataTable, XAxis, YAxis } from '@/components/charts/kit'
import { Deferred } from '@/components/charts/Deferred'
import { useWidth } from '@/components/charts/useMeasure'
import { useLive } from '@/components/LiveProvider'
import { localVolOf, MODEL_NAME } from '@/lib/bundle'
import { fixed } from '@/lib/format'
import { rampColor } from '@/lib/geometry'

const M = { top: 12, right: 76, bottom: 44, left: 52 }

export function LocalVol() {
  const { bundle, model, currency } = useLive()
  const [ref, w] = useWidth<HTMLDivElement>(900)
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null)
  const lv = bundle ? localVolOf(bundle, model) : null
  const h = w < 520 ? 300 : 380

  const stats = useMemo(() => {
    if (!lv) return null
    const vals = lv.vol.flat().filter((v): v is number => v != null)
    const blank = lv.vol.flat().length - vals.length
    return { lo: Math.min(...vals), hi: Math.max(...vals), blank, cells: lv.vol.flat().length }
  }, [lv])
  if (!bundle || !lv || !stats) return null

  const sq = lv.T.map((t) => Math.sqrt(t * 365))
  const x = scaleLinear().domain([lv.k[0], lv.k[lv.k.length - 1]]).range([M.left, w - M.right])
  const y = scaleLinear().domain([sq[0], sq[sq.length - 1]]).range([h - M.bottom, M.top])
  const cw = (x.range()[1] - x.range()[0]) / (lv.k.length - 1)
  const edge = (j: number, side: -1 | 1) => {
    const n = j + side
    return n < 0 || n >= sq.length ? sq[j] : (sq[j] + sq[n]) / 2
  }
  const tdays = [3, 7, 30, 90, 180, 365].filter((t) => Math.sqrt(t) >= sq[0] && Math.sqrt(t) <= sq[sq.length - 1])
  const kTicks = [-0.8, -0.4, 0, 0.4, 0.8].filter((k) => k >= lv.k[0] - 1e-9 && k <= lv.k[lv.k.length - 1] + 1e-9)
  const strikePct = (k: number) => Math.round(Math.exp(k) * 100)
  const name = currency === 'BTC' ? 'bitcoin' : 'ether'
  const hv = hover ? lv.vol[hover.j][hover.i] : null

  return (
    <section aria-labelledby="lv-title" className="page mt-24 sm:mt-32">
      <div className="grid-rail">
        <h2 id="lv-title" className="rail text-h3">
          Local volatility
        </h2>
        <div className="measure">
          <p>
            Implied volatility is one number per option. Local volatility is the volatility the price would need at each level
            and date for a single model to reprice every option on the surface at once (Dupire, 1994). It is read off the
            fitted surface as σ²<sub>loc</sub> = ∂w/∂T ÷ g(k): how fast total variance grows with maturity, divided by the
            curvature term that keeps the implied density positive.
          </p>
          <p className="mt-4">
            For {name}, from the {MODEL_NAME[model]} fit, it runs from <span className="num">{fixed(stats.lo)}%</span> to{' '}
            <span className="num">{fixed(stats.hi)}%</span>. The grid covers log-moneyness from{' '}
            <span className="num">{fixed(lv.k[0], 1)}</span> to <span className="num">{fixed(lv.k[lv.k.length - 1], 1)}</span>{' '}
            (strikes from <span className="num">{strikePct(lv.k[0])}%</span> to{' '}
            <span className="num">{strikePct(lv.k[lv.k.length - 1])}%</span> of the forward) and maturities from the first to
            the last fitted expiry, <span className="num">{fixed(lv.T[0] * 365, 1)}</span> to{' '}
            <span className="num">{Math.round(lv.T[lv.T.length - 1] * 365)}</span> days. {stats.blank} of {stats.cells} cells are
            blank: they lie more than three at-the-money standard deviations from the money, where the surface is
            extrapolation rather than fitted quotes.
          </p>
        </div>
        <figure ref={ref} className="wide relative mt-6" aria-labelledby="lv-cap" onPointerLeave={() => setHover(null)}>
          <Deferred height={h}>
          <svg width={w} height={h} aria-hidden="true">
            {lv.vol.map((row, j) =>
              row.map((v, i) => {
                if (v == null) return null
                const [r, g, b] = rampColor((v - stats.lo) / (stats.hi - stats.lo || 1))
                const y0 = y(edge(j, -1))
                const y1 = y(edge(j, 1))
                return (
                  <rect
                    key={`${i}-${j}`}
                    x={x(lv.k[i]) - cw / 2}
                    y={y1}
                    width={cw + 0.5}
                    height={y0 - y1 + 0.5}
                    fill={`rgb(${r},${g},${b})`}
                    onPointerEnter={() => setHover({ i, j })}
                  />
                )
              }),
            )}
            {hover && (
              <rect
                x={x(lv.k[hover.i]) - cw / 2}
                y={y(edge(hover.j, 1))}
                width={cw}
                height={y(edge(hover.j, -1)) - y(edge(hover.j, 1))}
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth={1.5}
              />
            )}
            <YAxis scale={y} x={M.left} width={0} ticks={tdays.map(Math.sqrt)} format={(v) => `${Math.round(v * v)}d`} />
            <XAxis scale={x} y={h - M.bottom} ticks={kTicks} format={(k) => `${strikePct(k)}%`} label="Strike as % of the forward" />
            <defs>
              <linearGradient id="lv-ramp" x1="0" x2="0" y1="1" y2="0">
                {[0, 1, 2, 3].map((s) => {
                  const [r, g, b] = rampColor(s / 3)
                  return <stop key={s} offset={s / 3} stopColor={`rgb(${r},${g},${b})`} />
                })}
              </linearGradient>
            </defs>
            <rect x={w - M.right + 24} y={M.top} width={10} height={h - M.top - M.bottom} fill="url(#lv-ramp)" />
            <text x={w - M.right + 40} y={M.top} dy="0.7em" className="num fill-graphite text-[11px]">
              {fixed(stats.hi, 0)}%
            </text>
            <text x={w - M.right + 40} y={h - M.bottom} className="num fill-graphite text-[11px]">
              {fixed(stats.lo, 0)}%
            </text>
          </svg>
          </Deferred>
          {hover && hv != null && (
            <div className="pointer-events-none absolute left-16 top-2 rounded-[4px] border border-rule bg-raised px-3 py-2 text-meta">
              <span className="num text-ink">
                {fixed(hv)}% at {strikePct(lv.k[hover.i])}% of the forward, {fixed(lv.T[hover.j] * 365, 0)} days
              </span>
            </div>
          )}
          <figcaption id="lv-cap" className="mt-2 text-note text-graphite">
            Dupire local volatility from the {MODEL_NAME[model]} fit, {lv.k.length} strikes by {lv.T.length} maturities; days on a
            square-root scale. Lighter is higher.
          </figcaption>
          <DataTable
            caption={`Local volatility for ${name}, at-the-money by maturity`}
            head={['Days', 'Local vol at the money, %']}
            rows={lv.T.map((t, j) => {
              const i0 = lv.k.reduce((b, k, i) => (Math.abs(k) < Math.abs(lv.k[b]) ? i : b), 0)
              const v = lv.vol[j][i0]
              return [fixed(t * 365, 1), v == null ? 'blank' : fixed(v, 1)]
            })}
          />
        </figure>
      </div>
    </section>
  )
}
