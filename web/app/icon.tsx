import { iconImage } from '@/lib/og'

export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

export default async function Icon() {
  // The data underneath is cached (getLatest); the image is redrawn when it changes.
  return iconImage(64)
}
