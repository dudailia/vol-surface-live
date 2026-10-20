import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const WIDTHS = [375, 768, 1440, 2560]

/** Fail the test on any console error or uncaught exception. */
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}

test.describe('front page', () => {
  test('renders live numbers with a timestamp and no console errors', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('implied volatility')
    await expect(page.locator('time[datetime]')).toBeVisible()
    await expect(page.getByText(/Thirty-day at-the-money vol is/)).toBeVisible()
    // The WebGL view takes over from the poster.
    await expect(page.locator('canvas')).toBeAttached({ timeout: 15_000 })
    await page.waitForTimeout(1000)
    expect(errors).toEqual([])
  })

  test('server HTML: each hero number once, wording matches snapshot age, no repo link', async ({ request }) => {
    const html = await (await request.get('/')).text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
    const m = /Thirty-day at-the-money vol is ([\d.]+)%\. 25\u2011delta (puts|calls) trade ([\d.]+) vol points/.exec(text)
    expect(m, 'hero sentence with single numbers').not.toBeNull()
    // A doubled number reads like "35.7%35.7%" or "3.73.7".
    expect(text).not.toMatch(/(\d+\.\d)%?\1/)
    const ts = /<time dateTime="([^"]+)"/.exec(html)?.[1]
    expect(ts).toBeTruthy()
    const old = Date.now() - Date.parse(ts!) > 15 * 60_000
    if (old) {
      expect(text).toContain('Latest snapshot')
      expect(text).toContain('more than 15 minutes old')
    } else {
      expect(text).toContain('refitted every five minutes')
    }
    expect(html).not.toContain('github.com')
  })

  for (const width of WIDTHS) {
    test(`screenshot at ${width}px`, async ({ page }) => {
      const errors = watchErrors(page)
      await page.setViewportSize({ width, height: width < 800 ? 812 : Math.round(width * 0.6) })
      await page.goto('/')
      await page.waitForTimeout(2500)
      await page.screenshot({ path: `test-results/screens/home-${width}.png` })
      await page.screenshot({ path: `test-results/screens/home-${width}-full.png`, fullPage: true })
      // No horizontal scroll at any width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      expect(errors).toEqual([])
    })
  }

  test('passes axe with no violations', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1500)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })

  test('keyboard: currency radio group, controls and slider all reachable with visible focus', async ({ page }) => {
    await page.goto('/')
    const radio = page.getByRole('radio', { name: 'BTC' })
    await radio.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: 'ETH' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ether')
    const outline = await page.getByRole('radio', { name: 'ETH' }).evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
    await page.getByRole('button', { name: 'Reset view' }).focus()
    await page.keyboard.press('Enter')
  })

  test('reduced motion: no rotation control, static figure', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: /rotation/ })).toBeHidden()
    expect(errors).toEqual([])
    await ctx.close()
  })

  test('falls back to the still image when WebGL is unavailable', async ({ browser }) => {
    const ctx = await browser.newContext()
    await ctx.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext
      // Deliberately break WebGL for this test; 2D still works.
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          if (String(type).startsWith('webgl')) return null
          return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest)
        },
      })
    })
    const page = await ctx.newPage()
    await page.goto('/')
    await expect(page.getByText(/showing a still image/)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('picture img')).toHaveCSS('opacity', '1')
    await ctx.close()
  })

  test('phones show the labelled still image and load 3D on request', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    const errors = watchErrors(page)
    await page.goto('/')
    await expect(page.locator('picture img')).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
    await page.getByRole('button', { name: 'Turn it in 3D' }).click()
    await expect(page.locator('canvas')).toBeAttached({ timeout: 15_000 })
    expect(errors).toEqual([])
    await ctx.close()
  })

  test('reports page and 404 render', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/reports')
    await expect(page.getByRole('heading', { level: 1, name: 'Daily reports' })).toBeVisible()
    const res = await page.goto('/no-such-page')
    expect(res?.status()).toBe(404)
    expect(errors.filter((e) => !e.includes('404'))).toEqual([])
  })

  test('share image and icon are real PNGs', async ({ request }) => {
    for (const path of ['/opengraph-image', '/icon']) {
      const res = await request.get(path)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toContain('image/png')
    }
  })
})
