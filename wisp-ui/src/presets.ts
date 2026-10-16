// Physical preset buttons (Digit1-4 on the Car Thing).
//
// Each button holds a playlist (any context) or an action. Short press plays
// the playlist or runs the action; long press saves whatever is playing to the
// button, turning it into a playlist button. Settings cycles a button through
// the actions. Defaults: 1 Liked Songs, 2 Map, 3 Home, 4 Voice.
// DJ is stored as its playlist uri like any other context, but the press does one of two
// things: with no set playing the daemon starts one from that uri, and with a set already
// playing the press is a retry that asks the DJ for a different one.

import { DJ_PLAYLIST_URI } from '@/hooks/useDJNarration'
import { getSettings, updateSettings } from '@/settings'

export type ButtonAction = 'home' | 'map' | 'voice' | 'drive' | 'playpause' | 'next' | 'prev' | 'like'

/** the actions a button can hold, in the order Settings cycles through them */
export const BUTTON_ACTIONS: { id: ButtonAction; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'map', label: 'Map' },
  { id: 'voice', label: 'Voice' },
  { id: 'drive', label: 'Drive Mode' },
  { id: 'playpause', label: 'Play / Pause' },
  { id: 'next', label: 'Next track' },
  { id: 'prev', label: 'Previous track' },
  { id: 'like', label: 'Like song' },
]

export interface PresetConfig {
  /** the saved playlist; kept while an action is set, so cycling back restores it */
  contextUri: string | null
  label: string
  /** set: the button runs this instead of playing contextUri */
  action?: ButtonAction
}

const DEFAULTS: Record<number, PresetConfig> = {
  1: { contextUri: 'spotify:collection:tracks', label: 'Liked Songs' },
  2: { contextUri: null, label: 'Map', action: 'map' },
  3: { contextUri: null, label: 'Home', action: 'home' },
  4: { contextUri: null, label: 'Voice', action: 'voice' },
}

export const PRESET_SLOTS = [1, 2, 3, 4] as const

export function actionLabel(action: ButtonAction): string {
  return BUTTON_ACTIONS.find((a) => a.id === action)?.label ?? action
}

/** what the button does, for Settings */
export function describePreset(preset: PresetConfig | null): string {
  if (!preset) return 'Empty'
  if (preset.action) return actionLabel(preset.action)
  return preset.contextUri ? preset.label : 'Empty (hold to save)'
}

/**
 * Settings: step a button to its next option. The saved playlist (if any) is
 * one stop on the cycle, so it isn't lost by stepping past it.
 */
export function cyclePreset(index: number): PresetConfig {
  const cur = getPreset(index) ?? { contextUri: null, label: `Preset ${index}` }
  const stops: (ButtonAction | 'playlist')[] = [
    ...(cur.contextUri ? (['playlist'] as const) : []),
    ...BUTTON_ACTIONS.map((a) => a.id),
  ]
  const at = stops.indexOf(cur.action ?? 'playlist')
  const next = stops[(at + 1) % stops.length]
  const config: PresetConfig =
    next === 'playlist'
      ? { contextUri: cur.contextUri, label: cur.label }
      : { contextUri: cur.contextUri, label: cur.label, action: next }
  setPreset(index, config)
  return config
}

export function getPreset(index: number): PresetConfig | null {
  return getSettings().presets[index] ?? DEFAULTS[index] ?? null
}

// long-press assigns the playing context; Settings assigns actions
export function setPreset(index: number, config: PresetConfig): void {
  updateSettings({ presets: { ...getSettings().presets, [index]: config } })
}

function isDJUri(uri: string | null | undefined): boolean {
  return uri === DJ_PLAYLIST_URI
}

export function isDJPreset(preset: PresetConfig | null): boolean {
  return isDJUri(preset?.contextUri)
}

export function presetForContext(
  contextUri: string,
  contextName: string,
  inDJSet: boolean,
): PresetConfig {
  if (inDJSet || isDJUri(contextUri)) return { contextUri: DJ_PLAYLIST_URI, label: 'DJ' }
  return { contextUri, label: contextName || labelFromUri(contextUri) }
}

export function refreshPresetLabels(contextUri: string, contextName: string): void {
  if (!contextUri || !contextName || isDJUri(contextUri)) return
  const presets = getSettings().presets
  let next: Record<number, PresetConfig> | null = null
  for (const [slot, preset] of Object.entries(presets)) {
    if (preset.contextUri !== contextUri || preset.label === contextName) continue
    next = next ?? { ...presets }
    next[Number(slot)] = { ...preset, label: contextName }
  }
  if (next) updateSettings({ presets: next })
}

// try to get the human readable label or fall back to a generic one
function labelFromUri(uri: string): string {
  if (uri === DJ_PLAYLIST_URI) return 'DJ'
  if (uri.startsWith('spotify:collection')) return 'Liked Songs'
  if (uri.includes(':playlist:')) return 'Playlist'
  if (uri.includes(':album:')) return 'Album'
  if (uri.includes(':artist:')) return 'Artist'
  if (uri.includes(':show:') || uri.includes(':episode:')) return 'Podcast'
  return 'Saved'
}

// maps a KeyboardEvent.code from a preset button
export function presetIndexFromCode(code: string): number | null {
  switch (code) {
    case 'Digit1':
      return 1
    case 'Digit2':
      return 2
    case 'Digit3':
      return 3
    case 'Digit4':
      return 4
    default:
      return null
  }
}
