'use client'

/**
 * The explainer's sticky figure. One chart per step, each drawn from the live snapshot.
 * Steps build on each other: quotes, then total variance, then the fit, then the checks
 * on it, then what the fit says (skew, term structure, local vol).
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { scaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { useMemo, useState } from 'react'
import type { Bundle } from '@/lib/generated/bundle'
import { checksOf, fitsOf, localVolOf, MODEL_NAME, nearestExpiry, surfaceOf, type Model } from '@/lib/bundle'
import { expiryLabel, fixed } from '@/lib/format'
import { rampColor } from '@/lib/geometry'
import { sliceG, sliceOf, sliceW } from '@/lib/ssvi'
import { COLORS, DataTable, DrawPath, XAxis, YAxis, niceTicks } from './kit'
import { useWidth } from './useMeasure'

export const STEPS = 7

type Props = { bundle: Bundle; step: number; model: Model }

const M = { top: 28, right: 20, bottom: 48, left: 52 }

function sliceColor(i: number, n: number) {
  const [r, g, b] = rampColor(0.3 + (0.7 * i) / Math.max(n - 1, 1))
  return `rgb(${r},${g},${b})`
}

function marketAtm(e: Bundle['expiries'][number]): number | null {
  const { k, mid_iv } = e.quotes
  let lo = -1
  let hi = -1
  for (let i = 0; i < k.length; i++) {
    if (k[i] <= 0 && (lo < 0 || k[i] > k[lo])) lo = i
    if (k[i] >= 0 && (hi < 0 || k[i] < k[hi])) hi = i
  }
  if (lo < 0 || hi < 0) return null
  if (lo === hi) return mid_iv[lo]
  const t = (0 - k[lo]) / (k[hi] - k[lo])
  return mid_iv[lo] + (mid_iv[hi] - mid_iv[lo]) * t
}

export function ExplainerFigure({ bundle, step, model }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(640)
  const height = width < 520 ? 250 : 400
  // Room for the caption under the chart, so it never spills over the steps below.
  const caption = width < 520 ? 64 : 48
  const reduce = useReducedMotion()
  return (
    <div ref={ref} className="relative w-full" style={{ height: height + caption }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className="absolute inset-0"
          initial={reduce ? false : { opacity: 0, filter: 'blur(2px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={reduce ? undefined : { opacity: 0, filter: 'blur(2px)', transition: { duration: 0.12 } }}
          transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
        >
          {step === 1 && <QuotesChart bundle={bundle} model={model} w={width} h={height} />}
          {step === 2 && <VarianceChart bundle={bundle} model={model} w={width} h={height} fitted={false} />}
          {step === 3 && <VarianceChart bundle={bundle} model={model} w={width} h={height} fitted />}
          {step === 4 && <DensityChart bundle={bundle} model={model} w={width} h={height} />}
          {step === 5 && <SkewChart bundle={bundle} model={model} w={width} h={height} />}
          {step === 6 && <TermChart bundle={bundle} model={model} w={width} h={height} />}
          {step === 7 && <LocalVolChart bundle={bundle} model={model} w={width} h={height} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// 1. Implied vol for one expiry: bid-ask bars, mid dot, the fit as a thin ink line.
function QuotesChart({ bundle, model, w, h }: { bundle: Bundle; model: Model; w: number; h: number }) {
  const e = nearestExpiry(bundle, 30)
  const i = bundle.expiries.indexOf(e)
  const s = surfaceOf(bundle, model)
  const q = e.quotes
  const [hover, setHover] = useState<number | null>(null)
  const x = scaleLinear().domain([Math.min(...q.k) - 0.02, Math.max(...q.k) + 0.02]).range([M.left, w - M.right])
  const vlo = Math.min(...q.bid_iv) * 100
  const vhi = Math.max(...q.ask_iv) * 100
  const y = scaleLinear().domain([Math.floor(vlo / 5) * 5, Math.ceil(vhi / 5) * 5]).range([h - M.bottom, M.top])
  const ks = Array.from({ length: 80 }, (_, j) => x.domain()[0] + ((x.domain()[1] - x.domain()[0]) * j) / 79)
  const fit = d3line<number>()
    .x((k) => x(k))
    .y((k) => y(Math.sqrt(sliceW(k, sliceOf(s, i)) / s.T[i]) * 100))(ks)
  const strikeTicks = niceTicks(x.domain()[0], x.domain()[1], 5)
  return (
    <figure className="h-full" aria-labelledby="fig1-cap">
      <svg width={w} height={h} aria-hidden="true" onPointerLeave={() => setHover(null)}>
        <YAxis scale={y} x={M.left} width={w - M.left - M.right} ticks={niceTicks(...(y.domain() as [number, number]), 5)} format={(v) => `${v}%`} label="Implied vol" />
        <XAxis scale={x} y={h - M.bottom} ticks={strikeTicks} format={(k) => `${Math.round(Math.exp(k) * 100)}%`} label="Strike as % of the forward" />
        {fit && <DrawPath d={fit} stroke={COLORS.ink} width={1.5} opacity={0.75} delay={0.2} />}
        {q.k.map((k, j) => (
          <g key={j}>
            <line x1={x(k)} x2={x(k)} y1={y(q.bid_iv[j] * 100)} y2={y(q.ask_iv[j] * 100)} stroke={COLORS.indigo} strokeOpacity={0.45} strokeWidth={2} />
            <circle cx={x(k)} cy={y(q.mid_iv[j] * 100)} r={hover === j ? 4.5 : 3} fill={q.flags[j] ? COLORS.flag : COLORS.indigo} stroke="var(--color-paper)" strokeWidth={1.5} />
            <rect x={x(k) - 7} y={M.top} width={14} height={h - M.top - M.bottom} fill="transparent" onPointerEnter={() => setHover(j)} />
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute right-5 top-0 text-right text-meta">
          <div className="num text-ink">{q.instrument[hover]}</div>
          <div className="num text-graphite">
            bid {fixed(q.bid_iv[hover] * 100)}% ask {fixed(q.ask_iv[hover] * 100)}%
          </div>
        </div>
      )}
      <figcaption id="fig1-cap" className="mt-1 text-note text-graphite">
        {expiryLabel(e.code)} expiry, {e.n} quotes. Bars run from bid to ask; dots are mids; the line is the {MODEL_NAME[model]} fit.
      </figcaption>
      <DataTable
        caption={`Quotes for the ${expiryLabel(e.code)} expiry`}
        head={['Instrument', 'Bid IV %', 'Ask IV %', 'Mid IV %']}
        rows={q.k.map((_, j) => [q.instrument[j], fixed(q.bid_iv[j] * 100, 2), fixed(q.ask_iv[j] * 100, 2), fixed(q.mid_iv[j] * 100, 2)])}
      />
    </figure>
  )
}

// 2 and 3. Total variance against log-moneyness for every expiry; then the SSVI fit.
function VarianceChart({ bundle, model, w, h, fitted }: { bundle: Bundle; model: Model; w: number; h: number; fitted: boolean }) {
  const s = surfaceOf(bundle, model)
  const ex = bundle.expiries
  const kLo = -0.6
  const kHi = 0.5
  const x = scaleLinear().domain([kLo, kHi]).range([M.left, w - M.right])
  const wMax = Math.max(
    ...ex.flatMap((e) => e.quotes.k.map((k, j) => (k >= kLo && k <= kHi ? e.quotes.mid_iv[j] ** 2 * e.T : 0))),
    ...ex.map((_, i) => Math.max(sliceW(kLo, sliceOf(s, i)), sliceW(kHi, sliceOf(s, i)))),
  )
  const y = scaleLinear().domain([0, wMax * 1.05]).range([h - M.bottom, M.top])
  const ks = Array.from({ length: 90 }, (_, j) => kLo + ((kHi - kLo) * j) / 89)
  const last = ex.length - 1
  return (
    <figure className="h-full" aria-labelledby="fig2-cap">
      <svg width={w} height={h} aria-hidden="true">
        <YAxis scale={y} x={M.left} width={w - M.left - M.right} ticks={niceTicks(0, wMax, 4)} format={(v) => fixed(v, 2)} label="Total variance σ²T" />
        <XAxis scale={x} y={h - M.bottom} ticks={[-0.6, -0.4, -0.2, 0, 0.2, 0.4]} format={(k) => (k === 0 ? '0' : fixed(k))} label="Log-moneyness k = ln(K/F)" />
        {ex.map((e, i) => {
          const color = sliceColor(i, ex.length)
          const pts = e.quotes.k.map((k, j) => [k, e.quotes.mid_iv[j] ** 2 * e.T] as const).filter(([k]) => k >= kLo && k <= kHi)
          const d = d3line<number>()
            .x((k) => x(k))
            .y((k) => y(sliceW(k, sliceOf(s, i))))(ks)
          return (
            <g key={e.code}>
              {fitted && d && <DrawPath d={d} stroke={color} width={1.75} delay={0.05 * i} />}
              {pts.map(([k, v], j) => (
                <circle key={j} cx={x(k)} cy={y(v)} r={fitted ? 1.8 : 2.4} fill={color} fillOpacity={fitted ? 0.55 : 0.9} />
              ))}
            </g>
          )
        })}
        {/* Direct labels for the first and last expiry; the shade runs between them. */}
        {[0, last].map((i) => (
          <text key={i} x={x(kHi) - 4} y={y(sliceW(kHi, sliceOf(s, i))) - 6} textAnchor="end" className="num text-[11px]" fill={sliceColor(i, ex.length)}>
            {expiryLabel(ex[i].code)}
          </text>
        ))}
      </svg>
      <figcaption id="fig2-cap" className="mt-1 text-note text-graphite">
        {fitted
          ? model === 'essvi' && bundle.essvi
            ? `eSSVI fit, ρ from ${fixed(Math.min(...bundle.essvi.rho), 2)} to ${fixed(Math.max(...bundle.essvi.rho), 2)} across expiries. Darker lines are nearer expiries.`
            : `SSVI fit with ρ ${fixed(bundle.ssvi.rho, 2)}, η ${fixed(bundle.ssvi.eta, 2)}, γ ${fixed(bundle.ssvi.gamma, 2)}. Darker lines are nearer expiries.`
          : `Mid quotes for all ${ex.length} expiries. Darker dots are nearer expiries; later expiries sit higher.`}
      </figcaption>
      <DataTable
        caption="Fitted ATM total variance by expiry"
        head={['Expiry', 'Years', 'θ (ATM total variance)', 'RMSE, vol points']}
        rows={fitsOf(bundle, model).map((e, i) => [expiryLabel(e.code), fixed(e.T, 3), fixed(s.theta[i], 4), fixed(e.rmse_vol_pts, 2)])}
      />
    </figure>
  )
}

