import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JamSheet } from '../JamSheet'

const api = vi.hoisted(() => ({
  state: {
    active: true,
    url: 'https://example.test/jam.html#wispabc',
    passengers: ['Sam'],
    votes: 0,
    needed: 1,
    waiting: 2,
    steer: true,
    picks: 0,
  },
  startJam: vi.fn(async () => api.state),
  stopJam: vi.fn(async () => {}),
  setJamSteer: vi.fn(async () => {}),
}))
vi.mock('@/api/jam', () => ({
  useJam: () => api.state,
  startJam: api.startJam,
  stopJam: api.stopJam,
  setJamSteer: api.setJamSteer,
}))

describe('JamSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 100))
  })

  it('shows the code and who is in, and Done leaves it running', () => {
    const onClose = vi.fn()
    const { container } = render(<JamSheet onClose={onClose} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(screen.getByText('1 vote skips a song · 2 waiting')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).toHaveBeenCalled()
    expect(api.stopJam).not.toHaveBeenCalled()
  })

  it('turning to Stop and pressing ends the session', () => {
    const onClose = vi.fn()
    render(<JamSheet onClose={onClose} />)
    fireEvent.wheel(window, { deltaY: 60 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(api.stopJam).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('turning back to Autoplay and pressing turns it off', () => {
    const onClose = vi.fn()
    render(<JamSheet onClose={onClose} />)
    expect(screen.getByRole('switch', { name: 'Autoplay' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.wheel(window, { deltaY: -60 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(api.setJamSteer).toHaveBeenCalledWith(false)
    expect(onClose).not.toHaveBeenCalled()
  })
})
