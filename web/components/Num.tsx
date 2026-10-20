'use client'

/**
 * A number that counts to its new value when it changes, and counts up once the first time
 * it scrolls into view (if it starts below the fold). One text node, server-rendered with
 * the real value: the HTML, copy-paste and screen readers all see the number once.
 */

import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

type Props = {
  value: number
  format: (x: number) => string
  className?: string
}

const DURATION = 900
// The site's ease-out, cubic-bezier(0.23, 1, 0.32, 1), approximated by a quintic ease-out.
const ease = (t: number) => 1 - (1 - t) ** 5

export function Num({ value, format, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const [text, setText] = useState(() => format(value))
  const fmt = useRef(format)
  const shown = useRef(value)
  const raf = useRef(0)
  useEffect(() => {
    fmt.current = format
  })

  const run = (from: number, to: number) => {
    cancelAnimationFrame(raf.current)
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION)
      shown.current = from + (to - from) * ease(t)
      setText(fmt.current(shown.current))
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }

  // A number that starts off screen is set to zero there, unseen, and counts up when it
  // arrives. One already on screen keeps its value.
  useEffect(() => {
    const el = ref.current
    if (reduce || !el || el.getBoundingClientRect().top <= window.innerHeight) return
    const target = value
    raf.current = requestAnimationFrame(() => {
      shown.current = 0
      setText(fmt.current(0))
    })
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        run(0, target)
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
    // Only on mount: later changes animate from wherever the number is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (shown.current === value) return
    if (reduce) {
      shown.current = value
      raf.current = requestAnimationFrame(() => setText(fmt.current(value)))
      return
    }
    run(shown.current, value)
    return () => cancelAnimationFrame(raf.current)
  }, [value, reduce])

  return (
    <span ref={ref} className={`num ${className ?? ''}`}>
      {text}
    </span>
  )
}
