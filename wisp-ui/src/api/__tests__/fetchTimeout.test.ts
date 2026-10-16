import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDaemonFetchTimeout } from '../fetchTimeout'

describe('installDaemonFetchTimeout', () => {
  const realFetch = window.fetch
  afterEach(() => {
    window.fetch = realFetch
    delete (window as Window & { __daemonFetchTimeout?: boolean }).__daemonFetchTimeout
    vi.useRealTimers()
  })

  it('gives up on a daemon request that never answers, freeing the connection', async () => {
    vi.useFakeTimers()
    // a request that only ends when aborted
    window.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    ) as typeof fetch
    installDaemonFetchTimeout(1000)
    const p = window.fetch('/update/status')
    const settled = expect(p).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1001)
    await settled
  })

  it("still honours the caller's own abort, and leaves other hosts alone", async () => {
    const seen: (AbortSignal | undefined | null)[] = []
    window.fetch = vi.fn((_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal)
      return Promise.resolve(new Response('{}'))
    }) as typeof fetch
    installDaemonFetchTimeout(1000)
    const own = new AbortController()
    await window.fetch('/library/liked', { signal: own.signal })
    expect(seen[0]).not.toBe(own.signal)
    await window.fetch('https://i.scdn.co/image/x')
    expect(seen[1]).toBeUndefined()
  })
})
