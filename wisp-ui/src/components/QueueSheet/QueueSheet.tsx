import { memo, useEffect, useRef, useState } from 'react'
import type { QueueTrack } from '@/api/types'
import styles from './QueueSheet.module.scss'
import { coverUrl } from '@/api/covers'
import { useDial } from '@/components/Home/useDial'
import { glideIntoView } from '@/utils/glide'

interface Props {
  open: boolean
  onClose: () => void
  /** what plays next, as the daemon has it (up to 10) */
  tracks: QueueTrack[]
  /** jumps to a track in the queue; absent when the context can't be skipped into */
  onPlay?: (track: QueueTrack) => void
  /** what an empty list says, if not that nothing's queued */
  emptyText?: string
  /** the sheet's heading, if not "Up next" */
  title?: string
}

/**
 * Up next: the queue as a bottom sheet, opened from the button beside "more".
 * The knob moves through it and a press plays the song, where it can be played.
 */
function QueueSheetImpl({ open, onClose, tracks, onPlay, emptyText, title = 'Up next' }: Props) {
  const [selected, setSelected] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setSelected(0)
  }
  const cursor = onPlay ? Math.min(selected, tracks.length - 1) : -1
  const listRef = useRef<HTMLDivElement>(null)

  useDial({
    enabled: open,
    onStep: (dir) => setSelected((i) => Math.max(0, Math.min(tracks.length - 1, i + dir))),
    onPress: () => {
      const t = tracks[cursor]
      if (t && onPlay) onPlay(t)
    },
    onBack: onClose,
  })

  // keep the cursor in view; without a cursor the knob still scrolls the list
  useEffect(() => {
    const list = listRef.current
    const row = list?.children[Math.min(selected, tracks.length - 1)] as HTMLElement | undefined
    if (open && list && row) glideIntoView(list, row, 8)
  }, [open, selected, tracks.length])

  return (
    <div
      className={`${styles.root} ${open ? styles.open : ''}`}
      aria-hidden={!open}
      onClick={onClose}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.handle} aria-hidden />
        <div className={styles.title}>{title}</div>
        {tracks.length === 0 ? (
          <div className={styles.empty}>{emptyText ?? 'Nothing queued after this song'}</div>
        ) : (
          <div className={styles.list} ref={listRef}>
            {tracks.map((t, i) => (
              <button
                key={`${t.uri}:${i}`}
                type="button"
                className={`${styles.track} ${i === cursor ? styles.focused : ''}`}
                disabled={!onPlay}
                onClick={() => onPlay?.(t)}
              >
                <span className={styles.art}>
                  {t.image_url ? (
                    <img src={coverUrl(t.image_url, 64)} alt="" loading="lazy" />
                  ) : null}
                </span>
                <span className={styles.text}>
                  <span className={styles.name}>{t.name || 'Unknown track'}</span>
                  {t.artist ? <span className={styles.artist}>{t.artist}</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const QueueSheet = memo(QueueSheetImpl)
