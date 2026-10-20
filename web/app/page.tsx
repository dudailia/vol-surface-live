import { LiveProvider } from '@/components/LiveProvider'
import { Explainer } from '@/components/sections/Explainer'
import { Footer } from '@/components/sections/Footer'
import { History } from '@/components/sections/History'
import { Methods } from '@/components/sections/Methods'
import { WhatMoved } from '@/components/sections/WhatMoved'
import { Hero } from '@/components/surface/Hero'
import { surfaceOf } from '@/lib/bundle'
import { getHistoryIndex, getHourly, getLatestReport, getLatestWithTime } from '@/lib/data'
import { utcDate } from '@/lib/format'
import { sharedFrame } from '@/lib/geometry'

export default async function Page() {
  const [{ bundles: latest, fetchedAt }, report, index, hourly] = await Promise.all([
    getLatestWithTime(),
    getLatestReport(),
    getHistoryIndex(),
    getHourly(),
  ])
  const surfaces = [latest.BTC, latest.ETH].filter((b) => b != null).map(surfaceOf)
  const frame = surfaces.length ? sharedFrame(surfaces) : { sqrtTMin: 0.1, sqrtTMax: 1, volLo: 0.2, volHi: 1 }
  const ts = latest.BTC?.ts ?? latest.ETH?.ts
  // The next 00:00 UTC after the latest snapshot, for "the first report is written at ...".
  const next = ts ? new Date(Date.UTC(new Date(ts).getUTCFullYear(), new Date(ts).getUTCMonth(), new Date(ts).getUTCDate() + 1)) : null
  return (
    <LiveProvider initial={latest} frame={frame} fetchedAt={fetchedAt}>
      <main>
        <Hero />
        <WhatMoved report={report} nextReport={next ? utcDate(next.toISOString()) : 'the next day'} />
        <Explainer />
        <History daily={index?.days ?? {}} hourly={hourly} />
        <Methods bundles={latest} />
      </main>
      <Footer />
    </LiveProvider>
  )
}
