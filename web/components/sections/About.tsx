'use client'

/**
 * What this page is, in plain sentences, with one live result and an index of the sections.
 */

import { useLive } from '@/components/LiveProvider'
import { fixed } from '@/lib/format'

const SECTIONS = [
  ['moved-title', 'What moved in the last day'],
  ['explainer-title', 'How the surface is built, in seven steps'],
  ['compare-title', 'Bitcoin against ether'],
  ['vrp-title', 'Implied against realized volatility'],
  ['lv-title', 'Local volatility'],
  ['history-title', 'History'],
  ['methods-title', 'Methods and limitations'],
] as const

export function About() {
  const { bundle } = useLive()
  const sel = bundle?.selection
  return (
    <section aria-labelledby="about-title" className="page mt-20 sm:mt-28">
      <div className="grid-rail">
        <h2 id="about-title" className="rail text-h3">
          What this is
        </h2>
        <div className="measure">
          <p>
            Every five minutes a worker pulls every bitcoin and ether option listed on Deribit, drops quotes it cannot trust,
            solves implied volatility from the bids and asks, and fits two arbitrage-free surface models to them: SSVI and
            extended SSVI. It checks the raw quotes for static arbitrage, keeps an archive, and writes a report of the day at
            00:00 UTC. This page draws the result and explains it.
            {sel && (
              <>
                {' '}On quotes held out of the fit, the extended model&rsquo;s error is <span className="num">{fixed(sel.essvi, 2)}</span>{' '}
                vol points against <span className="num">{fixed(sel.ssvi, 2)}</span> for SSVI over the last{' '}
                {sel.n === 1 ? 'snapshot' : `${sel.n} snapshots`}.
              </>
            )}
          </p>
          <nav aria-label="On this page" className="mt-5">
            <ul className="gap-x-8 space-y-1 text-note sm:columns-2">
              {SECTIONS.map(([id, label]) => (
                <li key={id} className="break-inside-avoid">
                  <a href={`#${id}`} className="text-graphite hover:text-ink">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </section>
  )
}
