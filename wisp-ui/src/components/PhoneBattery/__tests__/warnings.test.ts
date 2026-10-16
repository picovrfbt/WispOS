import { describe, expect, it } from 'vitest'
import { batteryWarning } from '../warnings'

describe('phone battery warnings', () => {
  it('warns at 15% and at 5%, once each', () => {
    let said: number | null = null
    const says: string[] = []
    for (const level of [30, 20, 15, 14, 12, 8, 5, 4, 3]) {
      const w = batteryWarning(level, false, said)
      said = w.said
      if (w.say) says.push(w.say)
    }
    expect(says).toEqual(['Phone at 15%: plug it in', 'Phone at 5% and not charging'])
  })

  it('says nothing while charging, and warns again after a charge', () => {
    expect(batteryWarning(10, true, null).say).toBeNull()
    // charged back up past 20%: the next drop warns again
    const reset = batteryWarning(25, false, 15)
    expect(reset.said).toBeNull()
    expect(batteryWarning(15, false, reset.said).say).toMatch(/15%/)
  })

  it('a phone already very low says the very-low warning first', () => {
    expect(batteryWarning(4, false, null).say).toBe('Phone at 4% and not charging')
  })
})
