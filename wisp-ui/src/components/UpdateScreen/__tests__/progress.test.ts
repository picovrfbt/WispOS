import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@/api/update'
import { downloadDetail, overallPercent, phoneLeg, stageOf, takesOver } from '../progress'

const base: UpdateState = {
  current: 'v0.2.9',
  available: true,
  has_token: true,
  phase: 'downloading',
  focus: true,
}

describe('update progress', () => {
  it('says how much, how fast and how long', () => {
    const u = {
      ...base,
      percent: 43,
      bytes_done: 12_400_000,
      bytes_total: 28_800_000,
      speed_bps: 1_350_000,
    }
    expect(downloadDetail(u)).toBe('11.8 of 27.5 MB · 1.3 MB/s · about 12 s left')
    expect(overallPercent(u)).toBeCloseTo(34.4)
  })

  it('splits the bar between the phone downloading and the copy from it', () => {
    const phone = {
      ...base,
      step: 'Your phone is downloading',
      percent: 50,
      bytes_done: 2_621_440,
      bytes_total: 5_242_880,
    }
    expect(overallPercent(phone)).toBe(20)
    expect(downloadDetail(phone)).toBe('Your phone is downloading · 2.5 of 5.0 MB')
    const copy = { ...phone, step: 'Copying from your phone' }
    expect(overallPercent(copy)).toBe(60)
    expect(downloadDetail(copy)).toMatch(/^Copying from your phone · /)
    expect(phoneLeg({ ...base, step: 'Copying fonts from your phone' })).toBe('copy')
    expect(phoneLeg({ ...base, step: 'Downloading' })).toBeNull()
  })

  it('ticks off the stages in order', () => {
    expect(stageOf(base)).toBe(0)
    expect(stageOf({ ...base, phase: 'installing', step: 'Checking the download' })).toBe(1)
    expect(stageOf({ ...base, phase: 'installing', step: 'Unpacking' })).toBe(2)
    expect(stageOf({ ...base, phase: 'restarting' })).toBe(3)
  })

  it('takes the screen only for an install that asked to', () => {
    expect(takesOver(base)).toBe(true)
    expect(takesOver({ ...base, focus: false })).toBe(false)
    expect(takesOver({ ...base, phase: 'idle' })).toBe(false)
    expect(takesOver({ ...base, phase: 'error', error: 'network' })).toBe(true)
    expect(takesOver(null)).toBe(false)
  })
})
