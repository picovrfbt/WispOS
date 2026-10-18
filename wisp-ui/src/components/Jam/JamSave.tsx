import { memo, useEffect, useState } from 'react'
import { forgetJam, saveJam, useJam, type JamSaved } from '@/api/jam'
import { useDial } from '@/components/Home/useDial'
import styles from './Jam.module.scss'

interface Props {
  onClose: () => void
}

const SHOW_SAVED_MS = 3500

/**
 * Jam favorites: when a session ends with songs the passengers added, keep
 * them as a private Spotify playlist, or not. The knob moves between Save and
 * No thanks; back is No thanks.
 */
function JamSaveImpl({ onClose }: Props) {
  const jam = useJam()
  const [focus, setFocus] = useState<'save' | 'skip'>('save')
  const [phase, setPhase] = useState<'ask' | 'saving' | 'saved' | 'failed'>('ask')
  const [saved, setSaved] = useState<JamSaved | null>(null)

  useEffect(() => {
    if (phase !== 'saved') return
    const t = window.setTimeout(onClose, SHOW_SAVED_MS)
    return () => window.clearTimeout(t)
  }, [phase, onClose])

  const save = () => {
    if (phase === 'saving') return
    setPhase('saving')
    saveJam()
      .then((s) => {
        setSaved(s)
        setPhase('saved')
      })
      .catch(() => setPhase('failed'))
  }
  const skip = () => {
    void forgetJam()
    onClose()
  }

  useDial({
    onStep: (dir) => setFocus(dir > 0 ? 'skip' : 'save'),
    onPress: () => (phase === 'saved' ? onClose() : focus === 'save' ? save() : skip()),
    onBack: () => (phase === 'saved' ? onClose() : skip()),
  })

  const songs = jam.picks
  let title = 'Keep their songs?'
  let text = `Save the ${songs === 1 ? 'song' : `${songs} songs`} the passengers added as a private Spotify playlist.`
  if (phase === 'saved' && saved) {
    title = 'Saved to Spotify'
    text = `“${saved.name}” is in your library with ${saved.songs} ${saved.songs === 1 ? 'song' : 'songs'}.`
    if (saved.missing > 0)
      text += ` ${saved.missing} from YouTube Music or SoundCloud ${saved.missing === 1 ? "wasn't" : "weren't"} on Spotify.`
  } else if (phase === 'failed') {
    title = "Couldn't save"
    text = "Spotify didn't take the playlist. Check the connection and try again."
  }

  return (
    <div
      className={`${styles.root} ${styles.saveRoot}`}
      role="dialog"
      aria-label="Keep their songs"
    >
      <div className={styles.saveArt} aria-hidden>
        <svg width="84" height="84" viewBox="0 0 24 24" fill="currentColor">
          {phase === 'saved' ? (
            <path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z" />
          ) : (
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18A3 3 0 1 0 19 17V8h3V6h-5z" />
          )}
        </svg>
      </div>
      <div className={styles.side}>
        <div className={styles.eyebrow}>The passengers&rsquo; picks</div>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.text}>{text}</p>
        {phase === 'saved' ? null : (
          <div className={styles.buttons}>
            <button
              type="button"
              className={`${styles.btn} ${styles.save} ${focus === 'save' ? styles.on : ''}`}
              onClick={save}
            >
              {phase === 'saving' ? 'Saving…' : phase === 'failed' ? 'Try again' : 'Save'}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${focus === 'skip' ? styles.on : ''}`}
              onClick={skip}
            >
              No thanks
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export const JamSave = memo(JamSaveImpl)
