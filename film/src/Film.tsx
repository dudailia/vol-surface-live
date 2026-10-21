import { ThreeCanvas } from '@remotion/three'
import { useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, useLayout } from './layout'
import { Overlay } from './Overlay'
import { Scene } from './three/Scene'
import { prog, storyTime, type Variant } from './timeline'

// The site's own faces, self-hosted.
let fonts: Promise<void> | null = null
function loadFonts() {
  fonts ??= Promise.all([
    new FontFace('Source Serif 4', `url(${staticFile('fonts/source-serif-4-latin-var.woff2')})`, { weight: '200 900' }).load(),
    new FontFace('Source Code Pro', `url(${staticFile('fonts/source-code-pro-latin-var.woff2')})`, { weight: '200 900' }).load(),
  ]).then((fs) => fs.forEach((f) => (document.fonts as unknown as { add: (x: FontFace) => void }).add(f)))
  return fonts
}

export function Film({ variant }: { variant: Variant }) {
  const [handle] = useState(() => {
    const h = delayRender('fonts')
    loadFonts().then(() => continueRender(h))
    return h
  })
  void handle
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const L = useLayout()
  const tc = frame / fps
  const t = storyTime(tc, variant)
  // The 3D stage hard-cuts out for the charts and fades back for the end card.
  const stage = t < 15.5 ? 1 : t >= 22 ? prog(t, 22, 22.3) : 0
  // The hook cut joins the surface to the end card through a brief dip to the page colour.
  const dip = variant === 'hook' ? Math.max(0, 1 - Math.abs(tc - 7) / 0.22) : 0
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <AbsoluteFill style={{ opacity: stage }}>
        <ThreeCanvas width={L.W} height={L.H} gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}>
          <Scene t={t} L={L} />
        </ThreeCanvas>
      </AbsoluteFill>
      <Overlay t={t} L={L} />
      {dip > 0 && <AbsoluteFill style={{ background: C.paper, opacity: dip }} />}
    </AbsoluteFill>
  )
}
