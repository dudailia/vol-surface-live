/** Number and date formatting. Every number on the page goes through here. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

export function fixed(x: number, dp = 1): string {
  // A true minus sign, so signed numbers line up in tabular figures.
  return x.toFixed(dp).replace('-', '−')
}

export function signed(x: number, dp = 1): string {
  const s = fixed(Math.abs(x), dp)
  if (Number(s) === 0) return fixed(0, dp)
  return (x > 0 ? '+' : '−') + s
}

export function pct(x: number, dp = 1): string {
  return `${fixed(x, dp)}%`
}

export function usd(x: number): string {
  return `$${Math.round(x).toLocaleString('en-US')}`
}

export function utcTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

export function utcDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function utcStamp(iso: string): string {
  return `${utcTime(iso)}, ${utcDate(iso)}`
}

/** "27NOV26" → "27 Nov 2026" */
export function expiryLabel(code: string): string {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code)
  if (!m) return code
  return `${Number(m[1])} ${m[2][0]}${m[2].slice(1).toLowerCase()} 20${m[3]}`
}

export function days(T: number): string {
  const d = T * 365
  return d < 10 ? `${d.toFixed(1)} days` : `${Math.round(d)} days`
}

export function upDown(x: number, up = 'rose', down = 'fell', flat = 'was unchanged'): string {
  return Math.abs(x) < 0.05 ? flat : x > 0 ? up : down
}

/** "27NOV26" → "27 Nov ’26", for narrow tables. */
export function expiryShort(code: string): string {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code)
  if (!m) return code
  return `${Number(m[1])} ${m[2][0]}${m[2].slice(1).toLowerCase()} ’${m[3]}`
}
