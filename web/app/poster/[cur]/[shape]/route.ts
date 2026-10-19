import { gzipSync } from 'node:zlib'
import { cacheLife } from 'next/cache'
import { posterQuotes, surfaceOf } from '@/lib/bundle'
import { getLatest } from '@/lib/data'
import { sharedFrame } from '@/lib/geometry'
import { posterSvg } from '@/lib/poster'

// The figure box is 16:11 from 640px and square below it.
const SHAPES = { wide: [1600, 1100], tall: [1100, 1100] } as const

const shortCode = (code: string) => {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code)
  return m ? `${Number(m[1])} ${m[2][0]}${m[2].slice(1).toLowerCase()} ${m[3]}` : code
}

export function generateStaticParams() {
  return ['BTC', 'ETH'].flatMap((cur) => Object.keys(SHAPES).map((shape) => ({ cur, shape: `${shape}.svg` })))
}

async function render(cur: string, shape: string): Promise<string | null> {
  'use cache'
  // stale ≥ 5 min keeps the data in the App Shell; the client polls /api/latest for freshness.
  cacheLife({ stale: 300, revalidate: 60, expire: 900 })
  const latest = await getLatest()
  const b = cur === 'BTC' || cur === 'ETH' ? latest[cur] : undefined
  const size = SHAPES[shape.replace(/\.svg$/, '') as keyof typeof SHAPES]
  if (!b || !size) return null
  const surfaces = [latest.BTC, latest.ETH].filter((x) => x != null).map(surfaceOf)
  const frame = sharedFrame(surfaces)
  const volTicks: number[] = []
  for (let v = Math.ceil(frame.volLo * 10) / 10 + 0.2; v <= frame.volHi + 1e-9; v += 0.2) volTicks.push(v)
  const ex = b.expiries
  const picks = [ex[0], ex[Math.floor(ex.length / 2)], ex[ex.length - 1]]
  return posterSvg(surfaceOf(b), {
    labels: { volTicks, fontSize: shape.startsWith('tall') ? 30 : 22, expiries: picks.map((e) => ({ T: e.T, label: shortCode(e.code) })) },
    width: size[0],
    height: size[1],
    nu: shape.startsWith('tall') ? 28 : 34,
    nt: shape.startsWith('tall') ? 18 : 22,
    frame,
    quotes: posterQuotes(b),
    expiries: b.expiries.map((e) => e.T),
  })
}

export async function GET(_req: Request, ctx: RouteContext<'/poster/[cur]/[shape]'>) {
  const { cur, shape } = await ctx.params
  const svg = await render(cur, shape)
  if (!svg) return new Response('Not found', { status: 404 })
  // The poster is the first thing painted; send it gzipped (about a quarter of its size).
  return new Response(gzipSync(svg, { level: 9 }), {
    headers: {
      'content-type': 'image/svg+xml',
      'content-encoding': 'gzip',
      vary: 'accept-encoding',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=600',
    },
  })
}
