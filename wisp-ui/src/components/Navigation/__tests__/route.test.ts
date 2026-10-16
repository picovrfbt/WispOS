import { describe, expect, it } from 'vitest'
import { remainingRoute } from '../route'

// a road east along a line of latitude, then north
const road: [number, number][] = [
  [33.77, -118.2],
  [33.77, -118.19],
  [33.77, -118.18],
  [33.78, -118.18],
]

describe('the route from the car on', () => {
  it('starts under the car and keeps what is ahead', () => {
    const out = remainingRoute(road, [33.7701, -118.185])
    expect(out).toHaveLength(3)
    expect(out[0][0]).toBeCloseTo(33.77, 4)
    expect(out[0][1]).toBeCloseTo(-118.185, 4)
    expect(out.slice(1)).toEqual([road[2], road[3]])
  })

  it('keeps the whole line while the car is off it', () => {
    expect(remainingRoute(road, [33.8, -118.3])).toBe(road)
  })

  it('keeps the whole line before the first fix', () => {
    expect(remainingRoute(road, null)).toBe(road)
  })

  it('past the end, only the last point is left to draw to', () => {
    const out = remainingRoute(road, [33.78, -118.18])
    expect(out[out.length - 1]).toEqual(road[3])
    expect(out.length).toBeLessThanOrEqual(2)
  })
})
