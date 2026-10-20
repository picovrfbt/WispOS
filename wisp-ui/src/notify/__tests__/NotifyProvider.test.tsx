import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NotifyProvider } from '../NotifyProvider'
import { useNotify } from '../notifyContext'
import type { ApiEvent } from '@/api/types'

const bus = vi.hoisted(() => ({ listener: null as ((event: ApiEvent) => void) | null }))
vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (listener: (event: ApiEvent) => void) => {
    bus.listener = listener
    return () => {
      bus.listener = null
    }
  },
}))
afterEach(() => vi.useRealTimers())

const icon = () =>
  screen.getByRole('status').querySelector('svg')?.getAttribute('data-notification-icon')

it('does not leak a contextual icon into the next ordinary or error notification', () => {
  vi.useFakeTimers()
  function Buttons() {
    const notify = useNotify()
    return (
      <>
        <button onClick={() => notify('Playing from favourites', { icon: 'playlist' })}>
          Playlist
        </button>
        <button onClick={() => notify('Nothing playing')}>Info</button>
        <button onClick={() => notify('Skip failed', { variant: 'error' })}>Error</button>
      </>
    )
  }
  render(
    <NotifyProvider>
      <Buttons />
    </NotifyProvider>,
  )
  for (const [label, expected] of [
    ['Playlist', 'playlist'],
    ['Info', 'info'],
    ['Error', 'error'],
  ]) {
    fireEvent.click(screen.getByText(label))
    expect(icon()).toBe(expected)
  }
  act(() => vi.advanceTimersByTime(2600))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('reuses the picker device types and does not retain the previous device icon', () => {
  function Devices() {
    const notify = useNotify()
    return (
      <>
        {['COMPUTER', 'smartphone', 'TABLET', 'SPEAKER'].map((type) => (
          <button
            key={type}
            onClick={() => notify(`Now playing on ${type}`, { icon: 'device', deviceType: type })}
          >
            {type}
          </button>
        ))}
        <button onClick={() => notify('Nothing playing')}>Info</button>
      </>
    )
  }
  render(
    <NotifyProvider>
      <Devices />
    </NotifyProvider>,
  )
  for (const [type, expected] of [
    ['COMPUTER', 'pc'],
    ['smartphone', 'phone'],
    ['TABLET', 'phone'],
    ['SPEAKER', 'generic'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: type }))
    expect(screen.getByRole('status').querySelector('svg')).toHaveAttribute(
      'data-device-type',
      expected,
    )
  }
  fireEvent.click(screen.getByRole('button', { name: 'Info' }))
  expect(icon()).toBe('info')
})

it('stacks a new notification on the ones still up, and a swipe shows the next', () => {
  vi.useFakeTimers()
  function Buttons() {
    const notify = useNotify()
    return (
      <>
        <button onClick={() => notify('Message from Sam', { durationMs: 6000 })}>First</button>
        <button onClick={() => notify('Message from Alex', { durationMs: 6000 })}>Second</button>
      </>
    )
  }
  render(
    <NotifyProvider>
      <Buttons />
    </NotifyProvider>,
  )
  fireEvent.click(screen.getByText('First'))
  fireEvent.click(screen.getByText('Second'))
  const banner = screen.getByRole('status')
  expect(banner).toHaveTextContent('Message from Alex')
  expect(screen.getByLabelText('2 notifications')).toBeInTheDocument()

  // swiped up: the one underneath is next
  fireEvent.pointerDown(banner, { pointerId: 1, clientY: 100 })
  fireEvent.pointerMove(banner, { pointerId: 1, clientY: 60 })
  fireEvent.pointerUp(banner, { pointerId: 1, clientY: 20 })
  expect(banner).toHaveTextContent('Message from Sam')
  expect(screen.queryByLabelText(/notifications/)).toBeNull()

  // and goes on its own time
  act(() => void vi.advanceTimersByTime(6100))
  expect(banner.className).not.toMatch(/visible/)
})
