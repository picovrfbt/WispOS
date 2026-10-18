import { memo, useCallback, useMemo, useRef, useState } from 'react'
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
import { playService, serviceOf, toLibraryItem } from '@/api/services'
import type { QueueTrack } from '@/api/types'
import { AlbumArt } from '@/components/AlbumArt'
import { ArtBackdrop } from '@/components/ArtBackdrop'
import { ArtGlow } from '@/components/ArtGlow'
import { Controls } from '@/components/Controls'
import { useDial } from '@/components/Home/useDial'
import { Lyrics } from '@/components/Lyrics'
import { Menu } from '@/components/Menu'
import { NoLyricsView } from '@/components/NoLyricsView'
import { ProgressBar } from '@/components/ProgressBar'
import { QueueSheet } from '@/components/QueueSheet'
import { TrackInfo } from '@/components/TrackInfo'
import { useServiceNow } from '@/hooks/useServiceNow'
import { useSwipeGestures } from '@/hooks/useSwipeGestures'
import { useNotify } from '@/notify/notifyContext'
import { useOverlayState } from '@/overlays/overlayContext'
import { getSettings, updateSettings, useSettings } from '@/settings'
import { artSizeFor, heroArtSizeFor } from '@/uiScale'
import { phoneStatus } from './phoneStatus'
import { WaveformBar } from './WaveformBar'
import { ServiceIcon } from '@/components/ServiceIcon'
import type { SaveKind } from '@/components/Controls/SaveButton'
import styles from './ServicePlayer.module.scss'
import appStyles from '@/App.module.scss'

const SKIP_MS = 15000

const SERVICE_NAME: Record<string, string> = {
  ytmusic: 'YouTube Music',
  soundcloud: 'SoundCloud',
}

/** each service's own feel on the same layout: its colour, its like, its name for what's next */
interface ServiceLook {
  /** the bar, the play button, the like, the line being sung */
  color: string
  lyric: string
  confetti: [string, string, string]
  like: SaveKind
  next: string
  tint: string
}

const LOOKS: Record<string, ServiceLook> = {
  ytmusic: {
    color: '#ff0033',
    lyric: '#ff5a6e',
    confetti: ['#ff0033', '#ff8a99', '#ffffff'],
    like: 'thumb',
    next: 'Up next',
    tint: 'rgba(255, 0, 51, 0.2)',
  },
  soundcloud: {
    color: '#ff5500',
    lyric: '#ff8a4c',
    confetti: ['#ff5500', '#ffb38a', '#ffffff'],
    like: 'heart',
    // SoundCloud carries on with related tracks once a song ends
    next: 'Related tracks',
    tint: 'rgba(255, 85, 0, 0.2)',
  },
}

function lookVars(look: ServiceLook): React.CSSProperties {
  return {
    '--player-fill': look.color,
    '--player-play': look.color,
    '--player-play-icon': '#fff',
    '--player-lyric': look.lyric,
    '--player-confetti-0': look.confetti[0],
    '--player-confetti-1': look.confetti[1],
    '--player-confetti-2': look.confetti[2],
    // the like's filled state, and any other accent inside the player
    '--accent': look.color,
  } as React.CSSProperties
}

interface Props {
  media: PhoneMedia
  service: string
  dialEnabled: boolean
  onBack: () => void
}

/**
 * YouTube Music or SoundCloud playing on the phone, laid out exactly like the
 * Spotify player: the cover and song on the left with lyrics beside them, or
 * the big cover when lyrics are off or there are none; the progress bar and
 * the controls row below, with liked on the left and Up next and More on the
 * right. The knob is the phone's volume, a press is play/pause.
 */
