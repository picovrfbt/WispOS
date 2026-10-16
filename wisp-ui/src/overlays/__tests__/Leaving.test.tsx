import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Leaving } from '../Leaving'
import { useDial } from '@/components/Home/useDial'

function Screen({ onPress }: { onPress: () => void }) {
  useDial({ onStep: () => {}, onPress, onBack: () => {} })
  return <div>the screen</div>
}

const press = () =>
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })))

describe('Leaving', () => {
  const realAnimate = Element.prototype.animate
  afterEach(() => {
    Element.prototype.animate = realAnimate
  })

  it('without animations, closes at once', () => {
    const { rerender } = render(
      <Leaving open>
        <Screen onPress={vi.fn()} />
      </Leaving>,
    )
    expect(screen.getByText('the screen')).toBeInTheDocument()
    rerender(
      <Leaving open={false}>
        <Screen onPress={vi.fn()} />
      </Leaving>,
    )
    expect(screen.queryByText('the screen')).toBeNull()
  })

  it('fades out before it goes, and lets go of the knob straight away', () => {
    const fade = { onfinish: null as null | (() => void), cancel: vi.fn() }
    Element.prototype.animate = vi.fn(() => fade) as unknown as typeof Element.prototype.animate
    const onPress = vi.fn()
    const { rerender } = render(
      <Leaving open>
        <Screen onPress={onPress} />
      </Leaving>,
    )
    rerender(
      <Leaving open={false}>
        <Screen onPress={onPress} />
      </Leaving>,
    )
    expect(screen.getByText('the screen')).toBeInTheDocument()
    press()
    expect(onPress).not.toHaveBeenCalled()
    act(() => fade.onfinish?.())
    expect(screen.queryByText('the screen')).toBeNull()
  })

  it('comes straight back if opened again mid-fade', () => {
    const fade = { onfinish: null as null | (() => void), cancel: vi.fn() }
    Element.prototype.animate = vi.fn(() => fade) as unknown as typeof Element.prototype.animate
    const onPress = vi.fn()
    const ui = (open: boolean) => (
      <Leaving open={open}>
        <Screen onPress={onPress} />
      </Leaving>
    )
    const { rerender } = render(ui(true))
    rerender(ui(false))
    rerender(ui(true))
    expect(fade.cancel).toHaveBeenCalled()
    press()
    expect(onPress).toHaveBeenCalled()
  })
})
