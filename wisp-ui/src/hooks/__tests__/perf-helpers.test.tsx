import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSettled } from '../useSettled'
import { getVolumeOverlay, setVolumeOverlay, useVolumeOverlay } from '../volumeOverlayStore'

describe('useSettled', () => {
  it('only passes a value on once it stops changing', () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook(({ v }) => useSettled(v, 200), {
        initialProps: { v: 1 },
      })
      rerender({ v: 2 })
      act(() => void vi.advanceTimersByTime(100))
      rerender({ v: 3 })
      act(() => void vi.advanceTimersByTime(100))
      // still spinning past cards: nothing settled yet
      expect(result.current).toBe(1)
      act(() => void vi.advanceTimersByTime(200))
      expect(result.current).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('volumeOverlayStore', () => {
  it('re-renders only its subscribers, not the rest of the tree', () => {
    let parentRenders = 0
    let overlayRenders = 0
    function Overlay() {
      overlayRenders++
      return <span>{useVolumeOverlay().value}</span>
    }
    function Parent() {
      parentRenders++
      return <Overlay />
    }
    render(<Parent />)
    act(() => setVolumeOverlay({ visible: true, value: 0.4, disabled: false }))
    act(() => setVolumeOverlay((s) => ({ ...s, value: 0.5 })))
    expect(getVolumeOverlay().value).toBe(0.5)
    expect(parentRenders).toBe(1)
    expect(overlayRenders).toBe(3)
  })
})
