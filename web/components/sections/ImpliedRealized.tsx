'use client'

/**
 * Implied against realized volatility: DVOL and our 30-day ATM vol against the index's
 * realized vol, and the gap between implied and what the index went on to do. Two panels on
 * their own axes, never one dual axis.
 */

import { scaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { useMemo, useState } from 'react'
import { COLORS, DataTable, DrawPath, YAxis, niceTicks } from '@/components/charts/kit'
import { Deferred } from '@/components/charts/Deferred'
import { useWidth } from '@/components/charts/useMeasure'
import { useLive, type Currency } from '@/components/LiveProvider'
import { fixed, utcDate } from '@/lib/format'
import type { VrpView } from '@/lib/vrp'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const M = { top: 20, right: 16, bottom: 30, left: 44 }

export function ImpliedRealized({ views }: { views: Partial<Record<Currency, VrpView>> }) {
  const { currency } = useLive()
  const v = views[currency]
  const name = currency === 'BTC' ? 'Bitcoin' : 'Ether'
  return (
    <section aria-labelledby="vrp-title" className="page mt-24 sm:mt-32">
      <div className="grid-rail">
        <h2 id="vrp-title" className="rail text-h3">
          Implied against realized
        </h2>
        <div className="measure">
          {!v || !v.latest ? (
            <p className="text-graphite">Implied and realized volatility are computed every hour by the worker; none is available right now.</p>
          ) : (
            <>
              <p>
                Implied volatility is what options charge for movement; realized volatility is how much the price actually
                moved. At 00:00 UTC on {utcDate(v.latest.date)}, DVOL, Deribit&rsquo;s 30-day implied volatility index for{' '}
                {name.toLowerCase()}, was <span className="num">{fixed(v.latest.dvol)}</span>, and the index had moved at{' '}
                <span className="num">{fixed(v.latest.realized_30d)}</span> over the previous 30 days: implied was{' '}
                <span className="num">{fixed(Math.abs(v.latest.gap))}</span> points {v.latest.gap >= 0 ? 'above' : 'below'} realized.
                {v.latest.ours_atm30 != null && (
                  <>
                    {' '}Our own 30-day at-the-money vol was <span className="num">{fixed(v.latest.ours_atm30)}</span> at{' '}
                    {v.latest.ours_ts?.slice(11, 16)} UTC; DVOL runs a little higher because it also prices the wings.
                  </>
                )}
              </p>
              {v.forward && (
                <p className="mt-4">
                  The fair comparison is with what came next. From {utcDate(v.forward.start)} to {utcDate(v.forward.end)}, DVOL was
                  above the realized volatility of the following 30 days on{' '}
                  <span className="num">{Math.round(v.forward.share_positive * 100)}%</span> of{' '}
                  <span className="num">{v.forward.days}</span> days, by a median of{' '}
                  <span className="num">{fixed(v.forward.median_gap)}</span> points. That gap is the volatility risk premium: what
                  option sellers were paid, on average, for carrying the risk.
                </p>
              )}
            </>
          )}
        </div>
        {v && v.latest && (
          <div className="wide mt-6">
            <Deferred reserve="min-h-[440px] sm:min-h-[510px]">
              <VrpChart v={v} />
            </Deferred>
            <VrpTable v={v} />
            <p className="mt-3 max-w-[var(--measure)] text-note text-graphite">
              Realized volatility is computed here from Deribit&rsquo;s index price every six hours (annualized root mean square
              of log returns over 30 days). Deribit&rsquo;s own published figure, dashed, covers the last 16 days; its window is not
              documented. Data from Deribit&rsquo;s public API, refreshed hourly.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function VrpChart({ v }: { v: VrpView }) {
  const [ref, w] = useWidth<HTMLDivElement>(900)
  const [hover, setHover] = useState<number | null>(null)
  const h1 = w < 520 ? 240 : 300
  const h2 = w < 520 ? 120 : 150
  const t = useMemo(() => v.days.map((d) => Date.parse(`${d}T00:00:00Z`)), [v.days])
  const x = scaleLinear().domain([t[0], Date.parse(v.generatedAt)]).range([M.left, w - M.right])
  const all = [...v.dvol, ...v.realized, ...v.hv.map((p) => p.v), ...v.ours.map((p) => p.v)].filter((a): a is number => a != null)
  const y = scaleLinear().domain([Math.floor(Math.min(...all) / 10) * 10, Math.ceil(Math.max(...all) / 10) * 10]).range([h1 - M.bottom, M.top])
  const gaps = v.gapForward.filter((a): a is number => a != null)
  const gLo = Math.min(0, ...gaps)
  const gHi = Math.max(0, ...gaps)
  const y2 = scaleLinear().domain([Math.floor(gLo / 10) * 10, Math.ceil(gHi / 10) * 10]).range([h2 - M.bottom, 8])
  const path = (vals: (number | null)[]) =>
    d3line<number | null>()
      .defined((d) => d != null)
      .x((_, i) => x(t[i]))
      .y((d) => y(d as number))(vals) ?? ''
  const hvPath =
    d3line<{ t: string; v: number }>()
      .x((p) => x(Date.parse(p.t)))
      .y((p) => y(p.v))(v.hv) ?? ''
  // Month ticks on the first of each month.
  const months: { x: number; label: string }[] = []
  v.days.forEach((d, i) => {
    if (d.endsWith('-01')) {
      const m = Number(d.slice(5, 7)) - 1
      // The year on January and on the first tick, so a year-long axis reads unambiguously.
      months.push({ x: x(t[i]), label: m === 0 || months.length === 0 ? `${MONTHS[m]} ’${d.slice(2, 4)}` : MONTHS[m] })
    }
  })
  const thin = w < 520 ? months.filter((_, i) => i % 2 === 0) : months
  const bw = Math.max(1, (w - M.left - M.right) / v.days.length - 0.5)
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const tx = x.invert(e.clientX - r.left)
    let best = 0
    for (let i = 0; i < t.length; i++) if (Math.abs(t[i] - tx) < Math.abs(t[best] - tx)) best = i
    setHover(best)
  }
  const last = v.days.length - 1
  const label = (val: number | null, text: string, color: string, dy = 0) =>
    val == null ? null : (
      <text x={w - M.right} y={y(val) + dy} dy="0.32em" textAnchor="end" className="text-[11px]" fill={color}>
        {text}
      </text>
    )
  return (
    <figure ref={ref} className="relative" aria-labelledby="vrp-cap">
      <figcaption id="vrp-cap" className="sr-only">
        DVOL, realized volatility and the forward gap for {v.currency}, daily, over the last year.
      </figcaption>
      <svg width={w} height={h1} aria-hidden="true" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <YAxis scale={y} x={M.left} width={w - M.left - M.right} ticks={niceTicks(...(y.domain() as [number, number]), 5)} format={(a) => `${a}`} label="Vol points" />
        {thin.map((m) => (
          <text key={m.x} x={m.x} y={h1 - 10} textAnchor="middle" className="num fill-graphite text-[11px]">
            {m.label}
          </text>
        ))}
        <DrawPath d={path(v.realized)} stroke={COLORS.ink} width={1.5} opacity={0.8} />
        <DrawPath d={path(v.dvol)} stroke={COLORS.indigo} width={2} delay={0.15} />
        <DrawPath d={hvPath} stroke={COLORS.graphite} width={1.25} dash="4 3" />
        {v.ours.map((p) => (
          <circle key={p.t} cx={x(Date.parse(p.t))} cy={y(p.v)} r={2.5} fill={COLORS.indigo} stroke="var(--color-paper)" strokeWidth={1} />
        ))}
        {label(v.dvol[last], 'DVOL', COLORS.indigo, -12)}
        {label(v.realized[last], 'realized 30-day', COLORS.ink, 12)}
        {hover != null && <line x1={x(t[hover])} x2={x(t[hover])} y1={M.top} y2={h1 - M.bottom} stroke={COLORS.graphite} strokeOpacity={0.5} />}
      </svg>
      <svg width={w} height={h2} aria-hidden="true" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <YAxis scale={y2} x={M.left} width={w - M.left - M.right} ticks={niceTicks(...(y2.domain() as [number, number]), 3)} format={(a) => `${a}`} />
        {v.gapForward.map((g, i) =>
          g == null ? null : (
            <rect key={i} x={x(t[i]) - bw / 2} width={bw} y={Math.min(y2(g), y2(0))} height={Math.abs(y2(g) - y2(0))} fill={g >= 0 ? COLORS.indigo : COLORS.ink} fillOpacity={g >= 0 ? 0.55 : 0.8} />
          ),
        )}
        <line x1={M.left} x2={w - M.right} y1={y2(0)} y2={y2(0)} stroke={COLORS.ink} strokeOpacity={0.6} />
        <text x={M.left + 4} y={12} className="fill-graphite text-[11px]">
          DVOL minus the realized vol of the following 30 days
        </text>
        {hover != null && <line x1={x(t[hover])} x2={x(t[hover])} y1={8} y2={h2 - M.bottom} stroke={COLORS.graphite} strokeOpacity={0.5} />}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute right-4 top-6 rounded-[4px] border border-rule bg-raised px-3 py-2 text-meta">
          <div className="num text-ink">{utcDate(`${v.days[hover]}T00:00:00Z`)}</div>
          <div className="num text-graphite">
            DVOL {v.dvol[hover] != null ? fixed(v.dvol[hover]!) : 'n/a'}, realized {v.realized[hover] != null ? fixed(v.realized[hover]!) : 'n/a'}
            {v.gapForward[hover] != null ? `, gap ${fixed(v.gapForward[hover]!)}` : ''}
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-note text-graphite">
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block h-0.5 w-5 bg-indigo" />DVOL (implied)</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-indigo" />Our 30-day ATM vol</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block h-0.5 w-5 bg-ink" />Realized, past 30 days</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="inline-block w-5 border-t border-dashed border-graphite" />Deribit&rsquo;s historical volatility</span>
      </div>
    </figure>
  )
}

function VrpTable({ v }: { v: VrpView }) {
  return (
    <DataTable
      caption={`DVOL and realized volatility for ${v.currency}, last 30 days`}
      head={['Date', 'DVOL', 'Realized 30-day', 'Gap to the following 30 days']}
      rows={v.days.slice(-30).map((d, j) => {
        const i = v.days.length - 30 + j
        return [d, v.dvol[i] ?? 'n/a', v.realized[i] ?? 'n/a', v.gapForward[i] ?? 'not yet known']
      })}
    />
  )
}
