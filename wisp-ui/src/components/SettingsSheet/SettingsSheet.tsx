import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { useDial } from '@/components/Home/useDial'
import { useDragScroll } from '@/hooks/useDragScroll'
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  updateSettings,
  useSettings,
  VOLUME_STEP_MAX,
  VOLUME_STEP_MIN,
} from '@/settings'
import { cyclePreset, describePreset, getPreset, PRESET_SLOTS } from '@/presets'
import { NotchedSlider } from './NotchedSlider'
import { checkForUpdate, installUpdate } from '@/api/update'
import { useUpdateState } from '@/hooks/useUpdateState'
import { useNightMode } from '@/hooks/useNightMode'
import { formatUtcOffset } from '@/hooks/useUtcOffset'
import type { NightMode } from '@/settings'
import { ACCENT_LABEL, ACCENT_ORDER } from '@/theme'
import { useNav } from '@/hooks/navContext'
import { sayNow } from '@/voice/speak'
import { VOICE_SPEED_MAX, VOICE_SPEED_MIN, type WispVoiceMode } from '@/settings'
import { clearSavedData, fetchSavedData, type SavedData } from '@/api/savedData'
import { useNotify } from '@/notify/notifyContext'
import { formatTemp, HOT_C, useThermal, zoneName } from '@/api/thermal'
import { glideIntoView, pageOffset } from '@/utils/glide'
import styles from './SettingsSheet.module.scss'

interface Props {
  open: boolean
  onClose: () => void
  // active device is a phone
  phoneVolume?: boolean
  /** shows a Bluetooth row that opens pairing */
  onOpenBluetooth?: () => void
}

// room kept above and below the knob's cursor as the page follows it
const CURSOR_PAD = 20

/** what the knob can land on: the buttons and sliders, not a slider's own − and + */
function knobTargets(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>('button, [role="slider"]')).filter(
    (el) =>
      !(el as HTMLButtonElement).disabled &&
      el.getAttribute('aria-disabled') !== 'true' &&
      !(el.tagName === 'BUTTON' && el.parentElement?.querySelector(':scope > [role="slider"]')),
  )
}

const OFFSET_MIN = -500
const OFFSET_MAX = 500
const OFFSET_STEP = 50

function fmtOffset(ms: number): string {
  if (ms === 0) return '0 ms'
  return `${ms > 0 ? '+' : ''}${ms} ms`
}

/**
 * Settings as a page of its own, over the whole screen. The arrow at the top
 * and the back button both return to where it was opened from; the dial
 * scrolls it, and the rows themselves are touch controls.
 */
