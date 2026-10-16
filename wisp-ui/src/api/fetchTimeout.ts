import { API_BASE } from '@/config'

// Chrome keeps at most 6 connections to one host, and every request to the
// daemon shares them. One that never answers holds its connection for good;
// six of those and everything else (sign-in checks, playlists, play commands)
// queues forever until a restart. So no request to the daemon may outlive
// this, whatever the caller forgot. Longer than any daemon-side limit (25s for
// a library page, 30s for an update check).
export const DAEMON_REQUEST_TIMEOUT_MS = 35_000

function isDaemon(url: string): boolean {
  if (API_BASE) return url.startsWith(API_BASE)
  // dev: relative paths through the Vite proxy
  return url.startsWith('/') && !url.startsWith('//')
}

/** wraps window.fetch once, at startup */
export function installDaemonFetchTimeout(timeoutMs = DAEMON_REQUEST_TIMEOUT_MS): void {
  const w = window as Window & { __daemonFetchTimeout?: boolean }
  if (w.__daemonFetchTimeout) return
  w.__daemonFetchTimeout = true
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!isDaemon(url)) return original(input, init)
    const ctrl = new AbortController()
    const outer = init?.signal
    const onAbort = () => ctrl.abort()
    if (outer) {
      if (outer.aborted) ctrl.abort()
      else outer.addEventListener('abort', onAbort)
    }
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
    return original(input, { ...init, signal: ctrl.signal }).finally(() => {
      window.clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    })
  }
}
