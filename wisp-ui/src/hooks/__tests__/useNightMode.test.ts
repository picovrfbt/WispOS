import { describe, expect, it } from 'vitest'
import { isNightAt, nightActive } from '../useNightMode'

const at = (isoUtc: string) => Date.parse(isoUtc)

describe('night mode', () => {
  it('reads the hour on the phone clock, not the Car Thing UTC one', () => {
    // 01:00 UTC is 21:00 the evening before at UTC-4
    expect(isNightAt(at('2026-10-10T01:00:00Z'), -240)).toBe(true)
    // 13:00 UTC is 09:00 at UTC-4
    expect(isNightAt(at('2026-10-10T13:00:00Z'), -240)).toBe(false)
    // 7pm starts it, 7am ends it
    expect(isNightAt(at('2026-10-10T19:00:00Z'), 0)).toBe(true)
    expect(isNightAt(at('2026-10-10T07:00:00Z'), 0)).toBe(false)
  })

  it('has no opinion without a time zone', () => {
    expect(isNightAt(Date.now(), null)).toBeNull()
  })

  it('auto only dims when it knows it is night', () => {
    expect(nightActive('on', false)).toBe(true)
    expect(nightActive('off', true)).toBe(false)
    expect(nightActive('auto', true)).toBe(true)
    expect(nightActive('auto', null)).toBe(false)
  })
})
