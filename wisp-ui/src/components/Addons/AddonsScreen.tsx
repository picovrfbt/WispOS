import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  addonImageSrc,
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

const sizeWords = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`

/**
 * Add-ons, from Home: the ones on this Car Thing (press to open), then "Get
 * add-ons", the reviewed catalog from Wisp's repo, where a press installs one
 * (or, pressed twice, removes it). The knob moves, back steps out. Each shows
 * its picture, name and author; the catalog shows the one under the knob in
 * full beside the list: picture, description, what it uses, its size.
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
        {view === 'catalog' ? (
          <span className={styles.sub}>Reviewed and shared by the community</span>
        ) : null}
      </div>
      <div className={styles.body}>
        <div className={`${styles.list} ${view === 'catalog' ? styles.listNarrow : ''}`} ref={list}>
          {view === 'mine' ? (
            <>
              {mineRows.map((a, i) => (
                <Row
                  key={a.id}
                  index={i}
                  focused={focus === i}
                  letter={a.name}
                  image={addonImageSrc(a, false)}
                  title={a.name}
                  author={a.author}
                  line={a.description || permissionLine(a)}
                />
              ))}
              {mine && mineRows.length === 0 ? (
                <p className={styles.empty}>
                  No add-ons yet. Add a forecast, a big clock, trip gauges and more from the
                  community.
                </p>
              ) : null}
              <Row
                index={mineRows.length}
                focused={focus === mineRows.length}
                letter="+"
                title="Get add-ons"
                line="Browse what the community has made"
                add
              />
            </>
          ) : catalogError ? (
            <p className={styles.empty}>
              {catalogError}. Check the Car Thing is online, then try again.
            </p>
          ) : !catalog ? (
            <p className={styles.empty}>Getting the catalog…</p>
          ) : catalog.length === 0 ? (
            <p className={styles.empty}>Nothing in the catalog yet.</p>
          ) : (
            catalog.map((e, i) => (
              <Row
                key={e.id}
                index={i}
                focused={focus === i}
                letter={e.name}
                image={addonImageSrc(e, true)}
                title={e.name}
                author={e.author}
                compact
              />
            ))
          )}
        </div>
        {view === 'catalog' && catalog?.[focus] ? (
          <Details
            entry={catalog[focus]}
            chip={chipFor(catalog[focus], mineRows, busy, confirmRemove)}
          />
        ) : null}
      </div>
      {note ? <div className={styles.note}>{note}</div> : null}
    </div>
  )
}

function chipFor(
  e: AddonCatalogEntry,
  mine: AddonManifest[],
  busy: string | null,
  confirmRemove: string | null,
): string {
  const have = mine.find((m) => m.id === e.id)
  if (busy === e.id) return 'Working…'
  if (confirmRemove === e.id) return 'Press again to remove'
  if (have && have.version === e.version) return 'Installed · press to remove'
  return have ? 'Press to update' : 'Press to install'
}

interface RowProps {
  index: number
  focused: boolean
  letter: string
  image?: string | null
  title: string
  author?: string
  line?: string
  /** the catalog's list: picture, name and author only */
  compact?: boolean
  add?: boolean
}

function Row({ index, focused, letter, image, title, author, line, compact, add }: RowProps) {
  return (
    <div
      data-row={index}
      className={`${styles.row} ${compact ? styles.rowCompact : ''} ${focused ? styles.focused : ''}`}
    >
      <Thumb image={image} letter={letter} add={add} small={compact} />
      <span className={styles.text}>
        <span className={styles.rowTitle}>{title}</span>
        {author ? <span className={styles.rowAuthor}>by {author}</span> : null}
        {line ? <span className={styles.rowLine}>{line}</span> : null}
      </span>
    </div>
  )
}

// the add-on's picture, or its first letter when it has none (or it won't load)
function Thumb({
  image,
  letter,
  add,
  small,
}: {
  image?: string | null
  letter: string
  add?: boolean
  small?: boolean
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const show = image && failed !== image
  return (
    <span
      className={`${styles.thumb} ${small ? styles.thumbSmall : ''} ${add ? styles.thumbAdd : ''}`}
      aria-hidden
    >
      {show ? (
        <img src={image} alt="" onError={() => setFailed(image)} />
      ) : (
        letter.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}

// the catalog add-on under the knob, in full
function Details({ entry, chip }: { entry: AddonCatalogEntry; chip: string }) {
  const image = addonImageSrc(entry, true)
  const [failed, setFailed] = useState<string | null>(null)
  const on = chip.startsWith('Press to')
  return (
    <aside className={styles.details} aria-live="polite">
      <div className={styles.shot}>
        {image && failed !== image ? (
          <img src={image} alt={`${entry.name}, as it looks`} onError={() => setFailed(image)} />
        ) : (
          <span className={styles.shotLetter}>{entry.name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className={styles.detailName}>{entry.name}</div>
      <div className={styles.detailAuthor}>
        {entry.author ? `by ${entry.author} · ` : ''}v{entry.version} · {sizeWords(entry.size)}
      </div>
      {entry.description ? <p className={styles.detailText}>{entry.description}</p> : null}
      <div className={styles.detailUses}>
        {permissionLine(entry).replace(/^./, (c) => c.toUpperCase())}
      </div>
      <span className={`${styles.chip} ${on ? styles.chipOn : ''}`}>{chip}</span>
    </aside>
  )
}

export const AddonsScreen = memo(AddonsScreenImpl)
