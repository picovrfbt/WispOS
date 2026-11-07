import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Planner } from '../Planner'
import { pushFind } from '../navFind'

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

    knob(60) // past Search to Gas
    press()
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
    for (let i = 0; i < 7; i++) knob(60) // past Search and the six kinds to the recent place
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

  it('types an address with the keys and picks a match', async () => {
    render(<Planner location={undefined} onClose={() => {}} />)
    await settle()
    press() // Search
    await settle()
    expect(screen.getByText('An address or a place')).toBeInTheDocument()
    for (const k of ['O', 'A', 'K', 'Space', 'S', 'Delete', 'S', 'T'])
      fireEvent.click(screen.getByRole('button', { name: k }))
    expect(screen.getByText('OAK ST')).toBeInTheDocument()
    // looked up once typing stops
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })
    expect(api.searchPlaces).toHaveBeenCalledWith({ q: 'OAK ST' })
    fireEvent.click(screen.getByText('Chevron'))
    await settle()
    expect(api.planRoutes).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chevron' }), {
      highways: false,
      tolls: false,
    })
    // back to the keyboard, with what was typed
    back()
    expect(screen.getByText('OAK ST')).toBeInTheDocument()
    back()
    expect(screen.getByText('Where to?')).toBeInTheDocument()
  })

  it('the knob types too, and goes round from A back to the matches', async () => {
    render(<Planner location={undefined} onClose={() => {}} />)
    await settle()
    press() // Search
    knob(60)
    press() // B
    knob(-60)
    press() // A
    knob(60)
    knob(60)
    press() // C
    expect(screen.getByText('BAC')).toBeInTheDocument()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })
    expect(screen.getByText('Shell')).toBeInTheDocument()
    knob(-60)
    knob(-60) // from C: B, A
    knob(-60) // round to the last match
    press()
    await settle()
    expect(api.planRoutes).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Chevron' }),
      expect.anything(),
    )
  })

  it('opens on a place sent from the phone or said', async () => {
    pushFind({
      q: '12 Oak Street',
      places: [{ name: '12 Oak Street', address: 'Long Beach', lat: 1, lng: 1 }],
    })
    render(<Planner location={undefined} onClose={() => {}} />)
    await settle()
    expect(screen.getByText('“12 Oak Street”')).toBeInTheDocument()
    expect(screen.getByText('Long Beach')).toBeInTheDocument()
    expect(api.searchPlaces).not.toHaveBeenCalled()
    // typed in the Wisp app while it's open: looked up here
    act(() => pushFind({ q: 'pier' }))
    await settle()
    expect(api.searchPlaces).toHaveBeenCalledWith({ q: 'pier' })
    expect(screen.getByText('Shell')).toBeInTheDocument()
  })
})
