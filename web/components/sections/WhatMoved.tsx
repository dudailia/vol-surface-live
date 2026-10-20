'use client'

/**
 * "What moved": sentences filled only from the latest daily report. A sentence whose
 * numbers are missing is left out, never estimated.
 */

import { useLive } from '@/components/LiveProvider'
import type { Report } from '@/lib/generated/report'
import { expiryLabel, fixed, signed, utcDate, utcStamp } from '@/lib/format'

const POINT = { '10P': '10-delta put', '25P': '25-delta put', ATM: 'at-the-money', '25C': '25-delta call', '10C': '10-delta call' } as Record<string, string>

export function WhatMoved({ report, nextReport }: { report: Report | null; nextReport: string }) {
  const { currency, stale } = useLive()
  const r = report?.currencies[currency]

  return (
    <section aria-labelledby="moved-title" className="page mt-20 sm:mt-28">
      <div className="grid-rail">
        <h2 id="moved-title" className="rail text-h3">
          What moved
        </h2>
        <div className="measure">
          {!report || !r ? (
            <p className="text-graphite">
              {stale
                ? 'Daily reports are written at 00:00 UTC by the worker that collects the quotes. It is not running at the moment, so no report is due; this panel will summarise the first one once it is.'
                : `The first daily report is written at 00:00 UTC on ${nextReport}. It will compare that day’s surface with the one 24 hours earlier, and this panel will summarise it.`}
            </p>
          ) : (
            <Sentences r={r} report={report} />
          )}
        </div>
      </div>
    </section>
  )
}

