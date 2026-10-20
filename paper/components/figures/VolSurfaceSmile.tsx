import { Figure } from '@/components/Figure'
import { ACCENT } from '@/components/figureKit'
import snap from '@/lib/volsurface/snapshot.json'
import { essviSlice, sliceVol, ssviSlice } from '@/lib/volsurface/ssvi'

/**
 * Fig. 1: one expiry of the archived snapshot with both fits. Bid-to-ask bars and mid dots
 * in indigo (the measurement); eSSVI solid and SSVI dashed in ink (the models); quotes that
 * fail a raw static-arbitrage check ringed. Drawn from
 * paper/data/snapshot-2026-10-20T0154Z.json, not typed in.
 */

const W = 640
const H = 360
const PAD = { l: 48, r: 16, t: 16, b: 40 }

const k0 = Math.min(...snap.k)
const k1 = Math.max(...snap.k)
const vLo = Math.floor((Math.min(...snap.bid) * 100) / 5) * 5
const vHi = Math.ceil((Math.max(...snap.ask) * 100) / 5) * 5
const x = (k: number) => PAD.l + ((k - k0) / (k1 - k0)) * (W - PAD.l - PAD.r)
const y = (v: number) => H - PAD.b - ((v * 100 - vLo) / (vHi - vLo)) * (H - PAD.t - PAD.b)
const ssvi = ssviSlice(snap.ssvi.theta, snap.ssvi.rho, snap.ssvi.eta, snap.ssvi.gamma)
const essvi = essviSlice(snap.essvi.theta, snap.essvi.rho, snap.essvi.psi)
const path = (sl: typeof ssvi) =>
  Array.from({ length: 81 }, (_, i) => k0 + ((k1 - k0) * i) / 80)
    .map((k, i) => `${i ? 'L' : 'M'}${x(k).toFixed(1)} ${y(sliceVol(k, sl, snap.T)).toFixed(1)}`)
    .join('')
const ticks = Array.from({ length: (vHi - vLo) / 5 + 1 }, (_, i) => vLo + 5 * i)

function Marks() {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t / 100)} y2={y(t / 100)} stroke="var(--color-rule)" />
          <text x={PAD.l - 6} y={y(t / 100)} dy="0.32em" textAnchor="end" className="fill-graphite font-mono text-meta">
            {t}%
          </text>
        </g>
      ))}
      <path d={path(ssvi)} fill="none" stroke="var(--color-ink)" strokeWidth={1.25} strokeDasharray="5 4" strokeOpacity={0.7} />
      <path d={path(essvi)} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} />
      {snap.k.map((k, i) => (
        <g key={k}>
          <line x1={x(k)} x2={x(k)} y1={y(snap.bid[i])} y2={y(snap.ask[i])} stroke={ACCENT} strokeOpacity={0.5} strokeWidth={2} />
          <circle cx={x(k)} cy={y(snap.mid[i])} r={2.5} fill={ACCENT} />
          {snap.flags[i] !== 0 && <circle cx={x(k)} cy={y(snap.mid[i])} r={6} fill="none" stroke="var(--color-ink)" />}
        </g>
      ))}
      <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-graphite text-meta">
        log-moneyness k = ln(K/F)
      </text>
    </g>
  )
}

export function VolSurfaceSmile() {
  const n = snap.k.length
  return (
    <Figure
      id="fig-1"
      number="1"
      title={`Bitcoin options expiring ${snap.code}, 01:54 UTC on 20 October 2026`}
      description={`${n} quotes from bid to ask in implied vol, between ${vLo}% and ${vHi}%, with the eSSVI fit (solid) and the SSVI fit (dashed) drawn through their mids.`}
      caption={
        <>
          Bars run from bid to ask and dots are mids. The solid line is eSSVI, the dashed line SSVI. Ringed quotes fail a raw
          static-arbitrage check at mid. The live surface is at <a href="https://vol.iliaduda.com">vol.iliaduda.com</a>.
        </>
      }
      arrangements={[{ viewBox: `0 0 ${W} ${H}`, width: W, height: H, Marks, className: '', key: 'all' }]}
    />
  )
}
