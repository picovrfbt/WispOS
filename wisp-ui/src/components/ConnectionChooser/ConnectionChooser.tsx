import { memo } from 'react'
import { BRAND_NAME } from '@/brand'
import { SetupScene, useKnobChoice } from '@/components/Setup'
import styles from './ConnectionChooser.module.scss'

interface Props {
  onPickPc: () => void
  onPickBluetooth: () => void
}

function PhoneIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <line x1="10.5" y1="18" x2="13.5" y2="18" />
    </svg>
  )
}

function ComputerIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="11" rx="1.5" />
      <line x1="1.5" y1="19.5" x2="22.5" y2="19.5" />
    </svg>
  )
}

// when there's no internet: where Wisp should borrow it from
function ConnectionChooserImpl({ onPickPc, onPickBluetooth }: Props) {
  const { ref, focused } = useKnobChoice(2)
  const card = (i: number) => [styles.card, focused === i ? styles.cardFocused : ''].join(' ')
  return (
    <SetupScene>
      <h1 className={styles.title}>Let's get {BRAND_NAME} online</h1>
      <p className={styles.lede}>{BRAND_NAME} borrows internet from your phone or a computer.</p>

      <div className={styles.cards} ref={ref}>
        <button type="button" className={card(0)} onClick={onPickBluetooth} aria-label="Connect with Bluetooth">
          <span className={styles.icon}>
            <PhoneIcon />
          </span>
          <span className={styles.cardText}>
            <span className={styles.cardTitle}>Your phone</span>
            <span className={styles.cardSub}>Over Bluetooth</span>
          </span>
          <span className={styles.badge}>Recommended</span>
        </button>

        <button type="button" className={card(1)} onClick={onPickPc} aria-label="Connect to PC">
          <span className={styles.icon}>
            <ComputerIcon />
          </span>
          <span className={styles.cardText}>
            <span className={styles.cardTitle}>A computer</span>
            <span className={styles.cardSub}>Over a USB cable</span>
          </span>
        </button>
      </div>

      <p className={styles.footnote}>Turn the knob to choose, press to continue</p>
    </SetupScene>
  )
}

export const ConnectionChooser = memo(ConnectionChooserImpl)
