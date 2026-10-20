'use client'

/**
 * Shared client state: the live bundles (polled every 60 s through /api/latest), the
 * selected currency, and the surface picked on the history slider, if any.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { LazyMotion, domAnimation } from 'motion/react'
import type { Bundle } from '@/lib/generated/bundle'
import { expandForClient, modelFor, type Model } from '@/lib/bundle'
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
  /** the model on screen: the reader's choice, else the bundle's default */
  model: Model
  modelChoice: Model | null
  setModelChoice: (m: Model | null) => void
}

const Ctx = createContext<Live | null>(null)

// /api/latest is cached at the edge for 5 minutes, so polling faster would only re-read the
// same copy. Polls go to Vercel's cache, never to the worker.
const POLL_MS = 120_000
const STALE_MS = 15 * 60_000

export function LiveProvider({
  initial,
  frame,
  fetchedAt,
  children,
}: {
  initial: Partial<Record<Currency, Bundle>>
  frame: Frame
  /** server time the bundles were fetched; the first render judges staleness by it */
  fetchedAt: number
  children: React.ReactNode
}) {
  const [bundles, setBundles] = useState(() => {
    const out: Partial<Record<Currency, Bundle>> = {}
    for (const c of ['BTC', 'ETH'] as const) if (initial[c]) out[c] = expandForClient(initial[c]!)
    return out
  })
  const [currency, setCurrency] = useState<Currency>('BTC')
  const [history, setHistory] = useState<HistoryPick | null>(null)
  const [modelChoice, setModelChoice] = useState<Model | null>(null)
  // The server's clock until the client's takes over, so the stale notice is in the HTML.
  const [now, setNow] = useState<number>(fetchedAt)

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
        // Our own API validated these against the schema on the server; a shape check is
        // enough here and keeps zod out of the browser bundle.
        for (const c of ['BTC', 'ETH'] as const) {
          const b = raw[c] as Bundle | undefined
          if (b && typeof b.ts === 'string' && Array.isArray(b.expiries) && b.expiries.length) next[c] = expandForClient(b)
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
  const stale = bundle != null && now - Date.parse(bundle.ts) > STALE_MS

  const model = modelFor(bundle, modelChoice)
  const value = useMemo<Live>(
    () => ({ currency, setCurrency, bundles, bundle, frame, history, setHistory, stale, model, modelChoice, setModelChoice }),
    [currency, bundles, bundle, frame, history, stale, model, modelChoice],
  )
  return (
    <Ctx.Provider value={value}>
      {/* Motion's DOM animation features only (no layout or drag), loaded once for the page. */}
      <LazyMotion features={domAnimation} strict>
        {children}
      </LazyMotion>
    </Ctx.Provider>
  )
}

export function useLive(): Live {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLive outside LiveProvider')
  return v
}
