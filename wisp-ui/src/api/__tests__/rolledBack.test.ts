import { describe, expect, it } from 'vitest'
import { rolledBackMessage } from '../update'

describe('an undone update', () => {
  it('says which version it went back to', () => {
    expect(rolledBackMessage({ from: 'v0.2.24', to: 'v0.2.23', why: 'kept crashing', at: 1 })).toBe(
      "v0.2.24 didn't start properly, so Wisp went back to v0.2.23",
    )
  })

  it('names the USB version when there was no update before', () => {
    expect(rolledBackMessage({ from: 'v0.2.24', to: '', why: 'x', at: 1 })).toMatch(
      /went back to the version installed over USB/,
    )
  })
})
