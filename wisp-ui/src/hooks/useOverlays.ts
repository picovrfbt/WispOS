import { useCallback, useMemo, useRef, useState } from 'react'

const UPDATE_REMIND_MS = 24 * 60 * 60 * 1000

export type OverlayId =
  | 'screensaver'
  | 'updateCard'
  | 'report'
  | 'debug'
  | 'deviceMenu'
  | 'btMenu'
  | 'settings'
  | 'powerMenu'
  | 'menu'
  | 'queue'
  | 'home'
  | 'nav'
  | 'drive'
  | 'viz'

/**
 * Back closes the first of these that is open. A fixed order rather than a
 * stack of open order: these open each other (menu opens settings, settings
 * opens debug), and this is the order a user can actually unwind them in.
 */
const BACK_ORDER: readonly OverlayId[] = [
  'screensaver',
  'updateCard',
  'report',
  'debug',
  'deviceMenu',
  'btMenu',
  'settings',
  'powerMenu',
  'menu',
  'queue',
  'nav',
]

/**
 * Overlays that run their own back button (home steps back through its levels
 * before closing), so `goBack` leaves them alone but they still count as busy.
 */
const SELF_BACK: readonly OverlayId[] = ['home', 'drive', 'viz']

/**
 * Overlays that do not count as "busy": the update card decides for itself
 * when to appear and gates that on `busy`, so counting it would mean it
 * blocks its own reappearance.
 */
const NOT_BUSY: readonly OverlayId[] = ['updateCard']

/**
 * Every overlay but the report dialog, which has no flag: `isOpen` reads its
 * id instead, so a flag would be written and never looked at.
 */
export type FlagId = Exclude<OverlayId, 'report'>

export type ScreensaverBy = 'manual' | 'auto'

export interface UseOverlaysParams {
  /**
   * Dev screens force an overlay open without touching its state. Treated as
   * open everywhere here, so `busy` and back behave as they would for real.
   */
  forcedOpen?: Partial<Record<OverlayId, boolean>>
  /** fires after any close, for the dev screen to drop its own override */
  onClosed?: (id: OverlayId) => void
}

export interface Overlays {
  isOpen: (id: OverlayId) => boolean
  /** the report dialog opens through `openReport`, which carries its id */
  open: (id: FlagId) => void
  close: (id: OverlayId) => void
  /** flips the real state, ignoring any dev override on top of it */
  toggle: (id: FlagId) => void
  /** an overlay owns the screen: idle timers and one-shot cards stand down */
  busy: boolean
  /** Closes the topmost overlay; false when there was nothing to close */
  goBack: () => boolean

  /** the support report dialog carries the id it is showing */
  reportId: string | null
  openReport: (id: string) => void

  /** an auto-opened screensaver yields to playback; a manual one stays */
  screensaverBy: ScreensaverBy
  openScreensaver: (by: ScreensaverBy) => void

  /** earliest time the update card may come back, as an epoch ms */
  updateRemindAt: () => number
  remindLater: () => void
}

const NONE: Record<FlagId, boolean> = {
  screensaver: false,
  updateCard: false,
  debug: false,
  deviceMenu: false,
  btMenu: false,
  settings: false,
  powerMenu: false,
  menu: false,
  queue: false,
  home: false,
  nav: false,
  drive: false,
  viz: false,
}

/**
 * Every menu, sheet, dialog, and card that can cover the screen, plus the
 * order the back button unwinds them in. Owns opening, closing, and what a
 * close has to remember; deciding *when* to open one is the caller's job.
 */
export function useOverlays({ forcedOpen, onClosed }: UseOverlaysParams = {}): Overlays {
  const [flags, setFlags] = useState(NONE)
  const [reportId, setReportId] = useState<string | null>(null)
  const [screensaverBy, setScreensaverBy] = useState<ScreensaverBy>('manual')

  const updateRemindAtRef = useRef(0)
  const updateRemindAt = useCallback(() => updateRemindAtRef.current, [])

  const isOpen = useCallback(
    (id: OverlayId) => forcedOpen?.[id] ?? (id === 'report' ? reportId !== null : flags[id]),
    [forcedOpen, flags, reportId],
  )

  const open = useCallback((id: FlagId) => {
    setFlags((f) => ({ ...f, [id]: true }))
  }, [])

  const close = useCallback(
    (id: OverlayId) => {
      if (id === 'report') {
        setReportId(null)
      } else {
        setFlags((f) => ({ ...f, [id]: false }))
      }
      onClosed?.(id)
    },
    [onClosed],
  )

  const toggle = useCallback((id: FlagId) => {
    setFlags((f) => ({ ...f, [id]: !f[id] }))
  }, [])

  const openReport = useCallback((id: string) => setReportId(id), [])

  const openScreensaver = useCallback((by: ScreensaverBy) => {
    setScreensaverBy(by)
    setFlags((f) => ({ ...f, screensaver: true }))
  }, [])

  const remindLater = useCallback(() => {
    updateRemindAtRef.current = Date.now() + UPDATE_REMIND_MS
    close('updateCard')
  }, [close])

  const busy =
    BACK_ORDER.some((id) => !NOT_BUSY.includes(id) && isOpen(id)) ||
    SELF_BACK.some((id) => isOpen(id))

  const goBack = useCallback(() => {
    for (const id of BACK_ORDER) {
      if (!isOpen(id)) continue
      if (id === 'updateCard') remindLater()
      else close(id)
      return true
    }
    return false
  }, [isOpen, close, remindLater])

  return useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      busy,
      goBack,
      reportId,
      openReport,
      screensaverBy,
      openScreensaver,
      updateRemindAt,
      remindLater,
    }),
    [
      isOpen,
      open,
      close,
      toggle,
      busy,
      goBack,
      reportId,
      openReport,
      screensaverBy,
      openScreensaver,
      updateRemindAt,
      remindLater,
    ],
  )
}
