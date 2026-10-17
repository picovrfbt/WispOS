import { createContext, useContext } from 'react'

export const DEV_SCREENS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_DEV_SCREENS === '1'

export type DevForcedScreen =
  | null
  | 'connection-chooser'
  | 'pc-connect'
  | 'needs-network'
  | 'starting'
  | 'setting-up'
  | 'boot-splash'
  | 'auth'
  | 'idle'
  | 'playing-lyrics'
  | 'playing-no-lyrics'
  | 'pairing'
  | 'menu'
  | 'home'
  | 'addons'
  | 'phone-media'
  | 'phone-ytmusic'
  | 'phone-soundcloud'
  | 'phone-local'
  | 'home-services'
  | 'nav'
  | 'nav-live'
  | 'power-menu'
  | 'bluetooth-menu'
  | 'settings'
  | 'reconnecting'
  | 'no-internet'
  | 'checking'
  | 'reconnect-banner'
  | 'debug'
  | 'screensaver'
  | 'update-card'
  | 'updating'

export interface DevScreenCtx {
  forced: DevForcedScreen
  setForced: (s: DevForcedScreen) => void
}

export const DevScreenContext = createContext<DevScreenCtx>({
  forced: null,
  setForced: () => {},
})

export function useDevScreen(): DevScreenCtx {
  return useContext(DevScreenContext)
}
