import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  HeartFilledIcon,
  HeartOutlineIcon,
  SaveFilledIcon,
  SaveOutlineIcon,
  ThumbFilledIcon,
  ThumbOutlineIcon,
} from './icons'
import styles from './SaveButton.module.scss'

/** whose like this is: Spotify's save, YouTube Music's thumbs up, SoundCloud's heart */
export type SaveKind = 'save' | 'thumb' | 'heart'

interface Props {
  saved: boolean
  onToggle?: () => void
  disabled?: boolean
  kind?: SaveKind
}

const ICONS = {
  save: [SaveOutlineIcon, SaveFilledIcon, 36],
  thumb: [ThumbOutlineIcon, ThumbFilledIcon, 30],
  heart: [HeartOutlineIcon, HeartFilledIcon, 32],
} as const

const LABELS = {
  save: ['Add to Liked Songs', 'Remove from Liked Songs'],
  thumb: ['Like', 'Remove like'],
  heart: ['Like', 'Remove like'],
} as const

const ANIM_MS = 420

const CONFETTI = [
  { x: -52, y: -34, r: -140, s: 9, c: 0 },
  { x: -33, y: -54, r: -90, s: 7, c: 1 },
  { x: -12, y: -62, r: -40, s: 10, c: 2 },
  { x: 12, y: -64, r: 60, s: 8, c: 0 },
  { x: 34, y: -52, r: 120, s: 7, c: 1 },
  { x: 54, y: -30, r: 160, s: 9, c: 2 },
  { x: -60, y: -8, r: -170, s: 6, c: 1 },
  { x: 60, y: -6, r: 30, s: 6, c: 0 },
  { x: -22, y: -42, r: -20, s: 6, c: 2 },
  { x: 24, y: -46, r: 100, s: 7, c: 1 },
]

function SaveButtonImpl({ saved, onToggle, disabled = false, kind = 'save' }: Props) {
  const [Outline, Filled, iconSize] = ICONS[kind]
  const [animating, setAnimating] = useState(false)
  const [burst, setBurst] = useState(0)
  const timerRef = useRef(0)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const handleClick = useCallback(() => {
    setAnimating(true)
    if (!saved) setBurst((n) => n + 1)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setAnimating(false), ANIM_MS)
    onToggle?.()
  }, [onToggle, saved])

  // nothing to save while a narration owns the screen, and its uri is not a saveable track
  const filled = saved && !disabled
  const className = [
    styles.save,
    filled && styles.saved,
    animating && styles.animating,
    disabled && styles.disabled,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      aria-label={LABELS[kind][filled ? 1 : 0]}
      aria-pressed={filled}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={disabled ? undefined : handleClick}
    >
      <span className={styles.icons}>
        <span className={styles.outline}>
          <Outline size={iconSize} />
        </span>
        <span className={styles.filled}>
          <Filled size={iconSize} />
        </span>
      </span>
      {burst > 0 ? (
        <span className={styles.confetti} key={burst} aria-hidden>
          {CONFETTI.map((p, i) => (
            <span
              key={i}
              className={`${styles.bit} ${styles[`c${p.c}`]}`}
              style={
                {
                  width: p.s,
                  height: p.s,
                  '--x': `${p.x}px`,
                  '--y': `${p.y}px`,
                  '--r': `${p.r}deg`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ) : null}
    </button>
  )
}

export const SaveButton = memo(SaveButtonImpl)
