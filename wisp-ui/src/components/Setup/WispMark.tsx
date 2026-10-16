import { memo } from 'react'
import { BRAND_NAME } from '@/brand'
import styles from './Setup.module.scss'

interface Props {
  /** the wordmark's font size; the wisp under it scales with it */
  size?: number
  /** loading: light circles along the wisp into its spark, one streak after another (the boot splash) */
  animate?: boolean
  className?: string
}

/**
 * Wisp's wordmark: "wisp" with the wisp of light under it, ending in its
 * spark. The same curve as the logo and the phone app's (WispViews.kt's
 * WispUnderline), on a 150 x 22 grid.
 */
function WispMarkImpl({ size = 28, animate = false, className }: Props) {
  const lineW = size * 1.9
  return (
    <div
      className={[styles.mark, animate ? styles.markAnimate : '', className ?? ''].join(' ')}
      aria-label={BRAND_NAME}
      role="img"
    >
      <span className={styles.markWord} style={{ fontSize: size }} aria-hidden>
        {BRAND_NAME.toLowerCase()}
      </span>
      <svg
        className={styles.markWisp}
        width={lineW}
        height={(lineW * 22) / 150}
        // a gap of 22% of the word's size clears the p's descender (measured on the Car Thing's Inter)
        style={{ marginTop: Math.round(size * 0.22) }}
        viewBox="0 0 150 22"
        aria-hidden
      >
        <path
          className={styles.markPath}
          d="M3 15 C30 3 52 21 76 11 C100 1 122 2 140 7"
          pathLength={100}
        />
        {animate ? (
          <path
            className={styles.markFlow}
            d="M3 15 C30 3 52 21 76 11 C100 1 122 2 140 7"
            pathLength={100}
          />
        ) : null}
        <circle className={styles.markSpark} cx="143" cy="7" r="3.4" />
      </svg>
    </div>
  )
}

export const WispMark = memo(WispMarkImpl)
