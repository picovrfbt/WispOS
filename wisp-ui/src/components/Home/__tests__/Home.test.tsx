import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import { Home } from '../Home'
import { __resetHomeMemory, writeHomeMemory } from '../homeMemory'
import { __resetLibraryLists } from '../useLibraryLists'

const page = (items: object[]) => HttpResponse.json({ items, total: items.length })

function setup(opts: { nowPlaying?: boolean } = {}) {
  const plays: unknown[] = []
  server.use(
    http.get('*/library/recents', () =>
      page([
        { name: 'Siamese Dream', artist: 'The Smashing Pumpkins', uri: 'spotify:album:sd' },
        { name: 'Road Trip', artist: 'me', uri: 'spotify:playlist:road' },
      ]),
    ),
    http.get('*/library/list', ({ request }) => {
      const filter = new URL(request.url).searchParams.get('filter')
      if (filter === 'artists')
        return page([{ name: 'Flume', artist: '', uri: 'spotify:artist:f' }])
      if (filter === 'albums')
        return page([{ name: 'Skin', artist: 'Flume', uri: 'spotify:album:skin' }])
      return page([{ name: 'Road Trip', artist: 'me', uri: 'spotify:playlist:road' }])
    }),
    http.get('*/library/playlist', () =>
      page([
        { name: 'Song A', artist: 'A', uri: 'spotify:track:a' },
        { name: 'Song B', artist: 'B', uri: 'spotify:track:b' },
      ]),
    ),
    http.get('*/library/liked', () =>
      page([{ name: 'Fave', artist: 'X', uri: 'spotify:track:fave' }]),
    ),
    http.post('*/player/play', async ({ request }) => {
      plays.push(await request.json())
      return HttpResponse.json({})
    }),
  )
  const onClose = vi.fn()
  const onOpenNav = vi.fn()
  const nowPlaying =
    opts.nowPlaying === false ? null : { title: 'Cherub Rock', artist: 'The Smashing Pumpkins' }
  const view = render(
    <Home nowPlaying={nowPlaying} onClose={onClose} onOpenNav={onOpenNav} notify={vi.fn()} />,
  )
  return { plays, onClose, onOpenNav, view }
}

const key = (k: string) =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })))
// the knob reports REL_HWHEEL: negative deltaX is clockwise
const turn = async (n: number) => {
  for (let i = 0; i < n; i++) {
    act(() => void window.dispatchEvent(new WheelEvent('wheel', { deltaX: n > 0 ? -1 : 1 })))
    // the dial drops notches closer together than 55ms
    await new Promise((r) => setTimeout(r, 60))
  }
}

// every test starts from a fresh home screen with nothing cached
beforeEach(() => {
  __resetHomeMemory()
  __resetLibraryLists()
})

