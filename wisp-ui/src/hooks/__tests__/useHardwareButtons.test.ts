import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHardwareButtons, type UseHardwareButtonsParams } from '../useHardwareButtons'
import { activeStatus } from '@/__tests__/fixtures/observer'
import { __resetSettings } from '@/settings'
import { getVolumeOverlay } from '../volumeOverlayStore'
import { setPreset } from '@/presets'

function params(over: Partial<UseHardwareButtonsParams> = {}): UseHardwareButtonsParams {
  return {
    status: null,
    onPlayPause: vi.fn(),
    setVolume: vi.fn(),
    playContext: vi.fn(),
    inDJSet: false,
    djNarrating: false,
    onDJSignal: vi.fn(),
    onBack: vi.fn(),
    onTogglePowerMenu: vi.fn(),
    onScreensaver: vi.fn(),
    onOpenDebug: vi.fn(),
    notify: vi.fn(),
    ...over,
  }
}

// the power button is KeyM; a press is a keydown/keyup pair
function press() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyM' }))
  })
}

describe('useHardwareButtons power button', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

  it('opens the power menu on a single press', () => {
    const p = params()
    renderHook(() => useHardwareButtons(p))

    press()
    expect(p.onTogglePowerMenu).not.toHaveBeenCalled() // still waiting on a second
    advance(400)
    expect(p.onTogglePowerMenu).toHaveBeenCalledTimes(1)
    expect(p.onScreensaver).not.toHaveBeenCalled()
  })

  it('opens the screensaver on a double press', () => {
    const p = params()
    renderHook(() => useHardwareButtons(p))

    press()
    press()
    advance(400)
    expect(p.onScreensaver).toHaveBeenCalledTimes(1)
    expect(p.onTogglePowerMenu).not.toHaveBeenCalled()
  })

  // the observer polls every 3s and App rebuilds these handlers inline, so a
  // re-render lands mid-gesture routinely
  it('survives a re-render between the two presses', () => {
    const { rerender } = renderHook((p: UseHardwareButtonsParams) => useHardwareButtons(p), {
      initialProps: params(),
    })

    press()
    const second = params()
    rerender(second)
    press()
    advance(400)

    expect(second.onScreensaver).toHaveBeenCalledTimes(1)
    expect(second.onTogglePowerMenu).not.toHaveBeenCalled()
  })

  it('calls the handlers it was last given, not the ones it mounted with', () => {
    const { rerender } = renderHook((p: UseHardwareButtonsParams) => useHardwareButtons(p), {
      initialProps: params(),
    })

    const latest = params()
    rerender(latest)
    press()
    advance(400)

    expect(latest.onTogglePowerMenu).toHaveBeenCalledTimes(1)
  })
})

// holding a preset for 2s saves the current context to that slot; the effect's
// cleanup clears that timer, so a re-render mid-hold used to cancel the save
describe('useHardwareButtons preset buttons', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
  const hold = (up: boolean) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent(up ? 'keyup' : 'keydown', { code: 'Digit2' }))
    })

  const playing = {
    ...activeStatus,
    context_uri: 'spotify:playlist:abc',
    context_name: 'Road Trip',
  }

  it('saves the playing context when a slot is held through a re-render', () => {
    const { rerender } = renderHook((x: UseHardwareButtonsParams) => useHardwareButtons(x), {
      initialProps: params({ status: playing }),
    })

    hold(false)
    advance(1000)
    const latest = params({ status: playing })
    rerender(latest)
    advance(1000)
    hold(true)

    expect(latest.notify).toHaveBeenCalledWith(
      expect.stringContaining('to preset 2'),
      expect.objectContaining({ variant: 'success' }),
    )
  })
})

describe('useHardwareButtons volume on a device that cannot take it', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const turn = () =>
    act(() => {
      window.dispatchEvent(new WheelEvent('wheel', { deltaX: 1 }))
      vi.advanceTimersByTime(60)
    })

  it('flashes the overlay once, then holds still while the knob keeps spinning', async () => {
    const setVolume = vi.fn(() => Promise.reject(new Error('no volume control')))
    const p = params({ status: { ...activeStatus, volume_disabled: true }, setVolume })
    renderHook(() => useHardwareButtons(p))

    turn()
    expect(getVolumeOverlay().visible).toBe(true)
    await act(async () => {})
    expect(getVolumeOverlay().visible).toBe(false)

    for (let i = 0; i < 5; i++) turn()
    expect(getVolumeOverlay().visible).toBe(false)
    expect(setVolume).toHaveBeenCalledTimes(1)
    expect(p.notify).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(4000))
    turn()
    expect(getVolumeOverlay().visible).toBe(true)
    expect(setVolume).toHaveBeenCalledTimes(2)
  })
})

describe('useHardwareButtons button actions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // presets persist to storage, and an earlier test saves one
    window.localStorage.clear()
    __resetSettings()
  })
  afterEach(() => vi.useRealTimers())

  const tap = (code: string) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code }))
      window.dispatchEvent(new KeyboardEvent('keyup', { code }))
    })

  it('runs the default actions: 2 Map, 3 Home, 4 Voice', () => {
    const onButtonAction = vi.fn()
    renderHook(() => useHardwareButtons(params({ onButtonAction })))
    tap('Digit2')
    tap('Digit3')
    tap('Digit4')
    expect(onButtonAction.mock.calls.map((c) => c[0])).toEqual(['map', 'home', 'voice'])
  })

  it('still plays button 1 (Liked Songs) rather than running an action', () => {
    const onButtonAction = vi.fn()
    const p = params({ onButtonAction })
    renderHook(() => useHardwareButtons(p))
    tap('Digit1')
    expect(p.playContext).toHaveBeenCalledWith('spotify:collection:tracks')
    expect(onButtonAction).not.toHaveBeenCalled()
  })

  it('says how to fill an empty button instead of doing nothing', () => {
    setPreset(3, { contextUri: null, label: 'Preset 3' })
    const p = params()
    renderHook(() => useHardwareButtons(p))
    tap('Digit3')
    expect(p.notify).toHaveBeenCalledWith(
      expect.stringContaining('Button 3 is empty'),
      expect.anything(),
    )
  })
})
