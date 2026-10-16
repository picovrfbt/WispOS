import { createContext, useContext } from 'react'

export const LeavingContext = createContext(false)

/** true while this screen is fading out: it should stop taking the knob and buttons */
export function useLeaving(): boolean {
  return useContext(LeavingContext)
}
