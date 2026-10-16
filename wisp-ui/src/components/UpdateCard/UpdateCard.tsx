import { memo, useEffect, useState } from 'react'
import { BRAND_NAME } from '@/brand'
import styles from './UpdateCard.module.scss'
import { useLeaving } from '@/overlays/leavingContext'

const MAX_HIGHLIGHTS = 3

interface Props {
  latest: string
  highlights?: string[]
  // a mandatory release drops the skip option
  mandatory?: boolean
  /** installs it over the air; without it the card says to reflash instead */
  onInstall?: () => void
  onRemindLater: () => void
  onSkip?: () => void
}

interface Choice {
  label: string
  run: () => void
  primary?: boolean
}

function UpdateCardImpl({
  latest,
  highlights = [],
  mandatory = false,
  onInstall,
  onRemindLater,
  onSkip,
}: Props) {
  const canSkip = !mandatory && onSkip != null
  const choices: Choice[] = []
  if (onInstall) choices.push({ label: 'Install now', run: onInstall, primary: true })
  choices.push({
    label: onInstall ? 'Later' : 'Remind me later',
    run: onRemindLater,
    primary: !onInstall,
  })
  if (canSkip) choices.push({ label: 'Skip this version', run: onSkip })
  const [sel, setSel] = useState(0)

  // the dial picks a button and a press takes it
  const many = choices.length > 1
  const leaving = useLeaving()
  useEffect(() => {
    if (!many || leaving) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        choices[Math.min(sel, choices.length - 1)].run()
      }
    }
    const onWheel = (e: WheelEvent) => {
      const d = e.deltaX !== 0 ? e.deltaX : e.deltaY
      if (d === 0) return
      e.preventDefault()
      e.stopPropagation()
      setSel((i) => Math.max(0, Math.min(choices.length - 1, i + (d > 0 ? 1 : -1))))
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('wheel', onWheel, { capture: true })
    }
  })

  return (
    <div className={styles.overlay} role="dialog" aria-label="Update available">
      <div className={styles.card}>
        <h1 className={styles.title}>Update available</h1>
        <p className={`${styles.body} ${styles.bodyCenter}`}>
          {BRAND_NAME} {latest} is out.
        </p>
        <div className={styles.body}>What's new</div>
        {highlights.length > 0 ? (
          <ul className={styles.highlights}>
            {highlights.slice(0, MAX_HIGHLIGHTS).map((h) => (
              <li key={h} className={styles.highlight}>
                {h}
              </li>
            ))}
          </ul>
        ) : null}
        <p className={styles.hint}>
          {onInstall ? (
            <>Downloads through your phone, then {BRAND_NAME} restarts. About a minute.</>
          ) : (
            <>
              Flash from <span className={styles.hintUrl}>terbium.app</span> on your computer
            </>
          )}
        </p>
        <div className={styles.buttons}>
          {choices.map((c, i) => (
            <button
              key={c.label}
              type="button"
              className={`${styles.btn} ${c.primary ? styles.btnPrimary : ''} ${
                many && sel === i ? styles.btnFocus : ''
              }`}
              onClick={c.run}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export const UpdateCard = memo(UpdateCardImpl)
