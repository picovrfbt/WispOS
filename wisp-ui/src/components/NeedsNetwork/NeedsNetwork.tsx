import { memo, useEffect } from 'react'
import { BRAND_NAME, BT_DEVICE_NAME, GUIDE_BLUETOOTH_URL } from '@/brand'
import { GuideQR, SetupScene, WispLink } from '@/components/Setup'
import { useKnownDevices } from '@/hooks/useKnownDevices'
import setup from '@/components/Setup/Setup.module.scss'
import styles from './NeedsNetwork.module.scss'

interface Props {
  onMount?: () => void
  retryMs?: number
}

// getting online through the phone: pair, then share its internet
function NeedsNetworkImpl({ onMount, retryMs = 3000 }: Props) {
  useEffect(() => {
    if (!onMount) return
    onMount()
    const id = window.setInterval(onMount, retryMs)
    return () => window.clearInterval(id)
  }, [onMount, retryMs])

  const { devices } = useKnownDevices(true)
  const connectedDevice = devices?.find((d) => d.connected)
  const paired = Boolean(connectedDevice)
  const name = connectedDevice ? connectedDevice.name || connectedDevice.address : ''

  return (
    <SetupScene tone={paired ? 'attention' : 'accent'}>
      <div className={styles.row}>
        <div className={styles.text}>
          <h1 className={setup.title}>{paired ? 'Almost there' : 'Connect a phone'}</h1>
          <ol className={`${setup.steps} ${styles.steps}`}>
            {paired ? (
              <>
                <li>
                  <span className={setup.stepNum}>✓</span>
                  <span>
                    <strong>{name}</strong> is paired
                  </span>
                </li>
                <li>
                  <span className={setup.stepNum}>2</span>
                  <span>
                    Turn on <strong>Bluetooth tethering</strong> on the phone (on iPhone,{' '}
                    <strong>Personal Hotspot</strong>)
                  </span>
                </li>
              </>
            ) : (
              <>
                <li>
                  <span className={setup.stepNum}>1</span>
                  <span>
                    In your phone's <strong>Bluetooth settings</strong>, pair with{' '}
                    <span className={setup.chip}>{BT_DEVICE_NAME}</span>
                  </span>
                </li>
                <li>
                  <span className={setup.stepNum}>2</span>
                  <span>
                    Turn on <strong>Bluetooth tethering</strong> (on iPhone,{' '}
                    <strong>Personal Hotspot</strong>)
                  </span>
                </li>
              </>
            )}
          </ol>
          <div className={setup.status}>
            <span className={setup.statusSpark} aria-hidden />
            <span>
              {paired
                ? 'Waiting for internet from the phone'
                : `${BRAND_NAME} carries on by itself once it's online`}
            </span>
          </div>
        </div>
        <div className={styles.side}>
          <WispLink from="phone" state={paired ? 'linked' : 'waiting'} />
          <GuideQR url={GUIDE_BLUETOOTH_URL} />
        </div>
      </div>
    </SetupScene>
  )
}

export const NeedsNetwork = memo(NeedsNetworkImpl)
