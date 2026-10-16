import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { LeavingContext } from './leavingContext'

/** how long a closing screen takes to fade out */
const LEAVE_MS = 160

/**
 * Shows [children] while [open], and when it closes keeps them a moment longer
 * to fade out (the caller still passes them once closed), so going back eases
 * away instead of snapping. A closing screen stops listening at once
 * (useLeaving), so the screen under it has the knob. Opening it again mid-fade
 * brings it straight back.
 */
export function Leaving({ open, children }: { open: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(open)
  const box = useRef<HTMLDivElement>(null)
  if (open && !shown) setShown(true)
  const leaving = shown && !open

  useLayoutEffect(() => {
    if (!leaving) return
    const els = Array.from(box.current?.children ?? []) as HTMLElement[]
    if (els.length === 0 || typeof els[0].animate !== 'function') {
      setShown(false)
      return
    }
    const fades = els.map((el) => {
      el.style.pointerEvents = 'none'
      return el.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: LEAVE_MS,
        easing: 'cubic-bezier(0.4, 0, 1, 1)',
        fill: 'forwards',
      })
    })
    fades[0].onfinish = () => setShown(false)
    return () => {
      fades[0].onfinish = null
      for (const f of fades) f.cancel()
      for (const el of els) el.style.pointerEvents = ''
    }
  }, [leaving])

  if (!shown) return null
  return (
    <LeavingContext.Provider value={leaving}>
      <div ref={box} style={{ display: 'contents' }}>
        {children}
      </div>
    </LeavingContext.Provider>
  )
}
