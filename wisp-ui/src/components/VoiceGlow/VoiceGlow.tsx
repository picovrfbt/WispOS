import { useEffect, useRef, useState } from 'react'
import { subscribeEvents } from '@/api/eventBus'
import type { ApiEvent, VoiceEventData } from '@/api/types'
import styles from './VoiceGlow.module.scss'

type GlowState = 'off' | 'listening' | 'thinking' | 'speaking'

// nothing after the wake word (silence, a dropped capture): let it go
const STALE_MS = 15000
// how tall the band stands with no voice, and how much a full voice adds
const REST = 0.42
const SWING = 0.85

/**
 * The Wisp bar: a band of soft colour along the bottom edge, in the style of
 * Spotify's DJ and voice screens. While the Car Thing listens after "Okay
 * Wisp" it rises and falls with your voice (the wake listener reports a level
 * every 80 ms); while it works out what you said, it drifts quicker and lower.
 *
 * Only transforms and opacity move, on layers whose gradients are drawn once,
 * so the Car Thing's compositor animates it without repainting.
 */
export function VoiceGlow() {
  const [state, setState] = useState<GlowState>('off')
  // a listener too old to report levels gets a steady breath instead
  const [heardLevel, setHeardLevel] = useState(false)
  const levelRef = useRef<HTMLDivElement>(null)

  // Wisp's words are up at the bottom (WispCaption): glow under them
  useEffect(() => {
    const onCaption = (e: Event) => {
      const showing = (e as CustomEvent<boolean>).detail === true
      setState((s) => (showing ? (s === 'off' ? 'speaking' : s) : s === 'speaking' ? 'off' : s))
    }
    window.addEventListener('wisp:caption', onCaption)
    return () => window.removeEventListener('wisp:caption', onCaption)
  }, [])

  useEffect(() => {
    let stale = 0
    const unsub = subscribeEvents((evt: ApiEvent) => {
      if (evt.type === 'voice/level') {
        const level = (evt.data as { level?: number } | null)?.level
        if (typeof level !== 'number' || !levelRef.current) return
        setHeardLevel(true)
        // straight onto the layer: twelve a second must not re-render React
        levelRef.current.style.transform = `scaleY(${REST + Math.min(1, Math.max(0, level)) * SWING})`
        return
      }
      if (evt.type !== 'voice') return
      const voice = (evt.data ?? {}) as VoiceEventData
      const next: GlowState =
        voice.state === 'listening' ? 'listening' : voice.state === 'thinking' ? 'thinking' : 'off'
      setState(next)
      if (next !== 'listening' && levelRef.current) levelRef.current.style.transform = ''
      if (next === 'off') setHeardLevel(false)
      window.clearTimeout(stale)
      if (next !== 'off') stale = window.setTimeout(() => setState('off'), STALE_MS)
    })
    return () => {
      unsub()
      window.clearTimeout(stale)
    }
  }, [])

  const breathing = state === 'listening' && !heardLevel
  return (
    <div
      className={`${styles.bar} ${state !== 'off' ? styles.on : ''} ${
        state === 'thinking' ? styles.thinking : ''
      } ${state === 'speaking' ? styles.speaking : ''}`}
      data-state={state}
      aria-hidden
    >
      <div ref={levelRef} className={`${styles.level} ${breathing ? styles.breathing : ''}`}>
        <span className={`${styles.blob} ${styles.b1}`} />
        <span className={`${styles.blob} ${styles.b2}`} />
        <span className={`${styles.blob} ${styles.b3}`} />
        <span className={`${styles.blob} ${styles.b4}`} />
        <span className={`${styles.blob} ${styles.b5}`} />
      </div>
    </div>
  )
}
