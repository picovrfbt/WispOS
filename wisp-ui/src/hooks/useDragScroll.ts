import { useEffect, useRef } from 'react'

// moved more than this and it was a drag, not a tap
const DRAG_SLOP = 6
// a release keeps going this long at the speed it left with (ms)
const FLING_MS = 220

/**
 * Drag a scroll container with a finger or a mouse, with a little fling on
 * release. Touch scrolling alone would leave the desktop simulator unable to
 * drag, and a mouse can't scroll a hidden-scrollbar row at all. The click that
 * ends a drag is swallowed so dragging over a card doesn't open it.
 *
 * onRelease gets where the scroll would come to rest, so a carousel can snap.
 */
export function useDragScroll<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  {
    axis,
    onRelease,
    enabled = true,
  }: { axis: 'x' | 'y'; onRelease?: (rest: number) => void; enabled?: boolean },
): void {
  const releaseRef = useRef(onRelease)
  useEffect(() => {
    releaseRef.current = onRelease
  })

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const pos = (e: PointerEvent) => (axis === 'x' ? e.clientX : e.clientY)
    const getScroll = () => (axis === 'x' ? el.scrollLeft : el.scrollTop)
    const setScroll = (v: number) => {
      if (axis === 'x') el.scrollLeft = v
      else el.scrollTop = v
    }

    let pointer: number | null = null
    let start = 0
    let startScroll = 0
    let dragging = false
    let swallowClick = false
    let lastPos = 0
    let lastAt = 0
    let velocity = 0 // px/ms, positive when the finger moves toward the start

    const onDown = (e: PointerEvent) => {
      if (pointer !== null || e.button > 0) return
      // a slider drag is the slider's, even when the finger wanders
      if ((e.target as Element | null)?.closest?.('[role="slider"]')) return
      pointer = e.pointerId
      start = lastPos = pos(e)
      lastAt = e.timeStamp
      startScroll = getScroll()
      dragging = false
      velocity = 0
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      const p = pos(e)
      if (!dragging && Math.abs(p - start) > DRAG_SLOP) {
        dragging = true
        // follow the finger exactly, not the smooth scroll the dial uses
        el.style.scrollBehavior = 'auto'
        el.setPointerCapture?.(e.pointerId)
      }
      if (!dragging) return
      const dt = Math.max(1, e.timeStamp - lastAt)
      velocity = (lastPos - p) / dt
      lastPos = p
      lastAt = e.timeStamp
      setScroll(startScroll - (p - start))
    }
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== pointer) return
      pointer = null
      if (!dragging) return
      dragging = false
      swallowClick = !cancelled
      el.style.scrollBehavior = ''
      const rest = getScroll() + velocity * FLING_MS
      if (releaseRef.current) releaseRef.current(rest)
      else setScroll(rest)
    }
    const onUp = (e: PointerEvent) => finish(e, false)
    const onCancel = (e: PointerEvent) => finish(e, true)
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
      el.style.scrollBehavior = ''
    }
  }, [ref, axis, enabled])
}
