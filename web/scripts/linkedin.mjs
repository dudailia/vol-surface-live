// LinkedIn videos of the live page: real data, frame by frame, captions built from the
// page's own numbers in the same session.
//   node scripts/linkedin.mjs <square|vertical> <workDir> [--preview | --assemble]
// Writes <workDir>/numbers.json and the finished video <workDir>/out.mp4 (H.264, no audio).
// --assemble re-encodes from the frames already in <workDir> without recording again.
// The 3D shots use capture mode (?capture=1) and its fixed clock; the chart shots run the
// normal page under Playwright's fake clock, so every animation is stepped exactly.
import { chromium } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [format = 'square', work = 'li-frames', flag] = process.argv.slice(2)
const PREVIEW = flag === '--preview'
const ASSEMBLE = flag === '--assemble'
const URL = process.env.URL ?? 'https://vol.iliaduda.com/'
const FPS = 30
const W = 1080
const H = format === 'vertical' ? 1920 : 1080
const XF = 0.5 // crossfade between shots, seconds
// Caption size in output pixels. The caption is a band across the bottom; on the vertical
// video its text sits 13% up, clear of the app's own controls.
const CAP = format === 'vertical' ? 42 : 38
const LIFT = format === 'vertical' ? 0.13 : 0
// The band's height in output pixels, to keep charts above it.
const BAND = 2.5 * CAP + LIFT * H

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const clamp = (x, a, b) => Math.min(Math.max(x, a), b)

async function caption(page, text, cssPerOut) {
  await page.evaluate(
    ([t, fs, lift]) => {
      let el = document.getElementById('li-caption')
      if (!el) {
        el = document.createElement('div')
        el.id = 'li-caption'
        document.body.appendChild(el)
      }
      el.textContent = t
      Object.assign(el.style, {
        display: t ? 'block' : 'none', position: 'fixed', left: '0', right: '0', bottom: '0',
        zIndex: '2147483647', pointerEvents: 'none', boxSizing: 'border-box',
        padding: `${fs * 0.6}px 5% calc(${lift * 100}vh + ${fs * 0.6}px)`,
        background: '#111316', borderTop: '1px solid #2b2e34',
        fontFamily: 'var(--font-serif)', fontSize: `${fs}px`, lineHeight: '1.3', color: '#e9e6df',
        textAlign: 'center', fontVariantNumeric: 'lining-nums tabular-nums', letterSpacing: '-0.005em',
      })
    },
    [text, CAP * cssPerOut, LIFT],
  )
}

