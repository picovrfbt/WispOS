/**
 * Wisp's saved data on the Car Thing was kept under Mira's names (mira.*).
 * They're wisp.* now; this moves anything saved under the old names across,
 * once, before anything reads it. main.tsx imports it first.
 */
export const RENAMED_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['mira.settings.v1', 'wisp.settings.v1'],
  ['mira.bluetooth.lastDevice', 'wisp.bluetooth.lastDevice'],
  ['mira.lastArtUrl', 'wisp.lastArtUrl'],
  ['mira.skippedVersion', 'wisp.skippedVersion'],
  ['mira.utcOffsetMin', 'wisp.utcOffsetMin'],
  ['mira.crashReloads', 'wisp.crashReloads'],
  ['mira.dev.forcedScreen', 'wisp.dev.forcedScreen'],
]

export function migrateStorage(store: Storage | undefined = globalThis.localStorage): void {
  if (!store) return
  for (const [from, to] of RENAMED_KEYS) {
    try {
      const old = store.getItem(from)
      if (old === null) continue
      if (store.getItem(to) === null) store.setItem(to, old)
      store.removeItem(from)
    } catch {
      // storage unavailable or full: the old value simply stays where it was
    }
  }
}

migrateStorage()
