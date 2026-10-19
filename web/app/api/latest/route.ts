import { getLatest } from '@/lib/data'

/** The live bundles for the client's 60-second poll, cached at the edge for a minute. */
export async function GET() {
  const latest = await getLatest()
  return Response.json(latest, {
    headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
