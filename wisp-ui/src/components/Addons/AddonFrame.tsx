import { memo, useEffect, useRef } from 'react'
import { addonPageUrl, type AddonManifest } from '@/api/addons'
import { useDial } from '@/components/Home/useDial'
import { subscribeEvents } from '@/api/eventBus'
import { answer, type BridgeRequest } from './bridge'
import styles from './Addons.module.scss'

interface Props {
  addon: AddonManifest
  onClose: () => void
}

/**
 * One add-on, full screen, in a sandboxed frame: scripts only, an origin of
 * its own (so none of Wisp's storage), and the daemon's policy on its pages
 * blocks any request it makes itself. The knob and the song changing are
 * passed in; back closes it.
 */
function AddonFrameImpl({ addon, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)

  const send = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ wisp: 1, ...msg }, '*')

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const req = e.data as BridgeRequest
      if (!req || req.wisp !== 1 || typeof req.type !== 'string') return
      if (req.type === 'ready') return
      if (req.type === 'close') {
        onClose()
        return
      }
      answer(addon, req).then(
        (data) => send({ reply: req.id, data }),
        (err: unknown) => send({ reply: req.id, error: err instanceof Error ? err.message : 'failed' }),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [addon, onClose])

  // the song changing, for add-ons that may know it
  useEffect(() => {
    if (!addon.permissions?.includes('now_playing')) return
    return subscribeEvents((evt) => {
      if (evt.type === 'observer_track_changed' || evt.type === 'observer_state_changed') {
        void answer(addon, { wisp: 1, type: 'now_playing' }).then((np) => send({ event: 'nowplaying', data: np }))
      }
    })
  }, [addon])

  // a touch on the add-on focuses its frame, which would take the knob's
  // presses with it: the Car Thing's screen keeps the focus
  useEffect(() => {
    const keep = () => window.setTimeout(() => window.focus(), 0)
    window.addEventListener('blur', keep)
    return () => window.removeEventListener('blur', keep)
  }, [])

  useDial({
    onStep: (dir) => send({ event: 'knob', data: { delta: dir } }),
    onPress: () => send({ event: 'press' }),
    onBack: onClose,
  })

  return (
    <div className={styles.frameWrap}>
      <iframe
        ref={frame}
        className={styles.frame}
        title={addon.name}
        src={addonPageUrl(addon)}
        sandbox="allow-scripts"
        tabIndex={-1}
        referrerPolicy="no-referrer"
      />
    </div>
  )
}

export const AddonFrame = memo(AddonFrameImpl)
