import { expect, test } from '@playwright/test'

// Median frame time of the live surface over five seconds. Headless Chromium renders WebGL
// in software, so this only enforces a loose bound in CI; on a real GPU (FPS_STRICT=1) the
// bound is one 60 Hz frame.
test('3D view frame time', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('canvas')).toBeAttached({ timeout: 15_000 })
  const median = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const times: number[] = []
        let last = performance.now()
        const end = last + 5000
        const tick = (now: number) => {
          times.push(now - last)
          last = now
          if (now < end) requestAnimationFrame(tick)
          else resolve(times.sort((a, b) => a - b)[Math.floor(times.length / 2)])
        }
        requestAnimationFrame(tick)
      }),
  )
  console.log(`median frame time ${median.toFixed(2)} ms`)
  expect(median).toBeLessThan(process.env.FPS_STRICT ? 16.8 : 60)
})
