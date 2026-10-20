import { Figure } from '@/components/Figure'
import { ACCENT } from '@/components/figureKit'
import data from '@/lib/volsurface/holdout.json'

/**
 * Fig. 2: error on held-out quotes for every bitcoin snapshot archived on 19 October 2026,
 * SSVI against eSSVI. Each snapshot is fitted twice with every fifth quote held out.
 * From paper/data/model-comparison-2026-10-19.json.
 */

const W = 640
const H = 280
const PAD = { l: 48, r: 16, t: 16, b: 36 }
const rows = data.BTC
const t0 = Date.parse(rows[0].ts)
const t1 = Date.parse(rows[rows.length - 1].ts)
const vals = rows.flatMap((r) => [r.ssvi, r.essvi])
const lo = Math.floor(Math.min(...vals) * 4) / 4
const hi = Math.ceil(Math.max(...vals) * 4) / 4
const x = (ts: string) => PAD.l + ((Date.parse(ts) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r)
const y = (v: number) => H - PAD.b - ((v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
const line = (key: 'ssvi' | 'essvi') => rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.ts).toFixed(1)} ${y(r[key]).toFixed(1)}`).join('')
const ticks = Array.from({ length: Math.round((hi - lo) / 0.25) + 1 }, (_, i) => lo + 0.25 * i)

function Marks() {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" />
          <text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-graphite font-mono text-meta">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      <path d={line('ssvi')} fill="none" stroke="var(--color-ink)" strokeWidth={1.25} strokeDasharray="5 4" strokeOpacity={0.7} />
      <path d={line('essvi')} fill="none" stroke={ACCENT} strokeWidth={1.75} />
      <text x={W - PAD.r} y={y(rows[rows.length - 1].ssvi) - 8} textAnchor="end" className="fill-ink text-meta">SSVI</text>
      <text x={W - PAD.r} y={y(rows[rows.length - 1].essvi) + 16} textAnchor="end" className="fill-ink text-meta">eSSVI</text>
      <text x={PAD.l} y={H - 8} className="fill-graphite text-meta">17:22 UTC</text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-graphite text-meta">midnight</text>
    </g>
  )
}

export function VolSurfaceHoldout() {
  return (
    <Figure
      id="fig-2"
      number="2"
      title="Error on held-out bitcoin quotes, 19 October 2026"
      description={`For each of ${rows.length} snapshots, the root-mean-square error in vol points on every fifth quote, which neither fit saw: eSSVI between ${Math.min(...rows.map((r) => r.essvi)).toFixed(2)} and ${Math.max(...rows.map((r) => r.essvi)).toFixed(2)}, SSVI between ${Math.min(...rows.map((r) => r.ssvi)).toFixed(2)} and ${Math.max(...rows.map((r) => r.ssvi)).toFixed(2)}.`}
      caption={<>Root-mean-square error in vol points on the quotes held out of each fit, one point per five-minute snapshot.</>}
      arrangements={[{ viewBox: `0 0 ${W} ${H}`, width: W, height: H, Marks, className: '', key: 'all' }]}
    />
  )
}
