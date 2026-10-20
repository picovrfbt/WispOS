import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSwipeDismiss } from '../useSwipeDismiss'

function Banner({ onDismiss, onTap }: { onDismiss: () => void; onTap: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useSwipeDismiss(ref, onDismiss)
  return (
    <button ref={ref} onClick={onTap}>
      banner
    </button>
  )
}

function swipe(el: HTMLElement, fromY: number, toY: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientY: fromY })
  fireEvent.pointerMove(el, { pointerId: 1, clientY: (fromY + toY) / 2 })
  fireEvent.pointerMove(el, { pointerId: 1, clientY: toY })
  fireEvent.pointerUp(el, { pointerId: 1, clientY: toY })
}

describe('useSwipeDismiss', () => {
  it('dismisses on a swipe up and swallows the click that follows', () => {
    const onDismiss = vi.fn()
    const onTap = vi.fn()
    render(<Banner onDismiss={onDismiss} onTap={onTap} />)
    const el = screen.getByText('banner')
    swipe(el, 100, 30)
    fireEvent.click(el)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('springs back from a short drag and a downward pull', () => {
    const onDismiss = vi.fn()
    render(<Banner onDismiss={onDismiss} onTap={vi.fn()} />)
    const el = screen.getByText('banner')
    swipe(el, 100, 90)
    swipe(el, 100, 200)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(el.style.getPropertyValue('--drag-y')).toBe('')
  })

  it('still taps when the finger barely moves', () => {
    const onTap = vi.fn()
    render(<Banner onDismiss={vi.fn()} onTap={onTap} />)
    const el = screen.getByText('banner')
    swipe(el, 100, 97)
    fireEvent.click(el)
    expect(onTap).toHaveBeenCalled()
  })

  it('dismisses on a swipe left or right too, but not a short sideways nudge', () => {
    const onDismiss = vi.fn()
    render(<Banner onDismiss={onDismiss} onTap={vi.fn()} />)
    const el = screen.getByText('banner')
    const sideways = (to: number) => {
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 300, clientY: 50 })
      fireEvent.pointerMove(el, { pointerId: 1, clientX: (300 + to) / 2, clientY: 52 })
      fireEvent.pointerUp(el, { pointerId: 1, clientX: to, clientY: 52, timeStamp: 10_000 })
    }
    sideways(340)
    expect(onDismiss).not.toHaveBeenCalled()
    sideways(150)
    sideways(450)
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })
})
