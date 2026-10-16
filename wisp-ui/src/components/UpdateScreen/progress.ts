import type { UpdateState } from '@/api/update'

/** the four stages the screen ticks off */
export const STAGES = ['Download', 'Check', 'Install', 'Restart'] as const

/** which stage is under way, 0-3 */
export function stageOf(u: UpdateState): number {
  if (u.phase === 'restarting') return 3
  if (u.phase === 'installing') return u.step === 'Checking the download' ? 1 : 2
  return 0
}

// one decimal for anything under 100 MB, so the count visibly moves
function mb(bytes: number, total: number): string {
  return (bytes / 1_048_576).toFixed(total < 100 * 1_048_576 ? 1 : 0)
}

/** "12.4 of 28 MB · 1.3 MB/s · about 12 s left" while downloading */
export function downloadDetail(u: UpdateState): string | null {
  const done = u.bytes_done ?? 0
  const total = u.bytes_total ?? 0
  if (u.phase !== 'downloading' || total <= 0) return null
  const parts = [`${mb(done, total)} of ${mb(total, total)} MB`]
  // through the phone it's two legs: say which one this is
  const leg = phoneLeg(u)
  if (leg === 'phone') parts.unshift('Your phone is downloading')
  else if (leg === 'copy') parts.unshift('Copying from your phone')
  const speed = u.speed_bps ?? 0
  if (speed > 0) {
    parts.push(
      speed >= 1_048_576
        ? `${(speed / 1_048_576).toFixed(1)} MB/s`
        : `${Math.round(speed / 1024)} KB/s`,
    )
    const left = Math.max(0, (total - done) / speed)
    parts.push(
      left < 60
        ? `about ${Math.max(1, Math.round(left))} s left`
        : `about ${Math.round(left / 60)} min left`,
    )
  }
  return parts.join(' · ')
}

/** the update coming through the companion app: the phone's own download, then the copy over the tether */
export function phoneLeg(u: UpdateState): 'phone' | 'copy' | null {
  const step = u.step ?? ''
  if (step.startsWith('Your phone is downloading')) return 'phone'
  if (step.endsWith('from your phone')) return 'copy'
  return null
}

/** the bar: the download fills the first 80% (half each for the phone's two legs), the rest of the install the last 20% */
export function overallPercent(u: UpdateState): number {
  if (u.phase === 'downloading') {
    const frac = (u.percent ?? 0) / 100
    const leg = phoneLeg(u)
    if (leg === 'phone') return Math.min(40, frac * 40)
    if (leg === 'copy') return Math.min(80, 40 + frac * 40)
    return Math.min(80, frac * 80)
  }
  if (u.phase === 'installing') return u.step === 'Checking the download' ? 84 : 92
  if (u.phase === 'restarting') return 100
  return 0
}

/** an install that should have the whole screen: under way, or just failed */
export function takesOver(u: UpdateState | null): boolean {
  if (!u?.focus) return false
  return (
    u.phase === 'downloading' ||
    u.phase === 'installing' ||
    u.phase === 'restarting' ||
    u.phase === 'error'
  )
}
