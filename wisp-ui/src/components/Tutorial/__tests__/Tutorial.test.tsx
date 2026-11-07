import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Tutorial } from '../Tutorial'

const key = (code: string, k = code) => {
  fireEvent.keyDown(window, { code, key: k })
  fireEvent.keyUp(window, { code, key: k })
}
const settle = () => act(() => vi.advanceTimersByTime(600))

describe('Tutorial', () => {
  it('walks every control and finishes', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<Tutorial onDone={onDone} />)
    const root = screen.getByRole('dialog', { name: 'Controls tutorial' })

    fireEvent.mouseDown(root, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseUp(root, { clientX: 100, clientY: 100 })
    settle()
    expect(screen.getByText('Turn the dial')).toBeInTheDocument()

    for (let i = 0; i < 3; i++) {
      fireEvent.wheel(window, { deltaX: 1 })
      fireEvent.wheel(window, { deltaX: -1 })
    }
    settle()
    key('Enter', 'Enter')
    settle()
    key('Escape', 'Escape')
    settle()
    for (const c of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) key(c, c.slice(-1))
    settle()
    key('KeyM', 'm')
    settle()
    expect(screen.getByText('Swipe to skip')).toBeInTheDocument()
    fireEvent.mouseDown(root, { button: 0, clientX: 400, clientY: 200 })
    fireEvent.mouseUp(root, { clientX: 200, clientY: 200 })
    fireEvent.mouseDown(root, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.mouseUp(root, { clientX: 400, clientY: 200 })
    settle()
    fireEvent.click(screen.getByRole('button', { name: 'Skip step' }))
    settle()
    expect(screen.getByText('Press the dial to finish')).toBeInTheDocument()
    key('Enter', 'Enter')
    settle()
    expect(onDone).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('keeps the dial and buttons from reaching the rest of the app', () => {
    const outside = vi.fn()
    window.addEventListener('keydown', outside)
    render(<Tutorial onDone={vi.fn()} />)
    key('Enter', 'Enter')
    key('KeyM', 'm')
    expect(outside).not.toHaveBeenCalled()
    window.removeEventListener('keydown', outside)
  })
})
