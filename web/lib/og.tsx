import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { allSurfaces, modelFor, posterQuotes, surfaceOf, tenorsOf } from './bundle'
import { getLatest } from './data'
import { fixed, utcStamp } from './format'
import { sharedFrame } from './geometry'
import { posterSvg } from './poster'

/**
 * Share card in iliaduda.com's register: a night card with the real surface drawn from the
 * latest snapshot. 1200 x 627 for LinkedIn; everything that must be read sits inside the
 * centred 600 x 600 square, because LinkedIn crops some placements to near square.
 */
export const OG_SIZE = { width: 1200, height: 627 } as const
const NIGHT = '#0F1220'
const TEXT = '#F2F0EB'
const MUTED = '#AEB3C4'

async function fonts() {
  const [serif, mono] = await Promise.all([
    readFile(join(process.cwd(), 'assets/og-fonts/SourceSerif4-Regular.otf')),
    readFile(join(process.cwd(), 'assets/og-fonts/SourceCodePro-Regular.otf')),
  ])
  return [
    { name: 'Source Serif 4', data: serif, style: 'normal' as const, weight: 400 as const },
    { name: 'Source Code Pro', data: mono, style: 'normal' as const, weight: 400 as const },
  ]
}

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

export async function shareImage() {
  const latest = await getLatest()
  const b = latest.BTC ?? latest.ETH
  if (!b) {
    return new ImageResponse(
      <div style={{ display: 'flex', width: '100%', height: '100%', background: NIGHT, color: TEXT, alignItems: 'center', justifyContent: 'center', fontFamily: 'Source Serif 4', fontSize: 44 }}>
        Implied volatility surface
      </div>,
      { ...OG_SIZE, fonts: await fonts() },
    )
  }
  const frame = sharedFrame(allSurfaces(latest))
  const model = modelFor(b, null)
  const svg = posterSvg(surfaceOf(b, model), {
    width: 1200,
    height: 640,
    dot: 2.4,
    nu: 46,
    nt: 30,
    frame,
    quotes: posterQuotes(b, model),
    expiries: b.expiries.map((e) => e.T),
  })
  const t30 = tenorsOf(b, model)['30d']
  const name = b.currency === 'BTC' ? 'Bitcoin' : 'Ether'
  return new ImageResponse(
    <div style={{ display: 'flex', width: '100%', height: '100%', background: NIGHT, position: 'relative' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUri(svg)} width={1200} height={640} style={{ position: 'absolute', left: 0, top: 60 }} alt="" />
      <div style={{ position: 'absolute', left: 300, top: 34, width: 600, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontFamily: 'Source Serif 4', fontSize: 46, color: TEXT, lineHeight: 1.1 }}>{`${name} implied volatility`}</div>
        <div style={{ fontFamily: 'Source Code Pro', fontSize: 22, color: MUTED, marginTop: 14 }}>
          {t30 ? `${model === 'essvi' ? 'eSSVI' : 'SSVI'} fit: 30-day ATM ${fixed(t30.atm)}%, 25-delta RR ${fixed(t30.rr25)}` : 'SSVI fit to Deribit quotes'}
        </div>
        <div style={{ fontFamily: 'Source Code Pro', fontSize: 18, color: MUTED, marginTop: 8 }}>
          {`Deribit quotes at ${utcStamp(b.ts)}`}
        </div>
      </div>
    </div>,
    { ...OG_SIZE, fonts: await fonts() },
  )
}

/** A 64px icon: the current surface on night, no quotes or lines. */
export async function iconImage(size: number) {
  const latest = await getLatest()
  const b = latest.BTC ?? latest.ETH
  const svg = b
    ? posterSvg(surfaceOf(b, modelFor(b, null)), { width: size * 2, height: size * 2, nu: 16, nt: 12, detail: false })
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="#a3adf5"/></svg>`
  return new ImageResponse(
    <div style={{ display: 'flex', width: '100%', height: '100%', background: NIGHT, borderRadius: size / 6, alignItems: 'center', justifyContent: 'center' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUri(svg)} width={size * 1.25} height={size * 1.25} alt="" />
    </div>,
    { width: size, height: size },
  )
}
