// Scroll to each explainer step and capture the viewport: node scripts/steps.mjs <url> <out> <width>
import { chromium } from '@playwright/test'
const [url, out, w = '1440'] = process.argv.slice(2)
const width = Number(w)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: width < 800 ? 812 : 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto(url, { waitUntil: 'networkidle' })
for (let s = 1; s <= 7; s++) {
  await page.locator(`li[data-step="${s}"]`).evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/step${s}-w${width}.png` })
}
console.log(errors.length ? errors.join('\n') : 'no console errors')
await browser.close()
