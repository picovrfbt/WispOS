import { memo } from 'react'
import { useBakedArt } from '@/hooks/useBakedArt'
import { useArtLuminance } from '@/hooks/useColorExtract'
import styles from './ArtGlow.module.scss'

const GLOW_BASE = 0.75
const GLOW_CEILING = 0.34

// bright covers glow less, so a white sleeve doesn't flood the screen
function glowOpacity(luminance: number, strength = 1): number {
  return Math.min(GLOW_BASE, GLOW_CEILING / Math.max(luminance, 0.001)) * strength
}

interface Props {
  src: string | undefined
  /** kept for callers; the glow is static now, so there's nothing to pause */
  active?: boolean
  /** how far past the cover it reaches, as a % of the cover */
  spread?: number
  /** scales the glow's opacity */
  strength?: number
}

/**
 * The cover as a soft glow behind itself. The blur and the feathered edge are
 * baked into one small image (useBakedArt), and it no longer drifts: two
 * blurred layers animating forever cost the Car Thing a GPU blur every frame.
 * Place it inside a position: relative wrapper, before the cover (z-index > 0).
 */
function ArtGlowImpl({ src, spread = 130, strength = 1 }: Props) {
  const baked = useBakedArt(src)
  const luminance = useArtLuminance(src)
  if (!src || !baked) return null
  const style = {
    backgroundImage: `url("${baked.glow}")`,
    opacity: glowOpacity(luminance, strength),
    '--glow-spread': `${spread}%`,
  } as React.CSSProperties
  return <div className={styles.glow} style={style} aria-hidden />
}

export const ArtGlow = memo(ArtGlowImpl)
