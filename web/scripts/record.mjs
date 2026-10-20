// Record the hero as a 15-second 1080x1080 video with a deterministic clock.
//   node scripts/record.mjs <url> <framesDir>   then ffmpeg (see README)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const [url = 'http://localhost:3200/?capture=1', dir = 'frames'] = process.argv.slice(2)
const FPS = 30
const SECONDS = 15
mkdirSync(dir, { recursive: true })
const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => 'canvas' && document.querySelector('canvas') && (window).__volsurf, null, { timeout: 30000 })
await page.waitForTimeout(1500)
for (let i = 0; i < FPS * SECONDS; i++) {
  // Halfway: switch to ether, so the surface morphs between two real fits.
  if (i === FPS * 7) await page.getByRole('radiogroup', { name: 'Underlying' }).getByRole('radio', { name: 'ETH' }).click()
  await page.evaluate((dt) => window.__volsurf.step(dt), 1 / FPS)
  await page.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.png` })
}
await browser.close()
console.log(`wrote ${FPS * SECONDS} frames to ${dir}`)
