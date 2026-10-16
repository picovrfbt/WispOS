import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSettings, getSettings } from '@/settings'
import { useSettingsRestore } from '../useSettingsRestore'

const listeners: Array<(evt: { type: string; data?: unknown }) => void> = []
vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (fn: (evt: { type: string; data?: unknown }) => void) => {
    listeners.push(fn)
    return () => listeners.splice(listeners.indexOf(fn), 1)
  },
}))

const send = (type: string) => act(() => listeners.forEach((l) => l({ type })))

beforeEach(() => {
  localStorage.clear()
  __resetSettings()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ v: 1, brightness: 9, autoBrightness: false }), { status: 200 }),
  )
})
afterEach(() => vi.restoreAllMocks())

describe('settings the daemon took from the phone', () => {
  it('takes a change from the phone quietly', async () => {
    const notify = vi.fn()
    renderHook(() => useSettingsRestore(notify))
    send('settings/changed')
    await waitFor(() => expect(getSettings().brightness).toBe(9))
    expect(getSettings().autoBrightness).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('says so when the backup came back after a reflash', async () => {
    const notify = vi.fn()
    renderHook(() => useSettingsRestore(notify))
    send('settings/restored')
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Settings restored from your phone', { icon: 'success' }),
    )
  })
})