// 4. Durrleman's g(k) for each fitted slice: positive everywhere means no butterfly arbitrage.
function DensityChart({ bundle, model, w, h }: { bundle: Bundle; model: Model; w: number; h: number }) {
  const s = surfaceOf(bundle, model)
  const ex = bundle.expiries
  const ks = Array.from({ length: 120 }, (_, j) => -1.2 + (2.4 * j) / 119)
  const gs = ex.map((_, i) => ks.map((k) => sliceG(k, sliceOf(s, i))))
  const gMax = Math.max(...gs.flat())
  const x = scaleLinear().domain([-1.2, 1.2]).range([M.left, w - M.right])
  const y = scaleLinear().domain([-0.1, Math.min(gMax, 1.4)]).range([h - M.bottom, M.top])
  return (
    <figure className="h-full" aria-labelledby="fig4-cap">
      <svg width={w} height={h} aria-hidden="true">
        <YAxis scale={y} x={M.left} width={w - M.left - M.right} ticks={niceTicks(0, Math.min(gMax, 1.4), 4)} format={(v) => fixed(v, 1)} label="g(k)" />
        <XAxis scale={x} y={h - M.bottom} ticks={[-1, -0.5, 0, 0.5, 1]} format={(k) => (k === 0 ? '0' : fixed(k))} label="Log-moneyness k" />
        <line x1={M.left} x2={w - M.right} y1={y(0)} y2={y(0)} stroke={COLORS.ink} strokeDasharray="4 4" strokeOpacity={0.7} />
        <text x={w - M.right} y={y(0) + 16} textAnchor="end" className="fill-graphite text-[11px]">
          Arbitrage below this line
        </text>
        {gs.map((g, i) => {
          const d = d3line<number>()
            .x((_, j) => x(ks[j]))
            .y((v) => y(Math.min(v, 1.4)))(g)
          return d ? <DrawPath key={i} d={d} stroke={sliceColor(i, ex.length)} width={1.5} delay={0.04 * i} /> : null
        })}
      </svg>
      <figcaption id="fig4-cap" className="mt-1 text-note text-graphite">
        Lowest g(k) on the {MODEL_NAME[model]} surface: <span className="num">{fixed(checksOf(bundle, model).min_g, 3)}</span>. Raw quotes checked at the same time:{' '}
        <span className="num">{Object.values(bundle.arbitrage.counts.mid ?? {}).reduce((a, b) => a + b, 0)}</span> failures at mid,{' '}
        <span className="num">{Object.values(bundle.arbitrage.counts.tradeable ?? {}).reduce((a, b) => a + b, 0)}</span> tradeable.
      </figcaption>
    </figure>
  )
}