function ServicePlayerImpl({ media, service, dialEnabled, onBack }: Props) {
  const notify = useNotify()
  const overlays = useOverlayState()
  const settings = useSettings()
  const artSize = artSizeFor(settings.uiScalePct)
  const heroArtSize = heroArtSizeFor(settings.uiScalePct)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const svc = useServiceNow(media, (m) => notify(m, { variant: 'error' }))
  // the phone app's own cover, else the service's for this song
  const art = phoneMediaArtUrl(media) ?? svc.now?.image

  // shown at once, then whatever the phone reports back
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [forUpdate, setForUpdate] = useState(media.updated_at)
  if (forUpdate !== media.updated_at) {
    setForUpdate(media.updated_at)
    setOptimistic(null)
  }
  const playing = optimistic ?? media.playing
  const status = useMemo(() => phoneStatus(media, art, playing), [media, art, playing])

  const send = (action: PhoneMediaAction) => void phoneMediaControl(action)
  const toggle = () => {
    setOptimistic(!playing)
    send(playing ? 'pause' : 'play')
  }

  const onSeek = useCallback(
    (ms: number) => {
      void phoneMediaSeek(ms).then((ok) => {
        if (!ok) notify("Couldn't skip to that spot", { variant: 'error' })
      })
    },
    [notify],
  )
  const seekRelative = (deltaMs: number) => {
    const now = phoneMediaPosition(media)
    onSeek(Math.min(media.duration_ms, Math.max(0, now + deltaMs)))
  }

  // as on the Spotify player: lyrics when they're on and this song has them
  const [trackHasLyrics, setTrackHasLyrics] = useState(true)
  const lyricsView = settings.showLyrics && trackHasLyrics
  const toggleLyrics = useCallback(() => {
    updateSettings({ showLyrics: !getSettings().showLyrics })
  }, [])

  useDial({
    enabled: dialEnabled,
    onStep: (dir) => send(dir > 0 ? 'volume_up' : 'volume_down'),
    onPress: toggle,
    onBack,
  })
  useSwipeGestures(stageRef, {
    onNext: () => send('next'),
    onPrev: () => send('prev'),
    onToggleView: toggleLyrics,
    enabled: dialEnabled,
  })

  const upNext = useMemo<QueueTrack[]>(
    () =>
      (svc.now?.items ?? []).map((i) => ({
        uri: toLibraryItem(service, i).uri,
        track_id: '',
        name: i.name,
        artist: i.sub ?? '',
        album: '',
        image_url: i.image ?? '',
      })),
    [service, svc.now],
  )

  const source = media.app_name || SERVICE_NAME[service] || 'Phone'
  const look = LOOKS[service] ?? LOOKS.ytmusic
  const waveform = svc.now?.waveform
  // where it's playing rides on the artist line: "M83 · YouTube Music"
  const withSource = useMemo(
    () => ({
      ...status,
      track_artist: status.track_artist ? `${status.track_artist} · ${source}` : source,
    }),
    [status, source],
  )

  return (
    <div
      className={`${appStyles.app} ${appStyles.appPlaying}`}
      style={{ '--art-size': `${artSize}px`, ...lookVars(look) } as React.CSSProperties}
    >
      <PhoneBatteryBadge hidden={lyricsView} />
      <ArtBackdrop src={art} dark />
      {/* a wash of the service's colour, so the screen says which one it is at a glance */}
      <div className={styles.tint} style={{ background: tintFor(look) }} aria-hidden />
      <div className={appStyles.stage} ref={stageRef}>
        <div
          className={`${appStyles.viewLayer} ${lyricsView ? appStyles.viewActive : appStyles.viewInactive}`}
        >
          <div className={appStyles.top}>
            <div className={appStyles.left}>
              <div className={appStyles.coverGlow}>
                <ArtGlow src={art} active={lyricsView} spread={135} />
                <ArtVisualizer src={art} active={lyricsView} />
                <div className={appStyles.coverFront}>
                  <AlbumArt src={art} size={artSize} />
                </div>
              </div>
              <TrackInfo
                trackName={withSource.track_name}
                artist={withSource.track_artist}
                badge={<ServiceIcon service={service} size={16} />}
              />
            </div>
            <div className={appStyles.right}>
              {/* keeps fetching on the big-art view so the next song can switch back */}
              <Lyrics
                status={status}
                onSeek={media.can_seek ? onSeek : undefined}
                active={settings.showLyrics}
                onAvailable={setTrackHasLyrics}
              />
            </div>
          </div>
        </div>
        <div
          className={`${appStyles.viewLayer} ${!lyricsView ? appStyles.viewActive : appStyles.viewInactive}`}
        >
          <div className={appStyles.topNoLyrics}>
            <NoLyricsView
              status={withSource}
              active={!lyricsView}
              artSize={heroArtSize}
              badge={<ServiceIcon service={service} size={20} />}
            />
          </div>
        </div>
      </div>

      <div className={appStyles.bottom}>
        {waveform && waveform.length > 0 ? (
          <WaveformBar status={status} waveform={waveform} onSeek={onSeek} />
        ) : (
          <ProgressBar status={status} onSeek={onSeek} />
        )}
        <Controls
          isPaused={!playing}
          shuffle={false}
          repeat="off"
          // the phone's app doesn't take shuffle or repeat from here; where it
          // seeks, those spots skip 15 seconds instead
          isPodcast={media.can_seek === true}
          hideModes={media.can_seek !== true}
          showSave
          saveKind={look.like}
          saved={svc.liked === true}
          onToggleSaved={svc.now?.current ? svc.toggleLike : undefined}
          onPrev={() => send('prev')}
          onNext={() => send('next')}
          onPlayPause={toggle}
          onRewind15={() => seekRelative(-SKIP_MS)}
          onForward15={() => seekRelative(SKIP_MS)}
          onMore={() => overlays.open('menu')}
          onQueue={() => {
            svc.refresh()
            overlays.open('queue')
          }}
        />
      </div>

      <QueueSheet
        open={overlays.isOpen('queue')}
        onClose={() => overlays.close('queue')}
        tracks={upNext}
        title={look.next}
        emptyText={
          svc.loading
            ? 'Asking your phone…'
            : svc.now
              ? 'Nothing up next'
              : "Your phone couldn't say what's next"
        }
        onPlay={(t) => {
          const picked = serviceOf(t.uri)
          overlays.close('queue')
          if (!picked) return
          // from that song, in the queue it came from
          void playService(picked.service, picked.item, picked.item).then((ok) => {
            if (!ok) notify(`Couldn't play ${t.name}`, { variant: 'error' })
          })
        }}
      />

      <Menu
        open={overlays.isOpen('menu')}
        onClose={() => overlays.close('menu')}
        showLyrics={settings.showLyrics}
        onToggleLyrics={toggleLyrics}
        voiceMic={settings.voiceMic}
        onToggleVoiceMic={() => updateSettings({ voiceMic: !getSettings().voiceMic })}
        currentDevice="Your phone"
        onOpenDevices={() => {
          overlays.close('menu')
          overlays.open('deviceMenu')
        }}
      />
    </div>
  )
}

function tintFor(look: ServiceLook) {
  return `radial-gradient(ellipse at 20% 15%, ${look.tint}, rgba(0, 0, 0, 0) 65%)`
}

export const ServicePlayer = memo(ServicePlayerImpl)
