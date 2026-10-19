import { useEffect, useState } from 'react'
import { PHONE } from '@/phone'

// Wisp Phone's window.WispPhone (MainActivity's Bridge)
interface PhoneBridge {
  daemonLog(): string
}

/**
 * Wisp Phone: the end of the background program's log, once [waiting] has
 * gone on [afterMs], then fresh every few seconds. For a screenshot when Wisp
 * is stuck; null otherwise, and always on the Car Thing
 */
export function usePhoneDaemonLog(waiting: boolean, afterMs: number): string | null {
  const [log, setLog] = useState<string | null>(null)
  useEffect(() => {
    if (!PHONE || !waiting) {
      setLog(null)
      return
    }
    const bridge = (window as unknown as { WispPhone?: PhoneBridge }).WispPhone
    if (!bridge) return
    const read = () => setLog(bridge.daemonLog())
    const first = window.setTimeout(read, afterMs)
    const again = window.setInterval(read, afterMs + 5000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(again)
    }
  }, [waiting, afterMs])
  return log
}
