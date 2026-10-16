import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriveState } from '@/api/drive'
import { DriveMode } from '../DriveMode'

const api = vi.hoisted(() => ({
  startDrive: vi.fn(async () => true),
  stopDrive: vi.fn(async () => {}),
  pauseDrive: vi.fn(async () => {}),
  state: null as DriveState | null,
}))

vi.mock('@/api/drive', () => ({
  startDrive: api.startDrive,
  stopDrive: api.stopDrive,
  pauseDrive: api.pauseDrive,
  useDriveState: () => api.state,
}))

const playing: DriveState = {
  genre: 'cinematic',
  playing: true,
  level: 0.7,
  clarity: 0.9,
  gps: true,
  speed_mph: 52,
  parts: { drums: 0.8, bass: 0.9, melody: 0.7, choir: 0.4 },
}

describe('DriveMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.state = null
  })

  it('warns first, and Cancel leaves', () => {
    const onClose = vi.fn()
    render(<DriveMode onClose={onClose} />)
    expect(screen.getByText('Drive Mode is in beta')).toBeInTheDocument()
    expect(screen.getByText(/a lot of battery/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(api.startDrive).not.toHaveBeenCalled()
  })

  it('OK shows the genres, and the knob picks one', async () => {
    render(<DriveMode onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('OK'))
    expect(screen.getByText('Choose a sound')).toBeInTheDocument()
    expect(screen.getByText('Ethereal')).toBeInTheDocument()
    expect(screen.getByText('Cinematic')).toBeInTheDocument()
    // a turn to Cinematic, then a press
    fireEvent.wheel(window, { deltaY: 60 })
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(api.startDrive).toHaveBeenCalledWith('cinematic')
  })

  it('shows the drive as the phone reports it, and back stops it', async () => {
    api.state = playing
    render(<DriveMode onClose={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Enter' }) // OK
    fireEvent.wheel(window, { deltaY: 60 })
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' }) // Cinematic
    })
    expect(screen.getByText('52')).toBeInTheDocument()
    expect(screen.getByText('Everything playing')).toBeInTheDocument()
    for (const part of ['Drums', 'Bass', 'Melody', 'Choir']) expect(screen.getByText(part)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(api.stopDrive).toHaveBeenCalled()
    expect(screen.getByText('Choose a sound')).toBeInTheDocument()
  })

  it('says when the phone is getting the music ready', async () => {
    api.state = { ...playing, playing: false, preparing: true, level: 0 }
    render(<DriveMode onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('OK'))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(screen.getByText(/Getting the music ready/)).toBeInTheDocument()
  })

  it('shows the music downloading, and warns that it uses data', async () => {
    api.state = { ...playing, playing: false, preparing: true, level: 0, download: 40 }
    render(<DriveMode onClose={vi.fn()} />)
    expect(screen.getByText(/uses data/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('OK'))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    expect(screen.getByText(/Downloading the music to your phone… 40%/)).toBeInTheDocument()
  })

  it('pauses with the knob', async () => {
    api.state = playing
    render(<DriveMode onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('OK'))
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' })
    })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(api.pauseDrive).toHaveBeenCalledWith(true)
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText('Resume')).toBeInTheDocument()
  })
})
