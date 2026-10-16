import { beforeEach, describe, expect, it } from 'vitest'
import { migrateStorage } from '../storageMigration'

describe('migrateStorage', () => {
  beforeEach(() => localStorage.clear())

  it("moves Mira's names to Wisp's", () => {
    localStorage.setItem('mira.settings.v1', '{"brightness":4}')
    localStorage.setItem('mira.lastArtUrl', 'https://art')
    migrateStorage()
    expect(localStorage.getItem('wisp.settings.v1')).toBe('{"brightness":4}')
    expect(localStorage.getItem('wisp.lastArtUrl')).toBe('https://art')
    expect(localStorage.getItem('mira.settings.v1')).toBeNull()
  })

  it('never overwrites what is already saved under the new name', () => {
    localStorage.setItem('wisp.settings.v1', '{"brightness":9}')
    localStorage.setItem('mira.settings.v1', '{"brightness":4}')
    migrateStorage()
    expect(localStorage.getItem('wisp.settings.v1')).toBe('{"brightness":9}')
    expect(localStorage.getItem('mira.settings.v1')).toBeNull()
  })
})
