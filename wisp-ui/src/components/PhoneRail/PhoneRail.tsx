import { pressPhoneButton, type PhoneButton } from '@/phone'
import styles from './PhoneRail.module.scss'

const BUTTONS: { id: PhoneButton; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  {
    id: 'voice',
    label: 'Wisp',
    icon: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  },
  { id: 'back', label: 'Back', icon: 'M15 5l-7 7 7 7' },
]

/**
 * Wisp Phone's stand-in for the Car Thing's buttons: Home, Wisp and Back down
 * the right edge of the phone, beside the screens
 */
export function PhoneRail() {
  return (
    <nav className={styles.rail} aria-label="Wisp buttons">
      {BUTTONS.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`${styles.btn} ${b.id === 'voice' ? styles.voice : ''}`}
          onClick={() => pressPhoneButton(b.id)}
        >
          <span className={styles.chip} aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={b.icon} />
            </svg>
          </span>
          <span>{b.label}</span>
        </button>
      ))}
    </nav>
  )
}
