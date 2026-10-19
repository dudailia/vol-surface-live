'use client'

/**
 * Shared client state: the live bundles (polled every 60 s through /api/latest), the
 * selected currency, and the surface picked on the history slider, if any.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { bundleSchema, type Bundle } from '@/lib/generated/bundle'
import type { Frame } from '@/lib/geometry'
import type { Surface } from '@/lib/ssvi'

export type Currency = 'BTC' | 'ETH'

export type HistoryPick = {
  ts: string
  label: string
  surface: Surface
  expiries: { code: string; T: number; atm: number }[]
  indexPrice: number
}

type Live = {
  currency: Currency
  setCurrency: (c: Currency) => void
  bundles: Partial<Record<Currency, Bundle>>
  bundle: Bundle | undefined
  frame: Frame
  history: HistoryPick | null
  setHistory: (h: HistoryPick | null) => void
  stale: boolean
}

const Ctx = createContext<Live | null>(null)

const POLL_MS = 60_000
const STALE_MS = 15 * 60_000

export function LiveProvider({
  initial,
  frame,
  children,
}: {
  initial: Partial<Record<Currency, Bundle>>
  frame: Frame
  children: React.ReactNode
}) {
  const [bundles, setBundles] = useState(initial)
  const [currency, setCurrency] = useState<Currency>('BTC')
  const [history, setHistory] = useState<HistoryPick | null>(null)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    let stop = false
    const poll = async () => {
      setNow(Date.now())
      if (document.hidden) return
      try {
        const res = await fetch('/api/latest', { cache: 'no-store' })
        if (!res.ok) return
        const raw = (await res.json()) as Record<string, unknown>
        const next: Partial<Record<Currency, Bundle>> = {}
        for (const c of ['BTC', 'ETH'] as const) {
          const r = bundleSchema.safeParse(raw[c])
          if (r.success) next[c] = r.data
        }
        if (stop) return
        // Keep object identity when nothing changed, so nothing re-renders or morphs.
        setBundles((prev) => {
          const same = (['BTC', 'ETH'] as const).every((c) => prev[c]?.ts === next[c]?.ts || !next[c])
          return same ? prev : { ...prev, ...next }
        })
      } catch {
        // Network hiccup: keep what we have; the stale notice covers long outages.
      }
    }
    const id = window.setInterval(poll, POLL_MS)
    const first = window.setTimeout(() => setNow(Date.now()), 0)
    return () => {
      stop = true
      window.clearInterval(id)
      window.clearTimeout(first)
    }
  }, [])

  const bundle = bundles[currency]
  const stale = now != null && bundle != null && now - Date.parse(bundle.ts) > STALE_MS

  const value = useMemo<Live>(
    () => ({ currency, setCurrency, bundles, bundle, frame, history, setHistory, stale }),
    [currency, bundles, bundle, frame, history, stale],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLive(): Live {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLive outside LiveProvider')
  return v
}
