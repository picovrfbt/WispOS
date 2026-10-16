import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import { UpdateScreen } from '../UpdateScreen'
import type { UpdateState } from '@/api/update'

const base: UpdateState = {
  current: 'v0.2.20',
  latest: 'v0.2.21',
  installing: 'v0.2.21',
  available: true,
  has_token: true,
  phase: 'downloading',
  focus: true,
  percent: 30,
  bytes_total: 5_000_000,
  bytes_done: 1_500_000,
}

describe('the update screen switching how the update comes', () => {
  it('through the phone: offers the Car Thing, and hides the button once pressed', () => {
    const asked: string[] = []
    server.use(
      http.post('*/update/direct', () => {
        asked.push('direct')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const update = {
      ...base,
      step: 'Copying from your phone',
      via: 'phone' as const,
      can_relay: true,
    }
    const { rerender } = render(
      <UpdateScreen update={update} onRetry={vi.fn()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download on the Car Thing instead' }))
    expect(screen.queryByRole('button', { name: 'Download on the Car Thing instead' })).toBeNull()

    // the daemon switched: the phone's words go, and the way back appears
    rerender(
      <UpdateScreen
        update={{ ...update, step: 'Downloading', via: 'direct' }}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText(/from your phone/)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Download through your phone instead' }),
    ).toBeInTheDocument()
  })

  it('offers no phone without one there', () => {
    render(
      <UpdateScreen
        update={{ ...base, step: 'Downloading', via: 'direct', can_relay: false }}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /instead/ })).toBeNull()
  })
})
