import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhoneCall } from '@/api/call'
import { CallCard } from '../CallCard'
import { formatTimer } from '../timer'

const api = vi.hoisted(() => ({
  call: { state: 'idle' } as PhoneCall,
  callControl: vi.fn(async () => true),
}))

vi.mock('@/api/call', () => ({
  usePhoneCall: () => api.call,
  callControl: api.callControl,
}))

describe('CallCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.call = { state: 'idle' }
  })

  it('shows nothing without a call', () => {
    const { container } = render(<CallCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows who is calling, and the knob answers', () => {
    api.call = { state: 'ringing', name: 'Sam' }
    render(<CallCard />)
    expect(screen.getByText('Sam')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(api.callControl).toHaveBeenCalledWith('answer')
  })

  it('turning the knob moves to Decline', () => {
    api.call = { state: 'ringing', name: 'Sam' }
    render(<CallCard />)
    fireEvent.wheel(window, { deltaY: -60 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(api.callControl).toHaveBeenCalledWith('decline')
  })

  it('back hides the card and leaves the phone ringing', () => {
    api.call = { state: 'ringing', name: 'Sam' }
    render(<CallCard />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Sam')).toBeNull()
    expect(api.callControl).not.toHaveBeenCalled()
  })

  it('during a call shows a timer and End', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    api.call = { state: 'active', name: 'Sam', since: 100_000 - 65_000 }
    render(<CallCard />)
    expect(screen.getByText('1:05')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('1:06')).toBeInTheDocument()
    fireEvent.click(screen.getByText('End'))
    expect(api.callControl).toHaveBeenCalledWith('hangup')
    vi.useRealTimers()
  })

  it('formats long calls', () => {
    expect(formatTimer(7)).toBe('0:07')
    expect(formatTimer(3723)).toBe('1:02:03')
  })
})
