'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Mounts a heavy chart only when it comes within `margin` of the viewport. Until then the
 * space is reserved at `height`, so nothing moves when it arrives. Text and screen-reader
 * tables stay outside, in the server HTML from the start.
 */
export function Deferred({
  height,
  reserve,
  margin = '400px',
  children,
}: {
  height?: number
  /** classes that reserve the space per breakpoint, when one height does not fit all */
  reserve?: string
  margin?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShow(true)
          io.disconnect()
        }
      },
      { rootMargin: `${margin} 0px` },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [margin])
  return (
    <div ref={ref} className={show ? undefined : reserve} style={show || height == null ? undefined : { minHeight: height }}>
      {show ? children : null}
    </div>
  )
}
