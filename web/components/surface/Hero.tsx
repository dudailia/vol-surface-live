'use client'

import dynamic from 'next/dynamic'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLive, type Currency } from '@/components/LiveProvider'
import { Num } from '@/components/Num'
import { arbCounts, posterQuotes, quotesOf, surfaceOf } from '@/lib/bundle'
import { fixed, utcStamp } from '@/lib/format'
import { DEPTH, HALF_WIDTH, SPREAD_SD, toWorld } from '@/lib/geometry'
import type { CanvasHandle, CanvasQuote } from './SurfaceCanvas'

const SurfaceCanvas = dynamic(() => import('./SurfaceCanvas'), { ssr: false })

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortExpiry = (code: string) => {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code)
  if (!m) return code
  const i = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(m[2])
  return `${Number(m[1])} ${SHORT_MONTH[i]}${m[3] !== '26' ? ` ’${m[3]}` : ''}`
}

/** Up to n expiries spread evenly in √T, for axis labels that do not collide. */
function spreadExpiries<T extends { T: number }>(list: T[], n: number): T[] {
  if (list.length <= n) return list
  const a = Math.sqrt(list[0].T)
  const b = Math.sqrt(list[list.length - 1].T)
  const picked = new Set<T>()
  for (let i = 0; i < n; i++) {
    const want = a + ((b - a) * i) / (n - 1)
    picked.add(list.reduce((best, e) => (Math.abs(Math.sqrt(e.T) - want) < Math.abs(Math.sqrt(best.T) - want) ? e : best)))
  }
  return list.filter((e) => picked.has(e))
}

