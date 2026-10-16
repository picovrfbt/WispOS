import { memo, useEffect, useState } from 'react'
import { useDial } from '@/components/Home/useDial'
import { VIZ_LABEL, VIZ_STYLES, useVizFeed } from '@/api/viz'
import { useColorExtract } from '@/hooks/useColorExtract'
import { updateSettings, useSettings } from '@/settings'
import { VizCanvas } from './VizCanvas'
import styles from './Visualizer.module.scss'

interface Props {
  /** what's playing, for its colours and a small caption */
  art?: string
  title?: string
  artist?: string
  onClose: () => void
}

/**
 * The visualizer on the whole screen (the player menu's "Full-screen
 * visualizer"). The knob changes the style, back leaves.
 */
function FullVisualizerImpl({ art, title, artist, onClose }: Props) {
  const { visualizerFull } = useSettings()
  const color = useColorExtract(art)
  const status = useVizFeed(true)
  // the style's name shows for a moment after it changes (and on opening)
  const [namedFor, setNamedFor] = useState<string | null>(visualizerFull)
  const [seen, setSeen] = useState(visualizerFull)
  if (seen !== visualizerFull) {
    setSeen(visualizerFull)
    setNamedFor(visualizerFull)
  }
  useEffect(() => {
    if (namedFor === null) return
    const t = window.setTimeout(() => setNamedFor(null), 2200)
    return () => window.clearTimeout(t)
  }, [namedFor])
  const named = namedFor !== null

  useDial({
    onStep: (dir) => {
      const i = VIZ_STYLES.indexOf(visualizerFull)
      const next = VIZ_STYLES[(i + dir + VIZ_STYLES.length) % VIZ_STYLES.length]
      updateSettings({ visualizerFull: next })
    },
    onPress: () => {},
    onBack: onClose,
  })

  const blocked = status?.known && !status.available
  return (
    <div className={styles.full} role="dialog" aria-label="Visualizer">
      <VizCanvas style={visualizerFull} layout="full" color={color} active className={styles.canvas} />
      <div className={`${styles.styleName} ${named ? styles.styleNameShown : ''}`}>
        {VIZ_LABEL[visualizerFull]}
        <span className={styles.styleHint}>Turn to change</span>
      </div>
      {blocked ? <div className={styles.note}>{status?.why || "This phone doesn't allow the visualizer"}</div> : null}
      {title ? (
        <div className={styles.caption}>
          {art ? <img className={styles.captionArt} src={art} alt="" /> : null}
          <div className={styles.captionText}>
            <div className={styles.captionTitle}>{title}</div>
            {artist ? <div className={styles.captionArtist}>{artist}</div> : null}
          </div>
        </div>
      ) : null}
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close the visualizer">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0z" />
        </svg>
      </button>
    </div>
  )
}

export const FullVisualizer = memo(FullVisualizerImpl)
