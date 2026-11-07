import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateScreen } from '../UpdateScreen'
import { downloadDetail, phoneLeg } from '../progress'
import { rolledBackMessage, sizeMB, type UpdateState } from '@/api/update'

const system: UpdateState = {
  current: 'v1.0.5',
  latest: 'v1.0.6',
  installing: 'v1.0.6',
  available: true,
  has_token: false,
  phase: 'downloading',
  focus: true,
  step: 'Downloading the system',
  via: 'direct',
  os: 'v1.0.0',
  system: { version: 'v1.0.6', size: 225_000_000 },
  percent: 10,
  bytes_done: 22_500_000,
  bytes_total: 225_000_000,
}

describe('system updates', () => {
  it('says it is the system that is updating', () => {
    render(<UpdateScreen update={system} onRetry={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Updating the system to v1.0.6')).toBeTruthy()
  })

  it('reads the phone legs of a system download', () => {
    expect(phoneLeg({ ...system, step: 'Your phone is downloading the system' })).toBe('phone')
    expect(phoneLeg({ ...system, step: 'Copying the system from your phone' })).toBe('copy')
    expect(downloadDetail(system)).toContain('21 of 215 MB')
  })

  it('explains a system that went back', () => {
    expect(
      rolledBackMessage({ from: 'v1.0.6', to: 'v1.0.0', why: 'x', at: 0, kind: 'system' }),
    ).toBe(
      "The system update to v1.0.6 didn't start properly, so the Car Thing went back to v1.0.0",
    )
  })

  it('rounds sizes', () => {
    expect(sizeMB(225_000_000)).toBe('215 MB')
    expect(sizeMB(10)).toBe('1 MB')
  })
})
