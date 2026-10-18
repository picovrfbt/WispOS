import { memo, useContext } from 'react'
import { VIZ_LABEL, VIZ_STYLES } from '@/api/viz'
import { OverlayContext } from '@/overlays/overlayContext'
import { updateSettings, useSettings } from '@/settings'
import styles from './Menu.module.scss'

export type RepeatMode = 'off' | 'context' | 'track'

interface Props {
  open: boolean
  onClose: () => void

  showLyrics: boolean
  onToggleLyrics: () => void

  voiceMic: boolean
  onToggleVoiceMic: () => void

  currentDevice?: string
  onOpenDevices: () => void
}

// the player's own quick menu; everything else lives in Home's Settings tab
function MenuImpl({
  open,
  onClose,
  showLyrics,
  onToggleLyrics,
  voiceMic,
  onToggleVoiceMic,
  currentDevice,
  onOpenDevices,
}: Props) {
  return (
    <div
      className={`${styles.root} ${open ? styles.open : styles.closed}`}
      aria-hidden={!open}
      onClick={onClose}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.handle} aria-hidden />
        <div className={styles.toggles}>
          <Toggle label="Lyrics" on={showLyrics} onClick={onToggleLyrics} />
          <Toggle label="Mic" on={voiceMic} onClick={onToggleVoiceMic} />
        </div>
        <Row label="Devices" value={currentDevice ?? 'Switch'} onClick={onOpenDevices} />
        <VisualizerRows />
        <PassengersRow />
      </div>
    </div>
  )
}

// the visualizer: its style behind the cover (tap to cycle), and the full-screen one
function VisualizerRows() {
  const { visualizer } = useSettings()
  const overlays = useContext(OverlayContext)
  const order = ['off', ...VIZ_STYLES] as const
  const next = order[(order.indexOf(visualizer) + 1) % order.length]
  return (
    <>
      <Row
        label="Visualizer"
        value={visualizer === 'off' ? 'Off' : VIZ_LABEL[visualizer]}
        onClick={() => updateSettings({ visualizer: next })}
      />
      {overlays ? (
        <Row
          label="Full-screen visualizer"
          value="Open"
          onClick={() => {
            overlays.close('menu')
            overlays.open('viz')
          }}
        />
      ) : null}
    </>
  )
}

// passengers pick the music from their phones: the QR code screen
function PassengersRow() {
  const overlays = useContext(OverlayContext)
  if (!overlays) return null
  return (
    <Row
      label="Passengers pick the music"
      value="Show code"
      onClick={() => {
        overlays.close('menu')
        overlays.open('jam')
      }}
    />
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
      onClick={onClick}
    >
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{on ? 'On' : 'Off'}</span>
    </button>
  )
}

function Row({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{value}</span>
    </button>
  )
}

export const Menu = memo(MenuImpl)
