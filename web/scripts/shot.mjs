// Quick screenshots for review: node scripts/shot.mjs <url> <outdir> [widths...]
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const [url = 'http://localhost:3100/', out = 'shots', ...ws] = process.argv.slice(2)
const widths = ws.length ? ws.map(Number) : [375, 768, 1440, 2560]
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
for (const w of widths) {
  const page = await browser.newPage({ viewport: { width: w, height: Math.round(w < 800 ? w * 2 : w * 0.62) }, deviceScaleFactor: w > 2000 || process.env.FULL === '1' ? 1 : 2 })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}/w${w}.png`, fullPage: process.env.FULL === '1' })
  console.log(w, errors.length ? `ERRORS: ${errors.join(' | ')}` : 'no console errors')
  await page.close()
}
await browser.close()
