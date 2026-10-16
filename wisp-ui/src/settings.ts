import { useSyncExternalStore } from 'react'
import { API_BASE } from '@/config'
import type { PresetConfig } from '@/presets'
import { ACCENT_ORDER, type AccentTheme } from '@/theme'
import { VIZ_STYLES, type VizStyle } from '@/api/viz'

// preferences for volume, offset, brightness store
// settings are all given by the daemon

export interface Settings {
  showLyrics: boolean
  karaokeLyrics: boolean
  lyricOffsetMs: number
  volumeStepPct: number
  autoBrightness: boolean
  brightness: number
  voiceMic: boolean
  uiScalePct: number
  presets: Record<number, PresetConfig>
  /** a dimmer, warmer screen: always, never, or from sunset to sunrise where you are */
  nightMode: NightMode
  /** show the phone's notifications as banners */
  phoneNotifications: boolean
  /** install new releases on their own, while nothing is playing */
  autoInstallUpdates: boolean
  /** what happens when directions end at the destination, beyond the arrival card */
  arrivalAction: ArrivalAction
  /** the colour of toggles, sliders and focus */
  accentTheme: AccentTheme
  /** updates install behind whatever is on screen, rather than taking the Car Thing over */
  updateInBackground: boolean
  /** Wisp speaking through the phone: never, what voice commands did, or that plus notifications and arrival */
  wispVoice: WispVoiceMode
  /** how fast Wisp talks, 0.5x to 2x; the pitch stays the same */
  voiceSpeed: number
  /** how loud Wisp talks, 10 to 100%, apart from the music's volume */
  voiceVolumePct: number
  /** which library Home opens on: 'spotify' or a music service's id */
  homeSource: string
  /** lyrics beside other phone players' songs (VLC, the phone's music app): off until turned on */
  phoneLyrics: boolean
  /** on by default: the graphics chip draws, the processor at full speed (the daemon's perf_mode.go) */
  performanceMode: boolean
  /** the idle screen's weather: Fahrenheit or Celsius */
  tempUnit: 'F' | 'C'
  /** the phone's battery on the players and idle screen while it isn't charging, and a warning when it's low */
  phoneBattery: boolean
  /** the visualizer behind the cover on the players: off, or its style */
  visualizer: 'off' | VizStyle
  /** the full-screen visualizer's style (the knob changes it there) */
  visualizerFull: VizStyle
}

export type WispVoiceMode = 'off' | 'confirmations' | 'everything'
const VOICE_MODES: readonly WispVoiceMode[] = ['off', 'confirmations', 'everything']
export const VOICE_SPEED_MIN = 0.5
export const VOICE_SPEED_MAX = 2

export type ArrivalAction = 'none' | 'pause'

export type NightMode = 'off' | 'on' | 'auto'
const NIGHT_MODES: readonly NightMode[] = ['off', 'on', 'auto']

export const VOLUME_STEP_MIN = 1
export const VOLUME_STEP_MAX = 10
export const BRIGHTNESS_MIN = 1
export const BRIGHTNESS_MAX = 10
export const UI_SCALE_MIN = 85
export const UI_SCALE_MAX = 115
export const UI_SCALE_STEP = 5
export const UI_SCALE_DEFAULT = 100

const SCHEMA_VERSION = 1
const LS_KEY = 'wisp.settings.v1'
const PUT_DEBOUNCE_MS = 400

