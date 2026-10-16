import { memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { GUIDE_HOME } from '@/brand'
import styles from './Setup.module.scss'

interface Props {
  url: string
}

/** a small QR to the setup guide, for when the steps on screen aren't enough */
function GuideQRImpl({ url }: Props) {
  return (
    <div className={styles.guide}>
      <div className={styles.guideQr}>
        <QRCodeSVG value={url} size={76} bgColor="#ffffff" fgColor="#0b0b0c" level="M" marginSize={1} />
      </div>
      <div className={styles.guideText}>
        <span className={styles.guideTitle}>Need a hand?</span>
        <span>Scan for the step-by-step guide</span>
        <span className={styles.guideUrl}>{GUIDE_HOME}</span>
      </div>
    </div>
  )
}

export const GuideQR = memo(GuideQRImpl)
