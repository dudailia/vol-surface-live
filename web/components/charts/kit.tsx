'use client'

/**
 * Chart parts, hand-drawn in SVG like the figures on iliaduda.com. Axes and grid are
 * recessive (rule and graphite); the measured value is indigo; the model is ink.
 */

import { m, useReducedMotion } from 'motion/react'
import type { ScaleLinear } from 'd3-scale'

export const COLORS = {
  ink: 'var(--color-ink)',
  graphite: 'var(--color-graphite)',
  rule: 'var(--color-rule)',
  indigo: 'var(--color-indigo)',
  wash: 'var(--color-indigo-wash)',
  flag: 'var(--color-flag)',
}

export type Margin = { top: number; right: number; bottom: number; left: number }

export function XAxis({
  scale,
  y,
  ticks,
  format,
  label,
}: {
  scale: ScaleLinear<number, number>
  y: number
  ticks: number[]
  format: (v: number) => string
  label?: string
}) {
  const [x0, x1] = scale.range()
  return (
    <g aria-hidden="true">
      <line x1={x0} x2={x1} y1={y} y2={y} stroke={COLORS.rule} />
      {ticks.map((t) => (
        <g key={t} transform={`translate(${scale(t)},${y})`}>
          <line y2={4} stroke={COLORS.graphite} strokeOpacity={0.6} />
          <text y={18} textAnchor="middle" className="num fill-graphite text-[11px]">
            {format(t)}
          </text>
        </g>
      ))}
      {label && (
        <text x={x1} y={y + 36} textAnchor="end" className="fill-graphite text-[12px]">
          {label}
        </text>
      )}
    </g>
  )
}

export function YAxis({
  scale,
  x,
  width,
  ticks,
  format,
  label,
}: {
  scale: ScaleLinear<number, number>
  x: number
  width: number
  ticks: number[]
  format: (v: number) => string
  label?: string
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t} transform={`translate(0,${scale(t)})`}>
          <line x1={x} x2={x + width} stroke={COLORS.rule} strokeOpacity={0.7} />
          <text x={x - 8} dy="0.32em" textAnchor="end" className="num fill-graphite text-[11px]">
            {format(t)}
          </text>
        </g>
      ))}
      {label && (
        <text x={x} y={scale.range()[1] - 12} className="fill-graphite text-[12px]">
          {label}
        </text>
      )}
    </g>
  )
}

/** A path that draws itself in once it scrolls into view (instant with reduced motion). */
export function DrawPath({
  d,
  stroke,
  width = 2,
  opacity = 1,
  delay = 0,
  dash,
}: {
  d: string
  stroke: string
  width?: number
  opacity?: number
  delay?: number
  dash?: string
}) {
  const reduce = useReducedMotion()
  return (
    <m.path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeOpacity={opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dash}
      initial={reduce || dash ? false : { pathLength: 0 }}
      whileInView={reduce || dash ? undefined : { pathLength: 1 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.7, delay, ease: [0.23, 1, 0.32, 1] }}
    />
  )
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}

/** Screen-reader table for a chart; the chart itself is aria-hidden decoration over it. */
export function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  // The wrapper carries sr-only: a table ignores the 1px width sr-only sets and widened the page.
  return (
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}
