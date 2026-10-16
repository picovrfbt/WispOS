import { memo, useContext } from 'react'
import { useVizFeed } from '@/api/viz'
import { useColorExtract } from '@/hooks/useColorExtract'
import { OverlayContext } from '@/overlays/overlayContext'
import { useSettings } from '@/settings'
import { VizCanvas } from './VizCanvas'
import styles from './Visualizer.module.scss'

/** how far past the cover it reaches, as a share of the cover */
const SPREAD = 2.1

/**
 * The visualizer behind the cover on the players (the player menu's
 * "Visualizer"). Place it inside the cover's position: relative wrapper,
 * after the glow and before the cover. Draws only while its view is the one
 * showing and nothing is open over the player.
 */
function ArtVisualizerImpl({ src, active = true }: { src: string | undefined; active?: boolean }) {
  const { visualizer } = useSettings()
  const overlays = useContext(OverlayContext)
  const color = useColorExtract(src)
  const on = visualizer !== 'off' && active && !(overlays?.busy ?? false)
  useVizFeed(on)
  if (visualizer === 'off') return null
  return (
    <div className={styles.behindCover} style={{ width: `${SPREAD * 100}%`, height: `${SPREAD * 100}%` }}>
      <VizCanvas
        style={visualizer}
        layout="cover"
        color={color}
        active={on}
        coverFrac={1 / SPREAD}
        className={styles.canvas}
      />
    </div>
  )
}

export const ArtVisualizer = memo(ArtVisualizerImpl)
