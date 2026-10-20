import type { Bundle } from '@/lib/generated/bundle'
import { expiryLabel, fixed, utcStamp } from '@/lib/format'
import { REPO_PUBLIC, REPO_URL } from '@/lib/site'

/** Methods and limitations. Rules and counts come from the latest bundles, not from copy. */
export function Methods({ bundles }: { bundles: Partial<Record<'BTC' | 'ETH', Bundle>> }) {
  const b = bundles.BTC ?? bundles.ETH
  if (!b) return null
  // drop_counts lists the reasons in the order the rules run (selection first, then quality).
  const order = Object.keys(b.cleaning.dropped).filter((r) => r in b.cleaning.rules)
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  return (
    <section aria-labelledby="methods-title" className="page mt-24 sm:mt-32">
      <div className="grid-rail">
        <h2 id="methods-title" className="rail text-h3">
          Methods
        </h2>
        <div className="measure space-y-10">
          <Block title="Data">
            <p>
              Every five minutes a worker calls Deribit&rsquo;s public API, with no account or key:{' '}
              <code className="num text-note">get_book_summary_by_currency</code> for every BTC and ETH option, and{' '}
              <code className="num text-note">get_instruments</code> for strikes and expiry times. That is about two dozen
              requests per currency per run, well under Deribit&rsquo;s public rate limits. Raw quotes are archived as
              Parquet, and a summary is written each day at 00:00 UTC.
            </p>
            <p className="mt-4">
              Implied vols are solved from bid and ask prices with Black-76 on Deribit&rsquo;s forward for each expiry, at
              zero rates, which is Deribit&rsquo;s own convention. As a check, each run solves a random sample of quotes
              against Deribit&rsquo;s published bid and ask IVs. In the latest BTC run the median gap was{' '}
              <span className="num">{b.iv_check.median_gap_pts != null ? fixed(b.iv_check.median_gap_pts, 3) : 'n/a'}</span> vol
              points over <span className="num">{b.iv_check.n}</span> comparisons.
            </p>
          </Block>

          <Block title="Cleaning">
            <p>Each quote gets the first reason that applies, in this order. Counts are from the latest snapshot.</p>
            <table className="mt-4 w-full text-note">
              <thead>
                <tr className="border-b border-rule text-left text-graphite">
                  <th scope="col" className="py-2 pr-4 font-normal">Rule</th>
                  {(['BTC', 'ETH'] as const).map((c) =>
                    bundles[c] ? (
                      <th key={c} scope="col" className="num py-2 pl-4 text-right font-normal">
                        {c}
                      </th>
                    ) : null,
                  )}
                </tr>
              </thead>
              <tbody>
                {order.map((r) => (
                  <tr key={r} className="border-b border-rule/60">
                    <td className="py-2 pr-4">{cap(b.cleaning.rules[r])}</td>
                    {(['BTC', 'ETH'] as const).map((c) =>
                      bundles[c] ? (
                        <td key={c} className="num py-2 pl-4 text-right">
                          {bundles[c]!.cleaning.dropped[r] ?? 0}
                        </td>
                      ) : null,
                    )}
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pr-4">Kept and fitted</td>
                  {(['BTC', 'ETH'] as const).map((c) =>
                    bundles[c] ? (
                      <td key={c} className="num py-2 pl-4 text-right text-ink">
                        {bundles[c]!.cleaning.n_kept} of {bundles[c]!.cleaning.n_raw}
                      </td>
                    ) : null,
                  )}
                </tr>
              </tbody>
            </table>
          </Block>

          <Block title="Model">
            <p>
              SSVI (Gatheral and Jacquier, 2014) gives total implied variance at log-moneyness <i>k</i> as
            </p>
            <p className="num my-4 overflow-x-auto whitespace-nowrap text-note">
              w(k, θ) = θ/2 · [1 + ρφk + √((φk + ρ)² + 1 − ρ²)],&nbsp;&nbsp;φ(θ) = η θ<sup>−γ</sup>(1 + θ)<sup>γ−1</sup>
            </p>
            <p>
              with one θ per expiry and ρ, η, γ shared. The SSVI fit keeps θ from falling with expiry (no calendar arbitrage) and
              imposes η(1&nbsp;+&nbsp;|ρ|)&nbsp;≤&nbsp;2 with 0&nbsp;&lt;&nbsp;γ&nbsp;≤&nbsp;½, which rules out butterfly
              arbitrage. After each fit the surface is checked on a grid: the lowest Durrleman <i>g</i>(<i>k</i>) in the
              latest BTC fit is <span className="num">{fixed(b.ssvi.min_g, 3)}</span>. Errors are measured in implied vol
              against the bid-ask mid, never against Deribit&rsquo;s mark IV, which is itself a model.
            </p>
            <p className="mt-4">
              Raw quotes are checked separately, for vertical spreads, butterflies and calendar spreads. Each check runs at mid
              prices and again at prices you could trade (buy at the ask, sell at the bid). Risk reversals and butterflies use
              forward delta, not Deribit&rsquo;s premium-adjusted delta. Local vol uses Dupire&rsquo;s formula on the fitted
              surface.
            </p>
          </Block>

          {b.essvi && b.selection && (
            <Block title="Two models">
              <p>
                Extended SSVI (Hendriks and Martini, 2019) keeps the SSVI form for each expiry but gives each its own skew ρ and
                slope ψ&nbsp;=&nbsp;θφ. The fit keeps θ and ψ from falling with expiry and holds{' '}
                <span className="whitespace-nowrap">|Δ(ρψ)| ≤ Δψ</span> between neighbouring expiries, so neither wing&rsquo;s slope falls with maturity and expiries
                do not cross; each expiry also meets the butterfly bounds{' '}
                <span className="whitespace-nowrap">ψ(1 + |ρ|) &lt; 4</span> and{' '}
                <span className="whitespace-nowrap">
                  ψ<sup>2</sup>(1 + |ρ|) ≤ 4θ
                </span>
                . Between expiries ψ and ρψ are interpolated linearly in θ, and every fit
                is checked on a grid.
              </p>
              <p className="mt-4">
                eSSVI contains SSVI, so on the quotes it is fitted to it can only do as well or better. To choose between them
                fairly, both are refitted every five minutes with every fifth quote held out, and the page defaults to the model
                with the lower median error on those held-out quotes over the last hour. Latest BTC: eSSVI{' '}
                <span className="num">{fixed(b.selection.essvi, 2)}</span>, SSVI <span className="num">{fixed(b.selection.ssvi, 2)}</span>{' '}
                vol points over <span className="num">{b.selection.n}</span> {b.selection.n === 1 ? 'snapshot' : 'snapshots'}.
              </p>
              {(['BTC', 'ETH'] as const).map((c) => {
                const x = bundles[c]
                if (!x?.essvi) return null
                return (
                  <div key={c} className="mt-6 overflow-x-auto">
                    <table className="w-full min-w-[28rem] text-note">
                      <caption className="mb-2 text-left text-graphite">
                        {c}, fit error by expiry (RMSE, vol points) and share of quotes inside bid-ask
                      </caption>
                      <thead>
                        <tr className="border-b border-rule text-left text-graphite">
                          <th scope="col" className="py-2 pr-4 font-normal">Expiry</th>
                          <th scope="col" className="py-2 pl-4 text-right font-normal">SSVI</th>
                          <th scope="col" className="py-2 pl-4 text-right font-normal">eSSVI</th>
                          <th scope="col" className="py-2 pl-4 text-right font-normal">inside, SSVI</th>
                          <th scope="col" className="py-2 pl-4 text-right font-normal">inside, eSSVI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {x.expiries.map((e, i) => {
                          const f = x.essvi!.expiries[i]
                          const pct = (v: number | null) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`)
                          return (
                            <tr key={e.code} className="border-b border-rule/60">
                              <td className="py-1.5 pr-4">{expiryLabel(e.code)}</td>
                              <td className="num py-1.5 pl-4 text-right">{fixed(e.rmse_vol_pts, 2)}</td>
                              <td className="num py-1.5 pl-4 text-right">{fixed(f.rmse_vol_pts, 2)}</td>
                              <td className="num py-1.5 pl-4 text-right">{pct(e.inside_spread)}</td>
                              <td className="num py-1.5 pl-4 text-right">{pct(f.inside_spread)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </Block>
          )}

          <Block title="Limitations">
            <ul className="list-disc space-y-2 pl-5 marker:text-graphite">
              <li>Deribit quotes only. This is a description of one venue&rsquo;s order book, not a trading signal.</li>
              <li>
                {b.essvi ? (
                  <>
                    SSVI&rsquo;s single ρ cannot follow skew that changes with maturity; eSSVI can. Neither reproduces every quote:
                    the worst eSSVI expiry in the latest BTC snapshot is{' '}
                    {(() => {
                      const w = b.essvi.expiries.reduce((a, e) => (e.rmse_vol_pts > a.rmse_vol_pts ? e : a))
                      return (
                        <>
                          {expiryLabel(w.code)} at <span className="num">{fixed(w.rmse_vol_pts, 2)}</span> vol points,
                        </>
                      )
                    })()}{' '}
                    and per-expiry errors for both models are published in every snapshot.
                  </>
                ) : (
                  'One ρ for every expiry cannot follow skew that changes with maturity; the per-expiry error is published in every snapshot.'
                )}
              </li>
              <li>
                &ldquo;Tradeable at quoted prices&rdquo; ignores fees, margin and size. A flagged quote is an inconsistency, not
                free money.
              </li>
              <li>Quotes are a snapshot every five minutes; anything between snapshots is not seen.</li>
            </ul>
          </Block>

          <Block title="Source">
            <p>
              {REPO_PUBLIC ? (
                <>
                  The worker (Python) and this page (Next.js) are open source under the MIT licence, with tests, at{' '}
                  <a href={REPO_URL}>github.com/dudailia/vol-surface-live</a>.{' '}
                </>
              ) : (
                'The worker is written in Python and this page in Next.js, both with tests. '
              )}
              Daily reports are in the <a href="/reports">report archive</a>. Built independently from public data. Latest
              snapshot {utcStamp(b.ts)}.
            </p>
          </Block>
        </div>
      </div>
    </section>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-h3">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  )
}
