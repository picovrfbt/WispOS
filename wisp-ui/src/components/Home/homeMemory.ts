import type { LibraryItem } from '@/api/library'

/**
 * Where the home screen was left. Home is rebuilt whenever the screen under it
 * changes (idle, starting up, playing), which happens on its own while you
 * browse; without this every rebuild dropped you back on the first tab.
 */
export interface HomeMemory {
  catIndex: number
  focus: 'rail' | 'cards'
  cardIndexes: Partial<Record<string, number>>
  opened: LibraryItem | null
  /** the library Home was showing: 'spotify' or a music service's id */
  source?: string
}

const FRESH: HomeMemory = { catIndex: 0, focus: 'rail', cardIndexes: {}, opened: null }

let memory: HomeMemory = FRESH

export const readHomeMemory = (): HomeMemory => memory

export function writeHomeMemory(next: HomeMemory) {
  memory = next
}

/** tests start from a fresh home screen */
export function __resetHomeMemory() {
  memory = FRESH
}
