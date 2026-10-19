import type { Metadata, Viewport } from 'next'
import { sourceCodePro, sourceSerif } from '@/lib/fonts'
import { DESCRIPTION, SITE_URL, TITLE } from '@/lib/site'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: `%s | ${TITLE}` },
  description: DESCRIPTION,
  authors: [{ name: 'Ilia Duda', url: 'https://iliaduda.com' }],
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: SITE_URL, siteName: 'Ilia Duda' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  alternates: { canonical: '/' },
}

export const viewport: Viewport = {
  themeColor: '#111316',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${sourceSerif.variable} ${sourceCodePro.variable}`}>
      <body>{children}</body>
    </html>
  )
}
