import { JamSave, JamSheet } from '@/components/Jam'
import { AddonsScreen } from '@/components/Addons'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavContext, useNav } from '@/hooks/navContext'
import type { NavState } from '@/api/nav'
import { AuthScreen } from '@/components/AuthScreen'
import { BootSplash } from '@/components/BootSplash'
import { ConnectionChooser } from '@/components/ConnectionChooser'
import { IdleScreen } from '@/components/IdleScreen'
import { NeedsNetwork } from '@/components/NeedsNetwork'
import { ReportDialog } from '@/components/ReportDialog'
import { PcConnect } from '@/components/PcConnect'
import type { ReconnectReason } from '@/components/ReconnectBanner'
import { ReconnectingScreen } from '@/components/ReconnectingScreen'
import { Screensaver } from '@/components/Screensaver'
import { UpdateCard } from '@/components/UpdateCard'
import { DebugScreen } from '@/components/DebugScreen'
import { resolveRoute } from '@/app/routes'
import { useDevScreen } from '@/dev/devContext'
import { makeMockStatus } from '@/dev/mockStatus'
import { useAuth } from '@/hooks/useAuth'
import { useConnectDevices } from '@/hooks/useConnectDevices'
import { useConnectivity } from '@/hooks/useConnectivity'
import { useControls } from '@/hooks/useControls'
import { useDelayedFlag } from '@/hooks/useDelayedFlag'
import { useDiscoverableWhilePairing } from '@/hooks/useDiscoverableWhilePairing'
import { useDeviceSwitch } from '@/hooks/useDeviceSwitch'
import { useHardwareButtons } from '@/hooks/useHardwareButtons'
import { useIdleScreensaver } from '@/hooks/useIdleScreensaver'
import { useLastArtUrl } from '@/hooks/useLastArtUrl'
import { useLastTrack } from '@/hooks/useLastTrack'
import { PHONE, PHONE_BUTTON_EVENT, type PhoneButton } from '@/phone'
import { isDJContext, useDJNarration } from '@/hooks/useDJNarration'
import { useNotify } from '@/notify/notifyContext'
import { usePhoneNotifications } from '@/hooks/usePhoneNotifications'
import { useRollbackNotice } from '@/hooks/useRollbackNotice'
import { useSettingsRestore } from '@/hooks/useSettingsRestore'
import { useObserver } from '@/hooks/useObserver'
import { useOfflineScreen } from '@/hooks/useOfflineScreen'
import { useOverlays, type OverlayId } from '@/hooks/useOverlays'
import { OverlayContext, useOverlayState } from '@/overlays/overlayContext'
import { OverlayHost } from '@/overlays/OverlayHost'
import { AuthPage } from '@/pages/Auth/AuthPage'
import { BootPage } from '@/pages/Boot/BootPage'
import { OfflinePage } from '@/pages/Offline/OfflinePage'
import { PlayerPage } from '@/pages/Player/PlayerPage'
import { usePlayerControls } from '@/hooks/usePlayerControls'
import { usePrefetch } from '@/hooks/usePrefetch'
import { resolveDropReason, useHeldStatus } from '@/hooks/useReconnect'
import { useUpdateNotice } from '@/hooks/useUpdateNotice'
import { useUtcOffset } from '@/hooks/useUtcOffset'
import { fetchSavedState, listenNow, resumeLastDevice, setSavedState } from '@/api/client'
import type { ButtonAction } from '@/presets'
import type { ObserverStatusActive } from '@/api/types'
import { Home } from '@/components/Home'
import { PhoneMediaPage } from '@/components/PhoneMedia'
import { usePhoneMedia } from '@/hooks/usePhoneMedia'
import { useUpdateState } from '@/hooks/useUpdateState'
import { confirmUpdate, installUpdate, type UpdateState } from '@/api/update'
import { takesOver, UpdateScreen } from '@/components/UpdateScreen'
import type { PhoneMedia } from '@/api/phoneMedia'
import { NavScreen } from '@/components/Navigation'
import { initSettings, useSettings } from '@/settings'
import type { Weather } from '@/api/weather'
import styles from './App.module.scss'

