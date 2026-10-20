import { describe, expect, it } from 'vitest'
import { bannerUp, nearTurn, noteTurn, turnKey, type TurnMemory } from '../turnBanner'

const fresh = (): TurnMemory => ({ key: '', since: 0, nearSince: 0, dismissed: '' })

describe('turn banner', () => {
  it('knows a turn through its countdown and rewording', () => {
    const icon = 'data:image/png;base64,AAAA'
    expect(turnKey({ text: 'Turn right in 500 ft', icon })).toBe(
      turnKey({ text: 'Turn right in 200 ft', icon }),
    )
    expect(turnKey({ text: 'Turn right onto Main St', icon })).not.toBe(
      turnKey({ text: 'Turn left onto Oak Ave', icon }),
    )
  })

  it('tells when the turn is close', () => {
    expect(nearTurn('500 ft')).toBe(true)
    expect(nearTurn('0.1 mi')).toBe(true)
    expect(nearTurn('0.5 mi')).toBe(false)
    expect(nearTurn('150 m')).toBe(true)
    expect(nearTurn('1.2 km')).toBe(false)
    expect(nearTurn(undefined)).toBe(false)
  })

  it('shows for 5 seconds, again near the turn, and anew for the next turn', () => {
    const m = fresh()
    noteTurn(m, 'a', false, 0)
    expect(bannerUp(m, 'a', 5, 4_900)).toBe(true)
    expect(bannerUp(m, 'a', 5, 5_100)).toBe(false)
    noteTurn(m, 'a', true, 60_000)
    expect(bannerUp(m, 'a', 5, 63_000)).toBe(true)
    // nearing again doesn't keep it up
    noteTurn(m, 'a', true, 66_000)
    expect(bannerUp(m, 'a', 5, 66_000)).toBe(false)
    noteTurn(m, 'b', false, 90_000)
    expect(bannerUp(m, 'b', 5, 91_000)).toBe(true)
  })

  it('stays up until the turn when set to', () => {
    const m = fresh()
    noteTurn(m, 'a', false, 0)
    expect(bannerUp(m, 'a', 0, 600_000)).toBe(true)
  })

  it('swiped away, stays away until the next turn', () => {
    const m = fresh()
    noteTurn(m, 'a', false, 0)
    m.dismissed = 'a'
    noteTurn(m, 'a', true, 30_000)
    expect(bannerUp(m, 'a', 5, 31_000)).toBe(false)
    noteTurn(m, 'b', false, 60_000)
    expect(bannerUp(m, 'b', 5, 61_000)).toBe(true)
  })
})