const DEFAULTS: Settings = {
  showLyrics: true,
  karaokeLyrics: true,
  lyricOffsetMs: 0,
  volumeStepPct: 2,
  autoBrightness: true,
  brightness: 5,
  voiceMic: true,
  uiScalePct: UI_SCALE_DEFAULT,
  presets: {},
  nightMode: 'off',
  phoneNotifications: false,
  autoInstallUpdates: false,
  arrivalAction: 'none',
  accentTheme: 'green',
  updateInBackground: false,
  wispVoice: 'off',
  voiceSpeed: 1,
  voiceVolumePct: 80,
  homeSource: 'spotify',
  phoneLyrics: false,
  // on unless turned off: the Car Thing keeps itself safe (it eases off at 85 °C)
  performanceMode: true,
  tempUnit: 'F',
  phoneBattery: true,
  visualizer: 'off',
  visualizerFull: 'bars',
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// the ui scale feeds arithmetic that ends up as a css length, and initSettings replaces
// the store wholesale from the daemon's opaque blob. a NaN here would render as "NaNpx"
// and take the lyrics drag math with it, so reject anything non-finite and snap to a notch
function coerceUiScale(raw: unknown): number {
  // Number(null) and Number('') are both 0, which would silently clamp to the minimum
  // rather than fall back, so only numbers and non-blank numeric strings get through
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return DEFAULTS.uiScalePct
  return clamp(Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP, UI_SCALE_MIN, UI_SCALE_MAX)
}

function coerce(partial: Partial<Settings> | null | undefined): Settings {
  return {
    showLyrics: partial?.showLyrics ?? DEFAULTS.showLyrics,
    karaokeLyrics: partial?.karaokeLyrics ?? DEFAULTS.karaokeLyrics,
    lyricOffsetMs: partial?.lyricOffsetMs ?? DEFAULTS.lyricOffsetMs,
    volumeStepPct: clamp(
      partial?.volumeStepPct ?? DEFAULTS.volumeStepPct,
      VOLUME_STEP_MIN,
      VOLUME_STEP_MAX,
    ),
    autoBrightness: partial?.autoBrightness ?? DEFAULTS.autoBrightness,
    brightness: clamp(partial?.brightness ?? DEFAULTS.brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX),
    voiceMic: partial?.voiceMic ?? DEFAULTS.voiceMic,
    uiScalePct: coerceUiScale(partial?.uiScalePct),
    presets: partial?.presets ?? {},
    nightMode: NIGHT_MODES.includes(partial?.nightMode as NightMode)
      ? (partial?.nightMode as NightMode)
      : DEFAULTS.nightMode,
    phoneNotifications: partial?.phoneNotifications === true,
    autoInstallUpdates: partial?.autoInstallUpdates === true,
    arrivalAction: partial?.arrivalAction === 'pause' ? 'pause' : 'none',
    accentTheme: ACCENT_ORDER.includes(partial?.accentTheme as AccentTheme)
      ? (partial?.accentTheme as AccentTheme)
      : DEFAULTS.accentTheme,
    updateInBackground: partial?.updateInBackground === true,
    wispVoice: VOICE_MODES.includes(partial?.wispVoice as WispVoiceMode)
      ? (partial?.wispVoice as WispVoiceMode)
      : DEFAULTS.wispVoice,
    // a tenth of a step, inside the range
    voiceSpeed:
      typeof partial?.voiceSpeed === 'number' && Number.isFinite(partial.voiceSpeed)
        ? clamp(Math.round(partial.voiceSpeed * 10) / 10, VOICE_SPEED_MIN, VOICE_SPEED_MAX)
        : DEFAULTS.voiceSpeed,
    voiceVolumePct:
      typeof partial?.voiceVolumePct === 'number' && Number.isFinite(partial.voiceVolumePct)
        ? clamp(Math.round(partial.voiceVolumePct / 10) * 10, 10, 100)
        : DEFAULTS.voiceVolumePct,
    homeSource:
      typeof partial?.homeSource === 'string' && /^[a-z0-9_-]{1,32}$/.test(partial.homeSource)
        ? partial.homeSource
        : DEFAULTS.homeSource,
    phoneLyrics: partial?.phoneLyrics === true,
    performanceMode:
      typeof partial?.performanceMode === 'boolean'
        ? partial.performanceMode
        : DEFAULTS.performanceMode,
    tempUnit: partial?.tempUnit === 'C' ? 'C' : 'F',
    phoneBattery: partial?.phoneBattery !== false,
    visualizer: VIZ_STYLES.includes(partial?.visualizer as VizStyle)
      ? (partial?.visualizer as VizStyle)
      : 'off',
    visualizerFull: VIZ_STYLES.includes(partial?.visualizerFull as VizStyle)
      ? (partial?.visualizerFull as VizStyle)
      : 'bars',
  }
}

function readLocal(): Settings {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return coerce(JSON.parse(raw) as Partial<Settings>)
  } catch {
    // ignore
  }
  return coerce(null)
}

let current: Settings = readLocal()

const listeners = new Set<() => void>()
function emit(): void {
  for (const l of listeners) l()
}

function writeLocal(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(current))
  } catch {
    // ignore
  }
}

let putTimer = 0
function schedulePut(): void {
  window.clearTimeout(putTimer)
  putTimer = window.setTimeout(() => void putSettings(current), PUT_DEBOUNCE_MS)
}

// seeded: the first-boot defaults, which a backup on the phone may replace
async function putSettings(s: Settings, seeded = false): Promise<void> {
  try {
    await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        seeded ? { v: SCHEMA_VERSION, ...s, seeded_defaults: true } : { v: SCHEMA_VERSION, ...s },
      ),
    })
  } catch {
    // offline/daemon busy
  }
}

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  writeLocal()
  emit()
  schedulePut()
}

export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, () => current)
}

// check with the daemon once at startup
let initialized = false
export async function initSettings(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    const res = await fetch(`${API_BASE}/settings`)
    if (!res.ok) return
    const data = (await res.json()) as (Partial<Settings> & { v?: number }) | null
    if (data && typeof data.v === 'number') {
      current = coerce(data)
      writeLocal()
      emit()
    } else {
      // daemon never seeded
      void putSettings(current, true)
    }
  } catch {
    // offline
  }
}

/** takes the daemon's settings again, after it restored them from the phone */
export async function reloadSettings(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/settings`)
    if (!res.ok) return false
    const data = (await res.json()) as (Partial<Settings> & { v?: number }) | null
    if (!data || typeof data.v !== 'number') return false
    current = coerce(data)
    writeLocal()
    emit()
    return true
  } catch {
    return false
  }
}

// test-only
export function __resetSettings(): void {
  initialized = false
  current = readLocal()
  emit()
}