function SettingsSheetImpl({ open, onClose, phoneVolume = false, onOpenBluetooth }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  useDragScroll(scrollRef, { axis: 'y', enabled: open })

  // the knob's cursor: a ring that glides from control to control. A press
  // takes a button; on a slider it starts adjusting, the knob then steps it
  // and a press (or back) is done. Hidden until the knob is first turned.
  const cursorRef = useRef<HTMLElement | null>(null)
  const [cursorOn, setCursorOn] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setCursorOn(false)
    setAdjusting(false)
  }

  const placeRing = () => {
    const el = cursorRef.current
    const panel = panelRef.current
    const ring = ringRef.current
    if (!el || !panel || !ring || !panel.contains(el)) return
    const at = pageOffset(el)
    const origin = pageOffset(panel)
    ring.style.top = `${at.top - origin.top}px`
    ring.style.left = `${at.left - origin.left}px`
    ring.style.width = `${el.offsetWidth}px`
    ring.style.height = `${el.offsetHeight}px`
  }
  // a press can change the page (Manual brightness adds a slider): follow it
  const placeSoon = () => {
    requestAnimationFrame(placeRing)
    window.setTimeout(placeRing, 250)
  }

  useDial({
    enabled: open,
    onStep: (dir) => {
      const panel = panelRef.current
      const scroll = scrollRef.current
      if (!panel || !scroll) return
      const cur = cursorRef.current
      if (adjusting && cur) {
        const [down, up] = Array.from(
          cur.parentElement?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [],
        )
        ;(dir > 0 ? up : down)?.click()
        return
      }
      const all = knobTargets(panel)
      if (all.length === 0) return
      let i = cur ? all.indexOf(cur) : -1
      if (i < 0 || !cursorOn) {
        // start from the first control on screen
        const top = scroll.scrollTop
        i = Math.max(
          0,
          all.findIndex((el) => pageOffset(el).top - pageOffset(panel).top >= top),
        )
      } else {
        i = Math.max(0, Math.min(all.length - 1, i + dir))
      }
      cursorRef.current = all[i]
      setCursorOn(true)
      placeRing()
      glideIntoView(scroll, all[i], CURSOR_PAD)
    },
    onPress: () => {
      const el = cursorRef.current
      if (!cursorOn || !el || !panelRef.current?.contains(el)) return
      if (adjusting) setAdjusting(false)
      else if (el.getAttribute('role') === 'slider') setAdjusting(true)
      else {
        el.click()
        placeSoon()
      }
    },
    onBack: () => {
      if (adjusting) setAdjusting(false)
      else onClose()
    },
  })

  return (
    <div
      className={`${styles.root} ${open ? styles.open : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      aria-hidden={!open}
    >
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={onClose} aria-label="Back">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M15.4 4.6a1 1 0 0 1 0 1.4L9.4 12l6 6a1 1 0 1 1-1.4 1.4l-6.7-6.7a1 1 0 0 1 0-1.4L14 4.6a1 1 0 0 1 1.4 0z" />
          </svg>
        </button>
        <div className={styles.title}>Settings</div>
      </div>
      <div className={styles.scroll} ref={scrollRef}>
        <div className={styles.panel} ref={panelRef}>
          <div
            ref={ringRef}
            className={`${styles.cursor} ${cursorOn ? styles.cursorOn : ''} ${
              adjusting ? styles.cursorAdjusting : ''
            }`}
            aria-hidden
          />
          <SettingsPanel
            active={open}
            phoneVolume={phoneVolume}
            onOpenBluetooth={onOpenBluetooth}
          />
        </div>
      </div>
    </div>
  )
}

interface PanelProps {
  /** on screen; a scale drag still in progress when it goes away is dropped */
  active: boolean
  phoneVolume?: boolean
  /** shows a Bluetooth row that opens pairing, where there is one to open */
  onOpenBluetooth?: () => void
}

/** the settings themselves, for the sheet and for Home's Settings tab */
export function SettingsPanel({ active, phoneVolume = false, onOpenBluetooth }: PanelProps) {
  const open = active
  // also re-renders the button rows when a preset changes
  const {
    lyricOffsetMs,
    volumeStepPct,
    autoBrightness,
    brightness,
    uiScalePct,
    phoneNotifications,
    phoneBattery,
  } = useSettings()

  // applying the scale mid-drag moves this very panel under the finger, which has no
  // fixed point near a notch boundary and makes the whole ui flicker between two sizes.
  // so track the drag locally and only commit on release
  const [scalePreview, setScalePreview] = useState<number | null>(null)
  // drop an uncommitted drag if the sheet is dismissed mid-gesture
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (scalePreview !== null) setScalePreview(null)
  }
  const shownScale = scalePreview ?? uiScalePct

  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.section}>Display</div>
      </div>
      {/* first on purpose: at the largest display size the page scrolls, and this is
            the one control that has to stay reachable to get back down */}
      <SettingRow icon={<DisplaySizeIcon />} label="Display size" value={`${shownScale}%`}>
        <NotchedSlider
          ariaLabel="Display size"
          value={shownScale}
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          onChange={setScalePreview}
          onCommit={(v) => {
            setScalePreview(null)
            // the sheet was dismissed mid-gesture, so drop the drag instead of
            // resizing the whole ui after it's gone
            if (!open) return
            updateSettings({ uiScalePct: v })
          }}
          onCancel={() => setScalePreview(null)}
          format={(v) => `${v}%`}
          defaultValue={UI_SCALE_DEFAULT}
        />
      </SettingRow>

      <BrightnessRow autoBrightness={autoBrightness} brightness={brightness} />
      <NightModeRow />
      <AccentRow />
      <PerformanceRow />
      <TemperaturesRow />
      <TempUnitRow />

      <div className={styles.sectionHead}>
        <div className={styles.section}>Playback</div>
      </div>
      <HomeSourceRow />
      <SettingRow icon={<LyricsIcon />} label="Lyric sync" value={fmtOffset(lyricOffsetMs)}>
        <NotchedSlider
          ariaLabel="Lyric sync offset"
          value={lyricOffsetMs}
          min={OFFSET_MIN}
          max={OFFSET_MAX}
          step={OFFSET_STEP}
          onChange={(v) => updateSettings({ lyricOffsetMs: v })}
          format={fmtOffset}
          defaultValue={0}
        />
      </SettingRow>

      <SettingRow
        icon={<SpeakerIcon />}
        label="Volume per turn"
        value={phoneVolume ? 'Set by phone' : `${volumeStepPct}%`}
      >
        <NotchedSlider
          ariaLabel="Volume per turn"
          value={volumeStepPct}
          min={VOLUME_STEP_MIN}
          max={VOLUME_STEP_MAX}
          step={1}
          onChange={(v) => updateSettings({ volumeStepPct: v })}
          format={(v) => `${v}%`}
          disabled={phoneVolume}
          defaultValue={2}
        />
      </SettingRow>

      <div className={styles.sectionHead}>
        <div className={styles.section}>Navigation</div>
      </div>
      <NavEngineRow />
      <NavVoiceRow />
      <ArrivalRow />

      {/* the four buttons along the top of the Car Thing */}
      <div className={styles.sectionHead}>
        <div className={styles.section}>Top buttons</div>
        <div className={styles.buttonsHint}>
          Tap to change. Hold a button to save what's playing.
        </div>
      </div>
      {PRESET_SLOTS.map((slot) => (
        <button
          key={slot}
          type="button"
          className={styles.buttonRow}
          onClick={() => cyclePreset(slot)}
        >
          <span className={styles.chip} aria-hidden>
            {slot}
          </span>
          <span className={styles.label}>Button {slot}</span>
          <span className={styles.value}>{describePreset(getPreset(slot))}</span>
        </button>
      ))}

      <SoftwareUpdate />

      <StorageSection />

      <WispVoiceSection />

      <div className={styles.sectionHead}>
        <div className={styles.section}>Phone</div>
      </div>
      <SwitchRow
        icon={<BellIcon />}
        label="Notifications"
        on={phoneNotifications}
        onToggle={() => updateSettings({ phoneNotifications: !phoneNotifications })}
      />
      <SwitchRow
        icon={<BatteryIcon />}
        label="Phone battery"
        on={phoneBattery}
        onToggle={() => updateSettings({ phoneBattery: !phoneBattery })}
      />
      {onOpenBluetooth ? (
        <button type="button" className={styles.buttonRow} onClick={onOpenBluetooth}>
          <span className={styles.chip} aria-hidden>
            <BluetoothIcon />
          </span>
          <span className={styles.label}>Bluetooth</span>
          <span className={styles.value}>Pair a phone</span>
        </button>
      ) : null}
    </>
  )
}

// the over-the-air updater: what's running, what's out, and the one button
function SoftwareUpdate() {
  const u = useUpdateState()
  const { autoInstallUpdates, updateInBackground } = useSettings()
  const [checking, setChecking] = useState(false)
  if (!u) return null
  const busy = u.phase === 'downloading' || u.phase === 'installing' || u.phase === 'restarting'
  let value: string
  let action: (() => void) | null = null
  if (u.phase === 'downloading') value = `Downloading ${u.percent ?? 0}%`
  else if (u.phase === 'installing') value = 'Installing...'
  else if (u.phase === 'restarting') value = 'Restarting...'
  else if (checking || u.phase === 'checking') value = 'Checking...'
  else if (u.available && u.latest) {
    value = `Install ${u.latest}`
    action = () => void installUpdate()
  } else {
    value = u.phase === 'error' ? 'Check again' : 'Check for updates'
    action = () => {
      setChecking(true)
      void checkForUpdate().finally(() => setChecking(false))
    }
  }
  const note =
    u.phase === 'error' && u.error
      ? u.error
      : u.available
        ? null
        : u.latest
          ? `Up to date (${u.current})`
          : null
  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.section}>Software update</div>
        {note ? <div className={styles.buttonsHint}>{note}</div> : null}
      </div>
      <button
        type="button"
        className={styles.buttonRow}
        onClick={action ?? undefined}
        disabled={busy || action === null}
      >
        <span className={styles.chip} aria-hidden>
          <UpdateIcon />
        </span>
        <span className={styles.label}>Version {u.current}</span>
        <span className={styles.value}>{value}</span>
      </button>
      <SwitchRow
        icon={<AutoIcon />}
        label="Install updates automatically"
        on={autoInstallUpdates}
        onToggle={() => updateSettings({ autoInstallUpdates: !autoInstallUpdates })}
      />
      <SwitchRow
        icon={<UpdateIcon />}
        label="Update in the background"
        on={updateInBackground}
        onToggle={() => updateSettings({ updateInBackground: !updateInBackground })}
      />
    </>
  )
}

// the accent colour; tapping cycles through them
function AccentRow() {
  const { accentTheme } = useSettings()
  const next = ACCENT_ORDER[(ACCENT_ORDER.indexOf(accentTheme) + 1) % ACCENT_ORDER.length]
  return (
    <button
      type="button"
      className={styles.buttonRow}
      aria-label={`Accent colour: ${ACCENT_LABEL[accentTheme]}`}
      onClick={() => updateSettings({ accentTheme: next })}
    >
      <span className={styles.chip} aria-hidden>
        <span className={styles.swatch} />
      </span>
      <span className={styles.label}>Accent colour</span>
      <span className={styles.value}>{ACCENT_LABEL[accentTheme]}</span>
    </button>
  )
}

// who gives directions you ask for by voice: Google Maps on the phone, or Wisp
// itself (from OpenStreetMap, with the turns on the Car Thing)
function NavEngineRow() {
  const { navEngine } = useSettings()
  const wisp = navEngine === 'wisp'
  return (
    <button
      type="button"
      className={styles.buttonRow}
      onClick={() => updateSettings({ navEngine: wisp ? 'google' : 'wisp' })}
    >
      <span className={`${styles.chip} ${wisp ? styles.chipOn : ''}`} aria-hidden>
        <FlagIcon />
      </span>
      <span className={styles.label}>Directions by</span>
      <span className={styles.value}>{wisp ? 'Wisp' : 'Google Maps'}</span>
    </button>
  )
}

// Wisp's directions out loud, as on the map screen's sound menu
const NAV_VOICE_NEXT = { all: 'turns', turns: 'off', off: 'all' } as const
const NAV_VOICE_LABEL = { all: 'Every turn', turns: 'Just the turns', off: 'Muted' } as const
function NavVoiceRow() {
  const { navVoice } = useSettings()
  return (
    <button
      type="button"
      className={styles.buttonRow}
      onClick={() => updateSettings({ navVoice: NAV_VOICE_NEXT[navVoice] })}
    >
      <span className={`${styles.chip} ${navVoice !== 'off' ? styles.chipOn : ''}`} aria-hidden>
        <SpeakerIcon />
      </span>
      <span className={styles.label}>Spoken directions</span>
      <span className={styles.value}>{NAV_VOICE_LABEL[navVoice]}</span>
    </button>
  )
}

// what else happens when directions end at the destination
function ArrivalRow() {
  const { arrivalAction } = useSettings()
  return (
    <button
      type="button"
      className={styles.buttonRow}
      onClick={() =>
        updateSettings({ arrivalAction: arrivalAction === 'pause' ? 'none' : 'pause' })
      }
    >
      <span
        className={`${styles.chip} ${arrivalAction === 'pause' ? styles.chipOn : ''}`}
        aria-hidden
      >
        <FlagIcon />
      </span>
      <span className={styles.label}>When you arrive</span>
      <span className={styles.value}>
        {arrivalAction === 'pause' ? 'Pause music' : 'Just show it'}
      </span>
    </button>
  )
}

function FlagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 21V4h9.4l.4 2H20v10h-6.4l-.4-2H5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const NIGHT_LABEL: Record<NightMode, string> = { off: 'Off', on: 'On', auto: 'Auto' }
const NIGHT_NEXT: Record<NightMode, NightMode> = { off: 'on', on: 'auto', auto: 'off' }

/** 7:42pm on the phone's clock (the Car Thing's own runs on UTC) */
function clockAt(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000)
  const h = d.getUTCHours()
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}`
}

// a dimmer, warmer screen; tapping cycles off, on, and sunset to sunrise
function NightModeRow() {
  const { mode, offsetMin, sun } = useNightMode()
  const value =
    mode === 'auto'
      ? sun?.sunset && sun.sunrise && offsetMin !== null
        ? `Auto · ${clockAt(sun.sunset, offsetMin)}–${clockAt(sun.sunrise, offsetMin)}`
        : offsetMin !== null
          ? `Auto · 7pm–7am ${formatUtcOffset(offsetMin)}`
          : 'Auto · needs phone'
      : NIGHT_LABEL[mode]
  return (
    <button
      type="button"
      className={styles.buttonRow}
      aria-label={`Night mode: ${NIGHT_LABEL[mode]}`}
      onClick={() => updateSettings({ nightMode: NIGHT_NEXT[mode] })}
    >
      <span className={`${styles.chip} ${mode !== 'off' ? styles.chipOn : ''}`} aria-hidden>
        <MoonIcon />
      </span>
      <span className={styles.label}>Night mode</span>
      <span className={styles.value}>{value}</span>
    </button>
  )
}

// which library Home opens on: Spotify, or a music service signed in on the phone
function HomeSourceRow() {
  const { homeSource } = useSettings()
  const nav = useNav()
  const choices = [
    { id: 'spotify', name: 'Spotify' },
    ...(nav.services ?? [])
      .filter((s) => s.enabled && s.signed_in)
      .map((s) => ({ id: s.id, name: s.name })),
  ]
  // nothing else signed in: nothing to choose
  if (choices.length < 2) return null
  const at = Math.max(
    0,
    choices.findIndex((c) => c.id === homeSource),
  )
  const next = choices[(at + 1) % choices.length]
  return (
    <button
      type="button"
      className={styles.buttonRow}
      aria-label={`Home opens on: ${choices[at].name}`}
      onClick={() => updateSettings({ homeSource: next.id })}
    >
      <span className={styles.chip} aria-hidden>
        <HomeIcon />
      </span>
      <span className={styles.label}>Home opens on</span>
      <span className={styles.value}>{choices[at].name}</span>
    </button>
  )
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// brightness: a big Auto / Manual switch, and the level below it for manual
function BrightnessRow({
  autoBrightness,
  brightness,
}: {
  autoBrightness: boolean
  brightness: number
}) {
  return (
    <div className={styles.row}>
      <span className={`${styles.chip} ${autoBrightness ? styles.chipOn : ''}`} aria-hidden>
        <SunIcon />
      </span>
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <span className={styles.label}>Brightness</span>
          <div className={styles.segmented} role="radiogroup" aria-label="Brightness mode">
            {[
              { auto: true, label: 'Auto' },
              { auto: false, label: 'Manual' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={autoBrightness === o.auto}
                className={`${styles.segment} ${autoBrightness === o.auto ? styles.segmentOn : ''}`}
                onClick={() => updateSettings({ autoBrightness: o.auto })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <NotchedSlider
          ariaLabel="Brightness"
          value={brightness}
          min={BRIGHTNESS_MIN}
          max={BRIGHTNESS_MAX}
          step={1}
          onChange={(v) => updateSettings({ brightness: v })}
          format={(v) => `${v * 10}%`}
          disabled={autoBrightness}
          defaultValue={5}
        />
      </div>
    </div>
  )
}

const VOICE_LABEL: Record<WispVoiceMode, string> = {
  off: 'Off',
  confirmations: 'Confirmations',
  everything: 'Everything',
}
const VOICE_NEXT: Record<WispVoiceMode, WispVoiceMode> = {
  off: 'confirmations',
  confirmations: 'everything',
  everything: 'off',
}
const PREVIEW_MS = 650

// Wisp talking through the phone: how much, and how fast
function WispVoiceSection() {
  const { wispVoice, voiceSpeed, voiceVolumePct } = useSettings()
  const nav = useNav()
  // the voice downloads to the phone the first time it's turned on
  const status =
    wispVoice === 'off'
      ? null
      : !nav.connected
        ? 'Needs the phone'
        : nav.voice_state === 'downloading'
          ? `Getting the voice ${nav.voice_percent ?? 0}%`
          : nav.voice_state === 'failed'
            ? (nav.voice_error ?? "The voice didn't download")
            : null
  const [preview, setPreview] = useState(0)
  // a moment after the speed stops moving, say how it sounds now
  useEffect(() => {
    if (preview === 0) return
    const t = window.setTimeout(() => void sayNow("This is how I'll sound."), PREVIEW_MS)
    return () => window.clearTimeout(t)
  }, [preview])

  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.section}>Wisp's voice</div>
        <div className={styles.buttonsHint}>
          {status ??
            'Wisp speaks through your phone into the car. The music dips while he talks, then comes back.'}
        </div>
      </div>
      <button
        type="button"
        className={styles.buttonRow}
        aria-label={`Wisp's voice: ${VOICE_LABEL[wispVoice]}`}
        onClick={() => updateSettings({ wispVoice: VOICE_NEXT[wispVoice] })}
      >
        <span className={`${styles.chip} ${wispVoice !== 'off' ? styles.chipOn : ''}`} aria-hidden>
          <VoiceIcon />
        </span>
        <span className={styles.label}>Speak</span>
        <span className={styles.value}>{VOICE_LABEL[wispVoice]}</span>
      </button>
      <SettingRow icon={<SpeedIcon />} label="Voice speed" value={`${voiceSpeed.toFixed(1)}×`}>
        <NotchedSlider
          ariaLabel="Voice speed"
          value={Math.round(voiceSpeed * 10)}
          min={VOICE_SPEED_MIN * 10}
          max={VOICE_SPEED_MAX * 10}
          step={1}
          onChange={(v) => {
            updateSettings({ voiceSpeed: v / 10 })
            if (wispVoice !== 'off') setPreview((n) => n + 1)
          }}
          format={(v) => `${(v / 10).toFixed(1)}×`}
          disabled={wispVoice === 'off'}
          defaultValue={10}
        />
      </SettingRow>
      <SettingRow icon={<SpeakerIcon />} label="Voice volume" value={`${voiceVolumePct}%`}>
        <NotchedSlider
          ariaLabel="Voice volume"
          value={voiceVolumePct}
          min={10}
          max={100}
          step={10}
          onChange={(v) => {
            updateSettings({ voiceVolumePct: v })
            if (wispVoice !== 'off') setPreview((n) => n + 1)
          }}
          format={(v) => `${v}%`}
          disabled={wispVoice === 'off'}
          defaultValue={80}
        />
      </SettingRow>
    </>
  )
}

function VoiceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SpeedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 16a8 8 0 1 1 16 0M12 16l4-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SwitchRow({
  icon,
  label,
  on,
  onToggle,
}: {
  icon: ReactNode
  label: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={styles.buttonRow}
      onClick={onToggle}
    >
      <span className={`${styles.chip} ${on ? styles.chipOn : ''}`} aria-hidden>
        {icon}
      </span>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{on ? 'On' : 'Off'}</span>
    </button>
  )
}

function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BatteryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="7" width="17" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <rect x="5" y="9.5" width="8" height="5" rx="1" fill="currentColor" />
      <path d="M21.5 10.5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 21h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AutoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function UpdateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BluetoothIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.5 6.5l11 11-5.5 5.5V1l5.5 5.5-11 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface RowProps {
  icon: ReactNode
  label: string
  value: string
  children: ReactNode
}

function SettingRow({ icon, label, value, children }: RowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.chip} aria-hidden>
        {icon}
      </span>
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{value}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function LyricsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18V6l10-2v10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
      <circle cx="16.5" cy="16" r="2.5" fill="currentColor" />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5v5h3.2L12 18.7V5.3L7.2 9.5H4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DisplaySizeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8.5 15V9.8m0 0H6.9m1.6 0h1.6M15.5 15V8.2m0 0h-2.1m2.1 0h2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const SettingsSheet = memo(SettingsSheetImpl)

// experimental: more of the Car Thing for the screen; it restarts once to take it
function PerformanceRow() {
  const { performanceMode } = useSettings()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={performanceMode}
      className={styles.buttonRow}
      onClick={() => updateSettings({ performanceMode: !performanceMode })}
    >
      <span className={`${styles.chip} ${performanceMode ? styles.chipOn : ''}`} aria-hidden>
        <BoltIcon />
      </span>
      <span className={styles.labelStack}>
        <span className={styles.label}>Performance mode</span>
        <span className={styles.sublabel}>
          Smoother, runs warmer · eases off when hot · screen restarts
        </span>
      </span>
      <span className={styles.value}>{performanceMode ? 'On' : 'Off'}</span>
    </button>
  )
}

function mbOf(bytes: number) {
  const mb = bytes / 1_048_576
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}

// what's kept for speed, and clearing it: a first press asks, a second clears
function StorageSection() {
  const notify = useNotify()
  const [saved, setSaved] = useState<SavedData | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void fetchSavedData().then((d) => {
      if (live) setSaved(d)
    })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (!confirming) return
    const t = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(t)
  }, [confirming])

  const total = saved ? saved.covers_bytes + saved.lyrics_bytes : null
  const press = () => {
    if (busy) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    setBusy(true)
    void clearSavedData().then((ok) => {
      setBusy(false)
      notify(ok ? 'Saved covers and lyrics cleared' : "Couldn't clear everything", {
        variant: ok ? undefined : 'error',
      })
      void fetchSavedData().then(setSaved)
    })
  }

  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.section}>Storage</div>
      </div>
      <button type="button" className={styles.buttonRow} onClick={press} disabled={busy}>
        <span className={styles.chip} aria-hidden>
          <TrashIcon />
        </span>
        <span className={styles.labelStack}>
          <span className={styles.label}>
            {confirming ? 'Press again to clear' : 'Clear saved covers & lyrics'}
          </span>
          <span className={styles.sublabel}>
            {saved
              ? `Covers ${mbOf(saved.covers_bytes)} · Lyrics ${mbOf(saved.lyrics_bytes)}`
              : 'Kept to load faster; they come back as you play'}
          </span>
        </span>
        <span className={styles.value}>
          {busy ? 'Clearing…' : total !== null ? mbOf(total) : ''}
        </span>
      </button>
    </>
  )
}

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z" />
    </svg>
  )
}

