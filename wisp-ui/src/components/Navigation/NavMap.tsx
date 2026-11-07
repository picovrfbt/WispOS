import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { NavLocation } from '@/api/nav'
import { API_BASE } from '@/config'
import type { NavView } from '@/settings'
import styles from './Navigation.module.scss'
import { zoomFor } from './zoom'
import { remainingRoute } from './route'

// OpenStreetMap's own tiles, through the Car Thing (map_tiles.go): it keeps
// them, darkens them once and fetches the ones around the car ahead of time
const TILE_URL = `${API_BASE}/map/tile/{z}/{x}/{y}`

/**
 * Where the map sits for each view. The car stays put on screen, right of the
 * turn card; turning and tilting views draw a map bigger than the screen so
 * its corners never show as it swings. Leaflet draws flat into the stage and
 * CSS turns and tilts it, which the Car Thing's GPU does without redrawing.
 */
const STAGES: Record<NavView, { w: number; h: number; carX: number; carY: number; tilt: number }> =
  {
    // north up fills the screen, the car in the middle
    north: { w: 0, h: 0, carX: 0, carY: 0, tilt: 0 },
    heading: { w: 1200, h: 1200, carX: 500, carY: 300, tilt: 0 },
    // square, so it covers the screen whichever way it's turned; the last bit
    // of distance fades into .mapSky
    '3d': { w: 1600, h: 1600, carX: 500, carY: 370, tilt: 45 },
  }
// below this (m/s, ~3 mph) the phone's heading wanders: the map holds still
const TURN_MIN_SPEED = 1.5

const PUCK_HTML =
  '<div class="nav-puck"><svg viewBox="0 0 40 40" width="40" height="40">' +
  '<circle cx="20" cy="20" r="17" fill="rgba(66,133,244,0.25)"/>' +
  '<path d="M20 6 L30 31 L20 25 L10 31 Z" fill="#fff" stroke="#4285f4" stroke-width="2.5" stroke-linejoin="round"/>' +
  '</svg></div>'

interface Props {
  location: NavLocation | undefined
  /** the route line, [lat, lng] pairs from start to end */
  route?: [number, number][] | null
  /** the route planner: the other ways there, drawn grey under the route */
  alternatives?: [number, number][][]
  /** the route planner: where it goes, with a pin */
  dest?: [number, number] | null
  /** the route planner: the whole trip in view, instead of following the car */
  overview?: boolean
  /** north up, turning with the car, or tilted (the planner is always north up) */
  view?: NavView
  /** metres to the next turn, for zooming in on it */
  turnDistance?: number | null
  /** the driver's zoom in or out on top of the automatic one */
  zoomNudge?: number
}

// the route as Google Maps draws it: blue, with a dark edge that holds it off the darkened map
const ROUTE_EDGE: L.PolylineOptions = {
  color: '#0b2d63',
  weight: 12,
  opacity: 0.9,
  interactive: false,
  lineCap: 'round',
  lineJoin: 'round',
}
const ROUTE_LINE: L.PolylineOptions = {
  color: '#4f9dff',
  weight: 7,
  opacity: 1,
  interactive: false,
  lineCap: 'round',
  lineJoin: 'round',
}

/** north-up map that follows the phone, with an arrow turned to its heading */
const ALT_LINE: L.PolylineOptions = { ...ROUTE_LINE, color: '#6b7380', weight: 6 }
const DEST_HTML =
  '<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="8" fill="#e5484d" stroke="#fff" stroke-width="3.5"/></svg>'