/**
 * Owns the overlay stack so every screen below can reach it, and nothing else.
 * The dev-screen override lives here because it is what `useOverlays` needs to
 * treat a forced menu as open.
 */
// the dev "Phone media" screen: no cover, so it shows the gradient fallback
// the dev Updating screen, part way through a download
const DEV_UPDATING: UpdateState = {
  current: 'v0.2.9',
  latest: 'v0.2.10',
  installing: 'v0.2.10',
  available: true,
  has_token: true,
  phase: 'downloading',
  // through the phone, so the screen shows its "download on the Car Thing instead"
  step: 'Your phone is downloading',
  focus: true,
  percent: 43,
  bytes_done: 12_400_000,
  bytes_total: 28_800_000,
  speed_bps: 1_350_000,
}

// the dev Navigation screen shows the live phone's route, or this one without it
const DEV_NAV: NavState = {
  connected: true,
  active: true,
  title: '500 ft',
  text: 'Turn right onto Main St',
  sub_text: '12 min · 5.1 mi · 3:45 PM ETA',
  location: { lat: 40.7128, lng: -74.006, bearing: 40, speed: 15.6, accuracy: 5 },
  updated_at: 1,
}

// the dev idle screen's weather, when the daemon has none (no phone, no location)
const DEV_WEATHER: Weather = {
  temp: 72,
  unit: 'F',
  code: 2,
  summary: 'Partly cloudy',
  is_day: true,
}

// the dev Home with YouTube Music and SoundCloud signed in on the phone
const DEV_NAV_SERVICES: NavState = {
  connected: true,
  active: false,
  updated_at: 1,
  services: [
    {
      id: 'ytmusic',
      name: 'YouTube Music',
      enabled: true,
      signed_in: true,
      sections: [{ id: 'liked', name: 'Liked music' }],
    },
    {
      id: 'soundcloud',
      name: 'SoundCloud',
      enabled: true,
      signed_in: true,
      sections: [{ id: 'likes', name: 'Liked tracks' }],
    },
  ],
}

function DevNavSample({ children }: { children: ReactNode }) {
  const live = useNav()
  return <NavContext.Provider value={live.active ? live : DEV_NAV}>{children}</NavContext.Provider>
}

const DEV_PHONE_MEDIA: PhoneMedia = {
  present: true,
  app: 'com.google.android.youtube',
  app_name: 'YouTube',
  title: 'How a car engine works (in 4 minutes)',
  artist: 'Animagraffs',
  playing: true,
  position_ms: 83_000,
  position_at: Date.now(),
  duration_ms: 243_000,
  updated_at: 1,
}

const DEV_PHONE_YTMUSIC: PhoneMedia = {
  ...DEV_PHONE_MEDIA,
  app: 'com.google.android.apps.youtube.music',
  app_name: 'YouTube Music',
  title: 'Tidewater',
  artist: 'Northbound',
  can_seek: true,
}

const DEV_PHONE_SOUNDCLOUD: PhoneMedia = {
  ...DEV_PHONE_YTMUSIC,
  app: 'com.soundcloud.android',
  app_name: 'SoundCloud',
}

const DEV_PHONE_LOCAL: PhoneMedia = {
  ...DEV_PHONE_YTMUSIC,
  app: 'org.videolan.vlc',
  app_name: 'VLC',
}

export default function App() {
  const { forced, setForced } = useDevScreen()

  // a forced screen shows its overlay without touching the real state
  const forcedOpen = useMemo(
    () => ({
      menu: forced === 'menu' || undefined,
      powerMenu: forced === 'power-menu' || undefined,
      btMenu: forced === 'bluetooth-menu' || undefined,
      settings: forced === 'settings' || undefined,
    }),
    [forced],
  )
  // closing a forced menu has to drop the override too, or it springs back
  const onOverlayClosed = useCallback(
    (id: OverlayId) => {
      if ((id === 'menu' && forced === 'menu') || (id === 'powerMenu' && forced === 'power-menu')) {
        setForced('playing-lyrics')
      }
    },
    [forced, setForced],
  )
  const overlays = useOverlays({ forcedOpen, onClosed: onOverlayClosed })

  return (
    <OverlayContext.Provider value={overlays}>
      <AppContent />
    </OverlayContext.Provider>
  )
}

