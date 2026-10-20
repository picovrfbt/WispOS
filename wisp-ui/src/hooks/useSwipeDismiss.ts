import { useEffect, useRef } from 'react'

// past this far up (px), or this fast (px/ms), letting go dismisses
const DISMISS_DISTANCE = 36
// sideways it takes further, so a slip of the finger never throws it away
const SIDE_DISTANCE = 90
// where a sideways swipe carries it on to once let go
const SIDE_THROW = 600
const DISMISS_VELOCITY = 0.5
// a flick still has to travel this far, so a nudge never dismisses
const FLICK_DISTANCE = 20
// moved more than this and it was a swipe, not a tap
const TAP_SLOP = 8

/**
 * Swipe-to-dismiss for a top banner: up, or left or right like an iPhone's.
 * The first few px of a drag pick the direction. While dragging it sets
 * --drag-x / --drag-y (px; y never positive) and data-dragging on the element;
 * the banner's own CSS turns those into its transform, since Chrome 69 has no
 * standalone `translate`. A click straight after a swipe is swallowed so a
 * swipe can't also tap.
 */
export function useSwipeDismiss<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onDismiss: () => void,
  enabled = true,
): void {
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let startX = 0
    let startY = 0
    let startAt = 0
    let dx = 0
    let dy = 0
    let axis: 'x' | 'y' | null = null
    let pointer: number | null = null
    let swallowClick = false

    const setDrag = (x: number, y: number) => {
      el.style.setProperty('--drag-x', `${x}px`)
      el.style.setProperty('--drag-y', `${y}px`)
      // fades as it goes so the dismiss reads
      el.style.setProperty('--drag-fade', String(Math.max(0, 1 + y / 120 - Math.abs(x) / 240)))
    }
    const reset = () => {
      el.removeAttribute('data-dragging')
      el.style.removeProperty('--drag-x')
      el.style.removeProperty('--drag-y')
      el.style.removeProperty('--drag-fade')
    }

    const onDown = (e: PointerEvent) => {
      if (pointer !== null) return
      pointer = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startAt = e.timeStamp
      dx = 0
      dy = 0
      axis = null
      swallowClick = false
      el.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      const rawX = e.clientX - startX
      const rawY = e.clientY - startY
      if (axis === null && (Math.abs(rawX) > TAP_SLOP || Math.abs(rawY) > TAP_SLOP)) {
        axis = Math.abs(rawX) > Math.abs(rawY) ? 'x' : 'y'
        swallowClick = true
        el.setAttribute('data-dragging', '')
      }
      if (axis === 'x') {
        dx = rawX
        setDrag(dx, 0)
      } else if (axis === 'y') {
        // only upward; a downward pull rubber-bands a little and stops
        dy = rawY < 0 ? rawY : Math.min(rawY / 4, 12)
        setDrag(0, dy)
      }
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      pointer = null
      const elapsed = Math.max(1, e.timeStamp - startAt)
      const dismiss =
        axis === 'x'
          ? Math.abs(dx) > SIDE_DISTANCE ||
            (Math.abs(dx) > FLICK_DISTANCE && Math.abs(dx) / elapsed > DISMISS_VELOCITY)
          : dy < -DISMISS_DISTANCE || (dy < -FLICK_DISTANCE && -dy / elapsed > DISMISS_VELOCITY)
      if (dismiss) {
        // let it carry on the way the finger sent it, then tidy up
        el.removeAttribute('data-dragging')
        if (axis === 'x') setDrag(Math.sign(dx) * SIDE_THROW, 0)
        dismissRef.current()
        window.setTimeout(reset, 300)
      } else {
        reset()
      }
    }
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      pointer = null
      reset()
    }
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('click', onClick, true)
      reset()
    }
  }, [ref, enabled])
}
