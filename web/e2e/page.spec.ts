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
    // Every section is in the HTML in order, not streamed as hidden blocks swapped in by script.
    expect(html).not.toMatch(/<div hidden id="S:\d+"/)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
    const m = /Thirty-day at-the-money vol is ([\d.]+)%\. 25\u2011delta (puts|calls) trade ([\d.]+) vol points/.exec(text)
    expect(m, 'hero sentence').not.toBeNull()
    // Each number exactly once: a doubled one would read "35.735.7" inside the capture.
    expect(m![1]).toMatch(/^\d+\.\d$/)
    expect(m![3]).toMatch(/^\d+\.\d$/)
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

  test('passes axe after scrolling, with every deferred chart mounted', async ({ page }) => {
    await page.goto('/')
    const H = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < H; y += 500) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y)
      await page.waitForTimeout(60)
    }
    await expect(page.locator('section[aria-labelledby="lv-title"] svg rect').first()).toBeAttached()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })

  test('keyboard: currency radio group, controls and slider all reachable with visible focus', async ({ page }) => {
    await page.goto('/')
    const radio = page.getByRole('radiogroup', { name: 'Underlying' }).getByRole('radio', { name: 'BTC' })
    await radio.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radiogroup', { name: 'Underlying' }).getByRole('radio', { name: 'ETH' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ether')
    const outline = await page.getByRole('radiogroup', { name: 'Underlying' }).getByRole('radio', { name: 'ETH' }).evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
    await expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible({ timeout: 15_000 })
    // The 3D view itself is focusable and turns with the arrow keys.
    const view = page.getByRole('img', { name: /surface in 3D/ })
    await view.focus()
    await expect(view).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowUp')
    await page.getByRole('button', { name: 'Reset view' }).focus()
    await page.keyboard.press('Enter')
  })

  test('model toggle: eSSVI and SSVI both selectable, comparison tables present', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/')
    const group = page.getByRole('radiogroup', { name: 'Fit' })
    await expect(group).toBeVisible()
    const essvi = group.getByRole('radio', { name: 'eSSVI', exact: true })
    const ssvi = group.getByRole('radio', { name: 'SSVI', exact: true })
    const before = await page.getByText(/Thirty-day at-the-money vol is/).innerText()
    const selected = (await essvi.getAttribute('aria-checked')) === 'true' ? essvi : ssvi
    const other = selected === essvi ? ssvi : essvi
    await other.click()
    await expect(other).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/Fitted with (SSVI|eSSVI)\./)).toBeVisible()
    // Keyboard: arrows move the selection back.
    await other.focus()
    await page.keyboard.press('ArrowRight')
    await expect(selected).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText(/Thirty-day at-the-money vol is/)).toHaveText(before)
    await expect(page.getByRole('table', { name: /fit error by expiry/ }).first()).toBeAttached()
    expect(errors).toEqual([])
  })

  test('history slider: keyboard moves to a saved snapshot and back to live', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/')
    const slider = page.getByRole('slider', { name: 'Snapshot time' })
    await slider.scrollIntoViewIfNeeded()
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(page.getByText(/Showing the fitted surface at/)).toBeVisible()
    await expect(slider).toHaveAttribute('aria-valuetext', /UTC/)
    await page.keyboard.press('End')
    await expect(slider).toHaveAttribute('aria-valuetext', 'Live')
    await expect(page.getByText(/Showing the fitted surface at/)).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('what moved: built from the daily report, levels when there is no earlier day', async ({ page }) => {
    await page.goto('/')
    const section = page.locator('section[aria-labelledby="moved-title"]')
    await expect(section).toContainText(/From the daily report for \d+ \w+ 2026/)
    await expect(section).toContainText(/snapshots/)
  })

  test('implied against realized: measured numbers, both panels, follows the currency', async ({ page }) => {
    await page.goto('/')
    const sec = page.locator('section[aria-labelledby="vrp-title"]')
    await sec.scrollIntoViewIfNeeded()
    await expect(sec).toContainText(/DVOL, Deribit.s 30-day implied volatility index for bitcoin, was [\d.]+/)
    await expect(sec).toContainText(/on \d+% of \d+ days, by a median of [\d.]+ points/)
    await expect(sec.locator('svg')).toHaveCount(2)
    await page.getByRole('radiogroup', { name: 'Underlying' }).getByRole('radio', { name: 'ETH' }).click()
    await expect(sec).toContainText('index for ether')
  })

  test('bitcoin against ether: three panels with both series and a sentence of live numbers', async ({ page }) => {
    await page.goto('/')
    const sec = page.locator('section[aria-labelledby="compare-title"]')
    await sec.scrollIntoViewIfNeeded()
    await expect(sec).toContainText(/At 30 days, ether.s at-the-money vol is [\d.]+% against bitcoin.s [\d.]+%/)
    await expect(sec.locator('figure svg')).toHaveCount(3)
    await expect(sec.getByRole('table', { name: 'Bitcoin and ether by expiry' })).toBeAttached()
  })

  test('local volatility: heatmap with stated grid limits and blank cells explained', async ({ page }) => {
    await page.goto('/')
    const sec = page.locator('section[aria-labelledby="lv-title"]')
    await sec.scrollIntoViewIfNeeded()
    await expect(sec).toContainText(/it runs from [\d.]+% to [\d.]+%/)
    await expect(sec).toContainText(/strikes from \d+% to \d+% of the forward/)
    await expect(sec).toContainText(/\d+ of \d+ cells are blank/)
    await expect.poll(() => sec.locator('svg rect').count()).toBeGreaterThan(100)
  })

  test('what this is: index links all point at headings on the page', async ({ page }) => {
    await page.goto('/')
    const links = page.getByRole('navigation', { name: 'On this page' }).getByRole('link')
    await expect(links).toHaveCount(7)
    for (let i = 0; i < 7; i++) {
      const href = await links.nth(i).getAttribute('href')
      expect(await page.locator(`h2${href}`).count(), href ?? '').toBe(1)
    }
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
