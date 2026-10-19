import { iconImage } from '@/lib/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default async function AppleIcon() {
  // The data underneath is cached (getLatest); the image is redrawn when it changes.
  return iconImage(180)
}
