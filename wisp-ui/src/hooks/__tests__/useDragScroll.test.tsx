import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDragScroll } from '../useDragScroll'

function Row({ onRelease, onTap }: { onRelease?: (rest: number) => void; onTap: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDragScroll(ref, { axis: 'x', onRelease })
  return (
    <div ref={ref} data-testid="row" onClick={onTap}>
      cards
    </div>
  )
}

function drag(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: from, button: 0 })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: (from + to) / 2 })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: to })
  fireEvent.pointerUp(el, { pointerId: 1, clientX: to })
}

describe('useDragScroll', () => {
  it('scrolls opposite the drag and reports where it comes to rest', () => {
    const onRelease = vi.fn()
    render(<Row onRelease={onRelease} onTap={vi.fn()} />)
    const row = screen.getByTestId('row')
    row.scrollLeft = 100
    drag(row, 300, 200)
    // dragged 100px left: content moves on by 100, plus any fling
    expect(row.scrollLeft).toBe(200)
    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(onRelease.mock.calls[0][0]).toBeGreaterThanOrEqual(200)
  })

  it('swallows the click that ends a drag but not a tap', () => {
    const onTap = vi.fn()
    render(<Row onTap={onTap} />)
    const row = screen.getByTestId('row')
    drag(row, 300, 200)
    fireEvent.click(row)
    expect(onTap).not.toHaveBeenCalled()
    drag(row, 300, 298)
    fireEvent.click(row)
    expect(onTap).toHaveBeenCalledTimes(1)
  })
})
