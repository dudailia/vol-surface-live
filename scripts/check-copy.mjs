#!/usr/bin/env node
// Copy rules for everything a reader sees: no em dashes and no hype words.
// Checks Markdown files, the JSX text of the paper draft, and (with --url) the rendered
// text of the live pages.
//
//   node scripts/check-copy.mjs [--url http://localhost:3000]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const BANNED = ['leverage', 'leveraging', 'seamless', 'seamlessly', 'robust', 'revolutionary', 'ai-powered', 'best', 'cutting-edge', 'game-changing', 'world-class']
const EM_DASH = '—'
const problems = []

function check(where, text) {
  text.split('\n').forEach((line, i) => {
    if (line.includes(EM_DASH)) problems.push(`${where}:${i + 1}: em dash`)
    for (const w of BANNED) {
      if (new RegExp(`(^|[^a-z-])${w}([^a-z-]|$)`, 'i').test(line)) problems.push(`${where}:${i + 1}: "${w}"`)
    }
  })
}

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.venv', 'test-results', '.lighthouseci', 'data'].includes(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, exts, out)
    else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

// JSX text nodes only: what sits between a closing '>' and the next '<' on a line.
const jsxText = (src) =>
  src
    .split('\n')
    .map((l) => (l.match(/>([^<>{}]*)</g) ?? []).map((m) => m.slice(1, -1)).join(' '))
    .join('\n')

for (const f of ['README.md', 'PROGRESS.md', ...walk(join(ROOT, 'docs'), ['.md']), ...walk(join(ROOT, 'paper'), ['.md'])]) {
  const p = f.startsWith('/') ? f : join(ROOT, f)
  try {
    check(relative(ROOT, p), readFileSync(p, 'utf8'))
  } catch {}
}
for (const f of [...walk(join(ROOT, 'paper'), ['.tsx']), ...walk(join(ROOT, 'web/components'), ['.tsx']), ...walk(join(ROOT, 'web/app'), ['.tsx'])]) {
  check(relative(ROOT, f), jsxText(readFileSync(f, 'utf8')))
}

const urlArg = process.argv.indexOf('--url')
if (urlArg > 0) {
  const base = process.argv[urlArg + 1]
  for (const path of ['/', '/reports']) {
    const html = await (await fetch(base + path)).text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, '\n')
    check(`page ${path}`, text)
  }
}

if (problems.length) {
  console.error(`Copy check failed (${problems.length}):\n${problems.join('\n')}`)
  process.exit(1)
}
console.log('Copy check passed: no em dashes, no banned words.')