describe('Home', () => {
  it('keeps its place when the screen under it rebuilds it', async () => {
    const { view } = setup()
    await turn(2)
    expect(await screen.findByText('Siamese Dream')).toBeInTheDocument()
    view.unmount()
    render(<Home nowPlaying={null} onClose={vi.fn()} onOpenNav={vi.fn()} notify={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Recents/ })).toHaveAttribute('aria-current', 'true')
    // straight from the kept list, no wait on a refetch
    expect(screen.getByText('Siamese Dream')).toBeInTheDocument()
  })

  it('opens on Now Playing, showing the current track as a card', () => {
    setup()
    expect(screen.getByRole('button', { name: /Now Playing/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText('Cherub Rock')).toBeInTheDocument()
  })

  it('pressing Now Playing returns to the player', () => {
    const { onClose } = setup()
    key('Enter')
    expect(onClose).toHaveBeenCalled()
  })

  it('dial moves the rail and the cards follow it', async () => {
    setup()
    await turn(2)
    expect(screen.getByRole('button', { name: /Recents/ })).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByText('Siamese Dream')).toBeInTheDocument()
  })

  it('steps into the cards and plays an album straight away', async () => {
    const { plays, onClose } = setup()
    await turn(2)
    await screen.findByText('Siamese Dream')
    key('Enter') // into the cards
    key('Enter') // play the focused card
    await waitFor(() => expect(plays).toEqual([{ uri: 'spotify:album:sd' }]))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('opens Liked Songs from Library and shuffle-plays it', async () => {
    const { plays } = setup()
    await turn(3)
    await screen.findByText('Road Trip')
    key('Enter') // into the cards, Liked Songs is pinned first
    key('Enter') // open it
    await screen.findByText('Fave')
    await turn(1) // Play -> Shuffle
    key('Enter')
    await waitFor(() =>
      expect(plays).toEqual([{ uri: 'spotify:collection:tracks', shuffle: true }]),
    )
  })

  it('plays a playlist from a tapped track', async () => {
    const { plays } = setup()
    fireEvent.click(screen.getByRole('button', { name: /Library/ }))
    fireEvent.click(await screen.findByText('Road Trip'))
    fireEvent.click(await screen.findByText('Song B'))
    await waitFor(() =>
      expect(plays).toEqual([
        { uri: 'spotify:playlist:road', skip_to_uri: 'spotify:track:b', shuffle: false },
      ]),
    )
  })

  it('back steps out of a playlist, then the cards, then closes', async () => {
    const { onClose } = setup()
    await turn(3)
    await screen.findByText('Road Trip')
    key('Enter')
    // past Liked Songs and the DJ
    await turn(2)
    key('Enter')
    await screen.findByText('Song A')
    key('Escape') // playlist -> cards
    expect(await screen.findByRole('navigation')).toBeInTheDocument()
    key('Escape') // cards -> rail
    expect(onClose).not.toHaveBeenCalled()
    key('Escape') // rail -> Now Playing
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the map from the Navigation row', async () => {
    const { onOpenNav } = setup()
    await turn(1)
    expect(screen.getByRole('button', { name: /Navigation/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByText('Phone not connected')).toBeInTheDocument()
    key('Enter')
    expect(onOpenNav).toHaveBeenCalled()
  })

  it('says so when nothing is playing', () => {
    setup({ nowPlaying: false })
    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
  })
})

describe('Home paging', () => {
  it('keeps paging when the daemon returns a short page', async () => {
    // the daemon drops folders, so a page of 50 can arrive with 49 items
    const offsets: number[] = []
    server.use(
      http.get('*/library/list', ({ request }) => {
        const url = new URL(request.url)
        // Home prefetches the next category (albums) from the same endpoint
        if (url.searchParams.get('filter') !== 'playlists') {
          return HttpResponse.json({ items: [], total: 0 })
        }
        const offset = Number(url.searchParams.get('offset'))
        offsets.push(offset)
        const items = Array.from({ length: offset === 0 ? 49 : 3 }, (_, i) => ({
          name: `PL ${offset + i}`,
          artist: 'me',
          uri: `spotify:playlist:${offset + i}`,
        }))
        return HttpResponse.json({ items, total: 53 })
      }),
      http.get('*/library/recents', () => HttpResponse.json({ items: [], total: 0 })),
    )
    render(<Home nowPlaying={null} onClose={vi.fn()} onOpenNav={vi.fn()} notify={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Library/ }))
    await screen.findByText('PL 0')
    // walk the cards toward the end so the next page is requested
    key('Enter')
    await turn(48)
    await screen.findByText('PL 50')
    expect(offsets).toEqual([0, 50])
  })
})

describe('Home with nothing active', () => {
  it('asks which device to play on, then plays there', async () => {
    const plays: Array<Record<string, unknown>> = []
    server.use(
      http.get('*/library/recents', () =>
        HttpResponse.json({
          items: [{ name: 'Siamese Dream', artist: 'SP', uri: 'spotify:album:sd' }],
          total: 1,
        }),
      ),
      http.get('*/library/list', () => HttpResponse.json({ items: [], total: 0 })),
      http.get('*/connect/devices', () =>
        HttpResponse.json({
          devices: [
            {
              id: 'phone',
              name: "Sam's Pixel 9",
              type: 'SMARTPHONE',
              is_active: false,
              is_offline: false,
              can_transfer: true,
            },
            {
              id: 'gone',
              name: 'Old Laptop',
              type: 'COMPUTER',
              is_active: false,
              is_offline: true,
              can_transfer: true,
            },
          ],
        }),
      ),
      http.post('*/player/play', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        plays.push(body)
        // only a named device works: nothing is active and nothing is remembered
        return body.device_id ? HttpResponse.json({}) : new HttpResponse(null, { status: 404 })
      }),
    )
    let woke = 0
    server.use(
      http.post('*/nav/wake-spotify', () => {
        woke++
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const onClose = vi.fn()
    render(<Home nowPlaying={null} onClose={onClose} onOpenNav={vi.fn()} notify={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Recents/ }))
    fireEvent.click(await screen.findByText('Siamese Dream'))

    expect(await screen.findByRole('dialog', { name: 'Play on' })).toBeInTheDocument()
    // and the phone was asked to wake Spotify
    expect(await screen.findByText(/Waking Spotify on your phone/)).toBeInTheDocument()
    expect(woke).toBe(1)
    // offline devices aren't offered
    expect(screen.queryByText('Old Laptop')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByText("Sam's Pixel 9"))

    await waitFor(() =>
      expect(plays).toEqual([
        { uri: 'spotify:album:sd' },
        { uri: 'spotify:album:sd', device_id: 'phone' },
      ]),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('has a Settings tab at the bottom of the rail that opens the Settings page', async () => {
    const onOpenSettings = vi.fn()
    const view = render(
      <Home
        nowPlaying={null}
        onClose={vi.fn()}
        onOpenNav={vi.fn()}
        onOpenSettings={onOpenSettings}
        notify={vi.fn()}
      />,
    )
    await turn(8)
    expect(screen.getByRole('button', { name: /^Settings$/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    key('Enter')
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    // while the page covers Home, the dial and back are the page's
    view.rerender(
      <Home
        nowPlaying={null}
        onClose={vi.fn()}
        onOpenNav={vi.fn()}
        onOpenSettings={onOpenSettings}
        covered
        notify={vi.fn()}
      />,
    )
    key('Enter')
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('opens Settings with the knob even when Home was left "in the cards"', async () => {
    // Home kept "in the cards" from another row, then reopened on Settings
    writeHomeMemory({ catIndex: 8, focus: 'cards', cardIndexes: {}, opened: null })
    const onOpenSettings = vi.fn()
    render(
      <Home
        nowPlaying={null}
        onClose={vi.fn()}
        onOpenNav={vi.fn()}
        onOpenSettings={onOpenSettings}
        notify={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^Settings$/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    key('Enter')
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('has Drive Mode and Add-ons just above Settings, and a press opens each', async () => {
    const onOpenDrive = vi.fn()
    const onOpenAddons = vi.fn()
    render(
      <Home
        nowPlaying={null}
        onClose={vi.fn()}
        onOpenNav={vi.fn()}
        onOpenDrive={onOpenDrive}
        onOpenAddons={onOpenAddons}
        notify={vi.fn()}
      />,
    )
    const rows = screen.getAllByRole('button').map((b) => b.textContent)
    expect(rows.indexOf('Drive Mode') + 1).toBe(rows.indexOf('Add-ons'))
    expect(rows.indexOf('Add-ons') + 1).toBe(rows.indexOf('Settings'))
    await turn(6)
    expect(screen.getByRole('button', { name: /^Drive Mode$/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    key('Enter')
    expect(onOpenDrive).toHaveBeenCalledTimes(1)
    await turn(1)
    expect(screen.getByRole('button', { name: /^Add-ons$/ })).toHaveAttribute('aria-current', 'true')
    key('Enter')
    expect(onOpenAddons).toHaveBeenCalledTimes(1)
  })

  it('pins the DJ beside Liked Songs, and a press plays it rather than listing it', async () => {
    const { plays } = setup()
    await turn(3)
    await screen.findByText('Road Trip')
    key('Enter')
    await turn(1)
    expect(screen.getByText('Picks and talks you through')).toBeInTheDocument()
    key('Enter')
    await waitFor(() => expect(plays).toEqual([{ uri: 'spotify:playlist:37i9dQZF1EYkqdzj48dyYq' }]))
  })
})
