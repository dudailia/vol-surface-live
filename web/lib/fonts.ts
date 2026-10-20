import localFont from 'next/font/local'

// The same self-hosted variable faces as iliaduda.com. The exported names and the
// *-face variables avoid colliding with the generic family keywords and with the
// --font-serif / --font-mono theme tokens that consume them.
export const sourceSerif = localFont({
  src: '../public/fonts/source-serif-4-latin-var.woff2',
  weight: '200 900',
  style: 'normal',
  // swap, not optional as on iliaduda.com: this is a one-page site, so a visitor's first
  // load is usually their only one, and with optional a slow first load kept the fallback
  // for the whole visit. The size-adjusted fallback keeps the swap's layout shift small.
  display: 'swap',
  variable: '--font-serif-face',
  adjustFontFallback: 'Times New Roman',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
})

export const sourceCodePro = localFont({
  src: '../public/fonts/source-code-pro-latin-var.woff2',
  weight: '200 900',
  style: 'normal',
  display: 'swap',
  // Not preloaded: it swaps in, and preloading it competed with the hero image for
  // bandwidth on slow connections.
  preload: false,
  variable: '--font-mono-face',
  adjustFontFallback: 'Arial',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})
