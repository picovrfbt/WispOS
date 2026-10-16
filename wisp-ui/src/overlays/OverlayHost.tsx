import { BluetoothMenu } from '@/components/BluetoothMenu'
import { CallCard } from '@/components/CallCard'
import { DebugScreen } from '@/components/DebugScreen'
import { DevicePicker } from '@/components/DevicePicker'
import { DriveMode } from '@/components/DriveMode'
import { FullVisualizer } from '@/components/Visualizer'
import { Home, type NowPlayingCard } from '@/components/Home'
import { NavBanner, NavScreen } from '@/components/Navigation'
import { ThemeSync } from '@/components/ThemeSync'
import { PairingDialog } from '@/components/PairingDialog'
import { PowerMenu } from '@/components/PowerMenu'
import { ReportDialog } from '@/components/ReportDialog'
import { Screensaver } from '@/components/Screensaver'
import { SettingsSheet } from '@/components/SettingsSheet'
import { UpdateCard } from '@/components/UpdateCard'
import { VolumeOverlay } from '@/components/VolumeOverlay'
import type { PairingPrompt } from '@/hooks/useBluetooth'
import type { ConnectDevice } from '@/api/types'
import type { NotifyFn } from '@/notify/notifyContext'
import { Leaving } from './Leaving'
import { useOverlayState } from './overlayContext'

export interface UpdateOfferProps {
  latest: string
  highlights: string[]
  mandatory: boolean
  onSkip: () => void
  /** installs it over the air */
  onInstall: () => void
}

export interface OverlayHostProps {
  /** the phone owns the volume, so the sheet says so instead of offering a slider */
  phoneVolume: boolean
  online: boolean | null
  connectDevices: ConnectDevice[]
  onPickDevice: (device: ConnectDevice) => void
  pairing: PairingPrompt | null
  update: UpdateOfferProps
  screensaverArt: string | null
  utcOffsetMin: number | null
  notify: NotifyFn
  /** the card under Now Playing on the home screen */
  nowPlaying: NowPlayingCard | null
}

/**
 * Every overlay that can cover any screen, rendered once. Which of them are up
 * is `useOverlays`' business; this only draws them.
 */
export function OverlayHost({
  phoneVolume,
  online,
  connectDevices,
  onPickDevice,
  pairing,
  update,
  screensaverArt,
  utcOffsetMin,
  notify,
  nowPlaying,
}: OverlayHostProps) {
  const overlays = useOverlayState()

  return (
    <>
      <VolumeOverlay />
      <ThemeSync art={nowPlaying?.image} />
      <Leaving open={overlays.isOpen('home')}>
        <Home
          nowPlaying={nowPlaying}
          onClose={() => overlays.close('home')}
          onOpenNav={() => {
            overlays.close('home')
            overlays.open('nav')
          }}
          onOpenSettings={() => overlays.open('settings')}
          onOpenDrive={() => {
            overlays.close('home')
            overlays.open('drive')
          }}
          covered={overlays.isOpen('settings')}
          notify={notify}
        />
      </Leaving>
      <Leaving open={overlays.isOpen('nav')}>
        <NavScreen
          onClose={() => overlays.close('nav')}
          nowPlaying={nowPlaying ? { title: nowPlaying.title, artist: nowPlaying.artist } : null}
        />
      </Leaving>
      <NavBanner
        hidden={
          overlays.isOpen('nav') ||
          overlays.isOpen('home') ||
          overlays.isOpen('screensaver') ||
          overlays.isOpen('menu')
        }
        onOpen={() => overlays.open('nav')}
      />
      <PowerMenu
        open={overlays.isOpen('powerMenu')}
        onClose={() => overlays.close('powerMenu')}
        onDriveMode={() => {
          overlays.close('powerMenu')
          overlays.close('home')
          overlays.close('settings')
          overlays.open('drive')
        }}
      />
      <SettingsSheet
        open={overlays.isOpen('settings')}
        onClose={() => overlays.close('settings')}
        phoneVolume={phoneVolume}
        onOpenBluetooth={() => {
          overlays.close('settings')
          overlays.close('home')
          overlays.open('btMenu')
        }}
      />
      <Leaving open={overlays.isOpen('deviceMenu')}>
        <DevicePicker
          devices={connectDevices}
          onSelect={onPickDevice}
          placement="modal"
          onClose={() => overlays.close('deviceMenu')}
        />
      </Leaving>
      <Leaving open={overlays.isOpen('btMenu')}>
        <BluetoothMenu online={online} onClose={() => overlays.close('btMenu')} />
      </Leaving>
      <DebugScreen
        open={overlays.isOpen('debug')}
        onClose={() => overlays.close('debug')}
        onReport={overlays.openReport}
      />
      {pairing ? <PairingDialog passkey={pairing.passkey} address={pairing.address} /> : null}
      {overlays.reportId ? (
        <ReportDialog id={overlays.reportId} onDismiss={() => overlays.close('report')} />
      ) : null}
      <Leaving open={overlays.isOpen('updateCard')}>
        <UpdateCard
          latest={update.latest}
          highlights={update.highlights}
          mandatory={update.mandatory}
          onInstall={update.onInstall}
          onRemindLater={overlays.remindLater}
          onSkip={update.onSkip}
        />
      </Leaving>
      <Leaving open={overlays.isOpen('drive')}>
        <DriveMode onClose={() => overlays.close('drive')} />
      </Leaving>
      <Leaving open={overlays.isOpen('viz')}>
        <FullVisualizer
          art={nowPlaying?.image}
          title={nowPlaying?.title}
          artist={nowPlaying?.artist}
          onClose={() => overlays.close('viz')}
        />
      </Leaving>
      {/* a call on the phone, over everything */}
      <CallCard />
      <Leaving open={overlays.isOpen('screensaver')}>
        <Screensaver
          artUrl={screensaverArt}
          utcOffsetMin={utcOffsetMin}
          onClose={() => overlays.close('screensaver')}
        />
      </Leaving>
    </>
  )
}
