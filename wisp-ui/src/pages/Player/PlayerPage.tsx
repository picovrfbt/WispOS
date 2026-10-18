import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArtVisualizer } from '@/components/Visualizer'
import { PhoneBatteryBadge } from '@/components/PhoneBattery'
import { AlbumArt } from '@/components/AlbumArt'
import { ArtBackdrop } from '@/components/ArtBackdrop'
import { ArtGlow } from '@/components/ArtGlow'
import { Controls } from '@/components/Controls'
import { Lyrics } from '@/components/Lyrics'
import { Menu } from '@/components/Menu'
import { QueueSheet } from '@/components/QueueSheet'
import { playFromLibrary } from '@/api/library'
import { NoLyricsView } from '@/components/NoLyricsView'
import { ProgressBar } from '@/components/ProgressBar'
import { ReconnectBanner, type ReconnectReason } from '@/components/ReconnectBanner'
import { TrackInfo } from '@/components/TrackInfo'
import {
  isDJContext,
  NarrationContext,
  presentTrack,
  type DJNarration,
} from '@/hooks/useDJNarration'
import { useSavedTrack } from '@/hooks/useSavedTrack'
import { useSwipeGestures } from '@/hooks/useSwipeGestures'
import type { UsePlayerControlsResult } from '@/hooks/usePlayerControls'
import type { Carriers, PairingPrompt } from '@/hooks/useBluetooth'
import { useOverlayState } from '@/overlays/overlayContext'
import type { ObserverStatusActive } from '@/api/types'
import type { NotifyFn } from '@/notify/notifyContext'
import { getSettings, updateSettings, useSettings } from '@/settings'
import { artSizeFor, heroArtSizeFor } from '@/uiScale'
import { prefetchCovers } from '@/api/covers'
import styles from '@/App.module.scss'

const SKIP_MS = 15000

export interface PlayerPageProps {
  /** live while playing, or the held status while a drop recovers */
  status: ObserverStatusActive
  /** false while `status` is the held one: the daemon cannot be reached */
  live: boolean
  controls: UsePlayerControlsResult
  /** app-level, because the hardware buttons need it on every screen */
  narration: DJNarration
  showLyrics: boolean
  bannerReason: ReconnectReason | null
  carriers: Carriers | null
  /** a pairing dialog owns the screen, so swipes stand down */
  pairing: PairingPrompt | null
  seek: (positionMs: number) => Promise<void>
  notify: NotifyFn
  /** the overlay host, which renders inside the player's own container */
  children?: ReactNode
}

