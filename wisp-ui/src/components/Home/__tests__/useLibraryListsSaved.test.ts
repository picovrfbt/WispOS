import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __forgetLibraryMemory,
  __resetLibraryLists,
  useLibraryLists,
  type ListSource,
} from '../useLibraryLists'

const item = { name: 'Jetski Tunes', artist: 'Topaz_Blue', uri: 'spotify:playlist:1' }

beforeEach(() => __resetLibraryLists())

describe('Home lists saved on the Car Thing', () => {
  it('shows the saved page when the fresh one cannot come (offline)', async () => {
    const online: ListSource = {
      key: 'recents',
      fetch: () => Promise.resolve({ items: [item], total: 1 }),
    }
    const first = renderHook(() => useLibraryLists())
    act(() => first.result.current.ensure(online))
    await waitFor(() => expect(first.result.current.get('recents').items).toHaveLength(1))
    first.unmount()

    // a restart, with no connection: the saved page, and no error over it
    const offline: ListSource = {
      key: 'recents',
      fetch: () => Promise.reject(new Error('offline')),
    }
    __forgetLibraryMemory()
    const second = renderHook(() => useLibraryLists())
    act(() => second.result.current.ensure(offline))
    await new Promise((r) => setTimeout(r, 20))
    const st = second.result.current.get('recents')
    expect(st.items.map((i) => i.name)).toEqual(['Jetski Tunes'])
    expect(st.error).toBeNull()
  })
})

describe('saving Home lists', () => {
  it('saves after the dial rests, not on the step that loaded the list', async () => {
    const source: ListSource = {
      key: 'library',
      fetch: () => Promise.resolve({ items: [item], total: 1 }),
    }
    const { result } = renderHook(() => useLibraryLists())
    act(() => result.current.ensure(source))
    await waitFor(() => expect(result.current.get('library').items).toHaveLength(1))
    expect(window.localStorage.getItem('wisp.homeLists.v1')).toBeNull()
    await waitFor(
      () => expect(window.localStorage.getItem('wisp.homeLists.v1')).toContain('Jetski Tunes'),
      {
        timeout: 3000,
      },
    )
  })

  it('saves at once when the page is left', async () => {
    const source: ListSource = {
      key: 'library',
      fetch: () => Promise.resolve({ items: [item], total: 1 }),
    }
    const { result } = renderHook(() => useLibraryLists())
    act(() => result.current.ensure(source))
    await waitFor(() => expect(result.current.get('library').items).toHaveLength(1))
    window.dispatchEvent(new Event('pagehide'))
    expect(window.localStorage.getItem('wisp.homeLists.v1')).toContain('Jetski Tunes')
  })
})
