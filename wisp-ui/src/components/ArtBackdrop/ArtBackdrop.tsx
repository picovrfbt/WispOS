import { memo, useState } from 'react'
import { useBakedArt } from '@/hooks/useBakedArt'
import styles from './ArtBackdrop.module.scss'

/**
 * The cover blurred to fill the screen behind a view. The blur is baked once
 * per cover (useBakedArt) and shown as a plain stretched image, so it costs the
 * Car Thing nothing per frame.
 */
function ArtBackdropImpl({
  src,
  dark = false,
  className = '',
}: {
  src: string | undefined
  dark?: boolean
  className?: string
}) {
  const baked = useBakedArt(src, dark ? 'dark' : 'normal')
  const url = baked?.backdrop
  // the outgoing art stays underneath while the new one fades in
  const [shown, setShown] = useState({ cur: url, prev: undefined as string | undefined })
  if (url !== shown.cur) setShown({ cur: url, prev: shown.cur })

  return (
    <div className={`${styles.backdrop} ${dark ? styles.dark : ''} ${className}`} aria-hidden>
      {shown.prev ? (
        <div className={styles.backdropArt} style={{ backgroundImage: `url("${shown.prev}")` }} />
      ) : null}
      {shown.cur ? (
        <div
          key={shown.cur}
          className={`${styles.backdropArt} ${styles.backdropIn}`}
          style={{ backgroundImage: `url("${shown.cur}")` }}
        />
      ) : null}
      <div className={styles.backdropShade} />
    </div>
  )
}

export const ArtBackdrop = memo(ArtBackdropImpl)
