import { describe, expect, it } from 'vitest'
import { parseTrip, speedIn, usesMiles } from '../trip'

describe('trip line', () => {
  it('labels time, distance and arrival', () => {
    expect(parseTrip('12 min · 5.1 mi · 3:45 PM ETA')).toEqual([
      { kind: 'time', text: '12 min' },
      { kind: 'distance', text: '5.1 mi' },
      { kind: 'arrival', text: '3:45 PM' },
    ])
    expect(parseTrip('1 hr 5 min · 98 km · 18:20')).toEqual([
      { kind: 'time', text: '1 hr 5 min' },
      { kind: 'distance', text: '98 km' },
      { kind: 'arrival', text: '18:20' },
    ])
  })

  it('keeps what it does not recognise', () => {
    expect(parseTrip('Fastest route')).toEqual([{ kind: 'other', text: 'Fastest route' }])
    expect(parseTrip(undefined)).toEqual([])
  })

  it('reads speed in the units Maps uses', () => {
    expect(usesMiles('500 ft', 'Turn right')).toBe(true)
    expect(usesMiles('200 m', '3 km')).toBe(false)
    expect(speedIn(26.8224, true)).toBe(60)
    expect(speedIn(27.78, false)).toBe(100)
  })
})
