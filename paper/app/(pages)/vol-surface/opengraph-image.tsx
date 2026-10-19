import { papers } from '@/content/papers'
import { OG_SIZE, paperOg } from '@/lib/og'

export const alt = `Ilia Duda: ${papers.find((p) => p.slug === 'vol-surface')!.title}`
export const size = OG_SIZE
export const contentType = 'image/png'

export default function Image() {
  return paperOg('vol-surface')
}
