import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import { PhoneMediaPage } from '../PhoneMediaPage'
import { phoneMediaPosition, type PhoneMedia } from '@/api/phoneMedia'

const media = (over: Partial<PhoneMedia> = {}): PhoneMedia => ({
  present: true,
  app: 'com.google.android.youtube',
  app_name: 'YouTube',
  title: 'How engines work',
  artist: 'Some Channel',
  playing: true,
  position_ms: 30_000,
  position_at: Date.now(),
  duration_ms: 600_000,
  updated_at: 1,
  ...over,
})

function captureControls() {
  const actions: string[] = []
  server.use(
    http.post('*/phone/media/control', async ({ request }) => {
      actions.push(((await request.json()) as { action: string }).action)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return actions
}

const key = (k: string) =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })))

describe('PhoneMediaPage', () => {
  it('seeks where the bar is tapped, when the app allows it', async () => {
    const seeks: number[] = []
    server.use(
      http.post('*/phone/media/control', async ({ request }) => {
        const body = (await request.json()) as { action: string; position_ms?: number }
        if (body.action === 'seek') seeks.push(body.position_ms ?? -1)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { rerender } = render(<PhoneMediaPage media={media()} dialEnabled onBack={vi.fn()} />)
    expect(screen.queryByRole('slider', { name: 'Seek' })).toBeNull()

    rerender(<PhoneMediaPage media={media({ can_seek: true })} dialEnabled onBack={vi.fn()} />)
    const bar = screen.getByRole('slider', { name: 'Seek' })
    bar.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 20 }) as DOMRect
    fireEvent.pointerDown(bar, { clientX: 300, pointerId: 1 })
    fireEvent.pointerUp(bar, { clientX: 300, pointerId: 1 })
    // halfway along a 10 minute video
    await waitFor(() => expect(seeks).toEqual([300_000]))
  })

  it('shows the app, title and artist, with a gradient when there is no cover', () => {
    const { container } = render(<PhoneMediaPage media={media()} dialEnabled onBack={vi.fn()} />)
    expect(screen.getByText('YouTube')).toBeInTheDocument()
    expect(screen.getByText('How engines work')).toBeInTheDocument()
    expect(screen.getByText('Some Channel')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('10:00')).toBeInTheDocument()
  })

  it('shows the cover from the daemon when the phone sent one', () => {
    const { container } = render(
      <PhoneMediaPage media={media({ art_id: 'abc123' })} dialEnabled onBack={vi.fn()} />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      '/phone/media/art?v=abc123',
    )
  })

  it('knob press pauses, the knob is the phone volume, buttons skip', async () => {
    const actions = captureControls()
    render(<PhoneMediaPage media={media()} dialEnabled onBack={vi.fn()} />)
    key('Enter')
    // shows paused at once, before the phone reports back
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    act(() => void window.dispatchEvent(new WheelEvent('wheel', { deltaX: -1 })))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(actions).toEqual(['pause', 'volume_up', 'next']))
  })

  it('back goes up, and the dial is left alone while an overlay has it', () => {
    const onBack = vi.fn()
    const actions = captureControls()
    const { rerender } = render(<PhoneMediaPage media={media()} dialEnabled onBack={onBack} />)
    key('Escape')
    expect(onBack).toHaveBeenCalledTimes(1)
    rerender(<PhoneMediaPage media={media()} dialEnabled={false} onBack={onBack} />)
    key('Escape')
    key('Enter')
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(actions).toEqual([])
  })
})

describe('phoneMediaPosition', () => {
  it('runs the clock on while playing and holds it while paused, never past the end', () => {
    const m = media({ position_ms: 1000, position_at: 10_000, duration_ms: 5000 })
    expect(phoneMediaPosition(m, 12_000)).toBe(3000)
    expect(phoneMediaPosition({ ...m, playing: false }, 12_000)).toBe(1000)
    expect(phoneMediaPosition(m, 99_000)).toBe(5000)
  })
})