// Shot lengths in seconds; s7 is the closing card, a still.
const PLAN = [['s1', 6], ['s2', 5], ['s3', 5], ['s4', 7], ['s5', 5.5], ['s6', 5.5], ['s7', 3.5, true]]
if (ASSEMBLE) {
  assemble(PLAN.map(([name, seconds, still]) => ({ dir: join(work, name), seconds, still })))
  process.exit(0)
}
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
const seconds = Object.fromEntries(PLAN)
const shots = [] // { dir, seconds } in order
async function shoot(name, page, seconds, onFrame) {
  const dir = join(work, name)
  mkdirSync(dir, { recursive: true })
  const n = Math.round(seconds * FPS)
  for (let i = 0; i < n; i++) {
    await onFrame(i, n)
    if (!PREVIEW || i % 30 === 0 || i === n - 1) {
      await page.screenshot({ path: join(dir, `f${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 93 })
    }
  }
  shots.push({ dir, seconds })
}

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })

// ---------- Phase A: the 3D surface (capture mode needs a 1024+ px layout) ----------
const a = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
await a.goto(`${URL}?capture=1`, { waitUntil: 'networkidle' })
await a.waitForFunction(() => window.__volsurf, null, { timeout: 30000 })
await a.evaluate(() => document.fonts.ready)
const step = (n = 1) => a.evaluate((k) => { for (let i = 0; i < k; i++) window.__volsurf.step(1 / 30) }, n)
const heroText = () => a.evaluate(() => document.getElementById('hero-title').nextElementSibling.innerText)
const radio = (c) => a.getByRole('radiogroup', { name: 'Underlying' }).getByRole('radio', { name: c })
await step(45)
await a.waitForTimeout(1500) // count-ups settle (they run on the real clock)
const ts = await a.evaluate(() => document.querySelector('time').getAttribute('dateTime'))
const btcHero = await heroText()
// Read ether's number before filming the switch, so its caption is real from frame one.
await radio('ETH').click()
await step(60)
await a.waitForTimeout(1500)
const ethHero = await heroText()
await radio('BTC').click()
await step(90)
await a.waitForTimeout(1200)
const atm = (s) => /at-the-money vol is (\d+\.\d)%/.exec(s)?.[1]
const btcAtm = atm(btcHero)
const ethAtm = atm(ethHero)
if (!btcAtm || !ethAtm) throw new Error(`could not read the hero numbers: ${btcHero} | ${ethHero}`)
const d = new Date(ts)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const stamp = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`

// Framing of the 3D view. On the tall frame the 1080 px layout leaves the surface small and
// low, so it is scaled up about a point left of centre and lifted, keeping every label in frame.
const fig = 'section[aria-labelledby="hero-title"] figure'
const intro = 'section[aria-labelledby="hero-title"] > div:first-child'
const FRAME = format === 'vertical'
  ? { origin: '40% 70%', scale: 1.25, lift: -120, push: 0.15 }
  : { origin: '54% 48%', scale: 1, lift: 0, push: 0.38 }
const frameFig = (zoom, introOpacity) => a.evaluate(
  ([f, it, o, s, ty, io]) => {
    const e = document.querySelector(f)
    e.style.transformOrigin = o
    e.style.transform = `translateY(${ty}px) scale(${s})`
    document.querySelector(it).style.opacity = String(io)
  },
  [fig, intro, FRAME.origin, FRAME.scale * zoom, FRAME.lift, introOpacity],
)

await frameFig(1, 1)
await caption(a, `Bitcoin options on Deribit, ${stamp}`, 1)
await shoot('s1', a, seconds.s1, () => step())

await caption(a, 'Dots are quotes; rings break static arbitrage', 1)
await shoot('s2', a, seconds.s2, async (i, n) => {
  await step()
  await frameFig(1 + FRAME.push * ease(i / (n - 1)), clamp(1 - i / 20, 0, 1))
})
await frameFig(1, 1)

await caption(a, `Ether 30-day vol ${ethAtm}%, bitcoin ${btcAtm}%`, 1)
await shoot('s3', a, seconds.s3, async (i) => {
  if (i === 12) await radio('ETH').click()
  await step()
})
await a.waitForTimeout(1500) // the count-up runs on the real clock
const ethShown = atm(await heroText())
if (ethShown !== ethAtm) throw new Error(`ether changed during the take: ${ethAtm} then ${ethShown}`)
await a.close()

// ---------- Phase B: the charts, on the phone layout, under a fake clock ----------
const b = await browser.newPage({ viewport: { width: W / 2, height: H / 2 }, deviceScaleFactor: 2 })
await b.clock.install()
await b.goto(URL, { waitUntil: 'networkidle' })
await b.clock.runFor(3000)
await b.evaluate(() => document.fonts.ready)
const tsB = await b.evaluate(() => document.querySelector('time').getAttribute('dateTime'))
if (tsB !== ts) throw new Error(`the snapshot changed between takes (${ts}, then ${tsB}); run again`)
const sectionText = (id) => b.evaluate((x) => document.getElementById(x).parentElement.innerText, id)
const vrp = /for bitcoin, was (\d+\.\d), and the index had moved at (\d+\.\d)/.exec(await sectionText('vrp-title'))
const lv = /runs from (\d+\.\d)% to (\d+\.\d)%/.exec(await sectionText('lv-title'))
if (!vrp || !lv) throw new Error('could not read the implied-realized or local-vol numbers')
const vh = H / 2
const top = (sel) => b.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY, sel)
const scrollTo = (y) => b.evaluate((v) => window.scrollTo(0, v), Math.max(0, y))
const tick = () => b.clock.runFor(1000 / FPS)
// Bring a section's charts within Deferred's mount margin without showing them, then measure.
async function mount(sel) {
  await scrollTo((await top(sel)) - vh - 300)
  for (let i = 0; i < 6; i++) await tick()
}

const cmp = 'section[aria-labelledby="compare-title"]'
await mount(`${cmp} .wide`)
const panels = await b.evaluate((s) => [...document.querySelectorAll(`${s} figure`)].map((f) => {
  const r = f.getBoundingClientRect()
  return { top: r.top + scrollY, bottom: r.bottom + scrollY }
}), cmp)
const capRoom = BAND / 2 + 8 // CSS px on the 2x phone layout
const s4End = panels[1].bottom - vh + capRoom
const s4Start = Math.min((await top('#compare-title')) - 16, s4End - vh * 0.5)
await caption(b, 'Term structure and 25-delta skew by expiry', 0.5)
await scrollTo(s4Start)
await shoot('s4', b, seconds.s4, async (i, n) => {
  await scrollTo(s4Start + (s4End - s4Start) * ease(clamp((i - 18) / (n - 60), 0, 1)))
  await tick()
})

const vrpChart = 'section[aria-labelledby="vrp-title"] .wide'
await mount(vrpChart)
const vrpTop = await top(vrpChart)
// The chart itself (the first child; a table and a note follow it).
const vrpH = await b.evaluate((s) => document.querySelector(`${s} > div`).getBoundingClientRect().height, vrpChart)
// Centred in the space above the caption band, or from its top if it is taller than that.
const s5End = vrpTop - Math.max(16, (vh - capRoom - vrpH) / 2)
await caption(b, `Bitcoin: DVOL ${vrp[1]}, realized ${vrp[2]} over 30 days`, 0.5)
await scrollTo(s5End - vh * 0.45)
await shoot('s5', b, seconds.s5, async (i, n) => {
  await scrollTo(s5End - vh * 0.45 * (1 - ease(clamp((i - 10) / 60, 0, 1))) + 30 * ease(i / (n - 1)))
  await tick()
})

const lvFig = 'section[aria-labelledby="lv-title"] figure'
await mount(lvFig)
const lvBox = await b.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect()
  return { top: r.top + scrollY, left: r.left, width: r.width, height: r.height }
}, lvFig)
const s6End = lvBox.top - (vh - lvBox.height - capRoom) / 2
await caption(b, `Local volatility from the fit: ${lv[1]}% to ${lv[2]}%`, 0.5)
await scrollTo(s6End - 120)
await shoot('s6', b, seconds.s6, async (i, n) => {
  const y = s6End - 120 * (1 - ease(clamp(i / 45, 0, 1)))
  await scrollTo(y)
  if (i >= 40) {
    // The pointer moves across the money, showing the readout of real cells.
    const p = ease((i - 40) / (n - 41))
    await b.mouse.move(lvBox.left + lvBox.width * (0.3 + 0.4 * p), lvBox.top - y + lvBox.height * (0.62 - 0.3 * p))
  }
  await tick()
})

// The close: the address, on the page's own colours and type.
await b.mouse.move(0, 0)
await caption(b, '', 0.5)
await b.evaluate(() => {
  const c = document.createElement('div')
  Object.assign(c.style, {
    position: 'fixed', inset: '0', zIndex: '2147483646', background: '#111316', display: 'flex',
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px',
    fontFamily: 'var(--font-serif)', color: '#e9e6df', textAlign: 'center', padding: '0 24px',
  })
  const a = document.createElement('div')
  a.textContent = 'vol.iliaduda.com'
  Object.assign(a.style, { fontSize: '50px', fontWeight: '600', letterSpacing: '-0.015em' })
  const s = document.createElement('div')
  s.textContent = 'Bitcoin and ether implied volatility, live from Deribit'
  Object.assign(s.style, { fontSize: '19px', color: '#9ea3ab', maxWidth: '420px', lineHeight: '1.4' })
  c.append(a, s)
  document.body.appendChild(c)
})
await b.clock.runFor(100)
mkdirSync(join(work, 's7'), { recursive: true })
await b.screenshot({ path: join(work, 's7', 'card.jpg'), type: 'jpeg', quality: 95 })
shots.push({ dir: join(work, 's7'), seconds: seconds.s7, still: true })
await browser.close()

const numbers = {
  source: URL, snapshot_ts: ts, format,
  captions: {
    s1: `Bitcoin options on Deribit, ${stamp}`,
    s3: { ether_atm30: ethAtm, bitcoin_atm30: btcAtm, from: 'hero sentence, selected fit' },
    s5: { bitcoin_dvol: vrp[1], realized_30d: vrp[2], from: 'Implied against realized section' },
    s6: { local_vol_low: lv[1], local_vol_high: lv[2], from: 'Local volatility section' },
  },
}
writeFileSync(join(work, 'numbers.json'), JSON.stringify(numbers, null, 1))
console.log(JSON.stringify(numbers))
if (!PREVIEW) assemble(shots)

// ---------- Assembly: scale, crossfade, fade in and out, H.264, no audio ----------
function assemble(list) {
  const inputs = []
  const chains = []
  list.forEach((s, k) => {
    if (s.still) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(s.seconds), '-i', join(s.dir, 'card.jpg'))
    else inputs.push('-framerate', String(FPS), '-i', join(s.dir, 'f%04d.jpg'))
    // JPEG frames are full range; convert to the standard (limited) range players expect.
    chains.push(`[${k}:v]scale=${W}:${H}:flags=lanczos:in_range=full:out_range=limited,setsar=1,fps=${FPS},format=yuv420p,settb=AVTB[v${k}]`)
  })
  let prev = 'v0'
  let offset = 0
  for (let k = 1; k < list.length; k++) {
    offset += list[k - 1].seconds - XF
    chains.push(`[${prev}][v${k}]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}[x${k}]`)
    prev = `x${k}`
  }
  const total = list.reduce((t, s) => t + s.seconds, 0) - XF * (list.length - 1)
  chains.push(`[${prev}]fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.6).toFixed(3)}:d=0.6[out]`)
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', chains.join(';'), '-map', '[out]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS), '-movflags', '+faststart', '-an',
    join(work, 'out.mp4')], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
  console.log(`wrote ${join(work, 'out.mp4')}: ${total.toFixed(1)} s`)
}