// 5. 25-delta risk reversal and butterfly by expiry, as two panels (never one dual axis).
function SkewChart({ bundle, model, w, h }: { bundle: Bundle; model: Model; w: number; h: number }) {
  const ex = fitsOf(bundle, model)
  const stacked = w < 560
  const pw = stacked ? w : (w - 24) / 2
  const ph = stacked ? (h - 24) / 2 : h
  const panel = (key: 'rr25' | 'bf25', title: string, ox: number, oy: number) => {
    const vals = ex.map((e) => e.stats[key])
    const lo = Math.min(0, ...vals)
    const hi = Math.max(0, ...vals)
    const pad = (hi - lo) * 0.15 || 1
    const m = { ...M, bottom: 40, top: 24 }
    const x = scaleLinear().domain([0, Math.sqrt(ex[ex.length - 1].T * 365)]).range([m.left, pw - m.right])
    const y = scaleLinear().domain([lo - pad, hi + pad]).range([ph - m.bottom, m.top])
    const d = d3line<(typeof ex)[number]>()
      .x((e) => x(Math.sqrt(e.T * 365)))
      .y((e) => y(e.stats[key]))(ex)
    const tdays = [7, 30, 90, 180, 365].filter((t) => Math.sqrt(t) <= x.domain()[1])
    return (
      <g transform={`translate(${ox},${oy})`}>
        <YAxis scale={y} x={m.left} width={pw - m.left - m.right} ticks={niceTicks(lo - pad, hi + pad, 4)} format={(v) => fixed(v, 1)} label={title} />
        <XAxis scale={x} y={ph - m.bottom} ticks={tdays.map(Math.sqrt)} format={(v) => `${Math.round(v * v)}d`} />
        <line x1={m.left} x2={pw - m.right} y1={y(0)} y2={y(0)} stroke={COLORS.ink} strokeOpacity={0.5} />
        {d && <DrawPath d={d} stroke={COLORS.indigo} width={2} />}
        {ex.map((e) => (
          <circle key={e.code} cx={x(Math.sqrt(e.T * 365))} cy={y(e.stats[key])} r={3} fill={COLORS.indigo} stroke="var(--color-paper)" strokeWidth={1.5} />
        ))}
      </g>
    )
  }
  return (
    <figure className="h-full" aria-labelledby="fig5-cap">
      <svg width={w} height={h} aria-hidden="true">
        {panel('rr25', '25-delta risk reversal, vol points', 0, 0)}
        {panel('bf25', '25-delta butterfly, vol points', stacked ? 0 : pw + 24, stacked ? ph + 24 : 0)}
      </svg>
      <figcaption id="fig5-cap" className="mt-1 text-note text-graphite">
        From the fitted smile at each expiry, using forward delta. Days to expiry on a square-root scale.
      </figcaption>
      <DataTable
        caption="Skew by expiry"
        head={['Expiry', 'Days', 'ATM vol %', '25d RR', '25d BF']}
        rows={ex.map((e) => [expiryLabel(e.code), Math.round(e.T * 365), fixed(e.stats.atm, 2), fixed(e.stats.rr25, 2), fixed(e.stats.bf25, 2)])}
      />
    </figure>
  )
}

