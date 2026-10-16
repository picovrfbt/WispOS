import { useEffect, useState } from 'react'
import { subscribeConnection, subscribeEvents } from '@/api/eventBus'
import { fetchPhoneMedia, PHONE_MEDIA_NONE, type PhoneMedia } from '@/api/phoneMedia'
import { serviceOfApp } from '@/api/services'

/** paused this long on the phone, it stops counting as playing there and the screen lets it go */
export const PHONE_PAUSED_LIMIT_MS = 5 * 60_000

/**
 * What the phone is playing outside Spotify, from /phone/media and kept
 * current by the `phone/media` event. Something left paused on the phone for
 * PHONE_PAUSED_LIMIT_MS reads as nothing at all, so a forgotten YouTube video
 * doesn't hold the screen; it comes back the moment it plays again.
 */
export function usePhoneMedia(): PhoneMedia {
  const [media, setMedia] = useState<PhoneMedia>(PHONE_MEDIA_NONE)
  // the song that sat paused past the limit
  const [staleFor, setStaleFor] = useState<string | null>(null)

  useEffect(() => {
    let ctrl: AbortController | null = null
    const refresh = () => {
      ctrl?.abort()
      ctrl = new AbortController()
      fetchPhoneMedia(ctrl.signal)
        // an event can land while the fetch is in flight; keep whichever is newer
        .then((fetched) =>
          setMedia((cur) => (fetched.updated_at >= cur.updated_at ? fetched : cur)),
        )
        .catch(() => {})
    }
    refresh()
    const unsubEvents = subscribeEvents((evt) => {
      if (evt.type === 'phone/media') setMedia(evt.data as PhoneMedia)
    })
    // anything sent while the socket was down is only in /phone/media
    const unsubConn = subscribeConnection((up) => {
      if (up) refresh()
    })
    return () => {
      ctrl?.abort()
      unsubEvents()
      unsubConn()
    }
  }, [])

  const key = `${media.app ?? ''}|${media.title ?? ''}`
  // YouTube Music and SoundCloud are music sources like Spotify: they stay up paused
  const paused = media.present && !media.playing && serviceOfApp(media.app) === null

  useEffect(() => {
    if (!paused) return
    const t = window.setTimeout(() => setStaleFor(key), PHONE_PAUSED_LIMIT_MS)
    return () => window.clearTimeout(t)
  }, [paused, key])

  return paused && staleFor === key ? { ...media, present: false } : media
}
