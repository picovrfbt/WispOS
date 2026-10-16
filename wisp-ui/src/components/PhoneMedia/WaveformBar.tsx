import { memo, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { ObserverStatusActive } from '@/api/types'
import { getUiScale } from '@/uiScale'
import styles from './WaveformBar.module.scss'

interface Props {
  status: ObserverStatusActive
  /** the song's shape: heights from 0 to 100, one per bar */
  waveform: number[]
  onSeek?: (positionMs: number) => void
}

const BAR_W = 2
const GAP = 1

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// the bars once, as an SVG; drawn twice, the played copy clipped to the position
function Bars({ waveform }: { waveform: number[] }) {
  const w = waveform.length * (BAR_W + GAP)
  return (
    <svg
      className={styles.svg}
      viewBox={`0 0 ${w} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {waveform.map((h, i) => {
        const height = Math.max(6, h)
        return <rect key={i} x={i * (BAR_W + GAP)} y={100 - height} width={BAR_W} height={height} />
      })}
    </svg>
  )
}

const MemoBars = memo(Bars)

/**
 * SoundCloud's progress bar: the song's waveform, the played part in its
 * orange. Tap or drag along it to seek, as on the plain bar.
 */
function WaveformBarImpl({ status, waveform, onSeek }: Props) {
  const areaRef = useRef<HTMLDivElement>(null)
  const playedRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  // where a drag is, 0-1; null when not dragging
  const [drag, setDrag] = useState<number | null>(null)
  const seekable = !status.disallow_seek && !!onSeek

  useEffect(() => {
    const played = playedRef.current
    const time = timeRef.current
    if (!played || !time) return
    const playing = status.is_playing && !status.is_paused
    let timer = 0
    let lastSec = -1
    const tick = () => {
      const pos =
        drag !== null
          ? drag * status.duration
          : Math.min(
              status.duration,
              status.position + (playing ? Math.max(0, Date.now() - status.received_at) : 0),
            )
      const f = status.duration > 0 ? Math.min(1, Math.max(0, pos / status.duration)) : 0
      // Chrome 69 clips with inset() fine, and it moves nothing else on the page
      played.style.clipPath = `inset(0 ${(1 - f) * 100}% 0 0)`
      const sec = Math.floor(pos / 1000)
      if (sec !== lastSec) {
        lastSec = sec
        time.textContent = fmt(pos)
      }
      // a bar is a second or more of the song: four redraws a second is plenty
      if (playing) timer = window.setTimeout(tick, 250)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [status, drag])

  const ratioAt = (e: PointerEvent) => {
    const r = areaRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return Math.min(1, Math.max(0, (e.clientX / getUiScale() - r.left) / r.width))
  }

  return (
    <div className={styles.row}>
      <span className={`${styles.time} ${styles.timeLeft}`} ref={timeRef} />
      <div
        ref={areaRef}
        className={styles.area}
        role={seekable ? 'slider' : undefined}
        aria-label={seekable ? 'Seek' : undefined}
        aria-valuemin={seekable ? 0 : undefined}
        aria-valuemax={seekable ? Math.round(status.duration / 1000) : undefined}
        onPointerDown={(e) => {
          if (!seekable) return
          e.currentTarget.setPointerCapture?.(e.pointerId)
          setDrag(ratioAt(e))
        }}
        onPointerMove={(e) => {
          if (drag !== null) setDrag(ratioAt(e))
        }}
        onPointerUp={(e) => {
          if (drag === null) return
          setDrag(null)
          onSeek?.(ratioAt(e) * status.duration)
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div className={styles.unplayed}>
          <MemoBars waveform={waveform} />
        </div>
        <div className={styles.played} ref={playedRef}>
          <MemoBars waveform={waveform} />
        </div>
      </div>
      <span className={`${styles.time} ${styles.timeRight}`}>{fmt(status.duration)}</span>
    </div>
  )
}

export const WaveformBar = memo(WaveformBarImpl)
