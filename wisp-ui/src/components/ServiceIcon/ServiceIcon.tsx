import { memo } from 'react'

interface Props {
  /** spotify, ytmusic or soundcloud */
  service: string
  size?: number
}

/**
 * A small mark for each music service, beside its name on Home's switch and
 * before the artist in the player: so it's clear at a glance where a song is
 * coming from. Drawn here (no image files), in each service's own colours.
 */
function ServiceIconImpl({ service, size = 16 }: Props) {
  if (service === 'ytmusic') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#ff0033" />
        <circle cx="12" cy="12" r="6.6" fill="none" stroke="#fff" strokeWidth="1.4" />
        <path d="M10.2 9.3v5.4l4.6-2.7z" fill="#fff" />
      </svg>
    )
  }
  if (service === 'soundcloud') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#ff5500" />
        <path
          d="M15.4 9.6a3.3 3.3 0 0 0-1.1.2 4 4 0 0 0-3.6-2.5v8.4h4.7a3 3 0 0 0 0-6.1zM9.6 8.4h1v7.3h-1zm-1.7.9h1v6.4h-1zm-1.7 1.2h1v5.2h-1zm-1.6 1.6h1v3.6h-1z"
          fill="#fff"
        />
      </svg>
    )
  }
  // Spotify: its green, as the switch has always shown it
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1ed760" />
      <path
        d="M6.6 9.4c3.6-1 7.6-.7 10.8 1.1M7.2 12.4c2.9-.8 6.1-.5 8.7.9M7.8 15.2c2.3-.6 4.6-.4 6.6.7"
        fill="none"
        stroke="#000"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const ServiceIcon = memo(ServiceIconImpl)
