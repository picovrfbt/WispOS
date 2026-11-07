import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IdleScreen } from '../IdleScreen'
import type { ConnectDevice } from '@/api/types'

const phone = {
  id: 'p',
  name: 'Phone',
  type: 'Smartphone',
  is_active: true,
  can_transfer: true,
  is_offline: false,
} as ConnectDevice
const gone = { ...phone, id: 'g', name: 'Old speaker', is_offline: true } as ConnectDevice

describe('IdleScreen', () => {
  it('offers to pick up the last song', () => {
    const onResume = vi.fn()
    render(
      <IdleScreen
        connected
        devices={[]}
        lastTrack={{ title: 'Open Highway', artist: 'Coastline Radio', image: '' }}
        onResume={onResume}
      />,
    )
    expect(screen.getByText('Open Highway')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(onResume).toHaveBeenCalled()
  })

  it('says how to get Home', () => {
    render(<IdleScreen connected devices={[]} />)
    expect(screen.getByText('Press back for Home')).toBeTruthy()
  })

  it('lists only devices that can play, and switches on a tap', () => {
    const onSelect = vi.fn()
    render(<IdleScreen connected devices={[phone, gone]} onSelectDevice={onSelect} />)
    expect(screen.queryByText('Old speaker')).toBeNull()
    fireEvent.click(screen.getByText('Phone'))
    expect(onSelect).toHaveBeenCalledWith(phone)
  })
})
