import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../__tests__/msw-server'
import { PHONE_PAUSED_LIMIT_MS, usePhoneMedia } from '../usePhoneMedia'
import type { PhoneMedia } from '@/api/phoneMedia'

const song = (playing: boolean): PhoneMedia => ({
  present: true,
  app: 'com.google.android.youtube',
  title: 'Midnight City',
  playing,
  position_ms: 0,
  position_at: 1,
  duration_ms: 240_000,
  updated_at: 1,
})

afterEach(() => vi.useRealTimers())

async function shown(playing: boolean) {
  server.use(http.get('*/phone/media', () => HttpResponse.json(song(playing))))
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const { result } = renderHook(() => usePhoneMedia())
  await vi.waitFor(() => expect(result.current.present).toBe(true))
  return result
}

describe('usePhoneMedia', () => {
  it('lets go of something left paused on the phone', async () => {
    const result = await shown(false)
    act(() => void vi.advanceTimersByTime(PHONE_PAUSED_LIMIT_MS - 1000))
    expect(result.current.present).toBe(true)
    act(() => void vi.advanceTimersByTime(2000))
    expect(result.current.present).toBe(false)
  })

  it('keeps something playing however long it plays', async () => {
    const result = await shown(true)
    act(() => void vi.advanceTimersByTime(PHONE_PAUSED_LIMIT_MS * 3))
    expect(result.current.present).toBe(true)
  })
})
