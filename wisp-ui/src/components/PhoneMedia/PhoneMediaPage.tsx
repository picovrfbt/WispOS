import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ArtVisualizer } from '@/components/Visualizer'
import { PhoneBatteryBadge } from '@/components/PhoneBattery'
import {
  phoneMediaArtUrl,
  phoneMediaControl,
  phoneMediaPosition,
  phoneMediaSeek,
  type PhoneMedia,
  type PhoneMediaAction,
} from '@/api/phoneMedia'
import { ArtBackdrop } from '@/components/ArtBackdrop'
import { ArtGlow } from '@/components/ArtGlow'
import { MusicIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from '@/components/Controls/icons'
import { useDial } from '@/components/Home/useDial'
import { serviceOfApp } from '@/api/services'
import { Lyrics } from '@/components/Lyrics'
import { getSettings, updateSettings, useSettings } from '@/settings'
import { phoneStatus } from './phoneStatus'
import { ServicePlayer } from './ServicePlayer'
import styles from './PhoneMediaPage.module.scss'

interface Props {
  media: PhoneMedia
  /** the dial and buttons are ours unless an overlay (Home, a menu) is up */
  dialEnabled: boolean
  /** back: up to Home, as from the Spotify player */
  onBack: () => void
}

/**
 * The phone's own playback (YouTube, a podcast app...), shown when Spotify
 * isn't playing. Cover art from the phone when the app gives one, a gradient
 * from the title when it doesn't. The knob is the phone's volume and a press
 * is play/pause, the same as on the Spotify player.
 */
function PhoneMediaPageImpl(props: Props) {
  // YouTube Music and SoundCloud get the full player, as Spotify does
  const service = props.media.present ? serviceOfApp(props.media.app) : null
  if (service) return <ServicePlayer {...props} service={service} />
  return <OtherAppPage {...props} />
}

function OtherAppPage({ media, dialEnabled, onBack }: Props) {
  const art = phoneMediaArtUrl(media)
  // shown at once, then whatever the phone reports back
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [forUpdate, setForUpdate] = useState(media.updated_at)
  if (forUpdate !== media.updated_at) {
    setForUpdate(media.updated_at)
    setOptimistic(null)
  }
  const playing = optimistic ?? media.playing

  const send = (action: PhoneMediaAction) => void phoneMediaControl(action)
  const toggle = () => {
    setOptimistic(!playing)
    send(playing ? 'pause' : 'play')
  }

  // lyrics by the song's name, for a song with an artist; only when turned on
  const settings = useSettings()
  const canLyrics = !!media.artist && !!media.title && media.duration_ms > 0
  const lyricsOn = canLyrics && settings.phoneLyrics
  const lyricsStatus = useMemo(
    () => (canLyrics ? phoneStatus(media, art, playing) : null),
    [canLyrics, media, art, playing],
  )

  useDial({
    enabled: dialEnabled,
    onStep: (dir) => send(dir > 0 ? 'volume_up' : 'volume_down'),
    onPress: toggle,
    onBack,
  })

  return (
    <div className={styles.root}>
      <PhoneBatteryBadge hidden={lyricsOn} />
      {art ? (
        <ArtBackdrop src={art} dark />
      ) : (
        <div className={styles.gradient} style={gradientFor(media)} />
      )}

      <div className={`${styles.main} ${lyricsOn ? styles.withLyrics : ''}`}>
        <div className={styles.artWrap}>
          {art ? <ArtGlow src={art} spread={110} strength={0.9} /> : null}
          <ArtVisualizer src={art} />
          <div className={styles.art}>
            {art ? (
              <img src={art} alt="" />
            ) : (
              <span className={styles.artFallback} style={gradientFor(media, 0.9)}>
                <MusicIcon size={84} />
              </span>
            )}
          </div>
        </div>

        <div className={styles.info}>
          <div className={styles.sourceRow}>
            <div className={styles.source}>
              <PhoneIcon />
              <span>{media.app_name || 'Phone'}</span>
            </div>
            {canLyrics ? (
              <button
                type="button"
                className={`${styles.lyricsToggle} ${lyricsOn ? styles.lyricsOn : ''}`}
                aria-pressed={lyricsOn}
                onClick={() => updateSettings({ phoneLyrics: !getSettings().phoneLyrics })}
              >
                Lyrics
              </button>
            ) : null}
          </div>
          <div className={styles.title}>{media.title || 'Playing on your phone'}</div>
          {media.artist ? <div className={styles.artist}>{media.artist}</div> : null}

          {media.duration_ms > 0 ? <Progress media={media} /> : null}

          <div className={styles.controls}>
            <button
              type="button"
              className={styles.ctrl}
              aria-label="Previous"
              onClick={() => send('prev')}
            >
              <PrevIcon size={34} />
            </button>
            <button
              type="button"
              className={`${styles.ctrl} ${styles.play}`}
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={toggle}
            >
              {playing ? <PauseIcon size={38} /> : <PlayIcon size={38} />}
            </button>
            <button
              type="button"
              className={styles.ctrl}
              aria-label="Next"
              onClick={() => send('next')}
            >
              <NextIcon size={34} />
            </button>
          </div>
        </div>

        {lyricsOn && lyricsStatus ? (
          <div className={styles.lyricsPane}>
            <Lyrics
              status={lyricsStatus}
              active
              onSeek={media.can_seek ? (ms) => void phoneMediaSeek(ms) : undefined}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

// its own clock, so the second hand doesn't re-render the whole page. Drag or
// tap the bar to seek, where the phone's app allows it
function Progress({ media }: { media: PhoneMedia }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!media.playing) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [media.playing])
  // where a drag is, as a fraction of the track; null when not dragging
  const [drag, setDrag] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const seekable = media.can_seek === true
  const ratioAt = (e: PointerEvent) => {
    const r = barRef.current?.getBoundingClientRect()
    return r && r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0
  }
  const pos =
    drag !== null
      ? drag * media.duration_ms
      : phoneMediaPosition(media, media.playing ? now : undefined)
  const pct = Math.min(100, (pos / media.duration_ms) * 100)
  return (
    <div className={styles.progress}>
      <div
        ref={barRef}
        className={`${styles.barHit} ${seekable ? styles.seekable : ''}`}
        role={seekable ? 'slider' : undefined}
        aria-label={seekable ? 'Seek' : undefined}
        aria-valuemin={seekable ? 0 : undefined}
        aria-valuemax={seekable ? Math.round(media.duration_ms / 1000) : undefined}
        aria-valuenow={seekable ? Math.round(pos / 1000) : undefined}
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
          void phoneMediaSeek(ratioAt(e) * media.duration_ms)
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div className={styles.bar}>
          <div className={styles.fill} style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
      </div>
      <div className={styles.times}>
        <span>{fmt(pos)}</span>
        <span>{fmt(media.duration_ms)}</span>
      </div>
    </div>
  )
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// two hues picked from the title, so each video gets its own look and keeps it
function gradientFor(media: PhoneMedia, alpha = 1) {
  const key = `${media.title ?? ''}${media.app ?? ''}`
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const a = h % 360
  const b = (a + 50 + (h % 70)) % 360
  return {
    backgroundImage: `linear-gradient(135deg, hsla(${a}, 62%, 38%, ${alpha}), hsla(${b}, 58%, 18%, ${alpha}))`,
  }
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M10.5 18h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export const PhoneMediaPage = memo(PhoneMediaPageImpl)
