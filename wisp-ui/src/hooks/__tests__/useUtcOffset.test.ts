import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { formatUtcOffset, useUtcOffset } from '../useUtcOffset'
import { NavContext } from '../navContext'
import { NAV_IDLE, type NavState } from '@/api/nav'
import type { ObserverStatus } from '@/api/types'

const withNav =
  (nav: NavState) =>
  ({ children }: { children: ReactNode }) =>
    createElement(NavContext.Provider, { value: nav }, children)

const status = (off: number) => ({ utc_offset_min: off }) as unknown as ObserverStatus

describe('your time zone', () => {
  beforeEach(() => localStorage.clear())

  it("prefers the phone's own zone over anything else", () => {
    const { result } = renderHook(() => useUtcOffset(status(60)), {
      wrapper: withNav({ ...NAV_IDLE, tz_offset_min: -240 }),
    })
    expect(result.current).toBe(-240)
  })

  it('falls back to what the daemon kept, then to the last value seen', () => {
    const daemon = renderHook(() => useUtcOffset(status(-300)), { wrapper: withNav(NAV_IDLE) })
    expect(daemon.result.current).toBe(-300)
    daemon.unmount()
    // a fresh boot before the daemon or phone answer: the remembered one
    const boot = renderHook(() => useUtcOffset(null), { wrapper: withNav(NAV_IDLE) })
    expect(boot.result.current).toBe(-300)
  })

  it('knows nothing on a first boot with no phone', () => {
    const { result } = renderHook(() => useUtcOffset(null), { wrapper: withNav(NAV_IDLE) })
    expect(result.current).toBeNull()
  })

  it('reads like a time zone', () => {
    expect(formatUtcOffset(-240)).toBe('UTC−4')
    expect(formatUtcOffset(330)).toBe('UTC+5:30')
    expect(formatUtcOffset(0)).toBe('UTC+0')
  })
})
