import { useVideoConfig } from 'remotion'

export const C = {
  paper: '#111316',
  raised: '#171a1f',
  ink: '#e9e6df',
  graphite: '#9ea3ab',
  rule: '#2b2e34',
  indigo: '#a3adf5',
  violet: '#d9c9ff',
  btc: '#8f99f7',
  eth: '#d9c9ff',
  red: '#ff6a5c',
}
export const SERIF = "'Source Serif 4', Georgia, serif"
export const MONO = "'Source Code Pro', ui-monospace, monospace"

export type Layout = {
  W: number
  H: number
  kind: 'square' | 'vertical' | 'wide'
  /** 1 at 1080 px on the short side */
  s: number
  padX: number
  top: number
  /** distance of the caption block from the bottom: LinkedIn's controls sit there */
  bottom: number
  caption: number
  /** how far up the 3D view is lifted, as a share of the frame height */
  lift: number
  zoom: number
}

export function useLayout(): Layout {
  const { width: W, height: H } = useVideoConfig()
  const kind = W === H ? 'square' : W > H ? 'wide' : 'vertical'
  const s = Math.min(W, H) / 1080
  if (kind === 'vertical') return { W, H, kind, s, padX: 0.08 * W, top: 0.12 * H, bottom: 0.2 * H, caption: 70 * s, lift: 0.04, zoom: 0.96 }
  if (kind === 'wide') return { W, H, kind, s, padX: 0.065 * W, top: 0.09 * H, bottom: 0.1 * H, caption: 62 * s, lift: 0.1, zoom: 0.74 }
  return { W, H, kind, s, padX: 0.075 * W, top: 0.08 * H, bottom: 0.095 * H, caption: 62 * s, lift: 0.08, zoom: 1.05 }
}
