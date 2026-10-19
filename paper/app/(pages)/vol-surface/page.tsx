import { CaseStudyTitle, Meta, Section } from '@/components/CaseStudy'
import { Annotated, Shell } from '@/components/Layout'
import { VolSurfaceSmile } from '@/components/figures/VolSurfaceSmile'
import { fact } from '@/content/facts'
import { papers } from '@/content/papers'
import { pageMeta } from '@/lib/meta'

const paper = papers.find((p) => p.slug === 'vol-surface')!

export const metadata = pageMeta('/vol-surface', paper.title, paper.description)

const REPO = 'https://github.com/dudailia/vol-surface-live/blob/main'
const LIVE = 'https://vol.iliaduda.com'

export default function VolSurface() {
  const v = (k: Parameters<typeof fact>[0]) => fact(k).value
  return (
    <Shell>
      <article>
        <CaseStudyTitle byline={paper.byline} level="h1" title={paper.title} standfirst={<p>{paper.standfirst}</p>} />

        <VolSurfaceSmile />

        <Section heading="What it shows">
          <p>
            An option&rsquo;s price says how much movement the market is paying for. Turned into a volatility and laid out
            by strike and expiry, the prices of every option on one underlying make a surface: the standard way to read an
            options market in one picture. <a href={LIVE}>The live page</a> draws that surface for bitcoin and ether from
            every option listed on Deribit, refitted every five minutes, with the quotes it was fitted to and the quotes
            that break static arbitrage marked on it.
          </p>
          <p>
            The numbers here are from one snapshot, archived with the code: 22:29 UTC on 19 October 2026. Thirty-day
            at-the-money vol was {v('vsBtcAtm30')}% for bitcoin and {v('vsEthAtm30')}% for ether. Bitcoin&rsquo;s 25-delta
            puts traded {Math.abs(v('vsBtcRr30'))} vol points over its calls, and at-the-money vol rose from{' '}
            {v('vsBtcAtmFirst')}% at the nearest fitted expiry to {v('vsBtcAtmLast')}% at the furthest.
          </p>
        </Section>

        <Section heading="The model">
          <p>
            SSVI (Gatheral and Jacquier, 2014) writes total implied variance w = σ²T at log-moneyness k = ln(K/F) as
            w(k, θ) = θ/2 · [1 + ρφk + √((φk + ρ)<sup>2</sup> + 1 − ρ<sup>2</sup>)], with φ(θ) = η θ<sup>−γ</sup>(1 + θ)
            <sup>γ−1</sup>. Each expiry has one number of its own, θ, its at-the-money total variance; ρ, η and γ are shared.
            The fit minimises error in implied vol against the mid of bid and ask, weighted towards tight, at-the-money
            quotes. It never targets Deribit&rsquo;s mark vol, which is itself a model.
          </p>
          <Annotated
            note={
              <>
                γ = {v('vsBtcGamma')}, its upper bound. The data asked for curvature to fade faster with θ than the
                no-arbitrage condition allows.
              </>
            }
          >
            <p>
              Bitcoin&rsquo;s {v('vsBtcKept')} usable quotes across {v('vsBtcExpiries')} expiries fitted with ρ ={' '}
              {v('vsBtcRho')}. Fit error ran from {v('vsBtcRmseMin')} vol points at the longest expiry to{' '}
              {v('vsBtcRmseMax')} at 25 December, and the fitted curve sat inside the bid-ask spread for a median{' '}
              {v('vsBtcInsideMedian')}% of quotes. One ρ for every expiry cannot follow a skew that flattens with maturity,
              so the deep put wing of the middle expiries fits worst. Extended SSVI, with ρ per expiry, would fix that
              without giving up the no-arbitrage conditions; the live page publishes the error for every expiry instead of
              hiding it.
            </p>
          </Annotated>
        </Section>

        <Section heading="Arbitrage">
          <p>
            A surface has static arbitrage if some fixed portfolio of options costs less than nothing. The fit rules it out
            by construction. θ is fitted as a sum of non-negative steps, so total variance never falls with expiry, and
            η(1 + |ρ|) ≤ 2 with 0 &lt; γ ≤ ½ keeps Durrleman&rsquo;s g(k) positive, so the implied density never goes
            negative. Each fit is then checked on a grid; the lowest g(k) in this snapshot was {v('vsBtcMinG')}.
          </p>
          <p>
            Raw quotes get no such guarantee, and they are checked separately: vertical spreads, butterflies and calendar
            spreads, each at mid prices and again at the prices someone could trade, buying at the ask and selling at the
            bid. In this snapshot {v('vsBtcArbMid')} bitcoin butterflies failed at mid and {v('vsBtcArbTrade')} were
            tradeable. A failure at mid is an inconsistency in the quotes, not free money.
          </p>
        </Section>

        <Section heading="How it is computed and tested">
          <p>
            A Python worker calls Deribit&rsquo;s public API every five minutes, with no account: one book summary per
            currency, the instrument list, and ten tickers as a cross-check. Implied vols are solved from bid and ask with
            Black-76 on Deribit&rsquo;s forward at zero rates, Deribit&rsquo;s own convention, and agree with its published
            vols to a median {v('vsBtcIvGapMedian')} vol points. Quotes with no bid, crossed markets, spreads over 15 vol
            points and expiries under two days are dropped, each with its reason logged.
          </p>
          <p>
            The tests hold Black-76 prices and Greeks to QuantLib within 10<sup>−10</sup>, recover known SSVI parameters to
            10<sup>−4</sup>, check that every constraint holds after fitting random surfaces, and feed the arbitrage checks
            deliberately broken quotes. The page&rsquo;s TypeScript SSVI matches the Python to twelve places, and the morph
            between snapshots mixes parameters so every frame stays arbitrage-free. Each day at 00:00 UTC the worker writes
            a report of what moved, kept as JSON.
          </p>
        </Section>

        <Meta
          rows={[
            ['live page', <a key="l" href={LIVE}>vol.iliaduda.com</a>],
            ['model', <a key="m" href={`${REPO}/worker/src/volsurf/ssvi.py`}>worker/src/volsurf/ssvi.py</a>],
            ['arbitrage checks', <a key="a" href={`${REPO}/worker/src/volsurf/arbitrage.py`}>worker/src/volsurf/arbitrage.py</a>],
            ['tests', <a key="t" href={`${REPO}/worker/tests`}>worker/tests</a>],
            ['snapshot', <a key="s" href={`${REPO}/paper/data/snapshot-2026-10-19T2229Z.json`}>paper/data/snapshot-2026-10-19T2229Z.json</a>],
            ['data', 'Deribit public API, no authentication'],
          ]}
        />
      </article>
    </Shell>
  )
}
