import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
}))

const api = vi.hoisted(() => ({ cancelVoice: vi.fn(() => Promise.resolve()) }))
vi.mock('@/api/client', () => api)

import { VoiceGlow } from '../VoiceGlow'

const voice = (state: string) =>
  act(() => bus.listeners.forEach((fn) => fn({ type: 'voice', data: { state } })))

describe('VoiceGlow', () => {
  it('rises on the wake word, shimmers while thinking, and fades after', () => {
    const { container } = render(<VoiceGlow />)
    const glow = () => container.firstElementChild!.getAttribute('data-state')
    expect(glow()).toBe('off')
    voice('listening')
    expect(glow()).toBe('listening')
    voice('thinking')
    expect(glow()).toBe('thinking')
    voice('playing')
    expect(glow()).toBe('off')
  })

  it('gives up if nothing follows the wake word', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<VoiceGlow />)
      voice('listening')
      act(() => void vi.advanceTimersByTime(16000))
      expect(container.firstElementChild!.getAttribute('data-state')).toBe('off')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stands taller with the voice level', () => {
    const { container } = render(<VoiceGlow />)
    voice('listening')
    const level = container.querySelector('[class*="level"]') as HTMLElement
    act(() => bus.listeners.forEach((fn) => fn({ type: 'voice/level', data: { level: 1 } })))
    expect(level.style.transform).toBe('scaleY(1.27)')
    act(() => bus.listeners.forEach((fn) => fn({ type: 'voice/level', data: { level: 0 } })))
    expect(level.style.transform).toBe('scaleY(0.42)')
    voice('thinking')
    expect(level.style.transform).toBe('')
  })

  it('closes on a tap above the bar, and stops listening', () => {
    const { container } = render(<VoiceGlow />)
    expect(screen.queryByTestId('wisp-catcher')).toBeNull()
    voice('listening')
    const dismissed = vi.fn()
    window.addEventListener('wisp:dismiss', dismissed)
    // a tap on the bar itself leaves it be
    fireEvent.pointerDown(screen.getByTestId('wisp-catcher'), { clientY: window.innerHeight - 20 })
    expect(container.firstElementChild!.getAttribute('data-state')).toBe('listening')
    fireEvent.pointerDown(screen.getByTestId('wisp-catcher'), { clientY: 100 })
    expect(container.firstElementChild!.getAttribute('data-state')).toBe('off')
    expect(api.cancelVoice).toHaveBeenCalledTimes(1)
    expect(dismissed).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('wisp-catcher')).toBeNull()
    window.removeEventListener('wisp:dismiss', dismissed)
  })
})
