import { beforeEach, describe, expect, it } from 'vitest'
import { __resetSettings } from '@/settings'
import { cyclePreset, describePreset, getPreset, setPreset } from '@/presets'

describe('preset buttons', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetSettings()
  })

  it('defaults to Liked Songs, Map, Home, Voice', () => {
    expect([1, 2, 3, 4].map((i) => describePreset(getPreset(i)))).toEqual([
      'Liked Songs',
      'Map',
      'Home',
      'Voice',
    ])
  })

  it('keeps presets saved before actions existed working as playlists', () => {
    // the shape older builds stored, with no action field
    setPreset(2, { contextUri: 'spotify:playlist:abc', label: 'Road Trip' })
    expect(getPreset(2)?.action).toBeUndefined()
    expect(describePreset(getPreset(2))).toBe('Road Trip')
  })

  it('cycles a playlist button through the actions and back to its playlist', () => {
    setPreset(2, { contextUri: 'spotify:playlist:abc', label: 'Road Trip' })
    const seen: string[] = []
    for (let i = 0; i < 9; i++) seen.push(describePreset(cyclePreset(2)))
    expect(seen).toEqual([
      'Home',
      'Map',
      'Voice',
      'Drive Mode',
      'Play / Pause',
      'Next track',
      'Previous track',
      'Like song',
      'Road Trip',
    ])
  })

  it('cycles an action-only button through the actions without an empty stop', () => {
    // button 3 defaults to Home with no playlist behind it
    expect(describePreset(cyclePreset(3))).toBe('Map')
    for (let i = 0; i < 7; i++) cyclePreset(3)
    expect(describePreset(getPreset(3))).toBe('Home')
  })
})
