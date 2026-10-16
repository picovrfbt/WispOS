import { createContext, useContext } from 'react'
import { NAV_IDLE, type NavState } from '@/api/nav'

export const NavContext = createContext<NavState>(NAV_IDLE)

/** the phone's turn-by-turn; NavProvider keeps it current */
export function useNav(): NavState {
  return useContext(NavContext)
}
