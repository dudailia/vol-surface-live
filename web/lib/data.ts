import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { cacheLife } from 'next/cache'
import { z } from 'zod'
import { bundleSchema, type Bundle } from './generated/bundle'
import { reportSchema, type Report } from './generated/report'
import { vrpSchema, type Vrp } from './generated/vrp'

/**
 * Where the data comes from:
 * - WORKER_URL: the Fly worker, for the live bundles (every 5 minutes) and hourly history.
 * - BLOB_BASE_URL: the public Blob store for the daily archive. In local development it
 *   may be a directory (the worker's publish mirror) instead of a URL.
 */
const WORKER_URL = process.env.WORKER_URL
const BLOB_BASE_URL = process.env.BLOB_BASE_URL
const LATEST_TOKEN = process.env.LATEST_TOKEN

export type Currency = 'BTC' | 'ETH'
export const CURRENCIES: Currency[] = ['BTC', 'ETH']

const compactSurface = z.object({
  ts: z.string(),
  index_price: z.number(),
  ssvi: z.object({ rho: z.number(), eta: z.number(), gamma: z.number() }),
  expiries: z.array(z.object({ code: z.string(), T: z.number(), theta: z.number(), atm: z.number() })),
  essvi: z.object({ theta: z.array(z.number()), rho: z.array(z.number()), psi: z.array(z.number()) }).optional(),
  selected: z.enum(['ssvi', 'essvi']).optional(),
})
export type CompactSurface = z.infer<typeof compactSurface>
const historyIndex = z.object({
  version: z.number(),
  days: z.record(z.string(), z.array(compactSurface.extend({ date: z.string() }))),
})
export type HistoryIndex = z.infer<typeof historyIndex>
const hourly = z.record(z.string(), z.array(compactSurface))
const reportIndex = z.object({ version: z.number(), dates: z.array(z.string()) })

export type Latest = Partial<Record<Currency, Bundle>>

async function getJSON(base: string | undefined, rel: string, auth = false): Promise<unknown> {
  if (!base) return null
  try {
    if (!/^https?:/.test(base)) {
      return JSON.parse(await readFile(path.join(base, rel), 'utf8'))
    }
    const res = await fetch(`${base.replace(/\/$/, '')}/${rel}`, {
      headers: auth && LATEST_TOKEN ? { authorization: `Bearer ${LATEST_TOKEN}` } : {},
      signal: AbortSignal.timeout(8000),
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** Parse, and on a schema mismatch report it and return null: the page shows a notice. */
function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T | null {
  if (data == null) return null
  const r = schema.safeParse(data)
  if (!r.success) {
    console.warn(`${what} did not match the schema`, r.error.issues.slice(0, 3))
    return null
  }
  return r.data
}

/** The live bundles and the moment they were fetched, so pages can tell a stale snapshot. */
export async function getLatestWithTime(): Promise<{ bundles: Latest; fetchedAt: number }> {
  'use cache'
  // stale ≥ 5 min keeps the data in the App Shell; the client polls /api/latest for freshness.
  // Revalidate every 5 minutes, the worker's own cadence: visitors never reach Fly, and Fly
  // serves this at most about once per 5 minutes (outbound data from Fly is billed).
  cacheLife({ stale: 300, revalidate: 300, expire: 1800 })
  return { bundles: await fetchLatest(), fetchedAt: Date.now() }
}

export async function getLatest(): Promise<Latest> {
  return (await getLatestWithTime()).bundles
}

async function fetchLatest(): Promise<Latest> {
  const raw = (await getJSON(WORKER_URL, 'latest.json', true)) as Record<string, unknown> | null
  const out: Latest = {}
  for (const c of CURRENCIES) {
    const b = parse(bundleSchema, raw?.[c], `${c} bundle`)
    if (b) out[c] = b
  }
  // Worker down: fall back to the last latest.json saved to the archive, then to the last
  // end-of-day bundle. Either way the page shows the snapshot's own timestamp.
  if (!out.BTC || !out.ETH) {
    const saved = (await getJSON(BLOB_BASE_URL, 'latest.json')) as Record<string, unknown> | null
    for (const c of CURRENCIES) {
      const b = out[c] ? null : parse(bundleSchema, saved?.[c], `${c} saved bundle`)
      if (b) out[c] = b
    }
  }
  if (!out.BTC || !out.ETH) {
    const idx = await getHistoryIndex()
    for (const c of CURRENCIES) {
      const last = idx?.days[c]?.at(-1)
      if (!out[c] && last) {
        const b = parse(bundleSchema, await getJSON(BLOB_BASE_URL, `history/${c}/${last.date}.json`), `${c} archive`)
        if (b) out[c] = b
      }
    }
  }
  return out
}

/** Implied against realized vol: the worker's hourly file, else the archive's daily copy. */
export async function getVrp(): Promise<Vrp | null> {
  'use cache'
  cacheLife({ stale: 1800, revalidate: 1800, expire: 86400 })
  return (
    parse(vrpSchema, await getJSON(WORKER_URL, 'vrp.json', true), 'vrp') ??
    parse(vrpSchema, await getJSON(BLOB_BASE_URL, 'vrp.json'), 'vrp archive')
  )
}

// The archive indexes change once a day, at 00:00 UTC. Reading them hourly keeps Blob reads
// (cache misses count against Hobby's 10,000 a month) to about 24 a day each.
export async function getHistoryIndex(): Promise<HistoryIndex | null> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 })
  return parse(historyIndex, await getJSON(BLOB_BASE_URL, 'history/index.json'), 'history index')
}

// Hourly surfaces change once an hour; every 15 minutes is enough and keeps Fly's egress low.
export async function getHourly(): Promise<Record<string, CompactSurface[]>> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 900, expire: 3600 })
  return parse(hourly, await getJSON(WORKER_URL, 'history.json', true), 'hourly history') ?? {}
}

export async function getReportDates(): Promise<string[]> {
  'use cache'
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 })
  return parse(reportIndex, await getJSON(BLOB_BASE_URL, 'reports/index.json'), 'report index')?.dates ?? []
}

export async function getReport(date: string): Promise<Report | null> {
  'use cache'
  cacheLife({ stale: 3600, revalidate: 3600, expire: 86400 * 30 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return parse(reportSchema, await getJSON(BLOB_BASE_URL, `reports/${date}.json`), `report ${date}`)
}

export async function getLatestReport(): Promise<Report | null> {
  const dates = await getReportDates()
  const last = dates.at(-1)
  return last ? getReport(last) : null
}

export function blobUrl(rel: string): string | null {
  return BLOB_BASE_URL && /^https?:/.test(BLOB_BASE_URL) ? `${BLOB_BASE_URL.replace(/\/$/, '')}/${rel}` : null
}

export type { Bundle, Report, Vrp }