function Sentences({ r, report }: { r: NonNullable<Report['currencies'][string]>; report: Report }) {
  const t30 = r.tenors.find((t) => t.tenor === '30d')
  const t7 = r.tenors.find((t) => t.tenor === '7d')
  const top = r.biggest_moves[0]
  const a = r.arbitrage
  const tradeable = Object.values(a.totals.tradeable ?? {}).reduce((x, y) => x + y, 0)
  const items: React.ReactNode[] = []

  // The first report has no day before it: state the levels instead of changes.
  if (!r.previous_ts && t30) {
    items.push(
      <>
        This is the first daily report, so there is no earlier day to compare with. At midnight, thirty-day at-the-money vol
        was <N v={t30.atm} />% and the 30-day 25-delta risk reversal <N v={t30.rr25} sign />
        {t7 ? (
          <>
            ; seven-day vol was <N v={t7.atm} />%
          </>
        ) : null}
        .
      </>,
    )
  }

  if (t30 && t30.atm_chg != null) {
    items.push(
      Math.abs(t30.atm_chg) < 0.05 ? (
        <>
          Thirty-day at-the-money vol was unchanged at <N v={t30.atm} />%.
        </>
      ) : (
        <>
          Thirty-day at-the-money vol {verb(t30.atm_chg)} <N v={Math.abs(t30.atm_chg)} /> points to <N v={t30.atm} />%.
        </>
      ),
    )
  }
  if (t30 && t30.rr25_chg != null) {
    items.push(
      <>
        The 30-day 25-delta risk reversal moved <N v={t30.rr25_chg} sign /> points to <N v={t30.rr25} sign />
        {t30.rr25 < 0 ? ', puts still over calls' : ', calls over puts'}.
      </>,
    )
  }
  if (t7 && t7.atm_chg != null && t30 && t30.atm_chg != null) {
    const spread = t7.atm - t30.atm
    items.push(
      <>
        Seven-day vol is <N v={Math.abs(spread)} /> points {spread >= 0 ? 'above' : 'below'} 30-day vol, so the front of the curve
        is {spread >= 0 ? 'inverted' : 'upward sloping'}.
      </>,
    )
  }
  if (top) {
    items.push(
      <>
        The biggest move on the surface was the {top.tenor.replace('d', '-day')} {POINT[top.point] ?? top.point}, {verb(top.change, 'up', 'down')}{' '}
        <N v={Math.abs(top.change)} /> points to <N v={top.vol} />%.
      </>,
    )
  }
  if (r.index_change_pct != null) {
    items.push(
      <>
        The index {verb(r.index_change_pct)} <N v={Math.abs(r.index_change_pct)} />% to <N v={r.index_price} dp={0} />.
      </>,
    )
  }
  if (r.vrp && r.vrp.gap != null && r.vrp.realized_30d != null) {
    items.push(
      <>
        At midnight DVOL was <N v={r.vrp.dvol} /> and the index&rsquo;s realized volatility over the previous 30 days{' '}
        <N v={r.vrp.realized_30d} />, so implied stood <N v={Math.abs(r.vrp.gap)} /> points {r.vrp.gap >= 0 ? 'above' : 'below'}{' '}
        realized.
      </>,
    )
  }
  const mid = a.totals.mid ?? {}
  const midTotal = Object.values(mid).reduce((x, y) => x + y, 0)
  const kinds = (['butterfly', 'vertical', 'calendar'] as const).filter((k) => (mid[k] ?? 0) > 0)
  const KIND = { butterfly: 'butterflies', vertical: 'vertical spreads', calendar: 'calendar spreads' } as const
  const ONE = { butterfly: 'butterfly', vertical: 'vertical spread', calendar: 'calendar spread' } as const
  items.push(
    <>
      Raw quotes failed a static-arbitrage check at mid in <N v={a.snapshots_with_mid} dp={0} /> of{' '}
      <N v={a.snapshots_checked} dp={0} /> snapshots
      {midTotal > 0 && kinds.length > 0 && (
        <>
          {' '}(<N v={midTotal} dp={0} /> failures in all,{' '}
          {kinds.length === 1
            ? `all of them ${KIND[kinds[0]]}`
            : kinds.map((k, i) => (
                <span key={k}>
                  {i > 0 && (i === kinds.length - 1 ? ' and ' : ', ')}
                  <N v={mid[k]} dp={0} /> {mid[k] === 1 ? ONE[k] : KIND[k]}
                </span>
              ))}
          )
        </>
      )}
      ;{' '}
      {tradeable === 0 ? (
        'none of the failures were tradeable at quoted prices.'
      ) : (
        <>
          <N v={tradeable} dp={0} /> {tradeable === 1 ? 'was' : 'were'} tradeable at quoted prices
          {/* The report lists tradeable failures first, largest first. */}
          {a.largest[0]?.level === 'tradeable' && (
            <>
              , {tradeable === 1 ? 'by' : 'the largest by'} <N v={a.largest[0].size_usd} dp={2} /> USD per option
            </>
          )}
          , before fees.
        </>
      )}
    </>,
  )
  items.push(
    <>
      Median fit error was <N v={r.fit.rmse_median} dp={2} /> vol points; the worst expiry at midnight was {expiryLabel(r.fit.worst_expiry)} at{' '}
      <N v={r.fit.worst_expiry_rmse} dp={2} />.
    </>,
  )
  if (r.data.snapshots_received < r.data.snapshots_expected) {
    items.push(
      <>
        <N v={r.data.snapshots_received} dp={0} /> of <N v={r.data.snapshots_expected} dp={0} /> five-minute snapshots arrived; the
        figures above use only those.
      </>,
    )
  }

  return (
    <>
      <p className="text-graphite">
        24 hours to {utcStamp(report.period_end)}
        {r.previous_ts ? `, against ${utcStamp(r.previous_ts)}` : ''}.{report.late ? ' This report was written late.' : ''}
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((it, i) => (
          <li key={i} className="border-l border-rule pl-4">
            {it}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-note text-graphite">
        From the daily report for {utcDate(report.period_start)}, fitted with {r.model === 'essvi' ? 'eSSVI' : 'SSVI'}.{' '}
        <a href={`/reports#${report.date}`}>All reports</a>
      </p>
    </>
  )
}

function verb(x: number, up = 'rose', down = 'fell') {
  return x >= 0 ? up : down
}

function N({ v, dp = 1, sign = false }: { v: number; dp?: number; sign?: boolean }) {
  return <span className="num">{sign ? signed(v, dp) : dp === 0 ? Math.round(v).toLocaleString('en-US') : fixed(v, dp)}</span>
}
