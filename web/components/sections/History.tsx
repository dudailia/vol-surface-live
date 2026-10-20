'use client'

/**
 * History slider: past surfaces from the archive (one per day at 00:00 UTC) and the last
 * 48 hours hourly from the worker. Moving it morphs the hero surface to that snapshot.
 */

import { useMemo, useState } from 'react'
import { useLive } from '@/components/LiveProvider'
import type { CompactSurface } from '@/lib/data'
import { fixed, utcStamp } from '@/lib/format'
import { tenorsOf, type Model } from '@/lib/bundle'
import { sliceAt, sliceStats, type Surface } from '@/lib/ssvi'

type Entry = { ts: string; kind: 'daily' | 'hourly'; c: CompactSurface }

/** A saved surface in the model on screen; snapshots saved before eSSVI fall back to SSVI. */
function toSurface(c: CompactSurface, model: Model): Surface {
  const base: Surface = { T: c.expiries.map((e) => e.T), theta: c.expiries.map((e) => e.theta), params: c.ssvi }
  return model === 'essvi' && c.essvi ? { ...base, theta: c.essvi.theta, rho: c.essvi.rho, psi: c.essvi.psi } : base
}

function atm30(c: CompactSurface, model: Model): number | null {
  const s = toSurface(c, model)
  const T = 30 / 365
  if (T < s.T[0] || T > s.T[s.T.length - 1]) return null
  return sliceStats(sliceAt(s, T), T).atm
}

export function History({
  daily,
  hourly,
}: {
  daily: Record<string, CompactSurface[]>
  hourly: Record<string, CompactSurface[]>
}) {
  const { currency, bundle, history, setHistory, model } = useLive()
  const entries = useMemo<Entry[]>(() => {
    const byTs = new Map<string, Entry>()
    for (const c of daily[currency] ?? []) byTs.set(c.ts, { ts: c.ts, kind: 'daily', c })
    for (const c of hourly[currency] ?? []) if (!byTs.has(c.ts)) byTs.set(c.ts, { ts: c.ts, kind: 'hourly', c })
    return [...byTs.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  }, [daily, hourly, currency])
  // The last position on the slider is the live surface.
  const n = entries.length
  const [pos, setPos] = useState(n)
  const at = history ? entries.findIndex((e) => e.ts === history.ts) : n
  const value = at < 0 ? pos : at

  const pick = (i: number) => {
    setPos(i)
    if (i >= n) {
      setHistory(null)
      return
    }
    const e = entries[i]
    setHistory({
      ts: e.ts,
      label: utcStamp(e.ts),
      surface: toSurface(e.c, model),
      expiries: e.c.expiries,
      indexPrice: e.c.index_price,
    })
  }

  const current = value >= n ? null : entries[value]
  const liveAtm = bundle ? (tenorsOf(bundle, model)['30d']?.atm ?? null) : null
  const shownAtm = current ? atm30(current.c, model) : liveAtm
  const fill = n > 0 ? `${(value / n) * 100}%` : '100%'

  return (
    <section aria-labelledby="history-title" className="page mt-24 sm:mt-32">
      <div className="grid-rail">
        <h2 id="history-title" className="rail text-h3">
          History
        </h2>
        <div className="measure">
          {n === 0 ? (
            <p className="text-graphite">
              The archive starts with the first daily snapshot. Past surfaces will appear here as they are saved, one a day at
              00:00 UTC, plus hourly snapshots for the last 48 hours.
            </p>
          ) : (
            <>
              <p className="text-graphite">
                Move the slider to morph the surface at the top of the page to an earlier snapshot. {n} saved{' '}
                {n === 1 ? 'snapshot' : 'snapshots'}: daily at 00:00 UTC, and hourly for the last 48 hours.
              </p>
              <label className="mt-6 block">
                <span className="sr-only">Snapshot time</span>
                <input
                  type="range"
                  min={0}
                  max={n}
                  step={1}
                  value={value}
                  onChange={(e) => pick(Number(e.target.value))}
                  aria-valuetext={current ? utcStamp(current.ts) : 'Live'}
                  className="w-full"
                  style={{ ['--fill' as string]: fill }}
                />
              </label>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4 text-note">
                <span className="text-graphite" aria-live="polite">
                  {current ? (
                    <>
                      {utcStamp(current.ts)} ({current.kind})
                    </>
                  ) : (
                    'Live'
                  )}
                </span>
                {shownAtm != null && (
                  <span>
                    30-day ATM vol <span className="num">{fixed(shownAtm)}%</span>
                    {current && liveAtm != null && (
                      <span className="text-graphite">
                        , now <span className="num">{fixed(liveAtm)}%</span>
                      </span>
                    )}
                  </span>
                )}
              </div>
              {current && (
                <button
                  type="button"
                  onClick={() => pick(n)}
                  className="press mt-4 rounded-[4px] border border-rule px-3 py-1.5 text-note hover:border-graphite"
                >
                  Back to live
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
