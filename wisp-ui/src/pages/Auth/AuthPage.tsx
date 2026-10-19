import { AuthScreen } from '@/components/AuthScreen'
import { PHONE } from '@/phone'

/** shown once the wait is long enough that it reads as broken rather than slow */
const STUCK_HINT = PHONE
  ? "Still fetching from Spotify. Check your phone's internet."
  : 'Still fetching from Spotify if this persists, try unplugging and replugging.'

export interface AuthPageProps {
  /** the sign-in link, once the daemon has one to give */
  url?: string
  /** waiting on the daemon long enough to say something about it */
  stuck?: boolean
}

/**
 * Sign-in, and the wait before there is anything to sign in with. The second
 * case exists so a first boot after a bluetooth pairing does not flash the
 * starting-up splash on its way here.
 */
export function AuthPage({ url, stuck }: AuthPageProps) {
  if (url) return <AuthScreen url={url} />
  return <AuthScreen hint={stuck ? STUCK_HINT : undefined} />
}
