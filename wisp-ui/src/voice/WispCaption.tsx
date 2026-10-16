import { useEffect, useState, type ReactNode } from 'react'
import { subscribeEvents } from '@/api/eventBus'
import type { ApiEvent, VoiceEventData } from '@/api/types'
import { speak, spokenTrack } from './speak'
import styles from './WispCaption.module.scss'

// how long a line stays up; "thinking" stays until the answer replaces it
const SHOW_MS = 4500
const THINKING_MS = 20000

// fun word bank for while it transcribes
const THINKING_WORDS = [
  'Thinking...',
  'Hmm...',
  'One sec...',
  'Let me see...',
  'Working on it...',
  'On it...',
  'Looking...',
  'Hang on...',
]

interface Caption {
  key: number
  body: ReactNode
  quiet: boolean
}

/** tells the Wisp bar a caption is up, so it glows under the words */
function signal(showing: boolean) {
  window.dispatchEvent(new CustomEvent('wisp:caption', { detail: showing }))
}

/**
 * Wisp talking: its answers to voice commands as subtitles along the bottom,
 * over the Wisp bar, instead of a banner at the top. Spoken through the phone
 * too, when Settings → Wisp's voice says so.
 */
export function WispCaption() {
  const [caption, setCaption] = useState<Caption | null>(null)

  useEffect(() => {
    let hide = 0
    let seq = 0
    const show = (body: ReactNode, ms: number, quiet = false) => {
      seq += 1
      setCaption({ key: seq, body, quiet })
      signal(true)
      window.clearTimeout(hide)
      hide = window.setTimeout(() => {
        setCaption(null)
        signal(false)
      }, ms)
    }
    const unsub = subscribeEvents((evt: ApiEvent) => {
      if (evt.type !== 'voice') return
      const { state, text } = (evt.data ?? {}) as VoiceEventData
      switch (state) {
        case 'thinking':
          show(text || THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)], THINKING_MS, true)
          break
        case 'playing': {
          const i = text ? text.lastIndexOf(' - ') : -1
          show(
            text ? (
              i > 0 ? (
                <>
                  Playing <b>{text.slice(0, i)}</b> by {text.slice(i + 3)}
                </>
              ) : (
                <>
                  Playing <b>{text}</b>
                </>
              )
            ) : (
              'Playing'
            ),
            SHOW_MS,
          )
          speak(text ? `Playing ${spokenTrack(text)}` : 'Playing', 'confirm')
          break
        }
        case 'done':
          show(text || 'Done', SHOW_MS)
          speak(text || 'Done', 'confirm')
          break
        case 'error':
          show(text || "Sorry, I didn't catch that", SHOW_MS)
          speak(text || "Sorry, I didn't catch that", 'confirm')
          break
        // 'listening' belongs to the Wisp bar; 'idle' changes nothing here
      }
    })
    return () => {
      unsub()
      window.clearTimeout(hide)
      signal(false)
    }
  }, [])

  return (
    <div className={`${styles.root} ${caption ? styles.on : ''}`} aria-live="polite">
      <div className={styles.fade} aria-hidden />
      {caption ? (
        <div key={caption.key} className={`${styles.words} ${caption.quiet ? styles.quiet : ''}`}>
          <span className={styles.who}>Wisp</span>
          <span className={styles.line}>{caption.body}</span>
        </div>
      ) : null}
    </div>
  )
}
