import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Planner } from '../Planner'

const api = vi.hoisted(() => ({
  fetchRecentPlaces: vi.fn(async () => [
    { name: 'The Beach Café', address: '1200 Ocean Blvd', lat: 1, lng: 1, distance_m: 8200 },
  ]),
  searchPlaces: vi.fn(async () => [
    {
      name: 'Shell',
      address: '700 Atlantic Ave',
      lat: 1,
      lng: 1,
      distance_m: 1900,
      open: 'Open 24 hours',
    },
    { name: 'Chevron', address: '1801 E Anaheim St', lat: 1, lng: 1, distance_m: 3200 },
  ]),
  planRoutes: vi.fn(async () => [
    { duration_s: 720, distance_m: 8200, via: 'Ocean Blvd', points: [] },
    { duration_s: 900, distance_m: 7400, via: 'Pine Ave', points: [] },
  ]),
  startRoute: vi.fn(async () => {}),
}))
vi.mock('@/api/nav', () => api)
// the map needs a real browser
vi.mock('../NavMap', () => ({ NavMap: () => <div data-testid="map" /> }))

const knob = (d: number) => fireEvent.wheel(window, { deltaY: d })
const press = () => fireEvent.keyDown(window, { key: 'Enter' })
const back = () => fireEvent.keyDown(window, { key: 'Escape' })
const settle = () => act(async () => {})

describe('Planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // the knob ignores turns closer together than the hardware's; the clock moves on for each
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 100))
  })

  it('goes from a kind of place to its routes and starts one', async () => {
    const onClose = vi.fn()
    render(<Planner location={undefined} onClose={onClose} />)
    await settle()
    expect(screen.getByText('Where to?')).toBeInTheDocument()
    expect(screen.getByText('The Beach Café')).toBeInTheDocument()

    press() // Gas
    await settle()
    expect(api.searchPlaces).toHaveBeenCalledWith({ cat: 'gas' })
    expect(screen.getByText('Shell')).toBeInTheDocument()
    expect(screen.getByText('· Open 24 hours')).toBeInTheDocument()

    knob(60) // Chevron
    press()
    await settle()
    expect(api.planRoutes).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chevron' }), {
      highways: false,
      tolls: false,
    })
    expect(screen.getByText('Fastest')).toBeInTheDocument()
    expect(screen.getByText('4.6 mi · via Pine Ave')).toBeInTheDocument()

    // the second route, then on past the avoid options to Start
    knob(60)
    knob(60)
    knob(60)
    knob(60)
    press()
    await settle()
    expect(api.startRoute).toHaveBeenCalledWith(1, false)

    // back to the results, then Where to, then out
    back()
    expect(screen.getByText('Shell')).toBeInTheDocument()
    back()
    expect(screen.getByText('Where to?')).toBeInTheDocument()
    back()
    expect(onClose).toHaveBeenCalled()
  })

  it('re-plans when an avoid option is pressed', async () => {
    render(<Planner location={undefined} onClose={() => {}} />)
    await settle()
    for (let i = 0; i < 6; i++) knob(60) // past the six kinds to the recent place
    press()
    await settle()
    knob(60)
    knob(60) // Avoid highways
    press()
    await settle()
    expect(api.planRoutes).toHaveBeenLastCalledWith(expect.anything(), {
      highways: true,
      tolls: false,
    })
  })
})
