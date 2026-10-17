import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchAddonCatalog,
  fetchAddons,
  installAddon,
  removeAddon,
  type AddonCatalogEntry,
  type AddonManifest,
} from '@/api/addons'
import { subscribeEvents } from '@/api/eventBus'
import { useDial } from '@/components/Home/useDial'
import { AddonFrame } from './AddonFrame'
import { forgetAddon } from './bridge'
import { permissionLine } from './permissions'
import styles from './Addons.module.scss'

interface Props {
  onClose: () => void
}

type View = 'mine' | 'catalog'

const sizeWords = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`)

/**
 * Add-ons, from Home: the ones on this Car Thing (press to open), then "Get
 * add-ons", the reviewed catalog from Wisp's repo, where a press installs one
 * (or, pressed twice, removes it). The knob moves, back steps out.
 */
function AddonsScreenImpl({ onClose }: Props) {
  const [view, setView] = useState<View>('mine')
  const [mine, setMine] = useState<AddonManifest[] | null>(null)
  const [catalog, setCatalog] = useState<AddonCatalogEntry[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [focus, setFocus] = useState(0)
  const [open, setOpen] = useState<AddonManifest | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const loadMine = useCallback(() => {
    fetchAddons().then(setMine, () => setMine([]))
  }, [])

  useEffect(() => {
    loadMine()
    return subscribeEvents((evt) => {
      if (evt.type === 'addons/changed') loadMine()
    })
  }, [loadMine])

  useEffect(() => {
    if (view !== 'catalog' || catalog) return
    fetchAddonCatalog().then(setCatalog, (e: unknown) =>
      setCatalogError(e instanceof Error ? e.message : "Couldn't reach the catalog"),
    )
  }, [view, catalog])

  // the rows the knob moves through
  const mineRows = mine ?? []
  const count = view === 'mine' ? mineRows.length + 1 : (catalog?.length ?? 0)

  useEffect(() => {
    list.current?.querySelector(`[data-row="${focus}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focus, view])

  const press = async () => {
    setNote(null)
    if (view === 'mine') {
      if (focus < mineRows.length) setOpen(mineRows[focus])
      else {
        setCatalogError(null)
        setView('catalog')
        setFocus(0)
      }
      return
    }
    const entry = catalog?.[focus]
    if (!entry || busy) return
    const installed = mineRows.some((m) => m.id === entry.id && m.version === entry.version)
    if (installed) {
      if (confirmRemove !== entry.id) {
        setConfirmRemove(entry.id)
        return
      }
      setConfirmRemove(null)
      setBusy(entry.id)
      try {
        await removeAddon(entry.id)
        forgetAddon(entry)
        setNote(`Removed ${entry.name}`)
      } catch {
        setNote(`Couldn't remove ${entry.name}`)
      }
      setBusy(null)
      loadMine()
      return
    }
    setBusy(entry.id)
    try {
      await installAddon(entry.id)
      setNote(`${entry.name} is on Home → Add-ons`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : `Couldn't install ${entry.name}`)
    }
    setBusy(null)
    loadMine()
  }

  useDial({
    enabled: !open,
    onStep: (dir) => {
        setConfirmRemove(null)
        setFocus((f) => Math.max(0, Math.min(Math.max(0, count - 1), f + dir)))
      },
      onPress: () => void press(),
      onBack: () => {
        if (view === 'catalog') {
          setView('mine')
          setFocus(mineRows.length)
          setNote(null)
        } else onClose()
      },
  })

  if (open) return <AddonFrame addon={open} onClose={() => setOpen(null)} />

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>{view === 'mine' ? 'Add-ons' : 'Get add-ons'}</span>
        {view === 'catalog' ? <span className={styles.sub}>Reviewed and shared by the community</span> : null}
      </div>
      <div className={styles.list} ref={list}>
        {view === 'mine' ? (
          <>
            {mineRows.map((a, i) => (
              <Row key={a.id} index={i} focused={focus === i} letter={a.name} title={a.name} line={a.description || permissionLine(a)} />
            ))}
            {mine && mineRows.length === 0 ? (
              <p className={styles.empty}>No add-ons yet. Add a forecast, a big clock, trip gauges and more from the community.</p>
            ) : null}
            <Row index={mineRows.length} focused={focus === mineRows.length} letter="+" title="Get add-ons" line="Browse what the community has made" add />
          </>
        ) : catalogError ? (
          <p className={styles.empty}>{catalogError}. Check the Car Thing is online, then try again.</p>
        ) : !catalog ? (
          <p className={styles.empty}>Getting the catalog…</p>
        ) : catalog.length === 0 ? (
          <p className={styles.empty}>Nothing in the catalog yet.</p>
        ) : (
          catalog.map((e, i) => {
            const have = mineRows.find((m) => m.id === e.id)
            const chip =
              busy === e.id
                ? 'Working…'
                : confirmRemove === e.id
                  ? 'Press again to remove'
                  : have && have.version === e.version
                    ? 'Installed'
                    : have
                      ? 'Update'
                      : 'Install'
            return (
              <Row
                key={e.id}
                index={i}
                focused={focus === i}
                letter={e.name}
                title={e.name}
                line={`${e.author ? `${e.author} · ` : ''}${permissionLine(e)} · ${sizeWords(e.size)}`}
                chip={chip}
                chipOn={chip === 'Install' || chip === 'Update'}
              />
            )
          })
        )}
      </div>
      {note ? <div className={styles.note}>{note}</div> : null}
    </div>
  )
}

interface RowProps {
  index: number
  focused: boolean
  letter: string
  title: string
  line: string
  chip?: string
  chipOn?: boolean
  add?: boolean
}

function Row({ index, focused, letter, title, line, chip, chipOn, add }: RowProps) {
  return (
    <div data-row={index} className={`${styles.row} ${focused ? styles.focused : ''}`}>
      <span className={`${styles.badge} ${add ? styles.badgeAdd : ''}`} aria-hidden>
        {letter.slice(0, 1).toUpperCase()}
      </span>
      <span className={styles.text}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowLine}>{line}</span>
      </span>
      {chip ? <span className={`${styles.chip} ${chipOn ? styles.chipOn : ''}`}>{chip}</span> : null}
    </div>
  )
}

export const AddonsScreen = memo(AddonsScreenImpl)
