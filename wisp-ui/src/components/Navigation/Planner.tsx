import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  fetchRecentPlaces,
  planRoutes,
  searchPlaces,
  startRoute,
  type NavLocation,
  type NavPlace,
  type PlaceKind,
  type PlanRoute,
} from '@/api/nav'
import { useDial } from '@/components/Home/useDial'
import { onFind, takeFind, type NavFind } from './navFind'
import styles from './Navigation.module.scss'

const NavMap = lazy(() => import('./NavMap').then((m) => ({ default: m.NavMap })))

const KINDS: { id: PlaceKind; label: string; plural: string; icon: string; tint: string }[] = [
  { id: 'gas', label: 'Gas', plural: 'Gas', icon: '⛽', tint: '#f59e0b' },
  { id: 'food', label: 'Food', plural: 'Food', icon: '🍔', tint: '#f43f5e' },
  { id: 'coffee', label: 'Coffee', plural: 'Coffee', icon: '☕', tint: '#c08a4a' },
  { id: 'parking', label: 'Parking', plural: 'Parking', icon: '🅿️', tint: '#3b82f6' },
  { id: 'charging', label: 'Charging', plural: 'EV charging', icon: '⚡', tint: '#1ed760' },
  { id: 'groceries', label: 'Groceries', plural: 'Groceries', icon: '🛒', tint: '#a855f7' },
]

const RECENTS_SHOWN = 3

// the knob's keyboard: A to Z in order (easier to find by turning than QWERTY),
// then space, the digits, a comma and delete; the matches come after delete
const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ' ', ...'0123456789', ',', '⌫']
const DELETE = KEYS.length - 1
const MATCHES_SHOWN = 3
// what you've typed is looked up once you stop for this long
const LOOKUP_AFTER_MS = 700
const LOOKUP_FROM = 3

const miles = (m?: number) =>
  m === undefined ? '' : `${(m / 1609.344).toFixed(m < 16093 ? 1 : 0)} mi`
