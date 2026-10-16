import type { ReactNode } from 'react'
import { ArtVisualizer } from '@/components/Visualizer'
import { memo } from 'react'
import { AlbumArt } from '@/components/AlbumArt'
import { Marquee } from '@/components/TrackInfo/Marquee'
import { presentTrack, useNarration } from '@/hooks/useDJNarration'
import { ArtGlow } from '@/components/ArtGlow'
import type { ObserverStatusActive } from '@/api/types'
import styles from './NoLyricsView.module.scss'

interface Props {
  status: ObserverStatusActive
  active?: boolean
  // shrinks with the display size so the 130% glow stays inside the stage row
  artSize?: number
  /** a small mark before the artist: the service it's playing from */
  badge?: ReactNode
}

const ART_SIZE = 220
function NoLyricsViewImpl({ status, active = true, artSize = ART_SIZE, badge }: Props) {
  const narration = useNarration()
  const { title, artist, art, djFallback } = presentTrack(status, narration)

  return (
    <div className={styles.wrap}>
      <div className={styles.art}>
        <ArtGlow src={art} active={active} />
        <ArtVisualizer src={art} active={active} />
        <div className={styles.cover}>
          <AlbumArt src={art} size={artSize} djFallback={djFallback} />
        </div>
      </div>
      <div className={styles.meta}>
        <Marquee text={title || 'Unknown track'} className={styles.title} />
        {badge ? (
          <div className={styles.artistRow}>
            <span className={styles.badge}>{badge}</span>
            <Marquee text={artist || 'Unknown artist'} className={styles.artist} />
          </div>
        ) : (
          <Marquee text={artist || 'Unknown artist'} className={styles.artist} />
        )}
      </div>
    </div>
  )
}

export const NoLyricsView = memo(NoLyricsViewImpl)
