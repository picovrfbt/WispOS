import { memo, useEffect, useState } from 'react'
import { callControl, usePhoneCall } from '@/api/call'
import { formatTimer } from './timer'
import styles from './CallCard.module.scss'

/**
 * A call on the phone, over whatever's on screen. Ringing: who it is, with
 * Decline and Answer (the knob picks, a press chooses, back hides the card and
 * leaves the phone ringing). Once answered: a small pill with a timer and End,
 * out of the way of the rest of the screen.
 */
function CallCardImpl() {
  const call = usePhoneCall()
  const [answerFocused, setAnswerFocused] = useState(true)
  // hidden with back for this call only
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const ringing = call.state === 'ringing' && hiddenFor !== key(call.name)

  // each new call starts on Answer, with the card showing
  const [seenState, setSeenState] = useState(call.state)
  if (seenState !== call.state) {
    setSeenState(call.state)
    if (call.state !== 'ringing') {
      setHiddenFor(null)
      setAnswerFocused(true)
    }
  }

  // while it rings, the knob and buttons belong to the card
  useEffect(() => {
    if (!ringing) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Enter') void callControl(answerFocused ? 'answer' : 'decline')
      else setHiddenFor(key(call.name))
    }
    const onWheel = (e: WheelEvent) => {
      const d = e.deltaX !== 0 ? -e.deltaX : e.deltaY
      if (d === 0) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setAnswerFocused(d > 0)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [ringing, answerFocused, call.name])

  if (ringing) {
    return (
      <div className={styles.ringing} role="dialog" aria-label="Incoming call">
        <div className={styles.card}>
          <div className={styles.label}>Incoming call</div>
          <div className={styles.name}>{call.name || 'Unknown caller'}</div>
          <div className={styles.buttons}>
            <button
              type="button"
              className={`${styles.round} ${styles.decline} ${!answerFocused ? styles.focus : ''}`}
              onClick={() => void callControl('decline')}
              aria-label="Decline"
            >
              <PhoneIcon down />
            </button>
            <button
              type="button"
              className={`${styles.round} ${styles.answer} ${answerFocused ? styles.focus : ''}`}
              onClick={() => void callControl('answer')}
              aria-label="Answer"
            >
              <PhoneIcon />
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (call.state === 'active') return <ActivePill name={call.name} since={call.since} />
  return null
}

function ActivePill({ name, since }: { name?: string; since?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const secs = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0
  return (
    <div className={styles.pill} role="status" aria-label="Call in progress">
      <span className={styles.pillIcon} aria-hidden>
        <PhoneIcon />
      </span>
      <span className={styles.pillName}>{name || 'On a call'}</span>
      <span className={styles.timer}>{formatTimer(secs)}</span>
      <button type="button" className={styles.end} onClick={() => void callControl('hangup')}>
        End
      </button>
    </div>
  )
}

function key(name?: string) {
  return name ?? ''
}

function PhoneIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      style={down ? { transform: 'rotate(135deg)' } : undefined}
    >
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" />
    </svg>
  )
}

export const CallCard = memo(CallCardImpl)
