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

const miles = (m?: number) =>
  m === undefined ? '' : `${(m / 1609.344).toFixed(m < 16093 ? 1 : 0)} mi`
const minutes = (s: number) => {
  const m = Math.max(1, Math.round(s / 60))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr ${m % 60} min`
}

type View =
  | { name: 'where' }
  | { name: 'results'; kind: (typeof KINDS)[number] }
  | { name: 'routes'; place: NavPlace; from: 'where' | 'results' }

interface Props {
  location: NavLocation | undefined
  onClose: () => void
}

/**
 * Where to, while nothing's navigating: kinds of place nearby and where you've
 * been lately, then the ways there on a map with up to three routes, avoid
 * highways or tolls, and Start with Wisp or in Google Maps. The knob moves,
 * a press picks, back steps out. Places by name come by voice ("take me to…").
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

  useEffect(() => {
    let alive = true
    void fetchRecentPlaces().then((r) => alive && setRecents(r.slice(0, RECENTS_SHOWN)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    listRef.current?.querySelector('[data-focus="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [focus, view])

  const go = (v: View, f = 0) => {
    setError(null)
    setView(v)
    setFocus(f)
  }

  const openKind = async (kind: (typeof KINDS)[number]) => {
    setResults(null)
    go({ name: 'results', kind })
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
    from: 'where' | 'results',
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

  const count =
    view.name === 'where'
      ? KINDS.length + recents.length
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
      if (focus < KINDS.length) void openKind(KINDS[focus])
      else if (recents[focus - KINDS.length]) void plan(recents[focus - KINDS.length], 'where')
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

  useDial({
    onStep: (dir) => {
      setFocus((f) => {
        const n = Math.max(0, Math.min(Math.max(0, count - 1), f + dir))
        if (view.name === 'routes' && n < routeCount) setPicked(n)
        return n
      })
    },
    onPress: press,
    onBack: () => {
      if (view.name === 'results')
        go(
          { name: 'where' },
          KINDS.findIndex((k) => k.id === view.kind.id),
        )
      else if (view.name === 'routes') {
        if (view.from === 'results' && lastResults.current) go(lastResults.current)
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

  if (view.name === 'results') {
    return (
      <div className={styles.plan} role="dialog" aria-label={`${view.kind.plural} nearby`}>
        <div className={styles.where} ref={listRef}>
          <h2 className={styles.whereTitle}>{view.kind.plural} nearby</h2>
          <div className={styles.whereSub}>Nearest first · turn to pick, press for routes</div>
          {error ? <p className={styles.planMsg}>{error}</p> : null}
          {!results ? <p className={styles.planMsg}>Looking nearby…</p> : null}
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
                    {p.address || view.kind.label}
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
        <div className={styles.kinds}>
          {KINDS.map((k, i) => (
            <div
              key={k.id}
              data-focus={focus === i}
              className={`${styles.kind} ${focus === i ? styles.on : ''}`}
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
          const f = KINDS.length + i
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
