import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Screensaver } from '../Screensaver'

describe('Screensaver', () => {
  it('shows the clock with the date above it', () => {
    const { container } = render(<Screensaver onClose={vi.fn()} utcOffsetMin={0} />)
    const clockEl = container.querySelector('[class*="clock"]')
    const dateEl = container.querySelector('[class*="date"]')
    expect(clockEl).toBeInTheDocument()
    expect(dateEl).toBeInTheDocument()
    expect(clockEl?.textContent).toMatch(/\d{1,2}:\d{2}/)
    expect(dateEl?.compareDocumentPosition(clockEl!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(dateEl?.textContent).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d{1,2}$/)
  })

  it('dismisses on tap release, not on press, so the tap cannot land on the ui below', () => {
    const onClose = vi.fn()
    const { container } = render(<Screensaver onClose={onClose} utcOffsetMin={0} />)
    const overlay = container.firstElementChild as HTMLElement

    fireEvent.pointerDown(overlay)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('swallows other keys and closes', () => {
    const onClose = vi.fn()
    render(<Screensaver onClose={onClose} utcOffsetMin={0} />)
    fireEvent.keyDown(window, { code: 'ArrowLeft' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not dismiss on power key (KeyM) keydown or keyup', () => {
    const onClose = vi.fn()
    render(<Screensaver onClose={onClose} utcOffsetMin={0} />)
    fireEvent.keyDown(window, { code: 'KeyM' })
    fireEvent.keyUp(window, { code: 'KeyM' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not render now-playing pill when no track is playing', () => {
    const { container } = render(<Screensaver onClose={vi.fn()} utcOffsetMin={0} />)
    expect(container.querySelector('[class*="nowPlayingDock"]')).toBeNull()
  })

  it('never shows what is playing: date, weather and the clock only', () => {
    const { container } = render(
      <Screensaver onClose={vi.fn()} utcOffsetMin={0} artUrl="https://example.com/art.jpg" />,
    )
    expect(container.querySelector('[class*="nowPlaying"]')).toBeNull()
  })
})
