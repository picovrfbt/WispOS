import { afterEach, describe, expect, it } from 'vitest'
import { __resetSettings, getSettings } from '@/settings'

const KEY = 'wisp.settings.v1'

describe("Wisp's voice defaults", () => {
  afterEach(() => localStorage.clear())

  it('starts on, Confirmations at 1.1x', () => {
    localStorage.clear()
    __resetSettings()
    expect(getSettings().wispVoice).toBe('confirmations')
    expect(getSettings().voiceSpeed).toBe(1.1)
  })

  it('moves untouched old settings (off at 1x) once', () => {
    localStorage.setItem(KEY, JSON.stringify({ wispVoice: 'off', voiceSpeed: 1 }))
    __resetSettings()
    expect(getSettings()).toMatchObject({
      wispVoice: 'confirmations',
      voiceSpeed: 1.1,
      voiceDefaultsOn: true,
    })
  })

  it('leaves a voice someone set, and off after the move stays off', () => {
    localStorage.setItem(KEY, JSON.stringify({ wispVoice: 'everything', voiceSpeed: 1.4 }))
    __resetSettings()
    expect(getSettings()).toMatchObject({ wispVoice: 'everything', voiceSpeed: 1.4 })
    localStorage.setItem(
      KEY,
      JSON.stringify({ wispVoice: 'off', voiceSpeed: 1, voiceDefaultsOn: true }),
    )
    __resetSettings()
    expect(getSettings().wispVoice).toBe('off')
  })
})
