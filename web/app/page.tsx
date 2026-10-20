import { LiveProvider } from '@/components/LiveProvider'
import { Explainer } from '@/components/sections/Explainer'
import { Footer } from '@/components/sections/Footer'
import { History } from '@/components/sections/History'
import { Methods } from '@/components/sections/Methods'
import { WhatMoved } from '@/components/sections/WhatMoved'
import { Hero } from '@/components/surface/Hero'
import { allSurfaces, slimForClient } from '@/lib/bundle'
import { getHistoryIndex, getHourly, getLatestReport, getLatestWithTime, getVrp } from '@/lib/data'
import { vrpView } from '@/lib/vrp'
import { ImpliedRealized } from '@/components/sections/ImpliedRealized'
import { Compare } from '@/components/sections/Compare'
import { LocalVol } from '@/components/sections/LocalVol'
import { utcDate } from '@/lib/format'
import { sharedFrame } from '@/lib/geometry'

const slim = (l: Awaited<ReturnType<typeof getLatestWithTime>>['bundles']) => ({
  ...(l.BTC ? { BTC: slimForClient(l.BTC) } : {}),
  ...(l.ETH ? { ETH: slimForClient(l.ETH) } : {}),
})

export default async function Page() {
  const [{ bundles: latest, fetchedAt }, report, index, hourly, vrp] = await Promise.all([
    getLatestWithTime(),
    getLatestReport(),
    getHistoryIndex(),
    getHourly(),
    getVrp(),
  ])
  const vrpViews = {
    ...(vrp && vrpView(vrp, 'BTC') ? { BTC: vrpView(vrp, 'BTC')! } : {}),
    ...(vrp && vrpView(vrp, 'ETH') ? { ETH: vrpView(vrp, 'ETH')! } : {}),
  }
  const surfaces = allSurfaces(latest)
  const frame = surfaces.length ? sharedFrame(surfaces) : { sqrtTMin: 0.1, sqrtTMax: 1, volLo: 0.2, volHi: 1 }
  const ts = latest.BTC?.ts ?? latest.ETH?.ts
  // The next 00:00 UTC after the latest snapshot, for "the first report is written at ...".
  const next = ts ? new Date(Date.UTC(new Date(ts).getUTCFullYear(), new Date(ts).getUTCMonth(), new Date(ts).getUTCDate() + 1)) : null
  return (
    <LiveProvider initial={slim(latest)} frame={frame} fetchedAt={fetchedAt}>
      <main>
        <Hero />
        <WhatMoved report={report} nextReport={next ? utcDate(next.toISOString()) : 'the next day'} />
        <Explainer />
        <Compare />
        <ImpliedRealized views={vrpViews} />
        <LocalVol />
        <History daily={index?.days ?? {}} hourly={hourly} />
        <Methods bundles={latest} />
      </main>
      <Footer />
    </LiveProvider>
  )
}
