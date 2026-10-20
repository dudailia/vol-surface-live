# Costs

Budget: under $5 a month in total, across every service. The target is about $2 to $3. Anything that would push the total over $5 gets shut down instead. Nothing that adds cost is changed without the owner's typed approval.

Last checked: 20 October 2026, 16:00 UTC. Prices are from the pages linked under each table, read on that date. Fly quotes prices per 30 days, so a 31-day month costs about 3% more.

## Fly.io (the worker)

| Resource | What runs | Price | Monthly |
|---|---|---|---|
| Machine | 1 × shared-cpu-1x, 256 MB, London (`lhr`), always on | $2.19 per 30 days in the cheapest regions × London's factor of 1.1346 | **$2.49** |
| Volume | 1 × 1 GB (`volsurf_1g`), mounted at `/data` | $0.15/GB/month, billed on provisioned size | **$0.15** |
| Volume snapshots | Fly's daily snapshots, kept 5 days; the data is under 1 GB | $0.08/GB/month, first 10 GB free | **$0.00** |
| IP addresses | Shared IPv4 and IPv6 only. No dedicated IPv4 | Shared IPv4 and IPv6 free; dedicated IPv4 $2/month | **$0.00** |
| Certificates | None (the domain is served by Vercel) | First 10 single-hostname certificates free | **$0.00** |
| Outbound data | At most about 22 MB a day: one round of gzipped JSON to Vercel per 5 minutes whatever the traffic (measured), and 8 uploads a day to Blob | $0.02/GB in Europe and North America; no free allowance | **about $0.01** |
| Swap (512 MB) | A file on the machine's root disk | The root disk is billed only while a machine is stopped ($0.15/GB/month) | **$0.00** |
| Add-ons | None: no extra apps, Postgres, Redis or Tigris | | **$0.00** |
| **Fly total** | | | **about $2.65** |

Sources: [Fly pricing](https://docs.fly.io/about/pricing) (machine, volume, snapshot, IP, certificate and data prices; London's factor of 1.134615385 is in that page's region selector), [Fly billing](https://docs.fly.io/about/billing) (per-second machine billing, hourly volumes), [Fly cost management](https://docs.fly.io/about/cost-management/).

**Spending limit or billing alert on Fly: none exists.** Fly's cost-management page says: "We don't support billing alerts (yet), so budget accordingly." There is also no hard cap: "If you go over, we'll bill you." The only view is the month-to-date bill on the Fly dashboard (your organization, then Billing). The weekly audit below is the guardrail instead.

Before 20 October 16:00 UTC the worker ran at 512 MB with a 5 GB volume: $4.19 + $0.75 + data, so about **$5.00**, over budget. It was cut to the sizes above the same day.

## Vercel (the page and the archive)

| Resource | Use | Hobby includes | Monthly |
|---|---|---|---|
| Plan | Hobby (`dudailias-projects`), no contract, no integrations, no add-ons | Free | **$0.00** |
| Functions, CDN, data transfer | Page served prerendered from the CDN; `/api/latest` cached 5 minutes at the edge | 1,000,000 invocations, 1,000,000 CDN requests, 100 GB Fast Data Transfer | **$0.00** |
| Blob storage | About 0.6 MB now, growing about 0.5 MB a day | 1 GB | **$0.00** |
| Blob uploads (advanced operations) | 8 a day, about 250 a month (worker budget: 600 a month, enforced in code) | 2,000 a month | **$0.00** |
| Blob reads on cache miss (simple operations) | Indexes read hourly, reports hourly at most: under about 2,000 a month | 10,000 a month | **$0.00** |
| **Vercel total** | | | **$0.00** |

Sources: [Vercel Hobby plan](https://vercel.com/docs/plans/hobby), [Vercel Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).

Hobby cannot be billed: "You will not pay for any additional usage." A feature that goes over its limit is paused for 30 days instead (for Blob, the archive would stop working). Blob uploads are capped at 600 a month in the worker (`MONTHLY_BUDGET` in `worker/src/volsurf/blob.py`) to stay far from the 2,000.

## Everything else

| Service | Use | Monthly |
|---|---|---|
| Deribit API | Public endpoints, no account | **$0.00** |
| GitHub | Private repository on GitHub Free. Actions: 2,000 minutes a month included for private repositories; CI runs only the jobs whose code changed, and a newer push cancels an older run | **$0.00** while under 2,000 minutes |
| Domain | `vol.iliaduda.com` is a subdomain of a domain that already existed, on Vercel DNS | **$0.00** added |

Source: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). On 20 October this repository had used about 344 of the month's 2,000 minutes, most of it that day, before CI was cut down. Without a payment method GitHub blocks Actions at the limit; with one, extra minutes cost $0.006 each unless a budget stops them. To be sure nothing is billed, set an Actions budget of $0 under GitHub Settings, Billing and licensing, Budgets and alerts. Making the repository public would make Actions free.

## Total

**About $2.65 a month (Fly), $0 elsewhere.** Clearly under $5.

## Guardrails

- **Weekly audit:** `.github/workflows/fly-audit.yml` runs every Monday at 07:00 UTC (and on demand). It runs `scripts/fly_audit.py`, which compares Fly with `scripts/fly-allowed.json`: one app, one shared-cpu-1x 256 MB machine in `lhr`, one 1 GB volume, shared IPv4 and IPv6 only, no certificates, snapshots within the free 10 GB, no Redis, Tigris or managed Postgres. Any difference opens a GitHub issue. It uses a read-only Fly token (GitHub secret `FLY_API_TOKEN`, valid for one year) that cannot change anything.
- **Volume:** raw five-minute quotes are compacted daily and kept 14 days; bundles 3 days. If `/data` passes 80% full, the oldest compacted days are deleted first. Daily summaries live in Blob.
- **Memory:** the worker peaks at about 141 MB on the 256 MB machine (measured 20 October). The daily report and compaction read one snapshot at a time; 512 MB of swap on the root disk is a safety net.
- **Data transfer:** visitors never reach Fly. Measured on 20 October with 80 and 126 requests to the page and `/api/latest` over 7 and 11 minutes: Fly saw one round of requests per 5 minutes, `latest.json` twice in each round (once for the page, once for `/api/latest`, which run in separate functions) plus `history.json` and `vrp.json`. That is about 75 KB per round, gzipped. With no visitors, Fly sees nothing.

## Stop everything

Stop the machine (billing for CPU and memory ends; the 1 GB volume, $0.15/month, stays):

```sh
fly scale count 0 -a vol-surface-live --yes
```

The page keeps working from the archive and says how old the snapshot is. To start again: `cd worker && fly deploy --app vol-surface-live --remote-only --ha=false --yes`.

Delete the worker entirely (machines, the volume, IP addresses):

```sh
fly volumes list -a vol-surface-live          # note the volume ID
fly volumes destroy <volume-id> -a vol-surface-live --yes
fly apps destroy vol-surface-live --yes
```

Volume snapshots can outlive a deleted volume until their retention ends (5 days); they fall inside the free 10 GB.

Revoke the audit's read-only token: `fly tokens list`, then `fly tokens revoke <id>`, and delete the `FLY_API_TOKEN` secret in GitHub.

Vercel bills nothing on Hobby. To take the page down anyway: `vercel project rm vol-surface-live`. To delete the archive: `vercel blob delete-store <store-id>` (`vercel blob list-stores` shows it).
