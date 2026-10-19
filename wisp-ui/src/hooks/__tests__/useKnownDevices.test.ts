import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { KnownBluetoothDevice } from '@/api/types'

const api = vi.hoisted(() => ({ listKnownDevices: vi.fn() }))
vi.mock('@/api/bluetooth', () => api)
vi.mock('@/api/eventBus', () => ({ subscribeEvents: () => () => {} }))

import { useKnownDevices } from '../useKnownDevices'

const phone = { address: 'AA', name: 'S24' } as KnownBluetoothDevice

describe('useKnownDevices', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("asks again when Bluetooth wasn't up yet at boot", async () => {
    api.listKnownDevices.mockRejectedValueOnce(new Error('503')).mockResolvedValue([phone])
    const { result } = renderHook(() => useKnownDevices(true))
    await act(async () => {})
    expect(result.current.devices).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(result.current.devices).toEqual([phone])
    expect(api.listKnownDevices).toHaveBeenCalledTimes(2)
  })
})
