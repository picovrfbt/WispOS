import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Menu } from '../Menu'

const baseProps = () => ({
  open: true,
  onClose: vi.fn(),
  showLyrics: true,
  onToggleLyrics: vi.fn(),
  voiceMic: false,
  onToggleVoiceMic: vi.fn(),
  onOpenDevices: vi.fn(),
})

describe('Menu', () => {
  it('hides the dialog from assistive tech when open=false', () => {
    const { container } = render(<Menu {...baseProps()} open={false} />)
    const root = container.firstElementChild
    expect(root).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps only the lyric and mic toggles and devices; settings live on Home', () => {
    render(<Menu {...baseProps()} />)
    expect(screen.getByRole('switch', { name: /Lyrics/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: /Mic/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Settings')).toBeNull()
    expect(screen.queryByText('Karaoke Lyrics')).toBeNull()
  })

  it('fires onToggleLyrics when the Lyrics toggle is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByRole('switch', { name: /Lyrics/ }))
    expect(props.onToggleLyrics).toHaveBeenCalledTimes(1)
  })

  it('fires onToggleVoiceMic when the Mic toggle is clicked', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByRole('switch', { name: /Mic/ }))
    expect(props.onToggleVoiceMic).toHaveBeenCalledTimes(1)
  })

  it('opens the device picker from the Devices row', () => {
    const props = baseProps()
    render(<Menu {...props} />)
    fireEvent.click(screen.getByText('Devices'))
    expect(props.onOpenDevices).toHaveBeenCalledTimes(1)
  })
})
