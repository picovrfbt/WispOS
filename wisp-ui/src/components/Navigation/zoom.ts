// further out the faster you go, so the next turn is on screen in time
export function zoomForSpeed(mps: number): number {
  if (mps < 8) return 17 // under ~18 mph: streets
  if (mps < 20) return 16 // under ~45 mph
  return 15
}
