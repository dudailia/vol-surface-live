#!/usr/bin/env bash
# Local quality pass: build, e2e (with screenshots at 375/768/1440/2560), Lighthouse mobile
# and desktop. Prints one line per Lighthouse run.
set -euo pipefail
cd "$(dirname "$0")/../web"
pnpm build > /tmp/vsl-build.log 2>&1 || { tail -30 /tmp/vsl-build.log; exit 1; }
lsof -ti tcp:3200 tcp:3300 | xargs kill 2>/dev/null || true
npx playwright test e2e/page.spec.ts 2>&1 | tail -3 || true
summary() {
  for f in $(find .lighthouseci -name 'lhr-*.json'); do
    python3 -c "
import json,sys; d=json.load(open(sys.argv[1])); a=d['audits']
print(d['finalUrl'].split('3300')[-1] or '/', d['configSettings'].get('formFactor'), {k: round(v['score']*100) for k, v in d['categories'].items()}, 'LCP', a['largest-contentful-paint']['displayValue'], 'TBT', a['total-blocking-time']['displayValue'])" "$f"
  done | sort
}
rm -rf .lighthouseci; npx lhci collect --config=lighthouserc.json > /dev/null 2>&1; summary
rm -rf .lighthouseci; npx lhci collect --config=lighthouserc.desktop.json > /dev/null 2>&1; summary