const minutes = (s: number) => {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`
}

type Kind = (typeof KINDS)[number]
type View =
  | { name: 'where' }
  | { name: 'type' }
  // a kind of place nearby, or the matches for what was typed or said
  | { name: 'results'; kind?: Kind; q?: string; from: 'where' | 'type' }
  | { name: 'routes'; place: NavPlace; from: 'where' | 'results' | 'type' }

interface Props {
  location: NavLocation | undefined
  onClose: () => void
}

/**
 * Where to, while nothing's navigating: kinds of place nearby and where you've
 * been lately, then the ways there on a map with up to three routes, avoid
 * highways or tolls, and Start with Wisp or in Google Maps. The knob moves,
 * a press picks, back steps out. Any address or place by name: Search (typed
 * with the knob), by voice ("take me to…"), or typed in the Wisp app.
 */
export function Planner({ location, onClose }: Props) {
  const [view, setView] = useState<View>({ name: 'where' })
  const [focus, setFocus] = useState(0)
  const [recents, setRecents] = useState<NavPlace[]>([])
  const [results, setResults] = useState<NavPlace[] | null>(null)
  const [routes, setRoutes] = useState<PlanRoute[] | null>(null)
  const [avoid, setAvoid] = useState({ highways: false, tolls: false })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // the results from before a route was picked, for back
  const lastResults = useRef<View | null>(null)
  // Search: what's typed, and its matches so far
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<{ q: string; places: NavPlace[] }>({ q: '', places: [] })

  useEffect(() => {
    let alive = true
    void fetchRecentPlaces().then((r) => alive && setRecents(r.slice(0, RECENTS_SHOWN)))
    return () => {
      alive = false
    }
  }, [])

  // what's typed is looked up as you go
  const query = typed.trim()
  useEffect(() => {
    if (view.name !== 'type' || query.length < LOOKUP_FROM) return
    let alive = true
    const t = window.setTimeout(() => {
      searchPlaces({ q: query })
        .then((m) => alive && setFound({ q: query, places: m.slice(0, MATCHES_SHOWN) }))
        .catch(() => alive && setFound({ q: query, places: [] }))
    }, LOOKUP_AFTER_MS)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [query, view.name])
  // only the matches for what's typed now
  const matches = query.length >= LOOKUP_FROM && found.q === query ? found.places : []

  useEffect(() => {
    listRef.current?.querySelector('[data-focus="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [focus, view])

  const go = (v: View, f = 0) => {
    setError(null)
    setView(v)
    setFocus(f)
  }

  const openFind = async (f: NavFind, from: 'where' | 'type' = 'where') => {
    setResults(f.places ?? null)
    go({ name: 'results', q: f.q, from })
    if (f.places) return
    try {
      setResults(await searchPlaces({ q: f.q }))
    } catch (e) {
      // nothing found is its own message below
      setError(e instanceof Error && !/nothing found/i.test(e.message) ? e.message : null)
      setResults([])
    }
  }

  // typed in the Wisp app, or said with more than one match
  useEffect(() => {
    const take = () => {
      const f = takeFind()
      if (f) void openFind(f)
    }
    take()
    return onFind(take)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openFind only sets state
  }, [])

  const openKind = async (kind: Kind) => {
    setResults(null)
    go({ name: 'results', kind, from: 'where' })
    try {
      setResults(await searchPlaces({ cat: kind.id }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't search")
      setResults([])
    }
  }

  // focusAfter: where the knob lands once the routes are in (an avoid option stays on itself)
  const plan = async (
    place: NavPlace,
    from: 'where' | 'results' | 'type',
    a = avoid,
    focusAfter?: (n: number) => number,
  ) => {
    if (from === 'results' && view.name === 'results') lastResults.current = view
    setRoutes(null)
    go({ name: 'routes', place, from }, focus)
    try {
      const r = await planRoutes(place, a)
      setRoutes(r)
      setFocus(focusAfter ? focusAfter(r.length) : 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't plan a route")
      setRoutes([])
    }
  }

  // the route screen's stops for the knob: each route, the two avoid options, the two starts
  const routeCount = routes?.length ?? 0
  const AVOID_HW = routeCount
  const AVOID_TOLL = routeCount + 1
  const START = routeCount + 2
  const GOOGLE = routeCount + 3
  const [picked, setPicked] = useState(0)

  // Where to?'s stops: Search, the kinds, the recent places
  const KIND0 = 1
  const RECENT0 = KIND0 + KINDS.length

  const count =
    view.name === 'where'
      ? RECENT0 + recents.length
      : view.name === 'type'
        ? KEYS.length + matches.length
        : view.name === 'results'
          ? (results?.length ?? 0)
          : GOOGLE + 1

  const start = async (google: boolean) => {
    setBusy(google ? 'Opening Google Maps on your phone…' : 'Starting…')
    try {
      await startRoute(Math.min(picked, Math.max(0, routeCount - 1)), google)
      if (google) window.setTimeout(onClose, 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start")
    }
    setBusy(null)
  }

  const press = () => {
    if (view.name === 'where') {
      if (focus === 0) go({ name: 'type' })
      else if (focus < RECENT0) void openKind(KINDS[focus - KIND0])
      else if (recents[focus - RECENT0]) void plan(recents[focus - RECENT0], 'where')
    } else if (view.name === 'type') {
      typeKey(focus)
    } else if (view.name === 'results') {
      if (results?.[focus]) void plan(results[focus], 'results')
    } else if (routes && !busy) {
      if (focus < routeCount) setPicked(focus)
      else if (focus === AVOID_HW || focus === AVOID_TOLL) {
        const next =
          focus === AVOID_HW
            ? { ...avoid, highways: !avoid.highways }
            : { ...avoid, tolls: !avoid.tolls }
        const which = focus === AVOID_HW ? 0 : 1
        setAvoid(next)
        setPicked(0)
        void plan(view.place, view.from, next, (n) => n + which)
      } else if (focus === START) void start(false)
      else if (focus === GOOGLE) void start(true)
    }
  }

  // a key on Search, by knob or touch; past the keys are the matches
  const typeKey = (i: number) => {
    if (i < KEYS.length) {
      if (i === DELETE) setTyped((t) => t.slice(0, -1))
      else if (typed.length < 80)
        setTyped((t) => (KEYS[i] === ' ' && (!t || t.endsWith(' ')) ? t : t + KEYS[i]))
    } else if (matches[i - KEYS.length]) void plan(matches[i - KEYS.length], 'type')
  }

  useDial({
    onStep: (dir) => {
      setFocus((f) => {
        // the keyboard goes round: back from A to the matches
        if (view.name === 'type') return (f + dir + count) % count
        const n = Math.max(0, Math.min(Math.max(0, count - 1), f + dir))
        if (view.name === 'routes' && n < routeCount) setPicked(n)
        return n
      })
    },
    onPress: press,
    onBack: () => {
      if (view.name === 'type') go({ name: 'where' })
      else if (view.name === 'results') {
        if (view.from === 'type') go({ name: 'type' }, Math.max(0, KEYS.length - 1))
        else
          go(
            { name: 'where' },
            view.kind ? KIND0 + KINDS.findIndex((k) => k.id === view.kind?.id) : 0,
          )
      } else if (view.name === 'routes') {
        if (view.from === 'results' && lastResults.current) go(lastResults.current)
        else if (view.from === 'type') go({ name: 'type' }, KEYS.length)
        else go({ name: 'where' })
      } else onClose()
    },
  })

  if (view.name === 'routes') {
    const shown = routes ?? []
    const main = shown[picked]?.points ?? null
    const alts = shown.filter((_, i) => i !== picked).map((r) => r.points)
    const best = shown.length ? Math.min(...shown.map((r) => r.duration_s)) : 0
    return (
      <div className={styles.plan} role="dialog" aria-label="Routes">
        <Suspense fallback={<div className={styles.mapOff} />}>
          <NavMap
            location={location}
            route={main}
            alternatives={alts}
            dest={[view.place.lat, view.place.lng]}
            overview
          />
        </Suspense>
        <div className={styles.planSide} ref={listRef}>
          <div className={styles.planEyebrow}>Directions to</div>
          <div className={styles.planDest}>{view.place.name}</div>
          {view.place.address ? <div className={styles.planAddr}>{view.place.address}</div> : null}
          {error ? <p className={styles.planMsg}>{error}</p> : null}
          {!routes && !error ? <p className={styles.planMsg}>Finding the ways there…</p> : null}
          {routes && !routes.length && !error ? (
            <p className={styles.planMsg}>No way there by road</p>
          ) : null}
          <div className={styles.routes}>
            {shown.map((r, i) => (
              <div
                key={i}
                data-focus={focus === i}
                className={`${styles.routeCard} ${focus === i ? styles.on : ''} ${picked === i ? styles.picked : ''}`}
              >
                <div>
                  <div
                    className={`${styles.routeTime} ${r.duration_s === best ? styles.best : ''}`}
                  >
                    {minutes(r.duration_s)}
                  </div>
                  <div className={styles.routeVia}>
                    {`${miles(r.distance_m)}${r.via ? ` · via ${r.via}` : ''}`}
                  </div>
                </div>
                {r.duration_s === best && shown.length > 1 ? (
                  <span className={styles.fastest}>Fastest</span>
                ) : null}
              </div>
            ))}
          </div>
          <div className={styles.avoidRow}>
            <span
              data-focus={focus === AVOID_HW}
              className={`${styles.avoid} ${avoid.highways ? styles.avoidOn : ''} ${focus === AVOID_HW ? styles.on : ''}`}
            >
              Avoid highways
            </span>
            <span
              data-focus={focus === AVOID_TOLL}
              className={`${styles.avoid} ${avoid.tolls ? styles.avoidOn : ''} ${focus === AVOID_TOLL ? styles.on : ''}`}
            >
              Avoid tolls
            </span>
          </div>
          <div className={styles.planHint}>{busy ?? 'Turn to pick · press to choose'}</div>
        </div>
        <div className={styles.startRow}>
          <span
            data-focus={focus === GOOGLE}
            className={`${styles.startGoogle} ${focus === GOOGLE ? styles.on : ''}`}
          >
            Google Maps
          </span>
          <span
            data-focus={focus === START}
            className={`${styles.startBtn} ${focus === START ? styles.on : ''}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2 4 21l8-4 8 4z" />
            </svg>
            Start
          </span>
        </div>
      </div>
    )
  }

  if (view.name === 'type') {
    return (
      <div className={styles.plan} role="dialog" aria-label="Search">
        <div className={styles.where} ref={listRef}>
          <div className={styles.typed} aria-live="polite">
            <span className={styles.typedIcon} aria-hidden>
              <SearchIcon />
            </span>
            {typed ? (
              <span className={styles.typedText}>{typed}</span>
            ) : (
              <span className={styles.typedHint}>An address or a place</span>
            )}
            <span className={styles.caret} aria-hidden />
            {matches.length ? (
              <span className={styles.typedTip}>Turn back from A for the matches</span>
            ) : null}
          </div>
          <div className={styles.keys}>
            {KEYS.map((k, i) => (
              <button
                key={k}
                type="button"
                data-focus={focus === i}
                className={`${styles.key} ${i === DELETE ? styles.keyDel : ''} ${k === ' ' ? styles.keySpace : ''} ${focus === i ? styles.on : ''}`}
                aria-label={i === DELETE ? 'Delete' : k === ' ' ? 'Space' : k}
                onClick={() => {
                  setFocus(i)
                  typeKey(i)
                }}
              >
                {k === ' ' ? 'space' : k}
              </button>
            ))}
          </div>
          {matches.length ? (
            <div className={styles.matches}>
              {matches.map((p, i) => {
                const f = KEYS.length + i
                return (
                  <button
                    key={i}
                    type="button"
                    data-focus={focus === f}
                    className={`${styles.match} ${focus === f ? styles.on : ''}`}
                    onClick={() => void plan(p, 'type')}
                  >
                    <span className={styles.resultText}>
                      <span className={styles.resultName}>{p.name}</span>
                      {p.address ? <span className={styles.resultAddr}>{p.address}</span> : null}
                    </span>
                    <span className={styles.resultDist}>{miles(p.distance_m)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className={styles.typeHint}>
              {query.length < LOOKUP_FROM
                ? 'Turn to a letter, press to type · or type it in the Wisp app on your phone'
                : found.q === query
                  ? 'Nothing found yet · keep typing'
                  : 'Looking it up…'}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (view.name === 'results') {
    return (
      <div
        className={styles.plan}
        role="dialog"
        aria-label={view.kind ? `${view.kind.plural} nearby` : `Places for ${view.q}`}
      >
        <div className={styles.where} ref={listRef}>
          <h2 className={styles.whereTitle}>
            {view.kind ? `${view.kind.plural} nearby` : `“${view.q}”`}
          </h2>
          <div className={styles.whereSub}>
            {view.kind ? 'Nearest first · turn' : 'Turn'} to pick, press for routes
          </div>
          {error ? <p className={styles.planMsg}>{error}</p> : null}
          {!results ? (
            <p className={styles.planMsg}>{view.kind ? 'Looking nearby…' : 'Looking it up…'}</p>
          ) : null}
          {results && !results.length && !error ? (
            <p className={styles.planMsg}>{view.kind ? 'Nothing close by' : 'Nothing found'}</p>
          ) : null}
          <div className={styles.results}>
            {(results ?? []).map((p, i) => (
              <div
                key={i}
                data-focus={focus === i}
                className={`${styles.result} ${focus === i ? styles.on : ''}`}
              >
                <div className={styles.resultText}>
                  <div className={styles.resultName}>{p.name}</div>
                  <div className={styles.resultAddr}>
                    {p.address || view.kind?.label}
                    {p.open ? <span className={styles.open}> · {p.open}</span> : null}
                  </div>
                </div>
                <div className={styles.resultDist}>{miles(p.distance_m)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.plan} role="dialog" aria-label="Where to?">
      <div className={styles.where} ref={listRef}>
        <h2 className={styles.whereTitle}>Where to?</h2>
        <div className={styles.whereSub}>
          Or say <b>"Okay Wisp, take me to…"</b>
        </div>
        <div
          data-focus={focus === 0}
          className={`${styles.searchRow} ${focus === 0 ? styles.on : ''}`}
          onClick={() => go({ name: 'type' })}
        >
          <SearchIcon />
          Search an address or place
        </div>
        <div className={styles.kinds}>
          {KINDS.map((k, i) => (
            <div
              key={k.id}
              data-focus={focus === KIND0 + i}
              className={`${styles.kind} ${focus === KIND0 + i ? styles.on : ''}`}
            >
              <span className={styles.kindIcon} style={{ background: `${k.tint}33` }} aria-hidden>
                {k.icon}
              </span>
              {k.label}
            </div>
          ))}
        </div>
        {recents.length ? <div className={styles.recentHead}>Recent</div> : null}
        {recents.map((p, i) => {
          const f = RECENT0 + i
          return (
            <div
              key={i}
              data-focus={focus === f}
              className={`${styles.recent} ${focus === f ? styles.on : ''}`}
            >
              <span className={styles.recentPin} aria-hidden>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <div className={styles.resultText}>
                <div className={styles.resultName}>{p.name}</div>
                {p.address ? <div className={styles.resultAddr}>{p.address}</div> : null}
              </div>
              <div className={styles.resultDist}>{miles(p.distance_m)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  )
}
