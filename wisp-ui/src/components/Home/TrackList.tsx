import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LibraryItem } from '@/api/library'
import { useDragScroll } from '@/hooks/useDragScroll'
import { useDial } from './useDial'
import type { ListState } from './useLibraryLists'
import styles from './Home.module.scss'
import { DJIcon } from '@/components/Controls/icons'
import { glideIntoView } from '@/utils/glide'
import { coverUrl } from '@/api/covers'

// start the next page when the cursor gets this close to the end
const PREFETCH_ROWS = 8
// room kept past the cursor row as the list follows it
const ROW_PAD = 12

type Row = { kind: 'play' } | { kind: 'shuffle' } | { kind: 'track'; item: LibraryItem }

interface Props {
  context: LibraryItem
  list: ListState
  onPlay: (opts: { skipTo?: LibraryItem; shuffle: boolean }) => void
  onLoadMore: () => void
  onRetry: () => void
  onBack: () => void
  /** false while a dialog over the list owns the dial */
  dialEnabled?: boolean
}

/** a playlist (or Liked Songs) opened from the home screen: Play, Shuffle, then its tracks */
export function TrackList({
  context,
  list,
  onPlay,
  onLoadMore,
  onRetry,
  onBack,
  dialEnabled = true,
}: Props) {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const rows: Row[] = [
    { kind: 'play' },
    { kind: 'shuffle' },
    ...list.items.map((item): Row => ({ kind: 'track', item })),
  ]

  const activate = (row: Row) => {
    if (row.kind === 'play') onPlay({ shuffle: false })
    else if (row.kind === 'shuffle') onPlay({ shuffle: true })
    else onPlay({ skipTo: row.item, shuffle: false })
  }

  useDial({
    enabled: dialEnabled,
    onStep: (dir) => setSelected((i) => Math.max(0, Math.min(rows.length - 1, i + dir))),
    onPress: () => {
      const row = rows[selected]
      if (row) activate(row)
    },
    onBack,
  })

  // keep the cursor on screen and pull the next page before it runs out
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-row="${selected}"]`)
    if (list && el) glideIntoView(list, el, ROW_PAD)
    if (selected >= rows.length - PREFETCH_ROWS) onLoadMore()
  }, [selected, rows.length, onLoadMore])

  useDragScroll(listRef, { axis: 'y' })

  const onScroll = () => {
    const el = listRef.current
    if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 400) onLoadMore()
  }

  return (
    <div className={styles.tracks}>
      <header className={styles.tracksHeader}>
        <button type="button" className={styles.backButton} onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <span className={styles.tracksHeaderArt}>
          {context.image ? <img src={coverUrl(context.image, 160)} alt="" /> : <LikedArt />}
        </span>
        <h1 className={styles.tracksTitle}>{context.name}</h1>
      </header>
      <div className={styles.tracksList} ref={listRef} onScroll={onScroll}>
        <div className={styles.tracksActions}>
          {(['play', 'shuffle'] as const).map((kind, i) => (
            <button
              key={kind}
              type="button"
              data-row={i}
              className={`${styles.tracksAction} ${kind === 'play' ? styles.primary : ''} ${
                selected === i ? styles.focused : ''
              }`}
              onClick={() => {
                setSelected(i)
                activate({ kind })
              }}
            >
              {kind === 'play' ? 'Play' : 'Shuffle'}
            </button>
          ))}
        </div>
        {list.items.map((item, j) => {
          const i = j + 2
          return (
            <button
              key={`${item.uri}:${j}`}
              type="button"
              data-row={i}
              className={`${styles.trackRow} ${selected === i ? styles.focused : ''}`}
              onClick={() => {
                setSelected(i)
                activate({ kind: 'track', item })
              }}
            >
              <span className={styles.trackArt}>
                {item.image ? <img src={coverUrl(item.image, 64)} alt="" loading="lazy" /> : null}
              </span>
              <span className={styles.trackText}>
                <span className={styles.trackName}>{item.name}</span>
                {item.artist ? <span className={styles.trackSub}>{item.artist}</span> : null}
              </span>
            </button>
          )
        })}
        <ListStatus list={list} onRetry={onRetry} />
      </div>
    </div>
  )
}

export function ListStatus({
  list,
  onRetry,
  loading = <SkeletonRows />,
}: {
  list: ListState
  onRetry: () => void
  /** shown until the first page lands */
  loading?: ReactNode
}) {
  if (list.error) {
    return (
      <button type="button" className={styles.status} onClick={onRetry}>
        {list.error}. Tap to retry
      </button>
    )
  }
  if (list.total === null) return <>{loading}</>
  if (list.total === 0 && list.items.length === 0) {
    return <div className={styles.status}>Nothing here yet</div>
  }
  return null
}

// placeholders shaped like what's coming, while the first page loads
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className={styles.skeleton} aria-label="Loading" role="status">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <span className={styles.skeletonArt} />
          <span className={styles.skeletonLines}>
            <span className={styles.skeletonLine} />
            <span className={`${styles.skeletonLine} ${styles.skeletonShort}`} />
          </span>
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`${styles.card} ${styles.skeleton}`}
          aria-label={i === 0 ? 'Loading' : undefined}
          role={i === 0 ? 'status' : undefined}
        >
          <span className={`${styles.cardArt} ${styles.skeletonBlock}`} />
          <span className={`${styles.skeletonLine} ${styles.skeletonCardLine}`} />
          <span className={`${styles.skeletonLine} ${styles.skeletonShort}`} />
        </div>
      ))}
    </>
  )
}

export function LikedArt() {
  return (
    <span className={styles.likedArt} aria-hidden>
      <svg viewBox="0 0 24 24" width="45%" height="45%" fill="currentColor">
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z" />
      </svg>
    </span>
  )
}

export function DJArt() {
  return (
    <span className={styles.djArt} aria-hidden>
      <DJIcon size={84} />
      <span className={styles.djLabel}>DJ</span>
    </span>
  )
}

function BackIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0z" />
    </svg>
  )
}