export function PlayerPage({
  status,
  live,
  controls,
  narration,
  showLyrics,
  bannerReason,
  carriers,
  pairing,
  seek,
  notify,
  children,
}: PlayerPageProps) {
  const overlays = useOverlayState()
  const settings = useSettings()
  const artSize = artSizeFor(settings.uiScalePct)
  const heroArtSize = heroArtSizeFor(settings.uiScalePct)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const onSeek = useCallback(
    (positionMs: number) => {
      void seek(positionMs).catch(() => notify("Couldn't skip to that spot", { variant: 'error' }))
    },
    [seek, notify],
  )

  // relative to where playback actually is now, not where the last status said
  const seekRelative = useCallback(
    (deltaMs: number) => {
      if (!live) return
      const base = status.is_paused
        ? status.position
        : status.position + (Date.now() - status.received_at)
      const target = Math.min(status.duration, Math.max(0, base + deltaMs))
      void seek(target).catch(() => notify("Couldn't skip to that spot", { variant: 'error' }))
    },
    [live, status, seek, notify],
  )

  const isPodcast = status.track_uri.startsWith('spotify:episode:')
  const isDJ = isDJContext(status)
  const savableUri = isPodcast ? null : status.track_uri
  const liked = useSavedTrack(savableUri, (message) => notify(message, { variant: 'error' }))

  // no lyrics for this track (none found, instrumental, the DJ talking): show
  // the big-art view as if lyrics were off, without touching the setting. Held
  // through a track change until the next track's lyrics settle, so it doesn't flicker
  const [trackHasLyrics, setTrackHasLyrics] = useState(true)
  const lyricsView = showLyrics && trackHasLyrics

  const toggleLyrics = useCallback(() => {
    updateSettings({ showLyrics: !getSettings().showLyrics })
  }, [])

  const swipeEnabled =
    live &&
    !overlays.isOpen('menu') &&
    !overlays.isOpen('queue') &&
    !overlays.isOpen('powerMenu') &&
    !overlays.isOpen('deviceMenu') &&
    !overlays.isOpen('btMenu') &&
    !overlays.isOpen('settings') &&
    !pairing
  useSwipeGestures(stageRef, {
    onNext: controls.onNext,
    onPrev: controls.onPrevTrack,
    onToggleView: toggleLyrics,
    enabled: swipeEnabled,
  })

  // the next songs' covers into the cache while this one plays, so a skip shows its cover at once
  const nextCovers = (status.next_tracks ?? []).slice(0, 2).map((t) => t.image_url)
  const nextKey = nextCovers.join('|')
  useEffect(() => {
    if (!nextKey) return
    const urls = nextKey.split('|')
    prefetchCovers(urls, artSize)
    // the small copy the backdrop and glow bake from
    prefetchCovers(urls, 64)
  }, [nextKey, artSize])

  // presentTrack substitutes the DJ while it talks
  const shown = presentTrack(status, narration)

  return (
    // provided once for all consumers
    <NarrationContext.Provider value={narration}>
      <div
        className={`${styles.app} ${styles.appPlaying}`}
        // the art is the only fixed-height block in the left column and never shrinks, so
        // it has to give way when a larger display size shortens the logical viewport
        style={{ '--art-size': `${artSize}px` } as React.CSSProperties}
      >
        <ArtBackdrop src={shown.art} dark />
        <PhoneBatteryBadge hidden={lyricsView} />
        {bannerReason ? <ReconnectBanner reason={bannerReason} carriers={carriers} /> : null}
        <div className={styles.stage} ref={stageRef}>
          <div
            className={`${styles.viewLayer} ${lyricsView ? styles.viewActive : styles.viewInactive}`}
          >
            <div className={styles.top}>
              <div
                className={`${styles.left} ${controls.transitioning ? styles.transitioning : ''}`}
              >
                <div className={styles.coverGlow}>
                  <ArtGlow src={shown.art} active={lyricsView} spread={135} />
                  <ArtVisualizer src={shown.art} active={lyricsView} />
                  <div className={styles.coverFront}>
                    <AlbumArt src={shown.art} size={artSize} djFallback={shown.djFallback} />
                  </div>
                </div>
                <TrackInfo trackName={shown.title} artist={shown.artist} />
              </div>
              <div className={styles.right}>
                {/* keeps fetching on the big-art view so the next track can switch back */}
                <Lyrics
                  status={status}
                  onSeek={onSeek}
                  active={showLyrics}
                  onAvailable={setTrackHasLyrics}
                />
              </div>
            </div>
          </div>
          <div
            className={`${styles.viewLayer} ${!lyricsView ? styles.viewActive : styles.viewInactive}`}
          >
            <div
              className={`${styles.topNoLyrics} ${controls.transitioning ? styles.transitioning : ''}`}
            >
              <NoLyricsView status={status} active={!lyricsView} artSize={heroArtSize} />
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <ProgressBar status={status} onSeek={onSeek} />
          <Controls
            isPaused={controls.isPaused}
            shuffle={controls.shuffle}
            repeat={controls.repeat}
            disallowPrev={status.disallow_prev}
            disallowNext={status.disallow_next}
            isPodcast={isPodcast}
            isDJ={isDJ}
            showSave={!isPodcast}
            saved={liked.saved}
            onToggleSaved={liked.toggle}
            onPrev={controls.onPrev}
            onNext={controls.onNext}
            onPlayPause={controls.onPlayPause}
            onToggleShuffle={controls.onToggleShuffle}
            onDJSignal={controls.onDJSignal}
            onCycleRepeat={controls.onCycleRepeat}
            onRewind15={() => seekRelative(-SKIP_MS)}
            onForward15={() => seekRelative(SKIP_MS)}
            onMore={() => overlays.open('menu')}
            onQueue={isDJ ? undefined : () => overlays.open('queue')}
          />
        </div>

        <QueueSheet
          open={overlays.isOpen('queue')}
          onClose={() => overlays.close('queue')}
          tracks={status.next_tracks ?? []}
          onPlay={
            status.context_uri
              ? (t) => {
                  overlays.close('queue')
                  void playFromLibrary(status.context_uri, { skipToUri: t.uri }).catch(() =>
                    notify(`Couldn't play ${t.name}`, { variant: 'error' }),
                  )
                }
              : undefined
          }
        />

        <Menu
          open={overlays.isOpen('menu')}
          onClose={() => overlays.close('menu')}
          showLyrics={showLyrics}
          onToggleLyrics={toggleLyrics}
          voiceMic={settings.voiceMic}
          onToggleVoiceMic={() => updateSettings({ voiceMic: !getSettings().voiceMic })}
          currentDevice={status.device_name}
          onOpenDevices={() => {
            overlays.close('menu')
            overlays.open('deviceMenu')
          }}
        />

        {children}
      </div>
    </NarrationContext.Provider>
  )
}
