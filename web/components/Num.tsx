'use client'

/**
 * A number that counts to its new value when it changes, and counts up once the first time
 * it scrolls into view (if it starts below the fold). Server-rendered with its real value.
 */

import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useRef } from 'react'

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
  const text = useTransform(mv, format)
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
      {/* Screen readers get the final value, not every frame of the count. */}
      <motion.span aria-hidden="true">{text}</motion.span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
