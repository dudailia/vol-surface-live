import type { CSSProperties, ReactNode } from 'react'
import { rampColor } from '../../web/lib/geometry'
import { D, nearestSnap, smile } from './data'
import { C, MONO, SERIF, type Layout } from './layout'
import { lapseMs, LAPSE } from './three/Scene'
import { clamp01, easeInOut, easeOut, lerp, prog } from './timeline'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
const minus = (x: number, dp = 1) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(dp)
const num: CSSProperties = { fontFamily: MONO, fontVariantNumeric: 'tabular-nums lining-nums', fontFeatureSettings: "'tnum' 1, 'lnum' 1" }

/** An entrance: rises and fades in on the strong ease-out. No blur: type is sharp on every frame. */
function enter(t: number, at: number, dur = 0.55, dist = 0.4): CSSProperties {
  const x = prog(t, at, at + dur)
  return { opacity: x, transform: `translateY(${(1 - x) * dist}em)` }
}
function leave(t: number, at: number, dur = 0.25): number {
  return 1 - prog(t, at, at + dur)
}

/** A caption: one plain line (it may wrap), words revealed 45 ms apart. */
function Caption({ t, from, to, text, L, size }: { t: number; from: number; to: number; text: string; L: Layout; size?: number }) {
  if (t < from - 0.01 || t > to + 0.3) return null
  const lines = text.split('\n')
  let n = 0
  return (
    <div
      style={{
        position: 'absolute', left: L.padX, right: L.padX, bottom: L.bottom, textAlign: 'center',
        fontFamily: SERIF, fontWeight: 600, fontSize: size ?? L.caption, lineHeight: 1.12, letterSpacing: '-0.018em',
        color: C.ink, opacity: leave(t, to), textShadow: '0 2px 28px rgba(17,19,22,0.95), 0 0 2px rgba(17,19,22,0.8)',
      }}
    >
      {lines.map((line, li) => (
        <div key={li} style={{ textWrap: 'balance' } as CSSProperties}>
          {line.split(' ').map((w, i) => (
            <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', ...enter(t, from + n++ * 0.045) }}>
              {w}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The hook's caption size: as large as two lines allow on each frame. */
const hook = (L: Layout) => L.caption * (L.kind === 'vertical' ? 1.12 : 1.3)

function Sub({ t, at, to, children, L }: { t: number; at: number; to: number; children: ReactNode; L: Layout }) {
  if (t < at - 0.01 || t > to + 0.3) return null
  return (
    <div
      style={{
        position: 'absolute', left: L.padX, right: L.padX, bottom: L.bottom + hook(L) * 1.12 * 2 + 26 * L.s,
        textAlign: 'center', ...num, fontSize: 28 * L.s, color: '#c4c8d0', letterSpacing: '0.01em',
        opacity: leave(t, to), ...enter(t, at),
      }}
    >
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ time-lapse readout
function LapseHud({ t, L }: { t: number; L: Layout }) {
  const on = t > LAPSE.in[0] + 0.2 && t < 14.3
  if (!on) return null
  const ms = lapseMs(t)
  const [ts, atm] = nearestSnap(ms)
  const d = new Date(ts)
  const series = D.timelapse.atm30
  const vals = series.map((s) => s[1])
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const w = L.kind === 'wide' ? 560 * L.s : L.kind === 'vertical' ? L.W - 2 * L.padX : 420 * L.s
  const h = 84 * L.s
  const t0 = Date.parse(series[0][0]), t1 = Date.parse(series[series.length - 1][0])
  const X = (s: string) => ((Date.parse(s) - t0) / (t1 - t0)) * w
  const Y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * h
  const shown = series.filter((s) => Date.parse(s[0]) <= ms)
  const path = shown.map((s, i) => `${i ? 'L' : 'M'}${X(s[0]).toFixed(1)},${Y(s[1]).toFixed(1)}`).join('')
  const out = leave(t, 14.0)
  const center = L.kind === 'vertical'
  return (
    <div style={{ position: 'absolute', top: L.top, left: L.padX, right: center ? L.padX : undefined, opacity: out, textAlign: center ? 'center' : 'left' }}>
      <div style={{ ...num, fontSize: 30 * L.s, color: C.graphite, ...enter(t, 7.25) }}>
        {d.getUTCDate()} {MON[d.getUTCMonth()]} {d.getUTCFullYear()}, <span style={{ color: C.ink }}>{hhmm(d)}</span> UTC
      </div>
      <div style={{ ...num, fontSize: 124 * L.s, fontWeight: 500, color: C.ink, lineHeight: 1, marginTop: 10 * L.s, letterSpacing: '-0.03em', ...enter(t, 7.32) }}>
        {atm.toFixed(1)}%
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 27 * L.s, color: C.graphite, marginTop: 10 * L.s, ...enter(t, 7.39) }}>
        30-day at-the-money vol, SSVI fit
      </div>
      <svg width={w} height={h + 12 * L.s} style={{ marginTop: 22 * L.s, overflow: 'visible', ...enter(t, 7.46) }}>
        <path d={series.map((s, i) => `${i ? 'L' : 'M'}${X(s[0]).toFixed(1)},${Y(s[1]).toFixed(1)}`).join('')} fill="none" stroke={C.rule} strokeWidth={2 * L.s} />
        <path d={path} fill="none" stroke={C.indigo} strokeWidth={3 * L.s} strokeLinejoin="round" />
        {shown.length > 0 && <circle cx={X(shown[shown.length - 1][0])} cy={Y(shown[shown.length - 1][1])} r={7 * L.s} fill={C.ink} />}
      </svg>
    </div>
  )
}

// ------------------------------------------------------------------ shared chart bits
type Box = { x: number; y: number; w: number; h: number }
function contentBox(L: Layout): Box {
  const top = L.top
  const bottom = L.H - L.bottom - L.caption * (L.kind === 'vertical' ? 2.6 : 1.6)
  return { x: L.padX, y: top, w: L.W - 2 * L.padX, h: bottom - top }
}
/** Kinetic entrance for the hard cuts: a short slide in from the right, sharp throughout. */
function cut(t: number, at: number): CSSProperties {
  const x = prog(t, at, at + 0.3)
  return { transform: `translateX(${(1 - x) * 4}%)` }
}
const drawn = (t: number, at: number, dur: number) => prog(t, at, at + dur, easeInOut)

function Title({ L, title, value, label, t, at }: { L: Layout; title: string; value?: string; label?: string; t: number; at: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 24 * L.s, flexWrap: 'wrap' }}>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 46 * L.s, color: C.ink, letterSpacing: '-0.015em', ...enter(t, at + 0.05) }}>{title}</div>
      {value && (
        <div style={{ textAlign: 'right', ...enter(t, at + 0.12) }}>
          <div style={{ ...num, fontSize: 64 * L.s, color: C.ink, lineHeight: 1 }}>{value}</div>
          <div style={{ fontFamily: SERIF, fontSize: 22 * L.s, color: C.graphite, marginTop: 6 * L.s }}>{label}</div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ bitcoin against ether
function Versus({ t, L }: { t: number; L: Layout }) {
  if (t < 15.5 || t >= 18) return null
  const at = 15.5
  const b = contentBox(L)
  const stacked = L.kind === 'vertical'
  const gap = 56 * L.s
  const pw = stacked ? b.w : (b.w - gap) / 2
  const ph = stacked ? (b.h - gap) / 2 : b.h
  const all = [...D.term.BTC, ...D.term.ETH]
  const lo = Math.floor(Math.min(...all.map((p) => p.atm)) / 5) * 5
  const hi = Math.ceil(Math.max(...all.map((p) => p.atm)) / 5) * 5
  const dmax = Math.max(...all.map((p) => p.days))
  const panel = (c: 'BTC' | 'ETH', i: number) => {
    const s = at + i * 0.12
    const color = c === 'BTC' ? C.btc : C.eth
    const target = D.atm30[c]
    const shown = target * prog(t, s, s + 0.8)
    const chartTop = 262 * L.s
    const cw = pw, ch = ph - chartTop - 48 * L.s
    const X = (d: number) => 74 * L.s + (Math.sqrt(d) / Math.sqrt(dmax)) * (cw - 92 * L.s)
    const Y = (v: number) => ch - ((v - lo) / (hi - lo)) * ch
    const pts = D.term[c]
    const path = pts.map((p, j) => `${j ? 'L' : 'M'}${X(p.days).toFixed(1)},${Y(p.atm).toFixed(1)}`).join('')
    const k = drawn(t, s + 0.05, 0.85)
    return (
      <div key={c} style={{ position: 'absolute', left: stacked ? 0 : i * (pw + gap), top: stacked ? i * (ph + gap) : 0, width: pw, height: ph, ...cut(t, s) }}>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 44 * L.s, color }}>{c === 'BTC' ? 'Bitcoin' : 'Ether'}</div>
        <div style={{ ...num, fontSize: 112 * L.s, color: C.ink, lineHeight: 1.02, letterSpacing: '-0.03em' }}>{shown.toFixed(1)}%</div>
        <div style={{ fontFamily: SERIF, fontSize: 27 * L.s, color: C.graphite }}>30-day at-the-money vol</div>
        <svg width={cw} height={ch + 40 * L.s} style={{ position: 'absolute', top: chartTop, left: 0, overflow: 'visible' }}>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line x1={74 * L.s} x2={cw} y1={Y(v)} y2={Y(v)} stroke={C.rule} strokeWidth={2 * L.s} />
              <text x={0} y={Y(v) + 9 * L.s} fill={C.graphite} fontSize={25 * L.s} style={num}>{v.toFixed(0)}%</text>
            </g>
          ))}
          {[7, 30, 90, 180].filter((d) => d < dmax).map((d) => (
            <text key={d} x={X(d)} y={ch + 40 * L.s} fill={C.graphite} fontSize={25 * L.s} textAnchor="middle" style={num}>{d}d</text>
          ))}
          <path d={path} fill="none" stroke={color} strokeWidth={5.5 * L.s} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - k} />
          {pts.map((p, j) => (
            <circle key={p.code} cx={X(p.days)} cy={Y(p.atm)} r={8 * L.s} fill={color} stroke={C.paper} strokeWidth={3 * L.s} opacity={clamp01((k * pts.length - j) * 1.5)} />
          ))}
        </svg>
      </div>
    )
  }
  return <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h }}>{panel('BTC', 0)}{panel('ETH', 1)}</div>
}

