import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import { PhoneMediaPage } from '../PhoneMediaPage'
import type { PhoneMedia } from '@/api/phoneMedia'
import { getSettings, updateSettings } from '@/settings'

const vlc: PhoneMedia = {
  present: true,
  app: 'org.videolan.vlc',
  app_name: 'VLC',
  title: 'Midnight City',
  artist: 'M83',
  playing: true,
  position_ms: 30_000,
  position_at: Date.now(),
  duration_ms: 240_000,
  updated_at: 1,
}

beforeEach(() => {
  updateSettings({ phoneLyrics: false })
  server.use(http.get('*/lyrics/*', () => new HttpResponse(null, { status: 404 })))
})

describe('lyrics on the simple phone player', () => {
  it('start off, and the small button turns them on beside the song', () => {
    const { container } = render(<PhoneMediaPage media={vlc} dialEnabled onBack={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Lyrics' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(getSettings().phoneLyrics).toBe(true)
    expect(screen.getByRole('button', { name: 'Lyrics' })).toHaveAttribute('aria-pressed', 'true')
    // the cover stays, beside the lyrics
    expect(container.querySelector('img, [class*="artFallback"]')).not.toBeNull()
  })

  it('offers no lyrics for something without an artist', () => {
    render(<PhoneMediaPage media={{ ...vlc, artist: '' }} dialEnabled onBack={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Lyrics' })).toBeNull()
  })
})