// the idle screen's weather in °F or °C; tapping switches
function TempUnitRow() {
  const { tempUnit } = useSettings()
  return (
    <button
      type="button"
      className={styles.buttonRow}
      aria-label={`Temperature: degrees ${tempUnit === 'C' ? 'Celsius' : 'Fahrenheit'}`}
      onClick={() => updateSettings({ tempUnit: tempUnit === 'C' ? 'F' : 'C' })}
    >
      <span className={styles.chip} aria-hidden>
        <ThermometerIcon />
      </span>
      <span className={styles.label}>Temperature</span>
      <span className={styles.value}>°{tempUnit}</span>
    </button>
  )
}

function ThermometerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a3 3 0 0 1 3 3v8.3a5 5 0 1 1-6 0V5a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v9.4l-.4.3a3 3 0 1 0 2.8 0l-.4-.3V5a1 1 0 0 0-1-1zm0 7a1 1 0 0 1 1 1v3.2a2 2 0 1 1-2 0V12a1 1 0 0 1 1-1z" />
    </svg>
  )
}

// the Car Thing's sensors, read live while the list is open; always °C, how chip
// temperatures are known (the weather keeps its own unit)
function TemperaturesRow() {
  const [open, setOpen] = useState(false)
  // the processor's reading shows on the row even closed: asked slowly then
  const thermal = useThermal(true, open ? 3000 : 15000)
  const soc = thermal?.zones.find((z) => z.name === 'soc_thermal') ?? thermal?.zones[0]
  if (thermal && thermal.zones.length === 0) return null
  return (
    <>
      <button
        type="button"
        className={styles.buttonRow}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`${styles.chip} ${thermal?.hot ? styles.chipHot : ''}`} aria-hidden>
          <ThermometerIcon />
        </span>
        <span className={styles.labelStack}>
          <span className={styles.label}>Temperatures</span>
          <span className={styles.sublabel}>
            {thermal?.backed_off
              ? 'Hot: Performance mode is easing off until it cools'
              : `Performance mode eases off at ${formatTemp(HOT_C, 'C')}`}
          </span>
        </span>
        <span className={styles.value}>
          {soc ? formatTemp(soc.temp_c, 'C') : '…'} {open ? '▴' : '▾'}
        </span>
      </button>
      {open && thermal ? (
        <div className={styles.sensorList}>
          {thermal.zones.map((z) => {
            const limit = z.trips?.find((t) => t.type === 'passive' && t.temp_c > 60)?.temp_c
            return (
              <div key={z.name} className={styles.sensor}>
                <span className={styles.sensorName}>{zoneName(z)}</span>
                <span
                  className={`${styles.sensorTemp} ${
                    limit !== undefined && z.temp_c >= limit ? styles.sensorHot : ''
                  }`}
                >
                  {formatTemp(z.temp_c, 'C')}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
