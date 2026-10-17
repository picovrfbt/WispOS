import { memo, useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { subscribeEvents } from '@/api/eventBus'
import styles from './ModelOffer.module.scss'

/** Download on the pop-up: the phone app fetches its model */
async function downloadPhoneModel(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/voice/model_download`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Once, ever: after Wisp misses a request on a phone with no model (no Gemini
 * Nano, nothing downloaded), an offer to download one to the phone. The knob
 * picks, a press chooses, back is No thanks. The daemon decides when (and
 * that it's only once); this only shows it.
 */
function ModelOfferImpl() {
  const [sizeMb, setSizeMb] = useState<number | null>(null)
  // a stray press while driving shouldn't start a big download
  const [downloadFocused, setDownloadFocused] = useState(false)

  useEffect(
    () =>
      subscribeEvents((evt) => {
        if (evt.type !== 'voice/model_offer') return
        const size = (evt.data as { size_mb?: number } | undefined)?.size_mb
        if (!size) return
        setDownloadFocused(false)
        setSizeMb(size)
      }),
    [],
  )

  const open = sizeMb !== null

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Enter' && downloadFocused) void downloadPhoneModel()
      setSizeMb(null)
    }
    const onWheel = (e: WheelEvent) => {
      const d = e.deltaX !== 0 ? -e.deltaX : e.deltaY
      if (d === 0) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setDownloadFocused(d > 0)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [open, downloadFocused])

  if (!open) return null
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-offer-title"
    >
      <div className={styles.card}>
        <div className={styles.eyebrow}>Smarter voice</div>
        <div id="model-offer-title" className={styles.title}>
          Help Wisp understand more?
        </div>
        <p className={styles.body}>
          Your phone can download a {sizeMb}&nbsp;MB model so Wisp gets looser requests and
          questions. Nothing you say leaves the phone. Best on Wi‑Fi.
        </p>
        <div className={styles.buttons}>
          <button
            type="button"
            className={`${styles.button} ${!downloadFocused ? styles.focus : ''}`}
            onClick={() => setSizeMb(null)}
          >
            No thanks
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.primary} ${downloadFocused ? styles.focus : ''}`}
            onClick={() => {
              void downloadPhoneModel()
              setSizeMb(null)
            }}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  )
}

export const ModelOffer = memo(ModelOfferImpl)
