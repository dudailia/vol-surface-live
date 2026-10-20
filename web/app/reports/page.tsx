import type { Metadata } from 'next'
import Link from 'next/link'
import { blobUrl, getReport, getReportDates } from '@/lib/data'
import { fixed, signed, utcDate } from '@/lib/format'

export const metadata: Metadata = {
  title: 'Daily reports',
  description: 'One JSON report per day at 00:00 UTC: ATM vol by tenor, skew, the biggest surface moves, arbitrage in raw quotes and fit quality.',
  alternates: { canonical: '/reports' },
}

export default async function Reports() {
  const dates = (await getReportDates()).slice().reverse()
  const reports = await Promise.all(dates.slice(0, 60).map((d) => getReport(d)))
  return (
    <main className="page pb-24 pt-10 sm:pt-14">
      <p className="text-note text-graphite">
        <Link href="/">Implied volatility surface</Link>
      </p>
      <h1 className="mt-6 text-h1">Daily reports</h1>
      <p className="mt-4 max-w-[var(--measure)] text-graphite">
        Each day at 00:00 UTC the worker writes a JSON summary of the previous 24 hours. Every number below is read from
        those files. Changes are against the surface 24 hours earlier, in vol points. A report uses extended SSVI only when
        both ends of its day carry that fit, so changes always compare like with like.
      </p>
      {reports.length === 0 ? (
        <p className="mt-10 max-w-[var(--measure)]">No reports yet. The first is written at the first 00:00 UTC after the worker starts.</p>
      ) : (
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-note">
            <caption className="sr-only">Daily reports, newest first</caption>
            <thead>
              <tr className="border-b border-rule text-left text-graphite">
                <th scope="col" className="py-2 pr-4 font-normal">Day</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">BTC 30d ATM</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">change</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">ETH 30d ATM</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">change</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Tradeable arb</th>
                <th scope="col" className="py-2 pr-4 font-normal">Fit</th>
                <th scope="col" className="py-2 font-normal">File</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r, i) => {
                if (!r) return null
                const cell = (c: 'BTC' | 'ETH') => r.currencies[c]?.tenors.find((t) => t.tenor === '30d')
                const trade = Object.values(r.currencies).reduce(
                  (a, c) => a + Object.values(c.arbitrage.totals.tradeable ?? {}).reduce((x, y) => x + y, 0),
                  0,
                )
                const url = blobUrl(`reports/${dates[i]}.json`)
                return (
                  <tr key={dates[i]} id={dates[i]} className="border-b border-rule/60">
                    <td className="py-2 pr-4">{utcDate(r.period_start)}{r.late ? ' (late)' : ''}</td>
                    {(['BTC', 'ETH'] as const).map((c) => {
                      const t = cell(c)
                      return [
                        <td key={`${c}a`} className="num py-2 pr-4 text-right">{t ? `${fixed(t.atm)}%` : 'n/a'}</td>,
                        <td key={`${c}c`} className="num py-2 pr-4 text-right text-graphite">{t?.atm_chg != null ? signed(t.atm_chg) : 'n/a'}</td>,
                      ]
                    })}
                    <td className="num py-2 pr-4 text-right">{trade}</td>
                    <td className="py-2 pr-4">{r.currencies.BTC?.model === 'essvi' ? 'eSSVI' : 'SSVI'}</td>
                    <td className="py-2">{url ? <a href={url}>JSON</a> : <span className="text-graphite">local</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
