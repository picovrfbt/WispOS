import { SetupScene } from '@/components/Setup'
import setup from '@/components/Setup/Setup.module.scss'
import { usePhoneDaemonLog } from '@/hooks/usePhoneDaemonLog'
import styles from './PhoneOffline.module.scss'

// how long Wisp gets to start before the screen shows why it hasn't
const DETAILS_AFTER_MS = 20000

/**
 * Wisp Phone in place of the Car Thing's connection screens: there's no phone
 * to pair or computer to plug into, only this phone's own internet. With no
 * word from Wisp's background program at all, it says Wisp is starting, and
 * after a while shows the end of its log, for a screenshot when it won't
 */
export function PhoneOffline({ online }: { online: boolean | null }) {
  const noInternet = online === false
  const log = usePhoneDaemonLog(!noInternet, DETAILS_AFTER_MS)

  return (
    <SetupScene>
      <div className={styles.wrap}>
        <h1 className={setup.title}>{noInternet ? 'No internet' : 'Starting Wisp…'}</h1>
        <p className={styles.text}>
          {noInternet
            ? "Wisp needs your phone's internet. Check Wi-Fi or mobile data, and Wisp carries on by itself."
            : 'This takes a few seconds.'}
        </p>
        {log ? (
          <>
            <p className={styles.text}>Wisp hasn't started. What it said last:</p>
            <pre className={styles.log}>{log}</pre>
          </>
        ) : null}
      </div>
    </SetupScene>
  )
}