function AppContent() {
  // with nothing navigating, the map screen is "Where to?", which takes the knob itself
  const navLive = useNav()
  const planning = navLive.connected && !navLive.active
  const auth = useAuth()
  const {
    status: realStatus,
    loading,
    connected,
    setupProgress,
    narration: seenNarration,
  } = useObserver()
  const notify = useNotify()
  usePhoneNotifications(notify)
  // an update that didn't come up and was undone: said once
  useRollbackNotice(notify)
  useSettingsRestore(notify)
  const { forced, setForced } = useDevScreen()
  const overlays = useOverlayState()
  // `overlays` itself is a new object on every open and close; these three are
  // not, so anything that ends up in a dep array is built from them
  const { open: openOverlay, close: closeOverlay, openScreensaver } = overlays

  const { play, pause, next, prev, seek, playContext, setVolume, setShuffle, djSignal, setRepeat } =
    useControls()
  usePrefetch(realStatus)
  const {
    online,
    carriers,
    pairing: realPairing,
    trouble: btTrouble,
    setDiscoverable,
    hasKnownDevice,
    btConnectedDevice,
    topKnownDeviceName,
    wasOnline,
  } = useConnectivity()
  const connectDevices = useConnectDevices()

  const closeDeviceMenu = useCallback(() => overlays.close('deviceMenu'), [overlays])
  const onPickDevice = useDeviceSwitch({
    status: realStatus,
    notify,
    onPicked: closeDeviceMenu,
  })

  const settings = useSettings()
  const showLyricsReal = settings.showLyrics

  // get settings from the daemon
  useEffect(() => {
    void initSettings()
  }, [])

  // Cold-boot rescue: fall through from BootSplash to NeedsNetwork after
  // BOOT_STUCK_MS without an online signal, so the user gets actionable
  // instructions instead of staring at a splash forever.
  const BOOT_STUCK_MS = 12000
  const bootStuck = useDelayedFlag(true, BOOT_STUCK_MS)

  // if something goes wrong change the text to try restarting
  // TODO: maybe not needed at this point since some further changes while developing the bluetooth flow showed this was not an issue as i thought
  const LOAD_STUCK_MS = 30000
  const loadStuck = useDelayedFlag(true, LOAD_STUCK_MS)

  const mockStatus = useMemo<ObserverStatusActive>(() => makeMockStatus(), [])

  const status =
    forced === 'playing-lyrics' ||
    forced === 'playing-no-lyrics' ||
    forced === 'pairing' ||
    forced === 'menu' ||
    forced === 'power-menu' ||
    forced === 'bluetooth-menu' ||
    forced === 'reconnect-banner' ||
    forced === 'settings'
      ? mockStatus
      : realStatus

  const SPOTIFY_STUCK_MS = 60000
  const playerStartingUp = status != null && !status.active && status.message === 'starting up'
  const splashOnlineStuck = playerStartingUp && online === true && !auth.url
  const spotifyStuck = useDelayedFlag(splashOnlineStuck, SPOTIFY_STUCK_MS)

  // hold the last now-playing through any small drops in network
  const heldStatus = useHeldStatus(realStatus)

  // small drops while the phone is still reachable
  const dropReason = resolveDropReason({
    suppressed: !!forced,
    held: heldStatus,
    status: realStatus,
    online,
    connected,
  })
  const reconnecting = dropReason !== null

  const offline = useOfflineScreen({
    suppressed: !!forced,
    online,
    carriers,
    btConnectedDevice,
    hasKnownDevice,
    wasOnline,
    heldStatus,
    bootStuck,
    reconnecting,
    bondLost: btTrouble === 'bond-lost',
  })
  const offlineScreen = offline.screen

  // the phone's own playback (YouTube, podcasts...) and Spotify share the
  // screen by who started playing last: the phone takes it the moment it
  // starts (no waiting for Spotify to report its pause), keeps it through its
  // own pauses, and hands it back when Spotify plays again
  const phoneMedia = usePhoneMedia()
  const spotifyPlaying = realStatus?.active === true && realStatus.is_playing
  const phonePlaying = phoneMedia.present && phoneMedia.playing
  const phoneTrack = phonePlaying ? `${phoneMedia.app}|${phoneMedia.title}` : null
  const [lastStarter, setLastStarter] = useState<'spotify' | 'phone' | null>(null)
  const [seen, setSeen] = useState({ spotifyPlaying, phoneTrack })
  if (seen.spotifyPlaying !== spotifyPlaying || seen.phoneTrack !== phoneTrack) {
    setSeen({ spotifyPlaying, phoneTrack })
    if (phoneTrack !== null && phoneTrack !== seen.phoneTrack) setLastStarter('phone')
    else if (spotifyPlaying && !seen.spotifyPlaying) setLastStarter('spotify')
  }
  const phoneShown =
    !forced &&
    phoneMedia.present &&
    offlineScreen === null &&
    !auth.required &&
    (lastStarter === 'phone' ||
      (phonePlaying && !spotifyPlaying) ||
      realStatus === null ||
      !realStatus.active)

  const showLyrics = forced === 'playing-no-lyrics' ? false : showLyricsReal
  const pairing =
    forced === 'pairing' ? { address: 'AB:CD:EF:01:23:45', passkey: '123456' } : realPairing

  // an overlay owns the screen, or something that is not an overlay does
  const overlayBusy = overlays.busy || !!forced || auth.required || reconnecting || !!pairing

  // over-the-air updates: confirm this version came up (or the daemon rolls it
  // back), and say what an install is doing while it runs
  useEffect(() => {
    if (realStatus !== null) void confirmUpdate()
  }, [realStatus !== null]) // eslint-disable-line react-hooks/exhaustive-deps
  const updateState = useUpdateState()
  const updatePhase = updateState?.phase
  // an install with the Car Thing to itself: only the updating screen (below);
  // "Not now" after a failure puts everything back
  const [updateDismissed, setUpdateDismissed] = useState<string | null>(null)
  const updateKey = updateState ? `${updateState.installing ?? ''}|${updateState.error ?? ''}` : ''
  const updateTakeover =
    takesOver(updateState) && !(updateState?.phase === 'error' && updateDismissed === updateKey)
  useEffect(() => {
    if (updateState?.focus) return
    if (updatePhase === 'downloading') notify('Downloading update...', { icon: 'info' })
    else if (updatePhase === 'restarting')
      notify('Update installed, restarting', { variant: 'success' })
    else if (updatePhase === 'error' && updateState?.error)
      notify(`Update failed: ${updateState.error}`, { variant: 'error' })
    // only on a change of phase
  }, [updatePhase]) // eslint-disable-line react-hooks/exhaustive-deps

  const openUpdateCard = useCallback(() => openOverlay('updateCard'), [openOverlay])
  const closeUpdateCard = useCallback(() => closeOverlay('updateCard'), [closeOverlay])
  const installFromCard = useCallback(() => {
    closeOverlay('updateCard')
    void installUpdate().then((ok) => {
      if (!ok) notify('That update is no longer available', { variant: 'error' })
    })
  }, [closeOverlay, notify])
  const openScreensaverAuto = useCallback(() => openScreensaver('auto'), [openScreensaver])
  const closeScreensaver = useCallback(() => closeOverlay('screensaver'), [closeOverlay])

  useIdleScreensaver({
    open: overlays.isOpen('screensaver'),
    openedBy: overlays.screensaverBy,
    busy: overlayBusy,
    updateCardOpen: overlays.isOpen('updateCard'),
    loading,
    status: realStatus,
    onOpen: openScreensaverAuto,
    onClose: closeScreensaver,
  })

  // discoverable while the Bluetooth pairing screen is up
  const pairingScreenShown = forced === 'needs-network' || offlineScreen === 'bluetooth'
  useDiscoverableWhilePairing({
    pairingScreenShown,
    btMenuOpen: overlays.isOpen('btMenu'),
    setDiscoverable,
  })

  const closePowerMenu = useCallback(() => overlays.close('powerMenu'), [overlays])

  const onOpenScreensaver = useCallback(() => {
    closePowerMenu()
    overlays.openScreensaver('manual')
  }, [closePowerMenu, overlays])

  // remembered across boots: the screensaver needs both on a cold start
  const lastArtUrl = useLastArtUrl(realStatus)
  const lastTrack = useLastTrack(realStatus)
  const utcOffsetMin = useUtcOffset(realStatus)

  const {
    version: latestVersion,
    highlights: latestHighlights,
    mandatory: updateMandatory,
    skip: skipVersion,
  } = useUpdateNotice({
    status: realStatus,
    loading,
    open: overlays.isOpen('updateCard'),
    busy: overlayBusy,
    remindAt: overlays.updateRemindAt(),
    onShow: openUpdateCard,
    onDismiss: closeUpdateCard,
  })

  // hardware back button; false when there was nothing to step back out of
  const goBack = useCallback((): boolean => {
    if (overlays.goBack()) return true
    if (offline.active && offline.method !== 'chooser') {
      offline.setMethod('chooser')
      return true
    }
    // back out of the chooser the reconnecting screen pushed us into
    if (offline.active && offline.setupOverride) {
      offline.setSetupOverride(false)
      return true
    }
    return false
  }, [overlays, overlayBusy, offline])

  const controls = usePlayerControls({
    status: status && status.active ? status : null,
    play,
    pause,
    next,
    prev,
    seek,
    setShuffle,
    djSignal,
    setRepeat,
    onCommandError: (message) => notify(message, { variant: 'error' }),
  })

  const savableStatus = status && status.active ? status : reconnecting ? heldStatus : null
  // resolved here so the hook stays unconditional
  const isDJ = isDJContext(savableStatus)
  // owns the DJ hold
  const narration = useDJNarration(savableStatus, seenNarration)
  const statusActive = status?.active === true
  const onPlayPauseActive = controls.onPlayPause
  const resumeLast = useCallback(() => {
    void resumeLastDevice().catch(() => {
      notify('Nothing to resume. Start playback on a device', { variant: 'info' })
    })
  }, [notify])
  const onHardwarePlayPause = useCallback(() => {
    if (statusActive) onPlayPauseActive()
    else resumeLast()
  }, [statusActive, onPlayPauseActive, resumeLast])

  const openDebug = useCallback(() => openOverlay('debug'), [openOverlay])

  // back with nothing left to close goes up to the home screen, from Now Playing
  // or from idle (play then starts on the last device); not before sign-in
  const signedIn = status !== null && !auth.required && !auth.loading
  const onBack = useCallback(() => {
    if (!goBack() && signedIn && !offline.active) openOverlay('home')
  }, [goBack, signedIn, offline.active, openOverlay])

  // a top button set to an action in Settings (or by default: 2 Map, 3 Home, 4 Voice)
  const onButtonAction = useCallback(
    (action: ButtonAction) => {
      const playing = statusActive && status && status.active ? status : null
      switch (action) {
        case 'home':
          if (signedIn) openOverlay('home')
          return
        case 'map':
          openOverlay('nav')
          return
        case 'drive':
          closeOverlay('home')
          closeOverlay('settings')
          openOverlay('drive')
          return
        case 'voice':
          void listenNow().then((r) => {
            if (r === 'mic-off')
              notify('The mic is off. Turn it on in the menu', { variant: 'info' })
            else if (r === 'unavailable') notify("Voice isn't available", { variant: 'warning' })
            // 'listening': the green glow says so
          })
          return
        case 'playpause':
          onHardwarePlayPause()
          return
        case 'next':
        case 'prev':
          if (!playing) {
            notify('Nothing playing', { variant: 'info' })
            return
          }
          if (action === 'next') controls.onNext()
          else controls.onPrev()
          return
        case 'like': {
          const uri = playing?.track_uri
          if (!uri || uri.startsWith('spotify:episode:')) {
            notify('Nothing to like', { variant: 'info' })
            return
          }
          void fetchSavedState(uri)
            .then((saved) =>
              setSavedState(uri, !saved).then(() =>
                notify(saved ? 'Removed from Liked Songs' : 'Added to Liked Songs', {
                  variant: 'success',
                }),
              ),
            )
            .catch(() => notify("Couldn't update Liked Songs", { variant: 'error' }))
          return
        }
      }
    },
    [statusActive, status, signedIn, openOverlay, notify, onHardwarePlayPause, controls],
  )

  // Wisp Phone's Home and Wisp buttons, as the Car Thing's top buttons do them
  useEffect(() => {
    if (!PHONE) return
    const onPress = (e: Event) =>
      onButtonAction((e as CustomEvent<PhoneButton>).detail as ButtonAction)
    window.addEventListener(PHONE_BUTTON_EVENT, onPress)
    return () => window.removeEventListener(PHONE_BUTTON_EVENT, onPress)
  }, [onButtonAction])

  useHardwareButtons({
    status: status && status.active ? status : null,
    onPlayPause: onHardwarePlayPause,
    setVolume,
    playContext,
    inDJSet: isDJ,
    djNarrating: narration.narrating,
    onDJSignal: controls.onDJSignal,
    onBack,
    onTogglePowerMenu: () => {
      if (overlays.isOpen('screensaver')) {
        overlays.close('screensaver')
        return
      }
      overlays.toggle('powerMenu')
    },
    onScreensaver: onOpenScreensaver,
    onOpenDebug: openDebug,
    notify,
    // the dev Home screen too, or its dial turns would also change the real volume
    // the phone media screen runs the knob itself (the phone's volume, play/pause)
    // Settings and Up next take the knob themselves, as do the screens below
    navigating:
      ((overlays.isOpen('nav') || forced === 'nav-live') && planning) ||
      overlays.isOpen('home') ||
      overlays.isOpen('settings') ||
      overlays.isOpen('queue') ||
      overlays.isOpen('drive') ||
      overlays.isOpen('addons') ||
      overlays.isOpen('jam') ||
      overlays.isOpen('jamSave') ||
      overlays.isOpen('viz') ||
      forced === 'addons' ||
      forced === 'jam' ||
      forced === 'jam-save' ||
      forced === 'home' ||
      forced === 'home-services' ||
      forced === 'phone-media' ||
      forced === 'phone-ytmusic' ||
      forced === 'phone-soundcloud' ||
      forced === 'phone-local' ||
      phoneShown,
    onButtonAction,
  })

  // ambient screensaver background
  let screensaverArt: string | null = null
  // nothing else mounted, so nothing else fetches: the download has the bandwidth
  if (updateTakeover && updateState) {
    return (
      <div className={styles.app}>
        <UpdateScreen
          update={updateState}
          onRetry={() => void installUpdate()}
          onClose={() => setUpdateDismissed(updateKey)}
        />
      </div>
    )
  }

  if (overlays.isOpen('screensaver') || forced === 'screensaver') {
    screensaverArt = savableStatus?.track_image || lastArtUrl
  }

  const globalOverlays = (
    <OverlayHost
      phoneVolume={status !== null && status.active === true && status.volume_disabled === true}
      online={online}
      connectDevices={connectDevices}
      onPickDevice={onPickDevice}
      pairing={pairing}
      update={{
        latest: latestVersion,
        highlights: latestHighlights,
        mandatory: updateMandatory,
        onSkip: skipVersion,
        onInstall: installFromCard,
      }}
      screensaverArt={screensaverArt}
      utcOffsetMin={utcOffsetMin}
      notify={notify}
      nowPlaying={
        savableStatus
          ? {
              title: savableStatus.track_name,
              artist: savableStatus.track_artist,
              image: savableStatus.track_image || undefined,
            }
          : null
      }
    />
  )

  if (forced === 'updating') {
    return (
      <div className={styles.app}>
        <UpdateScreen update={DEV_UPDATING} onRetry={() => {}} onClose={() => setForced(null)} />
      </div>
    )
  }

  if (forced === 'connection-chooser') {
    return (
      <div className={styles.app}>
        <ConnectionChooser
          onPickPc={() => setForced('pc-connect')}
          onPickBluetooth={() => setForced('needs-network')}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'pc-connect') {
    return (
      <div className={styles.app}>
        <PcConnect />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'needs-network') {
    return (
      <div className={styles.app}>
        <NeedsNetwork />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'starting') {
    return (
      <div className={styles.app}>
        <BootSplash caption="starting up" />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'setting-up') {
    return (
      <div className={styles.app}>
        <BootSplash caption="setting things up" progress={47} />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'boot-splash') {
    return (
      <div className={styles.app}>
        <BootSplash />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'addons') {
    return (
      <div className={styles.app}>
        <AddonsScreen onClose={() => setForced(null)} />
      </div>
    )
  }
  if (forced === 'jam-save') {
    return (
      <div className={styles.app}>
        <JamSave onClose={() => setForced(null)} />
      </div>
    )
  }
  if (forced === 'jam') {
    return (
      <div className={styles.app}>
        <JamSheet onClose={() => setForced(null)} />
      </div>
    )
  }
  if (forced === 'nav-live') {
    return (
      <div className={styles.app}>
        <NavScreen
          onClose={() => setForced(null)}
          nowPlaying={{ title: mockStatus.track_name, artist: mockStatus.track_artist }}
        />
      </div>
    )
  }
  if (forced === 'nav') {
    return (
      <div className={styles.app}>
        <DevNavSample>
          <NavScreen
            onClose={() => setForced(null)}
            nowPlaying={{ title: mockStatus.track_name, artist: mockStatus.track_artist }}
          />
        </DevNavSample>
      </div>
    )
  }
  if (
    forced === 'phone-media' ||
    forced === 'phone-ytmusic' ||
    forced === 'phone-soundcloud' ||
    forced === 'phone-local'
  ) {
    return (
      <div className={styles.app}>
        <PhoneMediaPage
          media={
            forced === 'phone-ytmusic'
              ? DEV_PHONE_YTMUSIC
              : forced === 'phone-soundcloud'
                ? DEV_PHONE_SOUNDCLOUD
                : forced === 'phone-local'
                  ? DEV_PHONE_LOCAL
                  : DEV_PHONE_MEDIA
          }
          dialEnabled={false}
          onBack={() => setForced(null)}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'home' || forced === 'home-services') {
    const home = (
      <Home
        nowPlaying={{
          title: mockStatus.track_name,
          artist: mockStatus.track_artist,
          image: mockStatus.track_image,
        }}
        onClose={() => setForced(null)}
        onOpenNav={() => setForced('nav')}
        notify={notify}
      />
    )
    return (
      <div className={styles.app}>
        {forced === 'home-services' ? (
          <NavContext.Provider value={DEV_NAV_SERVICES}>{home}</NavContext.Provider>
        ) : (
          home
        )}
      </div>
    )
  }
  if (forced === 'screensaver') {
    return (
      <div className={styles.app}>
        {/* sample weather, so the dev screen shows everything it can */}
        <Screensaver
          artUrl={screensaverArt || mockStatus.track_image}
          utcOffsetMin={utcOffsetMin}
          onClose={() => setForced(null)}
          sampleWeather={DEV_WEATHER}
        />
      </div>
    )
  }
  if (forced === 'update-card') {
    return (
      <div className={styles.app}>
        <UpdateCard
          latest="0.2.28"
          highlights={[
            'Drive Mode on Home and the power menu',
            'Visualizer with more range',
            'Settings opens from Home with the knob',
          ]}
          onInstall={() => setForced(null)}
          onRemindLater={() => setForced(null)}
          onSkip={() => setForced(null)}
        />
      </div>
    )
  }
  if (forced === 'debug') {
    return (
      <div className={styles.app}>
        <DebugScreen open onClose={() => setForced(null)} onReport={overlays.openReport} />
        {overlays.reportId ? (
          <ReportDialog id={overlays.reportId} onDismiss={() => overlays.close('report')} />
        ) : null}
      </div>
    )
  }
  if (forced === 'auth') {
    return (
      <>
        <AuthScreen url="https://accounts.spotify.com/authorize?response_type=code&client_id=dev-mock&redirect_uri=https%3A%2F%2Fexample.com%2Fcb&scope=user-read-private" />
        {globalOverlays}
      </>
    )
  }
  if (forced === 'idle') {
    return (
      <div className={styles.app}>
        <IdleScreen
          connected={connected}
          devices={connectDevices}
          onSelectDevice={onPickDevice}
          lastTrack={lastTrack}
          onResume={resumeLast}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'reconnecting') {
    return (
      <div className={styles.app}>
        <ReconnectingScreen
          deviceName="Kaz’s S24"
          carriers={{ usb: false, bt: false }}
          onSetUpOther={() => {}}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'no-internet') {
    return (
      <div className={styles.app}>
        <ReconnectingScreen
          phase="no-internet"
          deviceName="Kaz’s S24"
          carriers={{ usb: false, bt: false }}
          onSetUpOther={() => {}}
        />
        {globalOverlays}
      </div>
    )
  }
  if (forced === 'checking') {
    return (
      <div className={styles.app}>
        <ReconnectingScreen phase="checking" />
        {globalOverlays}
      </div>
    )
  }

  const phonePage = (
    <div className={styles.app}>
      <PhoneMediaPage
        media={phoneMedia}
        dialEnabled={!overlays.busy}
        onBack={() => {
          if (!goBack() && signedIn) openOverlay('home')
        }}
      />
      {globalOverlays}
    </div>
  )

  if (!forced) {
    const route = resolveRoute({
      offlineScreen,
      auth,
      status,
      setupProgress,
      loading,
      online,
      reconnecting,
      playerStartingUp,
      spotifyStuck,
      splashOnlineStuck,
      loadStuck,
    })

    switch (route.kind) {
      case 'offline':
        return (
          <div className={styles.app}>
            <OfflinePage
              screen={route.screen}
              deviceName={topKnownDeviceName}
              carriers={carriers}
              trouble={btTrouble}
              onSetUpOther={() => offline.setSetupOverride(true)}
              onPickMethod={offline.setMethod}
            />
            {globalOverlays}
          </div>
        )
      case 'auth':
        return (
          <>
            <AuthPage url={route.url} />
            {globalOverlays}
          </>
        )
      case 'spotify-unreachable':
        return (
          <div className={styles.app}>
            <ReconnectingScreen phase="spotify-unreachable" />
            {globalOverlays}
          </div>
        )
      case 'auth-pending':
        return (
          <>
            <AuthPage stuck={route.stuck} />
            {globalOverlays}
          </>
        )
      case 'booting':
        return (
          <div className={styles.app}>
            <BootPage phase="starting" stuck={route.stuck} />
            {globalOverlays}
          </div>
        )
      case 'setting-up':
        return (
          <div className={styles.app}>
            <BootPage phase="setting-up" progress={route.progress} />
            {globalOverlays}
          </div>
        )
      case 'idle':
        if (phoneShown) return phonePage
        return (
          <div className={styles.app}>
            <IdleScreen
              connected={connected}
              devices={connectDevices}
              onSelectDevice={onPickDevice}
              lastTrack={lastTrack}
              onResume={resumeLast}
            />
            {globalOverlays}
          </div>
        )
      case 'player':
        if (phoneShown) return phonePage
        break
    }
  }

  // live status when active otherwise the last playing
  const playerStatus = savableStatus
  if (!playerStatus || !playerStatus.active) return null

  // noti over the player on a network drops
  const bannerReason: ReconnectReason | null =
    forced === 'reconnect-banner' ? 'offline' : reconnecting ? dropReason : null

  return (
    <PlayerPage
      status={playerStatus}
      live={statusActive}
      controls={controls}
      narration={narration}
      showLyrics={showLyrics}
      bannerReason={bannerReason}
      carriers={carriers}
      pairing={pairing}
      seek={seek}
      notify={notify}
    >
      {globalOverlays}
    </PlayerPage>
  )
}
