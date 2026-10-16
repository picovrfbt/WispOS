import { useEffect, useState } from 'react'

/**
 * `value`, but only once it has stopped changing for `ms`. For work that is
 * wasted on every intermediate value, like baking the artwork of each card the
 * dial spins past on its way to the one you stop on.
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(value, settled)) return
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms, settled])
  return settled
}
