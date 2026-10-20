import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TopBanner, type BannerVariant, type BannerIcon } from '@/components/TopBanner'
import { NotifyContext, OverlayActivityContext, type NotifyFn } from './notifyContext'

const DEFAULT_DURATION_MS = 2600

// how many stay behind the newest; older ones drop off the bottom
const MAX_STACK = 3

interface BannerItem {
  id: number
  message: string
  variant: BannerVariant
  icon?: BannerIcon
  deviceType?: string
}

/**
 * Owns the top banners and exposes notify() to the whole app thru context.
 * A new one goes on top of any still up, which wait underneath, each on its
 * own clock; a swipe takes the top one away and shows the next.
 */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<BannerItem[]>([])
  const timers = useRef(new Map<number, number>())
  const nextId = useRef(1)
  // the last one shown, kept while it slides away
  const [last, setLast] = useState<BannerItem | null>(null)
  const [volumeVisible, setVolumeVisible] = useState(false)
  const visible = stack.length > 0
  const activity = useMemo(
    () => ({ volumeVisible, setVolumeVisible, notificationVisible: visible }),
    [volumeVisible, visible],
  )
  useEffect(() => {
    const all = timers.current
    return () => all.forEach((t) => window.clearTimeout(t))
  }, [])

  const remove = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setStack((s) => s.filter((b) => b.id !== id))
  }, [])

  const notify = useCallback<NotifyFn>(
    (message, opts) => {
      const item: BannerItem = {
        id: nextId.current++,
        message,
        variant: opts?.variant ?? 'info',
        icon: opts?.icon,
        deviceType: opts?.deviceType,
      }
      setLast(item)
      setStack((s) => {
        // the same words again just come back to the top
        const rest = s.filter((b) => b.message !== message)
        for (const gone of [
          ...s.filter((b) => b.message === message),
          ...rest.slice(MAX_STACK - 1),
        ]) {
          window.clearTimeout(timers.current.get(gone.id))
          timers.current.delete(gone.id)
        }
        return [item, ...rest.slice(0, MAX_STACK - 1)]
      })
      timers.current.set(
        item.id,
        window.setTimeout(() => remove(item.id), opts?.durationMs ?? DEFAULT_DURATION_MS),
      )
    },
    [remove],
  )

  const top = stack[0]
  const dismiss = useCallback(() => {
    if (top) remove(top.id)
  }, [top, remove])
  const shown = top ?? last

  return (
    <NotifyContext.Provider value={notify}>
      <OverlayActivityContext.Provider value={activity}>
        {children}
        <TopBanner
          visible={visible}
          message={shown?.message ?? ''}
          variant={shown?.variant}
          icon={shown?.icon}
          deviceType={shown?.deviceType}
          lowered={volumeVisible}
          count={stack.length}
          onDismiss={dismiss}
        />
      </OverlayActivityContext.Provider>
    </NotifyContext.Provider>
  )
}
