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
})