export function Hero() {
  const { currency, setCurrency, bundle, bundles, frame, history, setHistory, stale } = useLive()
  const reduce = useReducedMotion() ?? false
  const [ready, setReady] = useState(false)
  // WebGL starts after the page is idle on desktop, and only on request on phones and touch
  // screens, where the still image is the figure until someone asks to turn it.
  const [load, setLoad] = useState(false)
  const [touch, setTouch] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const [tip, setTip] = useState<{ q: CanvasQuote; x: number; y: number } | null>(null)
  const canvas = useRef<CanvasHandle>(null)
  const labels = useRef<HTMLDivElement>(null)
  const capture = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).has('capture'),
    () => false,
  )

  const surface = useMemo(() => (history ? history.surface : bundle ? surfaceOf(bundle) : null), [history, bundle])
  const quotes = useMemo<CanvasQuote[]>(() => {
    if (!bundle || history) return []
    const qs = quotesOf(bundle)
    return posterQuotes(bundle).map((p, i) => ({
      ...p,
      label: `${qs[i].instrument}: bid ${fixed(qs[i].bid * 100)}%, ask ${fixed(qs[i].ask * 100)}%${p.flagged ? ', breaks static arbitrage' : ''}`,
    }))
  }, [bundle, history])
  const expiries = useMemo(
    () => (history ? history.expiries : (bundle?.expiries ?? [])).map((e) => ({ T: e.T, code: e.code })),
    [bundle, history],
  )
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse), (max-width: 767px)').matches
    const t = window.setTimeout(() => setTouch(coarse), 0)
    if (capture) {
      const c = window.setTimeout(() => setLoad(true), 0)
      return () => {
        window.clearTimeout(t)
        window.clearTimeout(c)
      }
    }
    if (coarse) return () => window.clearTimeout(t)
    let idle = 0
    const start = () => {
      idle = window.requestIdleCallback
        ? window.requestIdleCallback(() => setLoad(true), { timeout: 3000 })
        : window.setTimeout(() => setLoad(true), 1200)
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('load', start)
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
    }
  }, [capture])
  // Capture mode (the 15-second video): expose the canvas clock so frames step exactly.
  useEffect(() => {
    if (!capture) return
    const w = window as unknown as { __volsurf?: { step: (dt: number) => void } }
    w.__volsurf = { step: (dt: number) => canvas.current?.step(dt) }
    return () => {
      delete w.__volsurf
    }
  }, [capture])
  const onReady = useCallback(() => setReady(true), [])
  const onFail = useCallback((r: string) => setFailed(r), [])
  const onHover = useCallback((q: CanvasQuote | null, x: number, y: number) => setTip(q ? { q, x, y } : null), [])

  if (!bundle || !surface) {
    return (
      <section className="page py-24">
        <h1 className="text-h1">Implied volatility surface</h1>
        <p className="mt-4 max-w-[var(--measure)] text-graphite">
          No snapshot is available right now. The worker that collects Deribit quotes may be restarting; this page
          checks again every minute.
        </p>
      </section>
    )
  }

  const t30 = bundle.tenors['30d']
  const counts = arbCounts(bundle)
  const volTicks: number[] = []
  for (let v = Math.ceil(frame.volLo * 10) / 10 + 0.1; v <= frame.volHi + 1e-9; v += 0.1) volTicks.push(v)
  const T0 = surface.T[0]
  const labelled = spreadExpiries(expiries.filter((e) => e.T >= T0), 5)
  // On phones only every other label shows (data-dense hides the rest below 640px).

  const intro = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4">
        <p className="text-note text-graphite">
          <a href="https://iliaduda.com" className="pointer-events-auto">Ilia Duda</a>
        </p>
        <div className="pointer-events-auto">
          <CurrencyToggle value={currency} onChange={setCurrency} available={Object.keys(bundles) as Currency[]} />
        </div>
      </div>
      <h1 id="hero-title" className={`mt-6 text-display lg:mt-10 ${capture ? 'max-w-[24ch]' : 'max-w-[16ch]'}`}>
        {currency === 'BTC' ? 'Bitcoin' : 'Ether'} implied volatility, live from Deribit
      </h1>
      <p className={`mt-5 text-small sm:text-body ${capture ? 'max-w-[44rem]' : 'max-w-[34rem] lg:max-w-[29rem] 2xl:max-w-[34rem]'}`}>
        {t30 && (
          <>
            Thirty-day at-the-money vol is <Num value={t30.atm} format={(x) => `${fixed(x)}%`} />.{' '}
            {t30.rr25 < 0 ? '25\u2011delta puts trade ' : '25\u2011delta calls trade '}
            <Num value={Math.abs(t30.rr25)} format={(x) => fixed(x)} /> vol points over{' '}
            {t30.rr25 < 0 ? 'calls' : 'puts'}.{' '}
          </>
        )}
        {counts.mid === 0 ? (
          'No raw quote breaks static arbitrage at mid.'
        ) : (
          <>
            <Num value={counts.mid} format={(x) => String(Math.round(x))} /> raw-quote{' '}
            {counts.mid === 1 ? 'check fails' : 'checks fail'} at mid, and{' '}
            {counts.tradeable === 0 ? 'none are' : <><Num value={counts.tradeable} format={(x) => String(Math.round(x))} /> are</>}{' '}
            tradeable at quoted prices.
          </>
        )}
      </p>
      <p className="mt-3 max-w-[34rem] text-note text-graphite">
        {history ? (
          <>
            Showing the fitted surface at {utcStamp(history.ts)}.{' '}
            <button type="button" className="press pointer-events-auto text-ink underline decoration-graphite underline-offset-4" onClick={() => setHistory(null)}>
              Back to live
            </button>
          </>
        ) : (
          stale ? (
            <>
              Latest snapshot <time dateTime={bundle.ts}>{utcStamp(bundle.ts)}</time>. It is more than 15 minutes old, so the
              worker that refits the surface may be down.
            </>
          ) : (
            <>
              Deribit quotes at <time dateTime={bundle.ts}>{utcStamp(bundle.ts)}</time>, refitted every five minutes.
            </>
          )
        )}
      </p>
    </>
  )

  return (
    <section aria-labelledby="hero-title" className="relative">
      {/* Below 1024px the text sits above the figure; from 1024px it floats over the sky of a
          full-height stage, and the surface takes the right of the screen. */}
      <div className="lg:pointer-events-none lg:absolute lg:inset-x-0 lg:top-0 lg:z-10">
        <div className="page pt-8 sm:pt-12">{intro}</div>
      </div>
      <figure
        aria-labelledby="hero-caption"
        className={capture ? 'relative h-[100svh]' : 'relative mt-4 lg:mt-0 lg:h-[100svh] lg:max-h-[72rem] lg:min-h-[44rem]'}
      >
        {capture && <style>{'html{overflow:hidden}'}</style>}
        <div
          className={
            capture
              ? 'absolute inset-x-0 bottom-[9%] top-[30%]'
              : 'relative aspect-[1/1] w-full sm:aspect-[16/11] lg:absolute lg:top-[19%] lg:bottom-[13%] lg:left-[38%] lg:right-[1%] lg:aspect-auto lg:w-auto 2xl:left-[40%]'
          }
        >
          {/* Poster: the first paint, and the whole figure when WebGL is unavailable. */}
          <picture>
            <source media="(min-width: 640px)" srcSet={`/poster/${currency}/wide.svg?t=${encodeURIComponent(bundle.ts)}`} />
            <img
              src={`/poster/${currency}/tall.svg?t=${encodeURIComponent(bundle.ts)}`}
              alt=""
              fetchPriority="high"
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-[var(--duration-ui)] ${ready && !failed ? 'opacity-0' : 'opacity-100'}`}
            />
          </picture>
          {!failed && !load && touch && (
            <button
              type="button"
              onClick={() => setLoad(true)}
              className="press absolute bottom-3 right-[var(--side)] z-10 rounded-[4px] border border-rule bg-paper/80 px-3 py-1.5 text-note text-ink"
            >
              Turn it in 3D
            </button>
          )}
          {!failed && load && (
            <div className={`absolute inset-0 transition-opacity duration-[var(--duration-ui)] ${ready ? 'opacity-100' : 'opacity-0'}`}>
              <SurfaceCanvas
                ref={canvas}
                surface={surface}
                frame={frame}
                quotes={quotes}
                expiries={expiries}
                reducedMotion={reduce}
                autoRotate={autoRotate}
                capture={capture}
                onReady={onReady}
                onFail={onFail}
                onHover={onHover}
                labels={labels}
              />
            </div>
          )}
          <div
            ref={labels}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 overflow-hidden text-meta text-graphite transition-opacity duration-[var(--duration-ui)] ${ready && !failed ? 'opacity-100' : 'opacity-0'}`}
          >
            {volTicks.map((v, i) => (
              <Label key={`v${v.toFixed(2)}`} dense={i % 2 === 1} at={[HALF_WIDTH + 0.26, toWorld(frame, 0, T0, v)[1], -DEPTH / 2]} align="left">
                <span className="num">{Math.round(v * 100)}%</span>
              </Label>
            ))}
            {labelled.map((e, i) => (
              <Label key={e.code} dense={i % 2 === 1} at={[-HALF_WIDTH - 0.08, 0, toWorld(frame, 0, e.T, frame.volLo)[2]]} align="right">
                <span className="num">{shortExpiry(e.code)}</span>
              </Label>
            ))}
            {[-2, -1, 0, 1, 2].map((u) => (
              <Label key={`u${u}`} dense={Math.abs(u) === 1} at={[(u / SPREAD_SD) * HALF_WIDTH, 0, DEPTH / 2 + 0.12]} align="center">
                <span className="num">{u === 0 ? 'ATM' : u > 0 ? `+${u}` : `\u2212${-u}`}</span>
              </Label>
            ))}
            <Label at={[0.25, 0, DEPTH / 2 + 0.62]} align="center" dense>
              <span className="text-note">Standard deviations from the forward</span>
            </Label>
          </div>
          {tip && (
            <div
              role="status"
              className="pointer-events-none absolute z-20 max-w-[18rem] -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-[4px] border border-rule bg-raised px-3 py-2 text-meta"
              style={{ left: tip.x, top: tip.y }}
            >
              <span className="num">{tip.q.label}</span>
            </div>
          )}
        </div>
        <div className={capture ? 'page absolute inset-x-0 bottom-6 z-10' : 'page relative z-10 mt-4 lg:absolute lg:inset-x-0 lg:bottom-6 lg:mt-0'}>
          <figcaption id="hero-caption" className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 text-note text-graphite">
            <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Legend />
              {failed && <span>{failed}; showing a still image.</span>}
            </span>
            {!failed && !capture && (
              <span className="flex gap-2">
                  <button
                    type="button"
                    className="press rounded-[4px] border border-rule bg-paper/70 px-3 py-1.5 text-ink hover:border-graphite motion-reduce:hidden"
                    aria-pressed={!autoRotate}
                    onClick={() => setAutoRotate((a) => !a)}
                  >
                    {autoRotate ? 'Pause rotation' : 'Resume rotation'}
                  </button>
                <button
                  type="button"
                  className="press rounded-[4px] border border-rule bg-paper/70 px-3 py-1.5 text-ink hover:border-graphite"
                  onClick={() => canvas.current?.resetView()}
                >
                  Reset view
                </button>
              </span>
            )}
          </figcaption>
          <p className={`mt-2 max-w-[var(--measure)] text-note text-graphite ${capture ? 'hidden' : ''}`}>
            Drag to turn it. {bundle.cleaning.n_kept} of {bundle.cleaning.n_raw} quotes passed the cleaning rules and were
            fitted; the few more than {SPREAD_SD} standard deviations out are left off this view.
          </p>
        </div>
      </figure>
    </section>
  )
}

