import { useEffect } from 'react'
import { subscribeEvents } from '@/api/eventBus'
import { getSettings } from '@/settings'
import type { NotifyFn } from '@/notify/notifyContext'
import { speak } from '@/voice/speak'

// must match PhoneNotification in wisp-daemon/daemon/phone_notify.go
export interface PhoneNotification {
  app: string
  title: string
  text?: string
}

const SHOW_MS = 6000

/** "Message from Sam: on my way" as Wisp reads it */
export function spokenNotification(n: PhoneNotification): string {
  const who = n.title && n.title !== n.app ? `${n.app}, ${n.title}` : n.app || n.title
  return n.text ? `${who}: ${n.text}` : who
}

export function describeNotification(n: PhoneNotification): string {
  const head = n.title && n.title !== n.app ? `${n.app} · ${n.title}` : n.app || n.title
  return n.text ? `${head}: ${n.text}` : head
}

/**
 * The phone's notifications as banners, while Settings → Notifications is on.
 * The daemon already drops them when it's off; this covers the moment between
 * turning it off and the phone hearing about it.
 */
export function usePhoneNotifications(notify: NotifyFn) {
  useEffect(
    () =>
      subscribeEvents((evt) => {
        if (evt.type !== 'phone/notification' || !getSettings().phoneNotifications) return
        const n = evt.data as PhoneNotification
        notify(describeNotification(n), {
          icon: 'bell',
          durationMs: SHOW_MS,
        })
        // read out on Wisp's voice: Everything
        speak(spokenNotification(n), 'extra')
      }),
    [notify],
  )
}
