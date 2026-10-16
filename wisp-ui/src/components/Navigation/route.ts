// the route line on the map: what's left of it from where the car is

type Pt = [number, number]

// metres east and north of [o], close enough over a city's span
function local(p: Pt, o: Pt): [number, number] {
  const k = Math.cos((o[0] * Math.PI) / 180)
  return [(p[1] - o[1]) * 111_320 * k, (p[0] - o[0]) * 110_540]
}

/**
 * The route from the car on: everything before the point on the line nearest
 * the car is dropped, so the line starts under the arrow and shrinks behind
 * it. Farther than [maxOffM] from the line (off it, waiting for a new one),
 * the whole line stays up.
 */
export function remainingRoute(points: Pt[], at: Pt | null, maxOffM = 80): Pt[] {
  if (!at || points.length < 2) return points
  let best = -1
  let bestD = Infinity
  let bestPt: Pt = points[0]
  for (let i = 0; i < points.length - 1; i++) {
    const a = local(points[i], at)
    const b = local(points[i + 1], at)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    // the car is the origin: project it onto the segment
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2))
    const px = a[0] + t * dx
    const py = a[1] + t * dy
    const d = px * px + py * py
    if (d < bestD) {
      bestD = d
      best = i
      const p0 = points[i]
      const p1 = points[i + 1]
      bestPt = [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])]
    }
  }
  if (Math.sqrt(bestD) > maxOffM) return points
  return [bestPt, ...points.slice(best + 1)]
}
