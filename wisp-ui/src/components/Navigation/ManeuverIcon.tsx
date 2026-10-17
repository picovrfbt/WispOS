import type { Maneuver } from '@/api/nav'

// Wisp's own turn arrows, drawn by shape: a stem coming up from below and the
// way it turns. Google Maps' directions bring their own picture instead.
const PATHS: Record<Maneuver, string> = {
  straight: 'M12 21V4M6 10l6-6 6 6',
  left: 'M15 21v-8a4 4 0 0 0-4-4H5M9 5 5 9l4 4',
  right: 'M9 21v-8a4 4 0 0 1 4-4h6M15 5l4 4-4 4',
  'slight-left': 'M14 21v-7l-6-6M8 13V8h5',
  'slight-right': 'M10 21v-7l6-6M16 13V8h-5',
  'sharp-left': 'M15 21V8L6 17M6 11v6h6',
  'sharp-right': 'M9 21V8l9 9M18 11v6h-6',
  uturn: 'M8 21V9a4 4 0 0 1 8 0v6M12 12l4 4 4-4',
  roundabout: 'M12 21v-6M12 15a4 4 0 1 0-4-4M8 11V6M5 9l3-3 3 3',
  arrive: 'M12 21s-6-5.6-6-10a6 6 0 0 1 12 0c0 4.4-6 10-6 10zM12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
}

export function ManeuverIcon({ kind, size = 56 }: { kind?: Maneuver; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[kind ?? 'straight'] ?? PATHS.straight} />
    </svg>
  )
}
