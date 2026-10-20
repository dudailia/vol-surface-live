import { slimForClient } from '@/lib/bundle'
import { getLatest } from '@/lib/data'

/** The live bundles for the client's 60-second poll, cached at the edge for a minute. */
export async function GET() {
  const latest = await getLatest()
  const body = Object.fromEntries(Object.entries(latest).map(([c, b]) => [c, slimForClient(b)]))
  return Response.json(body, {
    headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
