import type { PhoneMedia } from '@/api/phoneMedia'
import type { ObserverStatusActive } from '@/api/types'

/**
 * The phone's song in the shape the Spotify player's pieces read (lyrics, the
 * progress bar, the big-art view). Its id is made from the song, so lyrics
 * come by name and are cached per song.
 */
export function phoneStatus(
  media: PhoneMedia,
  art: string | undefined,
  playing: boolean,
): ObserverStatusActive {
  const key = `${media.title ?? ''}|${media.artist ?? ''}`
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const id = `phone${h.toString(36)}`
  return {
    active: true,
    device_id: '',
    device_name: media.app_name ?? '',
    device_type: '',
    track_id: id,
    track_uri: `phone:track:${id}`,
    track_name: media.title ?? '',
    track_artist: media.artist ?? '',
    track_album: media.album ?? '',
    track_image: art ?? '',
    context_uri: '',
    context_name: '',
    duration: media.duration_ms,
    position: media.position_ms,
    is_playing: playing,
    is_paused: !playing,
    shuffle: false,
    repeat_context: false,
    repeat_track: false,
    disallow_seek: !media.can_seek,
    lyrics_url: '',
    received_at: media.position_at || Date.now(),
  }
}
