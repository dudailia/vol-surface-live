'use client'

/**
 * Scroll-driven explainer: each step explains one idea, and the sticky figure beside it
 * redraws from the live snapshot as the step reaches the middle of the screen.
 */

import { useEffect, useRef, useState } from 'react'
import { useLive } from '@/components/LiveProvider'
import { ExplainerFigure } from '@/components/charts/ExplainerFigure'
import { arbCounts, checksOf, fitsOf, MODEL_NAME, nearestExpiry } from '@/lib/bundle'
import { expiryLabel, fixed } from '@/lib/format'

export function Explainer() {
  const { bundle, currency, model } = useLive()
  const [step, setStep] = useState(1)
  const refs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step))
        }
      },
      // A step is current while it crosses a band in the middle of the screen; on phones
      // the band sits lower, below the sticky figure.
      { rootMargin: window.matchMedia('(min-width: 64rem)').matches ? '-45% 0px -45% 0px' : '-62% 0px -18% 0px' },
    )
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [bundle])

  if (!bundle) return null
  const fits = fitsOf(bundle, model)
  const e30 = nearestExpiry(bundle, 30)
  const f30 = fits[bundle.expiries.indexOf(e30)]
  const worst = fits.reduce((a, b) => (b.rmse_vol_pts > a.rmse_vol_pts ? b : a))
  const best = fits.reduce((a, b) => (b.rmse_vol_pts < a.rmse_vol_pts ? b : a))
  const counts = arbCounts(bundle)
  const first = fits[0]
  const last = fits[fits.length - 1]
  const rrPut = fits.filter((e) => e.stats.rr25 < 0).length
  const sel = bundle.selection
  const insideMed = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : null
  }
  const inS = insideMed(bundle.expiries.map((e) => e.inside_spread))
  const inE = bundle.essvi ? insideMed(bundle.essvi.expiries.map((e) => e.inside_spread)) : null
  const name = currency === 'BTC' ? 'bitcoin' : 'ether'

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: 'Implied volatility',
      body: (
        <>
          An option&rsquo;s price says how much movement the market is paying for. Implied volatility is the
          volatility that makes the Black-76 formula return that price, using Deribit&rsquo;s own forward for the
          expiry. Each quote gives two numbers, one from the bid and one from the ask. For the{' '}
          {expiryLabel(e30.code)} {name} expiry, <span className="num">{e30.n}</span> quotes passed the cleaning
          rules.
        </>
      ),
    },
    {
      title: 'Total variance',
      body: (
        <>
          To compare expiries, square the vol and multiply by time to expiry: total variance{' '}
          <i>w</i>&nbsp;=&nbsp;σ²<i>T</i>. Plot it against log-moneyness <i>k</i>&nbsp;=&nbsp;ln(<i>K</i>/<i>F</i>). A later
          expiry has to sit above an earlier one at every <i>k</i>. If it did not, buying the later option and
          selling the earlier one would cost less than nothing.
        </>
      ),
    },
    {
      title: 'The fit',
      body: (
        <>
          SSVI (Gatheral and Jacquier, 2014) describes every expiry with its at-the-money total variance θ, plus three
          shared numbers: ρ for skew, and η and γ for how curvature changes with θ. Extended SSVI (Hendriks and Martini,
          2019) gives each expiry its own skew ρ and slope ψ, under conditions that keep expiries from crossing.
          {sel && inS != null && inE != null && (
            <>
              {' '}The fit lies inside the bid-ask spread for a median <span className="num">{Math.round(inE * 100)}%</span> of
              quotes with eSSVI and <span className="num">{Math.round(inS * 100)}%</span> with SSVI. On quotes held out of the fit,
              eSSVI&rsquo;s error is <span className="num">{fixed(sel.essvi, 2)}</span> vol points and SSVI&rsquo;s{' '}
              <span className="num">{fixed(sel.ssvi, 2)}</span>, so the page shows {MODEL_NAME[sel.selected]} unless you pick
              the other.
            </>
          )}{' '}
          {MODEL_NAME[model]} error by expiry runs from <span className="num">{fixed(best.rmse_vol_pts, 1)}</span> vol points (
          {expiryLabel(best.code)}) to <span className="num">{fixed(worst.rmse_vol_pts, 1)}</span> ({expiryLabel(worst.code)}).
        </>
      ),
    },
    {
      title: 'Static arbitrage',
      body: (
        <>
          A surface has static arbitrage if some fixed portfolio of options costs less than nothing. Both fits rule it
          out by construction: θ never falls with expiry, later expiries never cross earlier ones, and each slice meets
          the bounds that keep Durrleman&rsquo;s <i>g</i>(<i>k</i>) above zero. The lowest <i>g</i>(<i>k</i>) on the{' '}
          {MODEL_NAME[model]} surface is <span className="num">{fixed(checksOf(bundle, model).min_g, 3)}</span>. Raw quotes get
          no such guarantee. Right now{' '}
          <span className="num">{counts.mid}</span> raw-quote {counts.mid === 1 ? 'check fails' : 'checks fail'} at mid
          prices and <span className="num">{counts.tradeable}</span> at prices you could actually trade.
        </>
      ),
    },
    {
      title: 'Skew',
      body: (
        <>
          The 25-delta risk reversal is the vol of a 25-delta call minus that of a 25-delta put. Negative means
          puts cost more. It is negative at <span className="num">{rrPut}</span> of{' '}
          <span className="num">{fits.length}</span> expiries. The butterfly measures how far the
          wings sit above the money: <span className="num">{fixed(f30.stats.bf25, 1)}</span> vol points at{' '}
          {expiryLabel(e30.code)}.
        </>
      ),
    },
    {
      title: 'Term structure',
      body: (
        <>
          At-the-money vol by expiry runs from <span className="num">{fixed(first.stats.atm, 1)}%</span> for{' '}
          {expiryLabel(first.code)} to <span className="num">{fixed(last.stats.atm, 1)}%</span> for{' '}
          {expiryLabel(last.code)}. When near expiries trade above far ones the curve is inverted, which usually
          happens around stress.
        </>
      ),
    },
    {
      title: 'Local volatility',
      body: (
        <>
          Dupire&rsquo;s formula turns the implied surface into the volatility the price would need at each
          level and date for every option to be priced consistently. It needs smooth first and second derivatives,
          which is one reason to fit a model rather than interpolate quotes.
        </>
      ),
    },
  ]

  return (
    <section aria-labelledby="explainer-title" className="page mt-24 sm:mt-32">
      <h2 id="explainer-title" className="text-h2">
        How the surface is built
      </h2>
      <p className="mt-3 max-w-[var(--measure)] text-graphite">
        Seven steps from raw quotes to a model you can price with. The figure redraws from the same live snapshot as
        you read.
      </p>
      <div className="mt-10 grid grid-cols-1 gap-x-16 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* On phones the figure sticks to the top and the steps scroll under it. */}
        <div className="sticky top-0 z-10 -mx-[var(--side)] bg-paper px-[var(--side)] pb-4 pt-3 lg:static lg:order-2 lg:mx-0 lg:bg-transparent lg:p-0">
          <div className="lg:sticky lg:top-[12vh]">
            <p className="mb-2 text-note text-graphite" aria-live="polite">
              <span className="num">{step}</span> of <span className="num">{steps.length}</span>: {steps[step - 1].title}
            </p>
            <ExplainerFigure bundle={bundle} step={step} model={model} />
          </div>
        </div>
        <ol className="lg:order-1">
          {steps.map((s, i) => (
            <li
              key={s.title}
              ref={(el) => {
                refs.current[i] = el
              }}
              data-step={i + 1}
              className="flex min-h-[75vh] flex-col justify-end pb-[12vh] pt-10 lg:min-h-[85vh] lg:justify-center lg:py-10"
            >
              <h3 className={`text-h3 transition-colors duration-[var(--duration-ui)] ${step === i + 1 ? 'text-ink' : 'text-graphite'}`}>
                <span className="num mr-3 text-note text-graphite">{i + 1}</span>
                {s.title}
              </h3>
              <p className="mt-3">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
