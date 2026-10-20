import { CaseStudyTitle, Meta, Section } from '@/components/CaseStudy'
import { Annotated, Shell } from '@/components/Layout'
import { VolSurfaceHoldout } from '@/components/figures/VolSurfaceHoldout'
import { VolSurfaceSmile } from '@/components/figures/VolSurfaceSmile'
import { fact } from '@/content/facts'
import { papers } from '@/content/papers'
import { pageMeta } from '@/lib/meta'

const paper = papers.find((p) => p.slug === 'vol-surface')!

export const metadata = pageMeta('/vol-surface', paper.title, paper.description)

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
            every option listed on Deribit, refitted every five minutes, with the quotes it was fitted to and the quotes that
            break static arbitrage marked on it.
          </p>
          <p>
            In the snapshot this page quotes, 01:54 UTC on 20 October 2026, thirty-day at-the-money vol was{' '}
            {v('vsBtcAtm30')}% for bitcoin and {v('vsEthAtm30')}% for ether, and bitcoin&rsquo;s 25-delta puts traded{' '}
            {Math.abs(v('vsBtcRr30'))} vol points over its calls. {v('vsBtcKept')} of {v('vsBtcRaw')} bitcoin quotes passed
            the cleaning rules, across {v('vsBtcExpiries')} expiries.
          </p>
        </Section>

        <Section heading="Two models">
          <p>
            SSVI (Gatheral and Jacquier, 2014) writes total implied variance w = σ²T at log-moneyness k = ln(K/F) as
            w(k, θ) = θ/2 · [1 + ρφk + √((φk + ρ)<sup>2</sup> + 1 − ρ<sup>2</sup>)]. Each expiry has its own at-the-money
            total variance θ, and the skew ρ and the curvature function φ(θ) are shared by every expiry. Extended SSVI
            (Hendriks and Martini, 2019) keeps the same slice and gives every expiry its own ρ and slope ψ = θφ.
          </p>
          <Annotated
            note={
              <>
                ρ by expiry ran from {v('vsBtcRhoShort')} to {v('vsBtcRhoLong')}: bitcoin&rsquo;s skew flattens with
                maturity, which one shared ρ cannot follow.
              </>
            }
          >
            <p>
              The extended model contains the plain one, so on the quotes it is fitted to it can only match or improve on it.
              The fair test is quotes neither fit saw. Every snapshot is fitted twice more with every fifth quote held out.
              Across the {v('vsCmpBtcSnapshots')} bitcoin snapshots archived on 19 October, extended SSVI&rsquo;s median
              error on the held-out quotes was {v('vsCmpBtcHoldoutEssvi')} vol points against SSVI&rsquo;s{' '}
              {v('vsCmpBtcHoldoutSsvi')}, lower in every snapshot. For ether it was {v('vsCmpEthHoldoutEssvi')} against{' '}
              {v('vsCmpEthHoldoutSsvi')}.
            </p>
          </Annotated>
          <p>
            The extended fit also lay inside the bid-ask spread for a median {v('vsCmpBtcInsideEssvi')}% of bitcoin quotes,
            against {v('vsCmpBtcInsideSsvi')}%. Not every measure moves the same way: ether&rsquo;s median in-sample error by
            expiry was {v('vsCmpEthRmseEssvi')} vol points for the extended model and {v('vsCmpEthRmseSsvi')} for the plain
            one, because both fits weight tight at-the-money quotes over the wide wings that dominate an unweighted error.
            The live page shows whichever model has the lower held-out error over the last hour and lets the reader switch.
          </p>
        </Section>

        <VolSurfaceHoldout />

        <Section heading="Arbitrage">
          <p>
            A surface has static arbitrage if some fixed portfolio of options costs less than nothing. Both fits rule it out
            by construction. Total variance at the money never falls with expiry. In the extended fit ψ never falls either,
            and |Δ(ρψ)| ≤ Δψ between neighbouring expiries, so neither wing&rsquo;s slope falls with maturity and expiries do
            not cross. Each expiry meets ψ(1 + |ρ|) &lt; 4 and ψ<sup>2</sup>(1 + |ρ|) ≤ 4θ, which keep Durrleman&rsquo;s g(k),
            and so the implied density, positive. Every fit is then checked on a grid that includes the slices between
            expiries: over all 129 snapshots of 19 October the lowest g(k) was {v('vsCmpMinG')}, and total variance never
            fell with maturity.
          </p>
          <p>
            Raw quotes get no such guarantee, and they are checked separately: vertical spreads, butterflies and calendar
            spreads, each at mid prices and again at the prices someone could trade, buying at the ask and selling at the
            bid. In the snapshot above, {v('vsBtcArbMid')} bitcoin butterflies failed at mid and {v('vsBtcArbTrade')} were
            tradeable. A failure at mid is an inconsistency in the quotes, not free money.
          </p>
        </Section>

        <Section heading="How it is computed and tested">
          <p>
            A Python worker on Fly.io in London calls Deribit&rsquo;s public API every five minutes, with no account: one book
            summary per currency, the instrument list, and ten tickers as a cross-check. Implied vols are solved from bid and
            ask with Black-76 on Deribit&rsquo;s forward at zero rates, Deribit&rsquo;s own convention, and agree with its
            published vols to a median {v('vsBtcIvGapMedian')} vol points. Quotes with no bid, crossed markets, spreads over
            15 vol points and expiries under two days are dropped, each with its reason logged. Raw quotes go to Parquet on a
            volume; at 00:00 UTC the worker writes a JSON report of the day and publishes it, with the end-of-day surface,
            to a public archive. The page, on Vercel, reads the worker through a one-minute cache.
          </p>
          <p>
            The tests hold Black-76 prices and Greeks to QuantLib within 10<sup>−10</sup>; recover known SSVI parameters to
            10<sup>−4</sup> and known per-expiry skews to 10<sup>−3</sup>; check every constraint after fitting random
            surfaces; catch a deliberately crossing pair of expiries; and feed the raw-quote checks broken prices. The
            page&rsquo;s TypeScript port matches the Python to twelve places, and when the surface morphs between snapshots
            or models it mixes the per-expiry parameters, which keeps every in-between frame free of calendar arbitrage. The
            worst expiry in the snapshot above still missed by {v('vsBtcEssviWorst')} vol points; the page publishes every
            expiry&rsquo;s error for both models.
          </p>
        </Section>

        <Meta
          rows={[
            ['live page', <a key="l" href={LIVE}>vol.iliaduda.com</a>],
            ['data', 'Deribit public API, no authentication'],
            ['snapshot', 'paper/data/snapshot-2026-10-20T0154Z.json'],
            ['comparison', 'paper/data/model-comparison-2026-10-19.json'],
            ['stack', 'Python on Fly.io (London); Next.js, three.js and Vercel Blob'],
          ]}
        />
      </article>
    </Shell>
  )
}
