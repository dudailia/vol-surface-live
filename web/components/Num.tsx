'use client'

/**
 * A number that counts to its new value when it changes, and counts up once the first time
 * it scrolls into view (if it starts below the fold). One text node, server-rendered with
 * the real value: the HTML, copy-paste and screen readers all see the number once.
 */

import { animate, useInView, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

type Props = {
  value: number
  format: (x: number) => string
  className?: string
}

export function Num({ value, format, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: '0px 0px -8% 0px' })
  const mv = useMotionValue(value)
  const [text, setText] = useState(() => format(value))
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  })
  useMotionValueEvent(mv, 'change', (v) => setText(fmt.current(v)))
  const armed = useRef<'unknown' | 'below' | 'done'>('unknown')

  // After hydration: a number that starts off screen is reset to zero there, unseen, and
  // counts up when it arrives. One already on screen keeps its value.
  useEffect(() => {
    if (reduce || !ref.current) {
      armed.current = 'done'
      return
    }
    if (ref.current.getBoundingClientRect().top > window.innerHeight) {
      armed.current = 'below'
      mv.jump(0)
    } else {
      armed.current = 'done'
    }
  }, [reduce, mv])

  useEffect(() => {
    if (reduce) {
      mv.jump(value)
      return
    }
    if (armed.current === 'below' && !inView) return
    armed.current = 'done'
    if (mv.get() === value) return
    const controls = animate(mv, value, { duration: 0.9, ease: [0.23, 1, 0.32, 1] })
    return () => controls.stop()
  }, [value, inView, reduce, mv])

  return (
    <span ref={ref} className={`num ${className ?? ''}`}>
      {text}
    </span>
  )
}
