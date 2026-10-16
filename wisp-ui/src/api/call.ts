import { useEffect, useState } from 'react'
import { API_BASE } from '@/config'
import { subscribeEvents } from './eventBus'
import { readJson } from './client'

// A call on the phone (the daemon's phone_call.go): who's calling, then a timer.
// The car's hands-free does the talking; this only answers, declines, hangs up.

export interface PhoneCall {
  state: 'idle' | 'ringing' | 'active'
  name?: string
  /** when an active call was picked up, epoch ms */
  since?: number
}

const IDLE: PhoneCall = { state: 'idle' }

export async function callControl(action: 'answer' | 'decline' | 'hangup'): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/phone/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** the call as the phone reports it: asked once, then kept up to date */
export function usePhoneCall(): PhoneCall {
  const [call, setCall] = useState<PhoneCall>(IDLE)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/phone/call`, { cache: 'no-store' })
        const c = res.ok ? ((await readJson(res)) as PhoneCall | null) : null
        if (alive && c?.state) setCall(c)
      } catch {
        // no daemon yet; the event will say
      }
    })()
    const off = subscribeEvents((evt) => {
      if (evt.type === 'phone/call') setCall((evt.data as PhoneCall) ?? IDLE)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return call
}
