import { memo, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { NavLocation } from '@/api/nav'
import styles from './Navigation.module.scss'
import { zoomForSpeed } from './zoom'
import { remainingRoute } from './route'

// OpenStreetMap's own tiles: free with attribution and no key (CARTO's dark
// set now wants one). They are light, so .tiles darkens them with a filter.
// One device's driving is the light use the OSM tile policy allows.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '© OpenStreetMap contributors'

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

function NavMapImpl({ location, route, alternatives, dest, overview = false }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
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
      attributionControl: true,
      fadeAnimation: false,
    })
    map.attributionControl.setPrefix(false)
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19, className: styles.tiles }).addTo(
      map,
    )
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !location) return
    const at = L.latLng(location.lat, location.lng)
    if (!puckRef.current) {
      puckRef.current = L.marker(at, {
        icon: L.divIcon({ html: PUCK_HTML, className: styles.puckIcon, iconSize: [40, 40] }),
        interactive: false,
        keyboard: false,
      }).addTo(map)
      if (!overview) map.setView(at, zoomForSpeed(location.speed), { animate: false })
    } else {
      puckRef.current.setLatLng(at)
      if (!overview) map.setView(at, zoomForSpeed(location.speed), { animate: true })
    }
    const arrow = puckRef.current.getElement()?.querySelector<HTMLElement>('.nav-puck')
    if (arrow) arrow.style.transform = `rotate(${location.bearing}deg)`
  }, [location, overview])

  return <div className={styles.map} ref={elRef} data-testid="nav-map" />
}

export const NavMap = memo(NavMapImpl)