function NavMapImpl({
  location,
  route,
  alternatives,
  dest,
  overview = false,
  view = 'north',
  turnDistance,
  zoomNudge = 0,
}: Props) {
  const mode: NavView = overview ? 'north' : view
  const stage = STAGES[mode]
  const elRef = useRef<HTMLDivElement>(null)
  // the turn as one running angle, so 359° to 1° is a small step, not a spin back
  const turnRef = useRef(0)
  const mapRef = useRef<L.Map | null>(null)
  const puckRef = useRef<L.Marker | null>(null)
  const routeRef = useRef<{ edge: L.Polyline; line: L.Polyline } | null>(null)
  const extrasRef = useRef<L.Layer[]>([])

  useEffect(() => {
    if (!elRef.current) return
    const map = L.map(elRef.current, {
      zoomControl: false,
      // a passive display while driving: no pans or pinches that stop it following
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      // drawn outside the stage below, so it doesn't turn with the map
      attributionControl: false,
      fadeAnimation: false,
      // smooth zoom: tiles at the nearest level, scaled between
      zoomSnap: 0.25,
    })
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      // keep a wide ring of tiles loaded, so turning and going back are instant
      keepBuffer: 6,
      // fetch as the map moves rather than once it stops (it never stops while driving)
      updateWhenIdle: false,
      updateWhenZooming: false,
    }).addTo(map)
    // somewhere sensible until the first fix
    map.setView([39.5, -98.35], 4)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      puckRef.current = null
      routeRef.current = null
    }
  }, [])

  // the route, from the car on: the part driven drops away behind the arrow
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!route || route.length < 2) {
      routeRef.current?.edge.remove()
      routeRef.current?.line.remove()
      routeRef.current = null
      return
    }
    // the planner shows it all; driving drops what's behind
    const ahead = overview
      ? route
      : remainingRoute(route, location ? [location.lat, location.lng] : null)
    if (!routeRef.current) {
      routeRef.current = {
        edge: L.polyline(ahead, ROUTE_EDGE).addTo(map),
        line: L.polyline(ahead, ROUTE_LINE).addTo(map),
      }
    } else {
      routeRef.current.edge.setLatLngs(ahead)
      routeRef.current.line.setLatLngs(ahead)
    }
  }, [route, location, overview])

  // the planner's other routes and pin, and the whole trip in view
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    extrasRef.current.forEach((l) => l.remove())
    extrasRef.current = []
    if (!overview) return
    for (const alt of alternatives ?? []) {
      if (alt.length > 1) extrasRef.current.push(L.polyline(alt, ALT_LINE).addTo(map))
    }
    routeRef.current?.edge.bringToFront()
    routeRef.current?.line.bringToFront()
    if (dest) {
      const icon = L.divIcon({ html: DEST_HTML, className: styles.puckIcon, iconSize: [30, 30] })
      extrasRef.current.push(
        L.marker(dest, { icon, interactive: false, keyboard: false }).addTo(map),
      )
    }
    const all = [...(route ?? []), ...(alternatives ?? []).flat()]
    if (location) all.push([location.lat, location.lng])
    if (all.length > 1)
      map.fitBounds(L.latLngBounds(all), {
        paddingTopLeft: [350, 40],
        paddingBottomRight: [40, 40],
        animate: false,
      })
    // fits once per plan; the car moving doesn't refit it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, route, alternatives, dest])

  // a new view: the stage changed size
  useEffect(() => {
    mapRef.current?.invalidateSize({ animate: false })
  }, [mode])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !location) return
    const zoom = zoomFor(location.speed, turnDistance, mode, zoomNudge)
    const at = L.latLng(location.lat, location.lng)
    if (!puckRef.current) {
      puckRef.current = L.marker(at, {
        icon: L.divIcon({ html: PUCK_HTML, className: styles.puckIcon, iconSize: [40, 40] }),
        interactive: false,
        keyboard: false,
      }).addTo(map)
      if (!overview) map.setView(at, zoom, { animate: false })
    } else {
      puckRef.current.setLatLng(at)
      if (!overview) map.setView(at, zoom, { animate: true })
    }
    const arrow = puckRef.current.getElement()?.querySelector<HTMLElement>('.nav-puck')
    if (arrow) arrow.style.transform = `rotate(${location.bearing}deg)`
    // the map turns so the way ahead is up, the shortest way round
    if (mode !== 'north' && location.speed >= TURN_MIN_SPEED) {
      const cur = turnRef.current
      const diff = ((((location.bearing - cur) % 360) + 540) % 360) - 180
      turnRef.current = cur + diff
    }
    const el = elRef.current
    if (el) {
      el.style.transform =
        mode === 'north' ? '' : `rotateX(${stage.tilt}deg) rotate(${-turnRef.current}deg)`
    }
  }, [location, overview, turnDistance, mode, stage.tilt, zoomNudge])

  return (
    <div
      className={`${styles.map} ${mode === '3d' ? styles.map3d : ''}`}
      style={mode === '3d' ? { perspectiveOrigin: `${stage.carX}px ${stage.carY}px` } : undefined}
    >
      <div
        className={`${styles.mapStage} ${mode !== 'north' ? styles.mapTurning : ''}`}
        ref={elRef}
        data-testid="nav-map"
        style={
          mode === 'north'
            ? { inset: 0 }
            : {
                width: stage.w,
                height: stage.h,
                left: stage.carX - stage.w / 2,
                top: stage.carY - stage.h / 2,
              }
        }
      />
      {mode === '3d' ? <div className={styles.mapSky} /> : null}
      <div className={styles.mapCredit}>© OpenStreetMap contributors</div>
    </div>
  )
}

export const NavMap = memo(NavMapImpl)
