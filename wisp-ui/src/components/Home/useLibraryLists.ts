import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryItem, LibraryPage } from '@/api/library'

export const PAGE = 50

/** one pageable list: a cache key plus how to fetch a page of it */
export interface ListSource {
  key: string
  fetch: (offset: number, limit: number) => Promise<LibraryPage>
}

export interface ListState {
  items: LibraryItem[]
  /** null until the first page lands */
  total: number | null
  /**
   * The server offset of the next page. The daemon drops entries it can't show
   * (folders, nameless items), so a page can come back short of PAGE without
   * the list being over, and items.length is not an offset.
   */
  next: number
  done: boolean
  error: string | null
}

const EMPTY: ListState = { items: [], total: null, next: 0, done: false, error: null }

// lists outlive the home screen for this long, so a rebuild or a quick reopen
// shows them at once instead of refetching; older than this, recents are stale
const KEEP_MS = 5 * 60 * 1000
let kept: { lists: Record<string, ListState>; at: number } | null = null

/** tests start with nothing cached */
export function __resetLibraryLists() {
  kept = null
  saved = null
  window.clearTimeout(saveTimer)
  saveTimer = 0
  try {
    window.localStorage.removeItem(SAVED_KEY)
  } catch {
    // no storage
  }
}

/** tests: as after a restart, the saved pages kept but nothing in memory */
export function __forgetLibraryMemory() {
  flushSaved()
  kept = null
  saved = null
}

// the first page of each list, saved on the Car Thing: Home shows them at once
// after a restart, and with no connection, while it fetches fresh ones
const SAVED_KEY = 'wisp.homeLists.v1'
const SAVED_MAX = 40

interface Saved {
  items: LibraryItem[]
  total: number
  at: number
}

// read from storage once, then kept here: every list the dial lands on is
// looked up, and parsing the whole store each time (40 lists of 50) cost the
// Car Thing tens of milliseconds a step
let saved: Record<string, Saved> | null = null

function readSaved(): Record<string, Saved> {
  if (saved) return saved
  try {
    const raw = window.localStorage.getItem(SAVED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    saved = parsed && typeof parsed === 'object' ? (parsed as Record<string, Saved>) : {}
  } catch {
    saved = {}
  }
  return saved
}

// written once the dial has rested a moment, not on the step that loaded a
// list: serializing the store is the slow part
const SAVE_DELAY_MS = 1500
let saveTimer = 0

function flushSaved() {
  if (!saveTimer) return
  window.clearTimeout(saveTimer)
  saveTimer = 0
  if (!saved) return
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(saved))
  } catch {
    // full or missing storage only means fetching next time
  }
}

// a restart or reload doesn't wait for the timer
if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSaved)

function writeSaved(key: string, items: LibraryItem[], total: number) {
  const all = readSaved()
  all[key] = { items: items.slice(0, PAGE), total, at: Date.now() }
  // the lists looked at least lately go first
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at)
  for (const k of keys.slice(SAVED_MAX)) delete all[k]
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flushSaved, SAVE_DELAY_MS)
}

/**
 * Pages of every list the home screen has opened, so turning the dial back
 * over a category doesn't refetch it. Kept a while after it unmounts too.
 */
export function useLibraryLists() {
  const [lists, setLists] = useState<Record<string, ListState>>(() => {
    if (!kept || Date.now() - kept.at >= KEEP_MS) return {}
    // a list that failed gets a fresh try rather than its old error
    return Object.fromEntries(Object.entries(kept.lists).filter(([, l]) => !l.error))
  })
  const listsRef = useRef(lists)
  useEffect(() => {
    listsRef.current = lists
    kept = { lists, at: Date.now() }
  }, [lists])
  const inflight = useRef(new Set<string>())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback((source: ListSource, offset: number) => {
    if (inflight.current.has(source.key)) return
    inflight.current.add(source.key)
    source
      .fetch(offset, PAGE)
      .then((page) => {
        if (!alive.current) return
        setLists((prev) => {
          const cur = prev[source.key] ?? EMPTY
          const items = offset === 0 ? page.items : cur.items.concat(page.items)
          const next = offset + PAGE
          // an empty page ends it too, in case the server's count runs ahead
          const done = page.items.length === 0 || next >= page.total
          if (offset === 0) writeSaved(source.key, items, page.total)
          return { ...prev, [source.key]: { items, total: page.total, next, done, error: null } }
        })
      })
      .catch((e: unknown) => {
        if (!alive.current) return
        const error = e instanceof Error ? e.message : 'Could not load'
        setLists((prev) => {
          const cur = prev[source.key] ?? EMPTY
          // what's already showing (a saved page, offline) stays up, quietly
          if (cur.items.length > 0 && offset === 0) return prev
          return { ...prev, [source.key]: { ...cur, error } }
        })
      })
      .finally(() => inflight.current.delete(source.key))
  }, [])

  /** fetches the first page unless it is cached or on its way */
  const ensure = useCallback(
    (source: ListSource) => {
      if (listsRef.current[source.key]) return
      // the saved page at once, the fresh one when it comes
      const saved = readSaved()[source.key]
      if (saved && saved.items.length > 0) {
        const seeded: ListState = {
          items: saved.items,
          total: saved.total,
          next: PAGE,
          done: saved.items.length >= saved.total,
          error: null,
        }
        listsRef.current = { ...listsRef.current, [source.key]: seeded }
        setLists((prev) => (prev[source.key] ? prev : { ...prev, [source.key]: seeded }))
      }
      load(source, 0)
    },
    [load],
  )

  const loadMore = useCallback(
    (source: ListSource) => {
      const st = listsRef.current[source.key]
      if (st && st.total !== null && !st.done) load(source, st.next)
    },
    [load],
  )

  const retry = useCallback(
    (source: ListSource) => load(source, listsRef.current[source.key]?.next ?? 0),
    [load],
  )

  const get = useCallback((key: string): ListState => lists[key] ?? EMPTY, [lists])

  return useMemo(() => ({ get, ensure, loadMore, retry }), [get, ensure, loadMore, retry])
}

/** forgets Home's saved pages (Settings → Storage → Clear) */
export function clearSavedLists() {
  __resetLibraryLists()
}
