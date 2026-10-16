import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OfflinePage, type OfflinePageProps } from '../OfflinePage'
import type { OfflineScreen } from '@/app/routes'

function props(over: Partial<OfflinePageProps> = {}): OfflinePageProps {
  return {
    screen: 'chooser',
    deviceName: null,
    carriers: null,
    trouble: null,
    onSetUpOther: vi.fn(),
    onPickMethod: vi.fn(),
    ...over,
  }
}

describe('OfflinePage', () => {
  // resolveOfflineScreen picks the value; this pins the value -> screen mapping,
  // which the switch's `default` would otherwise swallow silently
  it.each([
    ['checking', 'Checking connection...'],
    ['tethering', 'Connect a phone'],
    ['reconnecting', 'Reconnecting...'],
    ['pc', 'Connect a computer'],
    ['bluetooth', 'Connect a phone'],
    ['chooser', "Let's get Wisp online"],
  ] as Array<[OfflineScreen, string]>)('renders the %s screen', (offlineScreen, heading) => {
    render(<OfflinePage {...props({ screen: offlineScreen })} />)
    expect(screen.getByText(heading)).toBeInTheDocument()
  })

  it('names the phone it is waiting on', () => {
    render(<OfflinePage {...props({ screen: 'reconnecting', deviceName: 'Pixel 7' })} />)
    expect(screen.getByText('Reconnecting to Pixel 7...')).toBeInTheDocument()
  })

  it('passes the trouble hint through, so a lost bond says so', () => {
    render(<OfflinePage {...props({ screen: 'reconnecting', trouble: 'bond-lost' })} />)
    expect(screen.getByText('Pairing needed')).toBeInTheDocument()
  })

  it('reports the method the user picked from the chooser', async () => {
    const onPickMethod = vi.fn()
    render(<OfflinePage {...props({ screen: 'chooser', onPickMethod })} />)

    await userEvent.click(screen.getByText('A computer'))
    expect(onPickMethod).toHaveBeenCalledWith('pc')
  })

  // setup works without touching the screen: turn the knob, press to choose
  it('chooses with the knob', () => {
    const onPickMethod = vi.fn()
    render(<OfflinePage {...props({ screen: 'chooser', onPickMethod })} />)

    // the phone is first, and focused
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPickMethod).toHaveBeenLastCalledWith('bluetooth')

    // clockwise is negative deltaX on the knob
    fireEvent.wheel(window, { deltaX: -1 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPickMethod).toHaveBeenLastCalledWith('pc')

    // it stops at the ends
    fireEvent.wheel(window, { deltaX: -1 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPickMethod).toHaveBeenLastCalledWith('pc')
    fireEvent.wheel(window, { deltaX: 1 })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onPickMethod).toHaveBeenLastCalledWith('bluetooth')
  })
})