// 6. ATM term structure: fitted √(θ/T) as a line, market ATM (interpolated mids) as dots.
function TermChart({ bundle, model, w, h }: { bundle: Bundle; model: Model; w: number; h: number }) {
  const ex = fitsOf(bundle, model)
  const [hover, setHover] = useState<number | null>(null)
  const mk = bundle.expiries.map(marketAtm)
  const vals = [...ex.map((e) => e.stats.atm), ...mk.filter((v): v is number => v != null).map((v) => v * 100)]
  const lo = Math.floor(Math.min(...vals) / 5) * 5
  const hi = Math.ceil(Math.max(...vals) / 5) * 5
  const x = scaleLinear().domain([0, Math.sqrt(ex[ex.length - 1].T * 365) * 1.03]).range([M.left, w - M.right])
  const y = scaleLinear().domain([lo, hi]).range([h - M.bottom, M.top])
  const d = d3line<(typeof ex)[number]>()
    .x((e) => x(Math.sqrt(e.T * 365)))
    .y((e) => y(e.stats.atm))(ex)
  const tdays = [7, 30, 90, 180, 365].filter((t) => Math.sqrt(t) <= x.domain()[1])
  return (
    <figure className="h-full" aria-labelledby="fig6-cap">
      <svg width={w} height={h} aria-hidden="true" onPointerLeave={() => setHover(null)}>
        <YAxis scale={y} x={M.left} width={w - M.left - M.right} ticks={niceTicks(lo, hi, 5)} format={(v) => `${v}%`} label="At-the-money vol" />
        <XAxis scale={x} y={h - M.bottom} ticks={tdays.map(Math.sqrt)} format={(v) => `${Math.round(v * v)}d`} label="Days to expiry (square-root scale)" />
        {hover != null && <line x1={x(Math.sqrt(ex[hover].T * 365))} x2={x(Math.sqrt(ex[hover].T * 365))} y1={M.top} y2={h - M.bottom} stroke={COLORS.graphite} strokeOpacity={0.5} />}
        {d && <DrawPath d={d} stroke={COLORS.ink} width={1.75} opacity={0.85} />}
        {ex.map((e, i) => {
          const cx = x(Math.sqrt(e.T * 365))
          return (
            <g key={e.code}>
              {mk[i] != null && <circle cx={cx} cy={y(mk[i]! * 100)} r={4} fill={COLORS.indigo} stroke="var(--color-paper)" strokeWidth={1.5} />}
              <rect x={cx - 12} y={M.top} width={24} height={h - M.top - M.bottom} fill="transparent" onPointerEnter={() => setHover(i)} />
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute right-5 top-0 text-right text-meta">
          <div className="num text-ink">{expiryLabel(ex[hover].code)}</div>
          <div className="num text-graphite">
            fit {fixed(ex[hover].stats.atm)}%{mk[hover] != null ? `, market ${fixed(mk[hover]! * 100)}%` : ''}
          </div>
        </div>
      )}
      <figcaption id="fig6-cap" className="mt-1 text-note text-graphite">
        Line: {MODEL_NAME[model]} ATM vol. Dots: market ATM vol, interpolated from the two quotes either side of the forward.
      </figcaption>
      <DataTable
        caption="ATM vol by expiry"
        head={['Expiry', 'Days', 'Fitted ATM %', 'Market ATM %']}
        rows={ex.map((e, i) => [expiryLabel(e.code), Math.round(e.T * 365), fixed(e.stats.atm, 2), mk[i] != null ? fixed(mk[i]! * 100, 2) : 'n/a'])}
      />
    </figure>
  )
}

// 7. Dupire local vol as a heatmap on the (k, T) grid the worker computes.
function LocalVolChart({ bundle, model, w, h }: { bundle: Bundle; model: Model; w: number; h: number }) {
  const lv = localVolOf(bundle, model)
  const all = lv.vol.flat().filter((v): v is number => v != null)
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const x = scaleLinear().domain([lv.k[0], lv.k[lv.k.length - 1]]).range([M.left, w - M.right - 84])
  const sq = lv.T.map((t) => Math.sqrt(t * 365))
  const y = scaleLinear().domain([sq[0], sq[sq.length - 1]]).range([h - M.bottom, M.top])
  const cw = (x.range()[1] - x.range()[0]) / (lv.k.length - 1)
  const cells = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number; fill: string; v: number }[] = []
    lv.vol.forEach((row, j) => {
      const y0 = y(j === 0 ? sq[0] : (sq[j] + sq[j - 1]) / 2)
      const y1 = y(j === sq.length - 1 ? sq[j] : (sq[j] + sq[j + 1]) / 2)
      row.forEach((v, i) => {
        if (v == null) return
        const [r, g, b] = rampColor((v - lo) / (hi - lo || 1))
        out.push({ x: x(lv.k[i]) - cw / 2, y: y1, w: cw + 0.5, h: y0 - y1 + 0.5, fill: `rgb(${r},${g},${b})`, v })
      })
    })
    return out
  }, [lv, x, y, sq, cw, lo, hi])
  const tdays = [7, 30, 90, 180, 365].filter((t) => Math.sqrt(t) >= sq[0] && Math.sqrt(t) <= sq[sq.length - 1])
  return (
    <figure className="h-full" aria-labelledby="fig7-cap">
      <svg width={w} height={h} aria-hidden="true">
        {cells.map((c, i) => (
          <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.fill} />
        ))}
        <YAxis scale={y} x={M.left} width={0} ticks={tdays.map(Math.sqrt)} format={(v) => `${Math.round(v * v)}d`} />
        <XAxis scale={x} y={h - M.bottom} ticks={[-0.8, -0.4, 0, 0.4, 0.8]} format={(k) => (k === 0 ? '0' : fixed(k))} label="Log-moneyness k" />
        {/* Legend: the ramp with its end values. */}
        <defs>
          <linearGradient id="lvramp" x1="0" x2="0" y1="1" y2="0">
            {[0, 1, 2, 3].map((i) => {
              const [r, g, b] = rampColor(i / 3)
              return <stop key={i} offset={i / 3} stopColor={`rgb(${r},${g},${b})`} />
            })}
          </linearGradient>
        </defs>
        <rect x={w - M.right - 28} y={M.top} width={10} height={h - M.top - M.bottom} fill="url(#lvramp)" />
        <text x={w - M.right - 34} y={M.top} dy="0.7em" textAnchor="end" className="num fill-graphite text-[11px]">{fixed(hi, 0)}%</text>
        <text x={w - M.right - 34} y={h - M.bottom} textAnchor="end" className="num fill-graphite text-[11px]">{fixed(lo, 0)}%</text>
      </svg>
      <figcaption id="fig7-cap" className="mt-1 text-note text-graphite">
        Dupire local vol from the {MODEL_NAME[model]} surface, {fixed(lo, 0)}% to {fixed(hi, 0)}%. Cells further than 3 ATM standard deviations out are left blank.
      </figcaption>
    </figure>
  )
}
