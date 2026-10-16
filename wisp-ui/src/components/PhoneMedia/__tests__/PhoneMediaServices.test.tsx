import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import { PhoneMediaPage } from '../PhoneMediaPage'
import type { PhoneMedia } from '@/api/phoneMedia'
import { useOverlays } from '@/hooks/useOverlays'
import { OverlayContext } from '@/overlays/overlayContext'
import { getSettings, updateSettings } from '@/settings'

const ytm: PhoneMedia = {
  present: true,
  app: 'app.morphe.android.apps.youtube.music',
  app_name: 'YouTube Music',
  title: 'Midnight City',
  artist: 'M83',
  playing: true,
  position_ms: 30_000,
  position_at: Date.now(),
  duration_ms: 240_000,
  can_seek: true,
  updated_at: 1,
}

function Overlays({ children }: { children: ReactNode }) {
  const overlays = useOverlays()
  return <OverlayContext.Provider value={overlays}>{children}</OverlayContext.Provider>
}

const show = (media: PhoneMedia) =>
  render(<PhoneMediaPage media={media} dialEnabled onBack={vi.fn()} />, { wrapper: Overlays })

function phone(liked = false) {
  const likes: unknown[] = []
  const played: unknown[] = []
  let asked = 0
  server.use(
    http.get('*/services/now', () => {
      asked++
      return HttpResponse.json({
        service: 'ytmusic',
        current: 'vid1',
        liked,
        items: [{ name: 'Wait', sub: 'M83', video: 'vid2', playlist: 'RD1' }],
      })
    }),
    http.post('*/services/ytmusic/like', async ({ request }) => {
      likes.push(await request.json())
      return HttpResponse.json({ liked: true })
    }),
    http.post('*/services/ytmusic/play', async ({ request }) => {
      played.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
    // lyrics by name, through the daemon's non-Spotify sources
    http.get('*/lyrics/*', () => new HttpResponse(null, { status: 404 })),
  )
  return { likes, played, asked: () => asked }
}

beforeEach(() => updateSettings({ showLyrics: true }))

describe('YouTube Music on the phone, in the Spotify player layout', () => {
  it('shows the cover, the song and the full controls row', () => {
    phone()
    show(ytm)
    expect(screen.getAllByText('Midnight City').length).toBeGreaterThan(0)
    expect(screen.getAllByText('M83 · YouTube Music').length).toBeGreaterThan(0)
    for (const name of ['Previous', 'Pause', 'Next', 'Up next', 'More', 'Rewind 15 seconds']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // the phone's app takes no shuffle or repeat from here
    expect(screen.queryByRole('button', { name: 'Shuffle' })).toBeNull()
  })

  it('likes the song in YouTube Music', async () => {
    const { likes, asked } = phone(false)
    show(ytm)
    // the phone's answer gives the song's id, which the like needs
    await waitFor(() => expect(asked()).toBe(1))
    await new Promise((r) => setTimeout(r, 50))
    fireEvent.click(screen.getByRole('button', { name: 'Like' }))
    await waitFor(() => expect(likes).toEqual([{ current: 'vid1', like: true }]))
    expect(screen.getByRole('button', { name: 'Remove like' })).toBeInTheDocument()
  })

  it('shows up next and plays a song from it', async () => {
    const { played, asked } = phone()
    show(ytm)
    fireEvent.click(screen.getByRole('button', { name: 'Up next' }))
    await screen.findByText('Wait')
    expect(asked()).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Wait').closest('button')!)
    await waitFor(() => expect(played).toEqual([{ playlist: 'RD1', video: 'vid2', title: 'Wait' }]))
  })

  it('turns lyrics off from More, as on Spotify', () => {
    phone()
    show(ytm)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByText(/lyrics/i, { selector: 'button *, button' }))
    expect(getSettings().showLyrics).toBe(false)
  })

  it('gives SoundCloud its waveform, a heart and related tracks', async () => {
    server.use(
      http.get('*/services/now', () =>
        HttpResponse.json({
          service: 'soundcloud',
          current: 'track:42',
          liked: true,
          waveform: [10, 80, 40, 100, 20],
          items: [{ name: 'Glow', sub: 'Ana', video: 'track:43' }],
        }),
      ),
      http.get('*/lyrics/*', () => new HttpResponse(null, { status: 404 })),
    )
    const { container } = show({
      ...ytm,
      app: 'com.soundcloud.android',
      app_name: 'SoundCloud',
    })
    // liked already, as a heart
    await screen.findByRole('button', { name: 'Remove like' })
    // the bar becomes the song's waveform, drawn once unplayed and once played
    expect(container.querySelectorAll('[role="slider"] svg rect').length).toBe(10)
    fireEvent.click(screen.getByRole('button', { name: 'Up next' }))
    expect(screen.getByRole('dialog', { name: 'Related tracks' })).toBeInTheDocument()
    expect(screen.getByText('Glow')).toBeInTheDocument()
  })

  it('keeps the simple page for a video app', () => {
    show({ ...ytm, app: 'com.google.android.youtube', app_name: 'YouTube' })
    expect(screen.queryByRole('button', { name: 'Up next' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
  })
})
