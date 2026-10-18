import { beforeEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLastTrack } from '../useLastTrack'
import { activeStatus } from '../../__tests__/fixtures/observer'
import type { ObserverStatus } from '@/api/types'

const idle: ObserverStatus = { active: false, message: 'no session' }

describe('useLastTrack', () => {
  beforeEach(() => window.localStorage.clear())

  const render = (status: ObserverStatus | null) =>
    renderHook(({ s }) => useLastTrack(s), { initialProps: { s: status } })

  it('has nothing to offer on a first boot', () => {
    expect(render(null).result.current).toBeNull()
  })

  it('keeps the last song once playback stops', () => {
    const playing = {
      ...activeStatus,
      track_name: 'Song',
      track_artist: 'Band',
      track_image: 'https://art/one',
    }
    const { result, rerender } = render(playing)
    rerender({ s: idle })
    expect(result.current).toEqual({ title: 'Song', artist: 'Band', image: 'https://art/one' })
  })

  it('survives a restart', () => {
    render({ ...activeStatus, track_name: 'Song', track_artist: 'Band', track_image: '' })
    expect(render(idle).result.current?.title).toBe('Song')
  })

  it('ignores a damaged memory', () => {
    window.localStorage.setItem('wisp.lastTrack', '{oops')
    expect(render(idle).result.current).toBeNull()
  })
})
