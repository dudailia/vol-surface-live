'use client'

/**
 * Bitcoin against ether on the same axes: at-the-money term structure, 25-delta risk reversal
 * and 25-delta butterfly by expiry, from the fitted surfaces, updating with every snapshot.
 * Two series, told apart by colour, marker and dash, and labelled directly.
 */

import { scaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { useState } from 'react'
import { COLORS, DataTable, DrawPath, XAxis, YAxis, niceTicks, thinTicks } from '@/components/charts/kit'
import { Deferred } from '@/components/charts/Deferred'
import { useWidth } from '@/components/charts/useMeasure'
import { useLive } from '@/components/LiveProvider'
import { fitsOf, MODEL_NAME, tenorsOf } from '@/lib/bundle'
import { expiryLabel, fixed, signed, utcTime } from '@/lib/format'

const SERIES = {
  BTC: { color: '#6f7cf0', dash: undefined, name: 'Bitcoin' },
  ETH: { color: '#3aa98a', dash: '5 4', name: 'Ether' },
} as const
type Cur = keyof typeof SERIES
type Point = { code: string; days: number; atm: number; rr25: number; bf25: number }
const M = { top: 22, right: 54, bottom: 34, left: 40 }

export function Compare() {
  const { bundles, model } = useLive()
  const btc = bundles.BTC
  const eth = bundles.ETH
  if (!btc || !eth) return null
  const pts = (c: Cur): Point[] =>
    fitsOf(bundles[c]!, model).map((e) => ({ code: e.code, days: e.T * 365, atm: e.stats.atm, rr25: e.stats.rr25, bf25: e.stats.bf25 }))
  const data = { BTC: pts('BTC'), ETH: pts('ETH') }
  const b30 = tenorsOf(btc, model)['30d']
  const e30 = tenorsOf(eth, model)['30d']
  return (
    <section aria-labelledby="compare-title" className="page mt-24 sm:mt-32">
      <div className="grid-rail">
        <h2 id="compare-title" className="rail text-h3">
          Bitcoin against ether
        </h2>
        <div className="measure">
          {b30 && e30 && (
            <p>
              At 30 days, ether&rsquo;s at-the-money vol is <span className="num">{fixed(e30.atm)}%</span> against bitcoin&rsquo;s{' '}
              <span className="num">{fixed(b30.atm)}%</span>, <span className="num">{fixed(Math.abs(e30.atm - b30.atm))}</span> points{' '}
              {e30.atm >= b30.atm ? 'higher' : 'lower'}. The 25-delta risk reversal is{' '}
              <span className="num">{signed(e30.rr25)}</span> for ether and <span className="num">{signed(b30.rr25)}</span> for
              bitcoin, and the butterfly <span className="num">{fixed(e30.bf25)}</span> against{' '}
              <span className="num">{fixed(b30.bf25)}</span>. Both are read from the {MODEL_NAME[model]} fits at {utcTime(btc.ts)}.
            </p>
          )}
        </div>
        <div className="wide mt-6">
          <Deferred reserve="min-h-[874px] md:min-h-[270px]">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              <Panel data={data} field="atm" title="At-the-money vol, %" />
              <Panel data={data} field="rr25" title="25-delta risk reversal, vol points" zero />
              <Panel data={data} field="bf25" title="25-delta butterfly, vol points" zero />
            </div>
          </Deferred>
        </div>
        <div className="wide mt-3 flex flex-wrap gap-x-6 gap-y-1 text-note text-graphite">
          {(['BTC', 'ETH'] as const).map((c) => (
            <span key={c} className="inline-flex items-center gap-2">
              <svg width="26" height="10" aria-hidden="true">
                <line x1="1" x2="25" y1="5" y2="5" stroke={SERIES[c].color} strokeWidth="2" strokeDasharray={SERIES[c].dash} />
                {c === 'BTC' ? <circle cx="13" cy="5" r="3" fill={SERIES[c].color} /> : <rect x="10" y="2" width="6" height="6" fill={SERIES[c].color} />}
              </svg>
              {SERIES[c].name}
            </span>
          ))}
          <span>Days to expiry on a square-root scale. Each point is one listed expiry.</span>
        </div>
        <div className="wide">
          <DataTable
            caption="Bitcoin and ether by expiry"
            head={['Currency', 'Expiry', 'Days', 'ATM vol %', '25d RR', '25d BF']}
            rows={(['BTC', 'ETH'] as const).flatMap((c) =>
              data[c].map((p) => [c, expiryLabel(p.code), Math.round(p.days), fixed(p.atm, 2), fixed(p.rr25, 2), fixed(p.bf25, 2)]),
            )}
          />
        </div>
      </div>
    </section>
  )
}

function Panel({ data, field, title, zero }: { data: Record<Cur, Point[]>; field: 'atm' | 'rr25' | 'bf25'; title: string; zero?: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>(300)
  const [hover, setHover] = useState<{ c: Cur; i: number } | null>(null)
  const h = 240
  const all = [...data.BTC, ...data.ETH]
  const vals = all.map((p) => p[field])
  let lo = Math.min(...vals, ...(zero ? [0] : []))
  let hi = Math.max(...vals, ...(zero ? [0] : []))
  const pad = (hi - lo) * 0.12 || 1
  lo -= pad
  hi += pad
  const x = scaleLinear().domain([0, Math.sqrt(Math.max(...all.map((p) => p.days))) * 1.03]).range([M.left, w - M.right])
  const y = scaleLinear().domain([lo, hi]).range([h - M.bottom, M.top])
  const tdays = [7, 30, 90, 180, 365].filter((t) => Math.sqrt(t) <= x.domain()[1])
  const ticks = niceTicks(lo, hi, 4)
  const dp = ticks.some((t) => !Number.isInteger(t)) ? 1 : 0
  return (
    <figure ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
      <figcaption className="text-note text-graphite">{title}</figcaption>
      <svg width={w} height={h} aria-hidden="true">
        <YAxis scale={y} x={M.left} width={w - M.left - M.right} ticks={ticks} format={(v) => fixed(v, dp)} />
        <XAxis scale={x} y={h - M.bottom} ticks={thinTicks(tdays.map(Math.sqrt), x, 28)} format={(v) => `${Math.round(v * v)}d`} />
        {zero && <line x1={M.left} x2={w - M.right} y1={y(0)} y2={y(0)} stroke={COLORS.ink} strokeOpacity={0.5} />}
        {(['BTC', 'ETH'] as const).map((c) => {
          const s = SERIES[c]
          const pts = data[c]
          const d = d3line<Point>()
            .x((p) => x(Math.sqrt(p.days)))
            .y((p) => y(p[field]))(pts)
          const last = pts[pts.length - 1]
          return (
            <g key={c}>
              {d && <DrawPath d={d} stroke={s.color} width={2} dash={s.dash} />}
              {pts.map((p, i) => {
                const cx = x(Math.sqrt(p.days))
                const cy = y(p[field])
                return (
                  <g key={p.code} onPointerEnter={() => setHover({ c, i })}>
                    {c === 'BTC' ? (
                      <circle cx={cx} cy={cy} r={3.5} fill={s.color} stroke="var(--color-paper)" strokeWidth={1.5} />
                    ) : (
                      <rect x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill={s.color} stroke="var(--color-paper)" strokeWidth={1.5} />
                    )}
                    <circle cx={cx} cy={cy} r={10} fill="transparent" />
                  </g>
                )
              })}
              <text x={x(Math.sqrt(last.days)) + 8} y={y(last[field])} dy="0.32em" className="num text-[11px]" fill={COLORS.ink}>
                {c}
              </text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute right-2 top-6 rounded-[4px] border border-rule bg-raised px-2 py-1 text-meta">
          <span className="num text-ink">
            {hover.c} {expiryLabel(data[hover.c][hover.i].code)}: {fixed(data[hover.c][hover.i][field], 2)}
          </span>
        </div>
      )}
    </figure>
  )
}
