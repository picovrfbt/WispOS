import { useEffect, useRef } from 'react'
import { subscribeEvents } from '@/api/eventBus'
import type { NotifyFn } from '@/notify/notifyContext'

interface Props {
  notify: NotifyFn
  /** a session just started (by voice, say): show its QR code */
  onStarted: () => void
  /** a session ended with songs the passengers added: offer to keep them */
  onEnded: () => void
}

/**
 * Passengers' picks as they happen ("Sam added Midnight City"), along the top,
 * the QR screen when a session starts somewhere other than its screen, and
 * the offer to keep the passengers' songs when one ends, however it ended.
 */
export function JamActivity({ notify, onStarted, onEnded }: Props) {
  const active = useRef<boolean | null>(null)
  useEffect(
    () =>
      subscribeEvents((evt) => {
        if (evt.type === 'jam/activity') {
          const text = (evt.data as { text?: string } | undefined)?.text
          if (text) notify(text)
        } else if (evt.type === 'jam/state') {
          const st = evt.data as { active?: boolean; picks?: number } | undefined
          const now = st?.active === true
          if (now && active.current === false) onStarted()
          if (!now && active.current === true && (st?.picks ?? 0) > 0) onEnded()
          active.current = now
        }
      }),
    [notify, onStarted, onEnded],
  )
  return null
}
