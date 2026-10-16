import { memo, type ReactNode } from 'react'
import { WispMark } from './WispMark'
import styles from './Setup.module.scss'

interface Props {
  children: ReactNode
  /** the small wordmark in the corner; the boot splash has its own, larger */
  mark?: boolean
  /** amber while something needs doing, as in the phone app; else the accent */
  tone?: 'accent' | 'attention'
  className?: string
}

/**
 * The backdrop every setup and offline screen sits on: near black with the
 * phone app's three soft glows (radial gradients, which read as blur at no
 * cost to Chrome 69), and the wordmark in the corner.
 */
function SetupSceneImpl({ children, mark = true, tone = 'accent', className }: Props) {
  return (
    <div
      className={[styles.scene, tone === 'attention' ? styles.sceneAttention : '', className ?? ''].join(
        ' ',
      )}
    >
      <div className={styles.glows} aria-hidden>
        <span className={styles.glowTop} />
        <span className={styles.glowRight} />
        <span className={styles.glowBottom} />
      </div>
      {mark ? <WispMark size={22} className={styles.sceneMark} /> : null}
      <div className={styles.sceneBody}>{children}</div>
    </div>
  )
}

export const SetupScene = memo(SetupSceneImpl)
