import { Figure } from '@/components/Figure'
import { ACCENT } from '@/components/figureKit'
import data from '@/lib/volsurface/vrp.json'

/**
 * Fig. 3: bitcoin's DVOL against the realized vol of its index, and DVOL minus the realized
 * vol of the following 30 days, daily for a year. From
 * paper/data/vrp-2026-10-20T0223Z.json (Deribit public API).
 */

const W = 640
const H1 = 220
const H2 = 110
const PAD = { l: 40, r: 12, t: 12, b: 24 }
const n = data.days.length
const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r)
const lv = [...data.dvol, ...data.realized].filter((v): v is number => v != null)
const lo = Math.floor(Math.min(...lv) / 10) * 10
const hi = Math.ceil(Math.max(...lv) / 10) * 10
const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H1 - PAD.t - PAD.b)
const gv = data.gap.filter((v): v is number => v != null)
const glo = Math.floor(Math.min(0, ...gv) / 10) * 10
const ghi = Math.ceil(Math.max(0, ...gv) / 10) * 10
const y2 = (v: number) => H1 + 4 + (1 - (v - glo) / (ghi - glo)) * (H2 - 8)
const path = (vals: (number | null)[]) => {
  let d = ''
  let pen = false
  vals.forEach((v, i) => {
    if (v == null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
    pen = true
  })
  return d
}
const ticks = Array.from({ length: (hi - lo) / 20 + 1 }, (_, i) => lo + 20 * i)
const bw = Math.max(1, (W - PAD.l - PAD.r) / n - 0.4)

function Marks() {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" />
          <text x={PAD.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-graphite font-mono text-meta">
            {t}
          </text>
        </g>
      ))}
      <path d={path(data.realized)} fill="none" stroke="var(--color-ink)" strokeWidth={1.25} strokeOpacity={0.8} />
      <path d={path(data.dvol)} fill="none" stroke={ACCENT} strokeWidth={1.5} />
      {data.gap.map((g, i) =>
        g == null ? null : (
          <rect key={i} x={x(i) - bw / 2} width={bw} y={Math.min(y2(g), y2(0))} height={Math.abs(y2(g) - y2(0))} fill={g >= 0 ? ACCENT : 'var(--color-ink)'} fillOpacity={0.6} />
        ),
      )}
      <line x1={PAD.l} x2={W - PAD.r} y1={y2(0)} y2={y2(0)} stroke="var(--color-ink)" strokeOpacity={0.6} />
      <text x={W - PAD.r} y={y(data.dvol[n - 1]) - 8} textAnchor="end" className="fill-ink text-meta">DVOL</text>
      <text x={W - PAD.r} y={H1 - 6} textAnchor="end" className="fill-graphite text-meta">realized, past 30 days</text>
      <text x={PAD.l} y={H1 + H2 + 12} className="fill-graphite text-meta">{data.days[0]}</text>
      <text x={W - PAD.r} y={H1 + H2 + 12} textAnchor="end" className="fill-graphite text-meta">{data.days[n - 1]}</text>
    </g>
  )
}

export function VolSurfaceVrp() {
  return (
    <Figure
      id="fig-3"
      number="3"
      title="Bitcoin: implied against realized volatility, a year to 20 October 2026"
      description={`Daily, ${data.days[0]} to ${data.days[n - 1]}: DVOL, Deribit's 30-day implied volatility index, between ${Math.min(...data.dvol).toFixed(0)} and ${Math.max(...data.dvol).toFixed(0)}; the index's realized volatility over the previous 30 days; and below, DVOL minus the realized volatility of the following 30 days, between ${glo} and ${ghi} points.`}
      caption={
        <>
          Top: DVOL and the realized volatility of Deribit&rsquo;s index over the previous 30 days, in vol points. Bottom: DVOL minus
          the realized volatility of the following 30 days; above the line, options charged more than the price then moved.
        </>
      }
      arrangements={[{ viewBox: `0 0 ${W} ${H1 + H2 + 16}`, width: W, height: H1 + H2 + 16, Marks, className: '', key: 'all' }]}
    />
  )
}
