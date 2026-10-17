import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiEvent } from '@/api/types'
import { ModelOffer } from '../ModelOffer'

const bus = vi.hoisted(() => ({ listener: null as null | ((e: ApiEvent) => void) }))

vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (fn: (e: ApiEvent) => void) => {
    bus.listener = fn
    return () => {
      bus.listener = null
    }
  },
}))

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))

function offer() {
  act(() => bus.listener?.({ type: 'voice/model_offer', data: { size_mb: 345 } } as ApiEvent))
}

describe('ModelOffer', () => {
  beforeEach(() => {
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows nothing until offered', () => {
    const { container } = render(<ModelOffer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the size, and a press on its own says no thanks', () => {
    render(<ModelOffer />)
    offer()
    expect(screen.getByText(/345 MB model/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('turning to Download and pressing asks the phone', () => {
    render(<ModelOffer />)
    offer()
    fireEvent.wheel(window, { deltaY: 60 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/voice/model_download'), {
      method: 'POST',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('back closes it', () => {
    render(<ModelOffer />)
    offer()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
