import { OG_SIZE, shareImage } from '@/lib/og'

export const alt = 'The live Bitcoin implied volatility surface, fitted to Deribit quotes'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image() {
  // The data underneath is cached (getLatest); the image is redrawn when it changes.
  return shareImage()
}
