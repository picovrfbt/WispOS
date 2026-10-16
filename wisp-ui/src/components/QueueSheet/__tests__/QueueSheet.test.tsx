import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueueSheet } from '../QueueSheet'
import type { QueueTrack } from '@/api/types'

const track = (n: number): QueueTrack => ({
  uri: `spotify:track:${n}`,
  track_id: String(n),
  name: `Song ${n}`,
  artist: `Artist ${n}`,
  album: '',
  image_url: '',
})

describe('QueueSheet', () => {
  it('lists what is up next and jumps to a tapped track', () => {
    const onPlay = vi.fn()
    render(<QueueSheet open onClose={vi.fn()} tracks={[track(1), track(2)]} onPlay={onPlay} />)
    expect(screen.getByText('Up next')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Song 2'))
    expect(onPlay).toHaveBeenCalledWith(track(2))
  })

  it('says so when nothing is queued', () => {
    render(<QueueSheet open onClose={vi.fn()} tracks={[]} />)
    expect(screen.getByText('Nothing queued after this song')).toBeInTheDocument()
  })

  it('closes when the backdrop is tapped', () => {
    const onClose = vi.fn()
    render(<QueueSheet open onClose={onClose} tracks={[track(1)]} />)
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalled()
  })
})

// the knob: clockwise is a negative horizontal wheel; notches closer than 55 ms are one
function turn(dir: 1 | -1) {
  act(() => {
    vi.advanceTimersByTime(100)
    window.dispatchEvent(new WheelEvent('wheel', { deltaX: -dir, cancelable: true }))
  })
}
const key = (k: string) =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })))

describe('QueueSheet with the knob', () => {
  it('moves through the songs and plays the one pressed', () => {
    vi.useFakeTimers()
    const onPlay = vi.fn()
    render(
      <QueueSheet open onClose={vi.fn()} tracks={[track(1), track(2), track(3)]} onPlay={onPlay} />,
    )
    turn(1)
    turn(1)
    turn(-1)
    key('Enter')
    expect(onPlay).toHaveBeenCalledWith(track(2))
    vi.useRealTimers()
  })

  it('goes back with the back button, and leaves the knob alone while closed', () => {
    const onClose = vi.fn()
    const onPlay = vi.fn()
    const { rerender } = render(
      <QueueSheet open onClose={onClose} tracks={[track(1)]} onPlay={onPlay} />,
    )
    key('Escape')
    expect(onClose).toHaveBeenCalled()
    rerender(<QueueSheet open={false} onClose={onClose} tracks={[track(1)]} onPlay={onPlay} />)
    key('Enter')
    expect(onPlay).not.toHaveBeenCalled()
  })
})
