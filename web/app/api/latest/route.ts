import { slimForClient } from '@/lib/bundle'
import { getLatest } from '@/lib/data'

/**
 * The live bundles, cached at the edge for five minutes (the worker's cadence). The page polls the slim form;
 * `?full=1` returns the bundles exactly as the worker wrote them, for download.
 */
export async function GET(req: Request) {
  const latest = await getLatest()
  const full = new URL(req.url).searchParams.has('full')
  const body = full ? latest : Object.fromEntries(Object.entries(latest).map(([c, b]) => [c, slimForClient(b)]))
  return Response.json(body, {
    headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=300' },
  })
}
