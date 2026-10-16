import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import { Home } from '../Home'
import { __resetHomeMemory } from '../homeMemory'
import { __resetLibraryLists } from '../useLibraryLists'
import { NavContext } from '@/hooks/navContext'
import { NAV_IDLE, type NavState } from '@/api/nav'

const nav: NavState = {
  ...NAV_IDLE,
  connected: true,
  services: [
    {
      id: 'ytmusic',
      name: 'YouTube Music',
      enabled: true,
      signed_in: true,
      sections: [
        { id: 'liked', name: 'Liked music' },
        { id: 'playlists', name: 'Playlists' },
      ],
    },
  ],
}

const key = (k: string) =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })))
const turn = async (n: number) => {
  for (let i = 0; i < n; i++) {
    act(() => void window.dispatchEvent(new WheelEvent('wheel', { deltaX: -1 })))
    await new Promise((r) => setTimeout(r, 60))
  }
}

function setup() {
  const browsed: string[] = []
  const played: unknown[] = []
  server.use(
    http.get('*/services/ytmusic/browse', ({ request }) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      browsed.push(id)
      if (id === 'playlists') {
        return HttpResponse.json({
          items: [{ name: 'Late Night Drive', sub: 'Playlist', id: 'VLPL1', playlist: 'PL1' }],
        })
      }
      if (id === 'VLPL1') {
        return HttpResponse.json({
          items: [{ name: 'Midnight City', sub: 'M83', video: 'v1', playlist: 'PL1' }],
        })
      }
      return HttpResponse.json({ items: [] })
    }),
    http.post('*/services/ytmusic/play', async ({ request }) => {
      played.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
  )
  const onClose = vi.fn()
  render(
    <NavContext.Provider value={nav}>
      <Home nowPlaying={null} onClose={onClose} onOpenNav={vi.fn()} notify={vi.fn()} />
    </NavContext.Provider>,
  )
  return { browsed, played, onClose }
}

beforeEach(() => {
  __resetHomeMemory()
  __resetLibraryLists()
})

describe('Home with YouTube Music signed in', () => {
  it('flips to YT Music, shows its library, and plays through the phone', async () => {
    const { browsed, played, onClose } = setup()
    // the switch heads the rail; a press flips it
    expect(screen.getByRole('radio', { name: /Spotify/ })).toHaveAttribute('aria-checked', 'true')
    key('Enter')
    expect(screen.getByRole('radio', { name: /YT Music/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: /Playlists/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Recents/ })).toBeNull()

    // switch, Now Playing, Liked music, Playlists
    await turn(3)
    await screen.findByText('Late Night Drive')
    expect(browsed).toContain('playlists')
    key('Enter')
    key('Enter')
    await screen.findByText('Midnight City')
    expect(browsed).toContain('VLPL1')

    // a song in it: the phone plays the playlist from that song
    const row = screen.getByText('Midnight City').closest('button')!
    fireEvent.click(row)
    await waitFor(() =>
      expect(played).toEqual([{ playlist: 'PL1', video: 'v1', title: 'Midnight City' }]),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('rounds all three libraries when SoundCloud is signed in too', () => {
    const three: NavState = {
      ...nav,
      services: [
        ...nav.services!,
        {
          id: 'soundcloud',
          name: 'SoundCloud',
          enabled: true,
          signed_in: true,
          sections: [{ id: 'likes', name: 'Liked tracks' }],
        },
      ],
    }
    render(
      <NavContext.Provider value={three}>
        <Home nowPlaying={null} onClose={vi.fn()} onOpenNav={vi.fn()} notify={vi.fn()} />
      </NavContext.Provider>,
    )
    // the ones not picked show only their dot, but keep their names for the reader
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    key('Enter')
    expect(screen.getByRole('radio', { name: 'YT Music' })).toHaveAttribute('aria-checked', 'true')
    key('Enter')
    expect(screen.getByRole('radio', { name: 'SoundCloud' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('button', { name: /Liked tracks/ })).toBeInTheDocument()
    key('Enter')
    expect(screen.getByRole('radio', { name: 'Spotify' })).toHaveAttribute('aria-checked', 'true')
  })

  it('tapping Spotify on the switch goes back to Spotify', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: /YT Music/ }))
    expect(screen.getByRole('button', { name: /Playlists/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Spotify/ }))
    expect(screen.getByRole('button', { name: /Recents/ })).toBeInTheDocument()
  })
})