// ------------------------------------------------------------------ inside the model
const CUTS = { skew: [18.0, 19.35], lv: [19.35, 20.7], bars: [20.7, 22.0] } as const

function Skew({ t, L }: { t: number; L: Layout }) {
  const [a, z] = CUTS.skew
  if (t < a || t >= z) return null
  const b = contentBox(L)
  const s = D.latest.BTC
  const want = [7, 30, 90, 180, 330]
  const idx = [...new Set(want.map((d) => s.T.reduce((bi, T, i) => (Math.abs(T * 365 - d) < Math.abs(s.T[bi] * 365 - d) ? i : bi), 0)))]
  const curves = idx.map((i) => ({ i, pts: smile(i), code: D.term.BTC[i].code }))
  const vs = curves.flatMap((c) => c.pts.map((p) => p[1]))
  const lo = Math.floor(Math.min(...vs) / 10) * 10, hi = Math.ceil(Math.max(...vs) / 10) * 10
  const top = 150 * L.s
  const cw = b.w - 190 * L.s, ch = b.h - top - 56 * L.s
  const X = (x: number) => 64 * L.s + ((Math.log(x) - Math.log(60)) / (Math.log(165) - Math.log(60))) * cw
  const Y = (v: number) => top + ch - ((v - lo) / (hi - lo)) * ch
  return (
    <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, ...cut(t, a) }}>
      <Title L={L} t={t} at={a} title="Bitcoin smiles by expiry" value={minus(D.rr25_30.BTC)} label="30-day risk reversal, vol pts" />
      <svg width={b.w} height={b.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}>
            <line x1={64 * L.s} x2={64 * L.s + cw} y1={Y(v)} y2={Y(v)} stroke={C.rule} strokeWidth={2 * L.s} />
            <text x={0} y={Y(v) + 9 * L.s} fill={C.graphite} fontSize={25 * L.s} style={num}>{v.toFixed(0)}%</text>
          </g>
        ))}
        {[70, 100, 140].map((x) => (
          <text key={x} x={X(x)} y={top + ch + 40 * L.s} fill={C.graphite} fontSize={25 * L.s} textAnchor="middle" style={num}>{x}%</text>
        ))}
        {curves.map((c, j) => {
          const [r, g, bl] = rampColor(0.5 + (0.5 * j) / Math.max(curves.length - 1, 1))
          const k = drawn(t, a + 0.02 + j * 0.07, 0.55)
          const path = c.pts.map((p, n) => `${n ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')
          const end = c.pts[c.pts.length - 1]
          return (
            <g key={c.i}>
              <path d={path} fill="none" stroke={`rgb(${r},${g},${bl})`} strokeWidth={5 * L.s} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - k} strokeLinecap="round" />
              <text x={X(end[0]) + 12 * L.s} y={Y(end[1]) + 9 * L.s} fill={C.ink} fontSize={24 * L.s} style={{ ...num, opacity: k }}>{expiry(c.code)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
const expiry = (code: string) => {
  const m = /^(\d+)([A-Z]{3})(\d{2})$/.exec(code)
  if (!m) return code
  const mon = m[2][0] + m[2].slice(1).toLowerCase()
  return `${m[1]} ${mon}${m[3] === '26' ? '' : ` ’${m[3]}`}`
}

function LocalVol({ t, L }: { t: number; L: Layout }) {
  const [a, z] = CUTS.lv
  if (t < a || t >= z) return null
  const b = contentBox(L)
  const lv = D.localVol
  const top = 150 * L.s
  const cw = b.w - 70 * L.s, ch = b.h - top - 56 * L.s
  const nk = lv.k.length, nt = lv.T.length
  const cx = cw / nk, cy = ch / nt
  const cells: ReactNode[] = []
  for (let j = 0; j < nt; j++)
    for (let i = 0; i < nk; i++) {
      const v = lv.vol[j][i]
      if (v == null) continue
      // The sweep: cells arrive along a diagonal from the short-dated money outwards.
      const d = (Math.abs(i - (nk - 1) / 2) / ((nk - 1) / 2)) * 0.5 + (j / (nt - 1)) * 0.5
      const x = prog(t, a + d * 0.5, a + 0.25 + d * 0.5)
      const [r, g, bl] = rampColor((v - lv.lo) / (lv.hi - lv.lo))
      cells.push(<rect key={`${i}-${j}`} x={64 * L.s + i * cx} y={top + ch - (j + 1) * cy} width={cx + 0.6} height={cy + 0.6} fill={`rgb(${r},${g},${bl})`} opacity={x} />)
    }
  return (
    <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, ...cut(t, a) }}>
      <Title L={L} t={t} at={a} title="Local volatility" value={`${lv.lo.toFixed(1)}% to ${lv.hi.toFixed(1)}%`} label="bitcoin, from the fitted surface" />
      <svg width={b.w} height={b.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {cells}
        {[0, Math.floor((nk - 1) / 2), nk - 1].map((i) => (
          <text key={i} x={64 * L.s + (i + 0.5) * cx} y={top + ch + 40 * L.s} fill={C.graphite} fontSize={25 * L.s} textAnchor="middle" style={num}>{Math.round(Math.exp(lv.k[i]) * 100)}%</text>
        ))}
        {[0, nt - 1].map((j) => (
          <text key={j} x={0} y={top + ch - (j + 0.5) * cy + 9 * L.s} fill={C.graphite} fontSize={25 * L.s} style={num}>{Math.round(lv.T[j] * 365)}d</text>
        ))}
      </svg>
    </div>
  )
}

function Bars({ t, L }: { t: number; L: Layout }) {
  const [a, z] = CUTS.bars
  if (t < a || t >= z) return null
  const b = contentBox(L)
  const rows = [
    { name: 'Extended SSVI', v: D.holdout.essvi, color: C.indigo },
    { name: 'SSVI', v: D.holdout.ssvi, color: C.graphite },
  ]
  const max = 1.8
  const barH = 92 * L.s
  const top = b.h * 0.4
  const d = new Date(D.holdout.date + 'T00:00:00Z')
  return (
    <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, ...cut(t, a) }}>
      <Title L={L} t={t} at={a} title="Error on quotes the fit never saw" />
      <div style={{ fontFamily: SERIF, fontSize: 28 * L.s, color: C.graphite, marginTop: 12 * L.s, ...enter(t, a + 0.1) }}>
        Bitcoin, median of {D.holdout.snapshots} snapshots, {d.getUTCDate()} {MONTHS[d.getUTCMonth()]}, in vol points
      </div>
      {rows.map((r, i) => {
        const k = prog(t, a + 0.03 + i * 0.08, a + 0.6 + i * 0.08)
        return (
          <div key={r.name} style={{ position: 'absolute', left: 0, right: 0, top: top + i * (barH + 96 * L.s) }}>
            <div style={{ fontFamily: SERIF, fontSize: 36 * L.s, color: C.ink, marginBottom: 14 * L.s, ...enter(t, a + 0.1 + i * 0.1) }}>{r.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 * L.s }}>
              <div style={{ height: barH, width: `${(r.v / max) * 82 * k}%`, background: r.color, borderRadius: 4 * L.s, }} />
              <div style={{ ...num, fontSize: 68 * L.s, color: C.ink, opacity: Math.min(1, k * 2) }}>{(r.v * k).toFixed(2)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------ end card
function End({ t, L }: { t: number; L: Layout }) {
  if (t < 22) return null
  const big = (L.kind === 'wide' ? 118 : 112) * L.s
  const rule = drawn(t, 22.75, 0.9)
  return (
    <div style={{ position: 'absolute', left: L.padX, right: L.padX, top: L.kind === 'vertical' ? L.H * 0.2 : L.H * 0.13, textAlign: 'center' }}>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: big, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1.05, textShadow: '0 2px 40px rgba(17,19,22,0.9)' }}>
        {'vol.iliaduda.com'.split('').map((ch, i) => (
          <span key={i} style={{ display: 'inline-block', ...enter(t, 22.35 + i * 0.03, 0.6, 0.3) }}>{ch}</span>
        ))}
      </div>
      <div style={{ margin: `${26 * L.s}px auto 0`, height: 3 * L.s, width: `${38 * rule}%`, background: C.indigo }} />
      <div style={{ ...num, fontSize: 34 * L.s, color: '#c4c8d0', marginTop: 26 * L.s, letterSpacing: '0.02em', ...enter(t, 23.0) }}>
        Open source · live · tested
      </div>
    </div>
  )
}

export function Overlay({ t, L }: { t: number; L: Layout }) {
  const snap = new Date(D.snapshot.BTC)
  return (
    <>
      <Caption t={t} from={0.22} to={2.05} text={'Every bitcoin option\non Deribit.'} L={L} size={hook(L)} />
      <Sub t={t} at={0.75} to={2.05} L={L}>
        {D.listed} listed, {snap.getUTCDate()} {MON[snap.getUTCMonth()]} {snap.getUTCFullYear()}, {hhmm(snap)} UTC
      </Sub>
      <Caption t={t} from={2.35} to={6.75} text={'Fitted every five minutes.\nNo static arbitrage.'} L={L} />
      <LapseHud t={t} L={L} />
      <Caption t={t} from={7.55} to={13.95} text={`${D.timelapse.hours} hours of the real market.`} L={L} />
      <Caption t={t} from={14.15} to={17.9} text="Ether against bitcoin." L={L} />
      <Versus t={t} L={L} />
      <Skew t={t} L={L} />
      <Caption t={t} from={18.05} to={19.3} text="The skew at every expiry." L={L} />
      <LocalVol t={t} L={L} />
      <Caption t={t} from={19.4} to={20.65} text="Local volatility, read off the fit." L={L} />
      <Bars t={t} L={L} />
      <Caption t={t} from={20.75} to={21.95} text="Tested on quotes it never saw." L={L} />
      <End t={t} L={L} />
    </>
  )
}
export { lerp, easeOut }
