import type { ObserverStatusActive } from '@/api/types'

// a made-up cover for a made-up song, so screenshots show nobody's real album
const SAMPLE_COVER =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNjAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9InMiIHgxPSIwIiB5MT0iMCIgeDI9IjAiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyYjEwNTUiLz48c3RvcCBvZmZzZXQ9Ii41NSIgc3RvcC1jb2xvcj0iI2Q1MzM2OSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2ZmOWE0NCIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI2MDAiIGhlaWdodD0iNjAwIiBmaWxsPSJ1cmwoI3MpIi8+PGNpcmNsZSBjeD0iMzAwIiBjeT0iMzMwIiByPSIxMjAiIGZpbGw9IiNmZmQ1NmIiIGZpbGwtb3BhY2l0eT0iLjkiLz48cGF0aCBkPSJNMCAzODAgTDYwMCAzODAgTDYwMCA2MDAgTDAgNjAwWiIgZmlsbD0iIzFhMGIyZSIvPjxwYXRoIGQ9Ik0yNzAgMzgwIEwzMzAgMzgwIEw0NjAgNjAwIEwxNDAgNjAwWiIgZmlsbD0iIzNhMjM1MiIvPjxwYXRoIGQ9Ik0yOTYgNDAwIEwzMDQgNDAwIEwzMTAgNDQwIEwyOTAgNDQwWiBNMjg2IDQ3MCBMMzE0IDQ3MCBMMzIyIDUzMCBMMjc4IDUzMFoiIGZpbGw9IiNmZmQ1NmIiIGZpbGwtb3BhY2l0eT0iLjgiLz48L3N2Zz4='

// mock playback state used by the dev screen switcher
export function makeMockStatus(): ObserverStatusActive {
  const env = import.meta.env
  const trackId = env.VITE_MOCK_TRACK_ID ?? ''
  return {
    active: true,
    device_id: 'dev-mock',
    device_name: 'Phone',
    device_type: 'SMARTPHONE',
    track_id: trackId || 'mock-track-1',
    track_uri: env.VITE_MOCK_TRACK_URI ?? 'spotify:track:mock',
    track_name: env.VITE_MOCK_TRACK_NAME ?? 'Open Highway',
    track_artist: env.VITE_MOCK_TRACK_ARTIST ?? 'Coastline Radio',
    track_album: env.VITE_MOCK_TRACK_ALBUM ?? 'Golden Hour',
    track_image: env.VITE_MOCK_TRACK_IMAGE ?? SAMPLE_COVER,
    context_uri: env.VITE_MOCK_CONTEXT_URI ?? 'spotify:playlist:dev-mock',
    context_name: env.VITE_MOCK_CONTEXT_NAME ?? 'Dev Playlist',
    duration: Number(env.VITE_MOCK_DURATION ?? 200000),
    position: Number(env.VITE_MOCK_POSITION ?? 60000),
    is_playing: true,
    is_paused: false,
    shuffle: false,
    repeat_context: false,
    repeat_track: false,
    lyrics_url: trackId ? `/lyrics/${trackId}` : '',
    raw_metadata: null,
    received_at: Date.now(),
    // for the Up next sheet
    next_tracks: [
      ['Exit Signs', 'Mono Harbor'],
      ['Paper Lanterns', 'The Velvet Hours'],
      ['Slow Burn', 'Juniper & Vale'],
      ['Tidewater', 'Northbound'],
    ].map(([name, artist], i) => ({
      uri: `spotify:track:mock-next-${i}`,
      track_id: `mock-next-${i}`,
      name,
      artist,
      album: '',
      image_url: '',
    })),
  }
}
