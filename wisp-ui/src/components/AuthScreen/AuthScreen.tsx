import { memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { SetupScene } from '@/components/Setup'
import setup from '@/components/Setup/Setup.module.scss'
import styles from './AuthScreen.module.scss'

interface Props {
  url?: string // if undefined we render the loading placeholder
  hint?: string // shown beneath the loading state if it gets stuck
}

// strip the start of the url, we only need to perserve the spotify url and the pair code
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

// the last step: Spotify sign-in, by QR on the phone or the link anywhere
function AuthScreenImpl({ url, hint }: Props) {
  const loading = !url
  return (
    <SetupScene>
      <div className={styles.row}>
        <div className={styles.qrPanel}>
          {loading ? (
            <div className={styles.qrPlaceholder} role="status" aria-label="Fetching pairing code">
              <span className={styles.qrSpinner} aria-hidden />
            </div>
          ) : (
            <QRCodeSVG value={url} size={232} bgColor="#ffffff" fgColor="#0b0b0c" level="M" marginSize={1} />
          )}
        </div>
        <div className={styles.text}>
          <h1 className={setup.title}>Sign in to Spotify</h1>
          <ol className={setup.steps}>
            <li>
              <span className={setup.stepNum}>1</span>
              <span>Scan the code with your phone's camera</span>
            </li>
            <li>
              <span className={setup.stepNum}>2</span>
              <span>Sign in to your Spotify account</span>
            </li>
          </ol>
          {loading ? null : (
            <div className={styles.fallback}>
              <span className={styles.fallbackLabel}>Or open this on any browser</span>
              <span className={styles.fallbackUrl}>{displayUrl(url)}</span>
            </div>
          )}
          <div className={setup.status}>
            <span className={setup.statusSpark} aria-hidden />
            <span>{loading ? 'fetching pairing code...' : 'waiting for sign-in...'}</span>
          </div>
          {loading && hint ? <div className={styles.hint}>{hint}</div> : null}
        </div>
      </div>
    </SetupScene>
  )
}

export const AuthScreen = memo(AuthScreenImpl)
