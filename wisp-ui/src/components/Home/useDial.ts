import { useEffect, useEffectEvent } from 'react'
import { useLeaving } from '@/overlays/leavingContext'

// matches useHardwareButtons: the encoder sends doubled notches closer than this
const MIN_STEP_INTERVAL_MS = 55

export interface DialHandlers {
  /** +1 clockwise, -1 counter-clockwise */
  onStep: (dir: 1 | -1) => void
  /** knob press (Enter) */
  onPress: () => void
  /** back button (Escape) */
  onBack: () => void
  enabled?: boolean
}

/**
 * The knob, its press and the back button, for screens that navigate with them.
 * useHardwareButtons stands down (its `navigating` flag) while one of these is up.
 */
export function useDial({ onStep, onPress, onBack, enabled = true }: DialHandlers) {
  const step = useEffectEvent(onStep)
  const press = useEffectEvent(onPress)
  const back = useEffectEvent(onBack)
  // a screen fading out has let go of the knob already
  const leaving = useLeaving()
  const live = enabled && !leaving

  useEffect(() => {
    if (!live) return
    let lastStepAt = 0
    const onWheel = (e: WheelEvent) => {
      // the knob is REL_HWHEEL, clockwise is negative deltaX; a desk mouse scrolls deltaY
      const d = e.deltaX !== 0 ? -e.deltaX : e.deltaY
      if (d === 0) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastStepAt < MIN_STEP_INTERVAL_MS) return
      lastStepAt = now
      step(d > 0 ? 1 : -1)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        press()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [live])
}
