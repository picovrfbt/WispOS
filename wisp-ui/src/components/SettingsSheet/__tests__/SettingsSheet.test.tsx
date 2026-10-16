import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { SettingsSheet } from '../SettingsSheet'
import { __resetSettings, getSettings } from '@/settings'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  __resetSettings()
})

afterEach(() => {
  vi.useRealTimers()
})

// jsdom gives every element a zero-sized rect and no pointer capture, so the drag
// handlers need both patched (same approach as ProgressBar.test.tsx)
function stubBar(el: HTMLElement, left = 100, width = 300): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      width,
      right: left + width,
      top: 0,
      bottom: 40,
      height: 40,
      x: left,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  el.setPointerCapture = () => undefined
  el.releasePointerCapture = () => undefined
  el.hasPointerCapture = () => false
}

describe('SettingsSheet display size', () => {
  it('shows the stored scale', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    expect(slider).toHaveAttribute('aria-valuemin', '85')
    expect(slider).toHaveAttribute('aria-valuemax', '115')
  })

  it('applies immediately when stepped', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Display size up' }))
    expect(getSettings().uiScalePct).toBe(105)
  })

  // the whole point of commit-on-release: applying mid-drag moves this panel under the
  // finger and oscillates between notches
  it('previews during a drag but only commits on release', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '115')
    expect(getSettings().uiScalePct).toBe(100)

    fireEvent.pointerMove(slider, { clientX: 250, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    expect(getSettings().uiScalePct).toBe(100)

    fireEvent.pointerUp(slider, { clientX: 250, pointerId: 1 })
    expect(getSettings().uiScalePct).toBe(100)

    fireEvent.pointerDown(slider, { clientX: 340, pointerId: 2 })
    fireEvent.pointerUp(slider, { clientX: 340, pointerId: 2 })
    expect(getSettings().uiScalePct).toBe(110)
    // without this a stuck preview would be invisible: the store is right but the row
    // would keep rendering the old drag value
    expect(slider).toHaveAttribute('aria-valuenow', '110')
  })

  it('abandons the drag on pointercancel instead of committing it', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '115')
    fireEvent.pointerCancel(slider, { clientX: 400, pointerId: 1 })

    expect(getSettings().uiScalePct).toBe(100)
    expect(slider).toHaveAttribute('aria-valuenow', '100')
  })

  it('drops the gesture when the sheet is dismissed mid-drag', () => {
    const { rerender } = render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '115')

    // pointer capture keeps delivering events to a sheet that is no longer open
    rerender(<SettingsSheet open={false} onClose={vi.fn()} />)
    fireEvent.pointerUp(slider, { clientX: 400, pointerId: 1 })

    expect(getSettings().uiScalePct).toBe(100)
  })

  it('does not stay armed when capture is lost without a pointerup', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Display size' })
    stubBar(slider)

    fireEvent.pointerDown(slider, { clientX: 250, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '100')
    // no pointerup ever arrives; without disarming here the drag flag would survive and
    // a later bare pointermove would drag the slider with no finger down
    fireEvent.lostPointerCapture(slider, { pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 130, pointerId: 2 })

    expect(slider).toHaveAttribute('aria-valuenow', '100')
  })

  it('keeps the display size preview out of the other rows', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const volume = screen.getByRole('slider', { name: 'Volume per turn' })
    stubBar(volume)
    fireEvent.pointerDown(volume, { clientX: 250, pointerId: 1 })
    fireEvent.pointerUp(volume, { clientX: 250, pointerId: 1 })

    expect(screen.getByRole('slider', { name: 'Display size' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })

  it('does not commit on release for the other sliders', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const slider = screen.getByRole('slider', { name: 'Volume per turn' })
    stubBar(slider)
    fireEvent.pointerDown(slider, { clientX: 400, pointerId: 1 })
    // no onCommit passed, so onChange alone drives it and it applies live
    expect(getSettings().volumeStepPct).toBe(10)
  })
})

describe('SettingsSheet with the knob', () => {
  const turn = (dir: 1 | -1) =>
    act(() => {
      vi.advanceTimersByTime(100)
      window.dispatchEvent(new WheelEvent('wheel', { deltaX: -dir, cancelable: true }))
    })
  const key = (k: string) =>
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })))

  it('lands on Display size, and a press then sets it with the knob', () => {
    const onClose = vi.fn()
    render(<SettingsSheet open onClose={onClose} />)
    const before = getSettings().uiScalePct
    turn(1)
    key('Enter')
    turn(1)
    expect(getSettings().uiScalePct).toBeGreaterThan(before)
    // back finishes adjusting first, then leaves
    key('Escape')
    expect(onClose).not.toHaveBeenCalled()
    turn(-1)
    expect(getSettings().uiScalePct).toBeGreaterThan(before)
    key('Escape')
    expect(onClose).toHaveBeenCalled()
  })

  it('presses the button the cursor is on, past a slider’s own − and +', () => {
    render(<SettingsSheet open onClose={vi.fn()} />)
    const clicked: Element[] = []
    const onClick = (e: Event) => clicked.push(e.target as Element)
    document.addEventListener('click', onClick, true)
    // Display size, then the first button after it
    turn(1)
    turn(1)
    key('Enter')
    document.removeEventListener('click', onClick, true)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].tagName).toBe('BUTTON')
    expect(clicked[0].getAttribute('aria-label') ?? '').not.toMatch(/ (up|down)$/)
  })
})
