import { useSyncExternalStore } from 'react'

export interface VolumeOverlayState {
  visible: boolean
  value: number
  // true when the active device refuses remote volume like a phone
  disabled: boolean
  phone?: boolean
  dir?: 1 | -1
}

/*
 * The knob fires up to ~18 notches a second. Kept in React state at the App
 * level, every notch re-rendered the whole app, which the Car Thing feels as
 * lag; here only the overlay itself subscribes.
 */
let state: VolumeOverlayState = { visible: false, value: 0, disabled: false }
const listeners = new Set<() => void>()

export function getVolumeOverlay(): VolumeOverlayState {
  return state
}

export function setVolumeOverlay(
  next: VolumeOverlayState | ((prev: VolumeOverlayState) => VolumeOverlayState),
): void {
  const value = typeof next === 'function' ? next(state) : next
  if (value === state) return
  state = value
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useVolumeOverlay(): VolumeOverlayState {
  return useSyncExternalStore(subscribe, getVolumeOverlay)
}
