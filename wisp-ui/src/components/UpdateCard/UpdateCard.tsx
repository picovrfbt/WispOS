import { memo, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { BRAND_NAME, whatsNewUrl } from '@/brand'
import styles from './UpdateCard.module.scss'
import { useLeaving } from '@/overlays/leavingContext'
import { updateSettings, useSettings } from '@/settings'

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
  // ticked, later updates install by themselves and this card stops coming
  const { autoInstallUpdates } = useSettings()
  const canAuto = onInstall != null
  const toggleAuto = () => updateSettings({ autoInstallUpdates: !autoInstallUpdates })
  // the checkbox is the dial's last stop, after the buttons
  const stops = choices.length + (canAuto ? 1 : 0)
  const [sel, setSel] = useState(0)

  // the dial picks a button and a press takes it
  const many = stops > 1
  const leaving = useLeaving()
  useEffect(() => {
    if (!many || leaving) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (canAuto && sel >= choices.length) toggleAuto()
        else choices[Math.min(sel, choices.length - 1)].run()
      }
    }
    const onWheel = (e: WheelEvent) => {
      const d = e.deltaX !== 0 ? e.deltaX : e.deltaY
      if (d === 0) return
      e.preventDefault()
      e.stopPropagation()
      setSel((i) => Math.max(0, Math.min(stops - 1, i + (d > 0 ? 1 : -1))))
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
        <div className={styles.news}>
          <div className={styles.newsText}>
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
          </div>
          {/* small, to the side: the whole of what's new on your phone */}
          <div className={styles.qr} aria-label="Scan for everything that's new">
            <QRCodeSVG
              value={whatsNewUrl(latest)}
              size={64}
              bgColor="#ffffff"
              fgColor="#0b0b0c"
              level="L"
              marginSize={1}
            />
            <span>Scan for more</span>
          </div>
        </div>
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
        {canAuto ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={autoInstallUpdates}
            className={`${styles.auto} ${many && sel === choices.length ? styles.autoFocus : ''}`}
            onClick={toggleAuto}
          >
            <span className={`${styles.box} ${autoInstallUpdates ? styles.boxOn : ''}`} aria-hidden>
              {autoInstallUpdates ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : null}
            </span>
            <span>Download and install updates automatically</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

export const UpdateCard = memo(UpdateCardImpl)