function Label({
  at,
  align,
  dense,
  children,
}: {
  at: [number, number, number]
  align: 'left' | 'right' | 'center'
  /** hidden on phones, where there is room for only half the labels */
  dense?: boolean
  children: React.ReactNode
}) {
  const shift = align === 'right' ? '-100%' : align === 'center' ? '-50%' : '0'
  return (
    <div data-anchor={at.join(',')} data-align={align} className={`absolute left-0 top-0 will-change-transform ${dense ? 'max-sm:hidden' : ''}`}>
      <div
        className="whitespace-nowrap"
        style={{ transform: `translate(${shift}, -50%)`, paddingRight: align === 'right' ? 8 : 0, paddingLeft: align === 'left' ? 8 : 0 }}
      >
        {children}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-2.5 w-12 rounded-[1px]" style={{ background: 'linear-gradient(to right, var(--color-ramp-0), var(--color-ramp-1), var(--color-ramp-2), var(--color-ramp-3))' }} />
        Fitted surface, low to high vol
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-[#eef0ff] shadow-[0_0_6px_2px_rgba(163,173,245,0.5)]" />
        Quote (mid of bid and ask)
      </span>
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="inline-block size-3 rounded-full border-2 border-flag" />
        Breaks static arbitrage
      </span>
    </>
  )
}

function CurrencyToggle({ value, onChange, available }: { value: Currency; onChange: (c: Currency) => void; available: Currency[] }) {
  const options: Currency[] = ['BTC', 'ETH']
  return (
    <div role="radiogroup" aria-label="Underlying" className="inline-flex rounded-[4px] border border-rule p-0.5">
      {options.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          disabled={!available.includes(c)}
          tabIndex={value === c ? 0 : -1}
          onClick={() => onChange(c)}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              e.preventDefault()
              const next = options[(options.indexOf(c) + 1) % options.length]
              onChange(next)
              ;(e.currentTarget.parentElement?.querySelector(`[data-c="${next}"]`) as HTMLElement | null)?.focus()
            }
          }}
          data-c={c}
          className={`press num rounded-[3px] px-3 py-1 text-note ${value === c ? 'bg-indigo-wash text-ink' : 'text-graphite hover:text-ink'}`}
        >
          {c}
        </button>
      ))}
    </div>
  )
}
