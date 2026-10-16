import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * The knob on a setup screen: turning moves between the screen's buttons and
 * pressing chooses the one in focus, so setup works without touching the
 * screen. The knob is REL_HWHEEL (clockwise is negative deltaX); a desk mouse
 * scrolls deltaY. Back stays with App's global handler.
 */
export function useKnobChoice(
  count: number,
  enabled = true,
): { ref: RefObject<HTMLDivElement | null>; focused: number } {
  const ref = useRef<HTMLDivElement | null>(null)
  const [focused, setFocused] = useState(0)
  const focusedRef = useRef(0)

  useEffect(() => {
    if (!enabled || count === 0) return
    const buttons = () =>
      Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const move = (to: number) => {
      const n = Math.max(0, Math.min(count - 1, to))
      focusedRef.current = n
      setFocused(n)
    }
    const onWheel = (e: WheelEvent) => {
      const d = e.deltaX !== 0 ? -e.deltaX : e.deltaY
      if (d === 0) return
      e.preventDefault()
      move(focusedRef.current + (d > 0 ? 1 : -1))
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      const b = buttons()[focusedRef.current]
      if (!b) return
      e.preventDefault()
      b.click()
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [count, enabled])

  return { ref, focused }
}
