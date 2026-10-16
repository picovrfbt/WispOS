import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { describeTrip, endedAtDestination, useArrival } from '../useArrival'
import type { NavState } from '@/api/nav'

const turn = (over: Partial<NavState>): NavState => ({
  connected: true,
  active: true,
  title: '500 ft',
  text: 'Turn right onto Main St',
  sub_text: '12 min · 5.1 mi · 3:45 PM',
  updated_at: 1_000_000,
  ...over,
})

describe('arrival', () => {
  it('tells arriving from giving up', () => {
    expect(endedAtDestination(turn({ sub_text: '1 min · 0.1 mi · 3:45 PM' }))).toBe(true)
    expect(endedAtDestination(turn({ sub_text: '3 min · 250 m · 15:45' }))).toBe(true)
    expect(endedAtDestination(turn({ text: 'Your destination is on the right' }))).toBe(true)
    expect(endedAtDestination(turn({}))).toBe(false)
  })

  it('reports an arrival once directions end near the destination', () => {
    const start = turn({ updated_at: 1_000_000 })
    const { result, rerender } = renderHook(({ nav }) => useArrival(nav), {
      initialProps: { nav: start },
    })
    rerender({ nav: turn({ sub_text: '1 min · 0.2 mi · 3:45 PM', updated_at: 2_000_000 }) })
    expect(result.current.arrival).toBeNull()
    rerender({ nav: { connected: true, active: false, updated_at: 2_380_000 } })
    expect(result.current.arrival).toEqual({ at: 2_380_000, tripMin: 23 })
  })

  it('says nothing when directions are cancelled or the phone drops', () => {
    const { result, rerender } = renderHook(({ nav }) => useArrival(nav), {
      initialProps: { nav: turn({}) },
    })
    rerender({ nav: { connected: true, active: false, updated_at: 5 } })
    expect(result.current.arrival).toBeNull()

    rerender({ nav: turn({ sub_text: '1 min · 0.1 mi' }) })
    rerender({ nav: { connected: false, active: false, updated_at: 6 } })
    expect(result.current.arrival).toBeNull()
  })

  it('words the card in local time', () => {
    // 19:45 UTC at UTC-4
    const at = Date.parse('2026-10-10T19:45:00Z')
    expect(describeTrip({ at, tripMin: 83 }, -240)).toBe('Arrived at 3:45 PM · 1 hr 23 min trip')
    expect(describeTrip({ at, tripMin: null }, 0)).toBe('Arrived at 7:45 PM')
  })
})
