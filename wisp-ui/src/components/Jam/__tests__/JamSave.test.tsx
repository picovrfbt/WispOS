import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JamSave } from '../JamSave'

const api = vi.hoisted(() => ({
  state: { active: false, passengers: [], votes: 0, needed: 1, waiting: 0, steer: true, picks: 12 },
  saveJam: vi.fn(async () => ({
    name: 'Car jam · Oct 17',
    uri: 'spotify:playlist:x',
    songs: 11,
    missing: 1,
  })),
  forgetJam: vi.fn(async () => {}),
}))
vi.mock('@/api/jam', () => ({
  useJam: () => api.state,
  saveJam: api.saveJam,
  forgetJam: api.forgetJam,
}))

describe('JamSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 100))
  })

  it('offers the songs and a press saves them as a playlist', async () => {
    const onClose = vi.fn()
    render(<JamSave onClose={onClose} />)
    expect(screen.getByText(/Save the 12 songs the passengers added/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(api.saveJam).toHaveBeenCalled()
    expect(screen.getByText('Saved to Spotify')).toBeInTheDocument()
    expect(
      screen.getByText(/“Car jam · Oct 17” is in your library with 11 songs\. 1 from/),
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('No thanks forgets them', () => {
    const onClose = vi.fn()
    render(<JamSave onClose={onClose} />)
    fireEvent.wheel(window, { deltaY: 60 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(api.forgetJam).toHaveBeenCalled()
    expect(api.saveJam).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('a failed save can be tried again', async () => {
    api.saveJam.mockRejectedValueOnce(new Error('502'))
    render(<JamSave onClose={vi.fn()} />)
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(screen.getByText("Couldn't save")).toBeInTheDocument()
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })
})
