import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import type { NavState } from '@/api/nav'

const bus = vi.hoisted(() => ({
  listeners: [] as Array<(evt: { type: string; data: unknown }) => void>,
}))

vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (fn: (evt: { type: string; data: unknown }) => void) => {
    bus.listeners.push(fn)
    return () => {
      bus.listeners.splice(bus.listeners.indexOf(fn), 1)
    }
  },
  subscribeConnection: () => () => {},
}))

// leaflet needs real layout; the map itself is covered on the simulator
vi.mock('../NavMap', () => ({
  NavMap: ({ location }: { location?: { lat: number } }) => (
    <div data-testid="nav-map">{location ? `at ${location.lat}` : 'no fix'}</div>
  ),
}))

import { NavProvider } from '@/hooks/NavProvider'
import { NavBanner } from '../NavBanner'
import { NavScreen } from '../NavScreen'
import { distanceMetres, zoomFor, zoomForSpeed } from '../zoom'

const TURN: NavState = {
  connected: true,
  active: true,
  title: '500 ft',
  text: 'Turn right onto Main St',
  sub_text: '12 min · 5.1 mi · 3:45 PM',
  updated_at: 1,
}

function withStatus(status: NavState) {
  server.use(http.get('*/nav/status', () => HttpResponse.json(status)))
}

const emit = (type: string, data: unknown) =>
  act(() => bus.listeners.forEach((fn) => fn({ type, data })))

describe('NavScreen', () => {
  it('explains setup while the phone is not connected', async () => {
    withStatus({ connected: false, active: false, updated_at: 0 })
    render(
      <NavProvider>
        <NavScreen onClose={vi.fn()} nowPlaying={null} />
      </NavProvider>,
    )
    expect(await screen.findByText('Needs the Wisp app')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-map')).not.toBeInTheDocument()
  })

  it('shows the turn and follows location events', async () => {
    withStatus(TURN)
    render(
      <NavProvider>
        <NavScreen onClose={vi.fn()} nowPlaying={{ title: 'Song', artist: 'Band' }} />
      </NavProvider>,
    )
    expect(await screen.findByText('500 ft')).toBeInTheDocument()
    expect(screen.getByText('Turn right onto Main St')).toBeInTheDocument()
    expect(screen.getByText('Song')).toBeInTheDocument()
    emit('nav/location', { lat: 40.5, lng: -74, bearing: 0, speed: 10, accuracy: 5 })
    expect(screen.getByTestId('nav-map')).toHaveTextContent('at 40.5')
    emit('nav', { ...TURN, title: '200 ft' })
    expect(screen.getByText('200 ft')).toBeInTheDocument()
    // a new turn keeps the fix it had
    expect(screen.getByTestId('nav-map')).toHaveTextContent('at 40.5')
  })

  it('closes from its back button', async () => {
    withStatus(TURN)
    const onClose = vi.fn()
    render(
      <NavProvider>
        <NavScreen onClose={onClose} nowPlaying={null} />
      </NavProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('NavBanner', () => {
  it('appears only while navigating and opens the map', async () => {
    withStatus({ connected: true, active: false, updated_at: 0 })
    const onOpen = vi.fn()
    render(
      <NavProvider>
        <NavBanner hidden={false} onOpen={onOpen} />
      </NavProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
    emit('nav', TURN)
    fireEvent.click(await screen.findByRole('button', { name: 'Open navigation' }))
    expect(onOpen).toHaveBeenCalled()
  })

  it('stays out of the way when told to', async () => {
    withStatus(TURN)
    render(
      <NavProvider>
        <NavBanner hidden onOpen={vi.fn()} />
      </NavProvider>,
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()
  })
})

describe('zoomForSpeed', () => {
  it('zooms out as speed rises', () => {
    expect(zoomForSpeed(3)).toBe(17)
    expect(zoomForSpeed(15)).toBe(16)
    expect(zoomForSpeed(30)).toBe(15)
  })
})

describe('zoomFor', () => {
  it('zooms out with speed and in on a coming turn', () => {
    expect(zoomFor(0)).toBeGreaterThan(zoomFor(30))
    expect(zoomFor(30, 50)).toBeGreaterThan(zoomFor(30, 450))
    expect(zoomFor(30, 2000)).toBe(zoomFor(30))
  })
  it('sits closer in 3D and takes the driver nudge', () => {
    expect(zoomFor(10, null, '3d')).toBeGreaterThan(zoomFor(10, null, 'north'))
    expect(zoomFor(10, null, 'north', 1)).toBe(zoomFor(10, null, 'north') + 1)
    expect(zoomFor(0, 0, '3d', 9)).toBe(19)
  })
  it('reads turn distances', () => {
    expect(distanceMetres('500 ft')).toBeCloseTo(152.4)
    expect(distanceMetres('0.3 mi')).toBeCloseTo(482.8, 0)
    expect(distanceMetres('200 m')).toBe(200)
    expect(distanceMetres('1,2 km')).toBe(1200)
    expect(distanceMetres('Turn left')).toBeNull()
  })
})
