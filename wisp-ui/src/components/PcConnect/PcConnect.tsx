import { memo } from 'react'
import { BRAND_NAME, GUIDE_USB_URL } from '@/brand'
import { GuideQR, SetupScene, WispLink } from '@/components/Setup'
import setup from '@/components/Setup/Setup.module.scss'
import styles from '@/components/NeedsNetwork/NeedsNetwork.module.scss'

// getting online through a computer's USB port
function PcConnectImpl() {
  return (
    <SetupScene>
      <div className={styles.row}>
        <div className={styles.text}>
          <h1 className={setup.title}>Connect a computer</h1>
          <ol className={`${setup.steps} ${styles.steps}`}>
            <li>
              <span className={setup.stepNum}>1</span>
              <span>
                Plug {BRAND_NAME} into the computer with a <strong>USB cable that carries data</strong>
              </span>
            </li>
            <li>
              <span className={setup.stepNum}>2</span>
              <span>
                Share the computer's internet with it: <strong>Internet Connection Sharing</strong>{' '}
                on Windows, <strong>Internet Sharing</strong> on a Mac
              </span>
            </li>
          </ol>
          <div className={setup.status}>
            <span className={setup.statusSpark} aria-hidden />
            <span>{BRAND_NAME} carries on by itself once it's online</span>
          </div>
        </div>
        <div className={styles.side}>
          <WispLink from="computer" state="waiting" />
          <GuideQR url={GUIDE_USB_URL} />
        </div>
      </div>
    </SetupScene>
  )
}

export const PcConnect = memo(PcConnectImpl)
