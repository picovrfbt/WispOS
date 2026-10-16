import { useCallback, useEffect, useRef, useState } from 'react'
import type { PhoneMedia } from '@/api/phoneMedia'
import { fetchServiceNow, likeService, serviceOfApp, type ServiceNow } from '@/api/services'

// a moment for the title to settle after a skip before asking the phone
const SETTLE_MS = 700

export interface ServiceNowState {
  /** the service playing on the phone (ytmusic, soundcloud), or null for any other app */
  service: string | null
  now: ServiceNow | null
  /** waiting on the phone's answer */
  loading: boolean
  /** liked in the service, as last known; null when it can't be said */
  liked: boolean | null
  toggleLike: () => void
  /** asks again (opening Up next) */
  refresh: () => void
}

/**
 * The song playing in YouTube Music or SoundCloud on the phone, as that
 * service knows it: what's up next and whether it's liked. Asked again on each
 * new song; a like shows at once and goes back if the service refuses it.
 */
export function useServiceNow(
  media: PhoneMedia,
  onError?: (message: string) => void,
): ServiceNowState {
  const service = media.present ? serviceOfApp(media.app) : null
  const key = service ? `${service}|${media.title ?? ''}|${media.artist ?? ''}` : ''
  const [ask, setAsk] = useState(0)
  // each answer, and each like, belongs to the song (and the asking) it was for
  const [answer, setAnswer] = useState<{ for: string; now: ServiceNow | null } | null>(null)
  const [likedOverride, setLikedOverride] = useState<{ for: string; liked: boolean } | null>(null)
  const errRef = useRef(onError)
  useEffect(() => {
    errRef.current = onError
  })
  // the song last asked about: a new one waits for its title to settle, a refresh doesn't
  const askedKey = useRef('')
  const asking = `${key}#${ask}`

  useEffect(() => {
    if (!key) return
    const ctl = new AbortController()
    const settle = askedKey.current !== key
    const t = window.setTimeout(
      () => {
        askedKey.current = key
        void fetchServiceNow(ctl.signal).then((n) => {
          if (!ctl.signal.aborted) setAnswer({ for: `${key}#${ask}`, now: n })
        })
      },
      settle ? SETTLE_MS : 0,
    )
    return () => {
      ctl.abort()
      window.clearTimeout(t)
    }
  }, [key, ask])

  // the last answer for this song stays up while a refresh is out
  const now = key && answer?.for.startsWith(`${key}#`) ? answer.now : null
  const liked = likedOverride?.for === key ? likedOverride.liked : (now?.liked ?? null)

  const toggleLike = useCallback(() => {
    if (!now?.current || !service) return
    const next = !(liked ?? false)
    setLikedOverride({ for: key, liked: next })
    void likeService(service, now.current, next).then((ok) => {
      if (ok) return
      setLikedOverride({ for: key, liked: !next })
      errRef.current?.(next ? "Couldn't like that" : "Couldn't remove that like")
    })
  }, [now, service, liked, key])

  const refresh = useCallback(() => setAsk((n) => n + 1), [])

  return {
    service,
    now,
    loading: !!key && answer?.for !== asking,
    liked,
    toggleLike,
    refresh,
  }
}
