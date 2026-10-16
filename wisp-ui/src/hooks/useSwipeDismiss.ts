import { useEffect, useRef } from 'react'

// past this far up (px), or this fast (px/ms), letting go dismisses
const DISMISS_DISTANCE = 36
const DISMISS_VELOCITY = 0.5
// a flick still has to travel this far, so a nudge never dismisses
const FLICK_DISTANCE = 20
// moved more than this and it was a swipe, not a tap
const TAP_SLOP = 8

/**
 * Swipe-up-to-dismiss for a top banner. While dragging it sets --drag-y (px,
 * never positive) and data-dragging on the element; the banner's own CSS turns
 * those into its transform, since Chrome 69 has no standalone `translate`.
 * A click straight after a swipe is swallowed so a swipe can't also tap.
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

    let startY = 0
    let startAt = 0
    let dy = 0
    let pointer: number | null = null
    let swallowClick = false

    const setDrag = (y: number) => {
      el.style.setProperty('--drag-y', `${y}px`)
      // fades as it goes so the dismiss reads
      el.style.setProperty('--drag-fade', String(Math.max(0, 1 + y / 120)))
    }
    const reset = () => {
      el.removeAttribute('data-dragging')
      el.style.removeProperty('--drag-y')
      el.style.removeProperty('--drag-fade')
    }

    const onDown = (e: PointerEvent) => {
      if (pointer !== null) return
      pointer = e.pointerId
      startY = e.clientY
      startAt = e.timeStamp
      dy = 0
      swallowClick = false
      el.setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      // only upward; a downward pull rubber-bands a little and stops
      const raw = e.clientY - startY
      dy = raw < 0 ? raw : Math.min(raw / 4, 12)
      if (Math.abs(raw) > TAP_SLOP) {
        swallowClick = true
        el.setAttribute('data-dragging', '')
      }
      if (swallowClick) setDrag(dy)
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      pointer = null
      const velocity = -dy / Math.max(1, e.timeStamp - startAt)
      const dismiss =
        dy < -DISMISS_DISTANCE || (dy < -FLICK_DISTANCE && velocity > DISMISS_VELOCITY)
      if (dismiss) {
        // let it carry on up from where the finger left it, then tidy up
        el.removeAttribute('data-dragging')
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
