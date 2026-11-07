import { useEffect, useRef, useState } from 'react'
import { SetupScene } from '@/components/Setup'
import styles from './Tutorial.module.scss'

/**
 * The controls, taught hands-on the first time Wisp starts after a flash:
 * each step lights the control on a drawing of the Car Thing and waits for
 * the driver to use it. While it's open the controls only teach (App pauses
 * their usual jobs), so turning the dial here doesn't change the volume.
 * Skip ends it; every step can be skipped too, in case a button is broken.
 */

type Part = 'screen' | 'dial' | 'back' | 'presets' | 'power' | 'mic'

interface Step {
  id: string
  part: Part
  title: string
  body: string
  /** what to do, under the text */
  task: string
}

const STEPS: Step[] = [
  {
    id: 'tap',
    part: 'screen',
    title: 'Welcome to Wisp',
    body: "Let's try every control once. It takes about a minute.",
    task: 'Tap the screen to start',
  },
  {
    id: 'turn',
    part: 'dial',
    title: 'Turn the dial',
    body: 'It sets the volume, and moves through lists and menus.',
    task: 'Turn it both ways',
  },
  {
    id: 'press',
    part: 'dial',
    title: 'Press the dial',
    body: 'Plays and pauses. In a list, it picks what’s highlighted.',
    task: 'Press the dial down',
  },
  {
    id: 'back',
    part: 'back',
    title: 'The back button',
    body: 'Under the dial. It goes back a step, and from the player it opens Home.',
    task: 'Press back',
  },
  {
    id: 'presets',
    part: 'presets',
    title: 'The four top buttons',
    body: 'Each plays a favorite. Hold one for 2 seconds to save what’s playing to it.',
    task: 'Press all four',
  },
  {
    id: 'power',
    part: 'power',
    title: 'The small button on top',
    body: 'At the right of the four. Press it for sleep and restart, twice for the clock.',
    task: 'Press it once',
  },
  {
    id: 'swipe',
    part: 'screen',
    title: 'Swipe to skip',
    body: 'On the player, swipe left for the next song and right for the one before.',
    task: 'Swipe left, then right',
  },
  {
    id: 'two',
    part: 'screen',
    title: 'Two fingers for lyrics',
    body: 'On the player, swipe up or down with two fingers to switch lyrics and the cover.',
    task: 'Swipe with two fingers',
  },
  {
    id: 'voice',
    part: 'mic',
    title: '“Okay Wisp”',
    body: 'Ask for any song, directions, the weather and more, hands-free.',
    task: 'Press the dial to finish',
  },
]

const PRESET_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4']
// dial notches each way before turning counts as learned
const TURNS_NEEDED = 3
// a finger this far sideways is a swipe
const SWIPE_PX = 70

interface Props {
  onDone: () => void
}

export function Tutorial({ onDone }: Props) {
  const [at, setAt] = useState(0)
  // how far into a step: notches each way, presets pressed, swipes made
  const [turns, setTurns] = useState({ left: 0, right: 0 })
  const [presets, setPresets] = useState<boolean[]>([false, false, false, false])
  const [swiped, setSwiped] = useState({ left: false, right: false })
  const [nice, setNice] = useState(false)
  const step = STEPS[at]

  // the handlers below are attached once and read these
  const doneRef = useRef(onDone)
  const stepRef = useRef(step.id)
  useEffect(() => {
    doneRef.current = onDone
    stepRef.current = step.id
  })
  const advancing = useRef(false)

  // a short "nice" on the drawing, then on to the next control
  const next = useRef(() => {
    if (advancing.current) return
    advancing.current = true
    setNice(true)
    window.setTimeout(() => {
      advancing.current = false
      setNice(false)
      if (stepRef.current === STEPS[STEPS.length - 1].id) doneRef.current()
      else setAt((a) => Math.min(a + 1, STEPS.length - 1))
    }, 550)
  })

  // the knob, back, the top buttons: held here (capture, ahead of the app's own
  // handlers) so they teach rather than act
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = stepRef.current
      const known =
        e.key === 'Enter' ||
        e.key === 'Escape' ||
        e.code === 'KeyM' ||
        PRESET_CODES.includes(e.code)
      if (!known) return
      e.preventDefault()
      e.stopPropagation()
      if (e.type !== 'keyup' || e.repeat) return
      if (e.key === 'Enter' && (id === 'press' || id === 'voice')) next.current()
      else if (e.key === 'Escape' && id === 'back') next.current()
      else if (e.code === 'KeyM' && id === 'power') next.current()
      else if (id === 'presets' && PRESET_CODES.includes(e.code)) {
        const i = PRESET_CODES.indexOf(e.code)
        setPresets((p) => {
          const n = p.map((v, j) => v || j === i)
          if (n.every(Boolean)) next.current()
          return n
        })
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX === 0 && e.deltaY === 0) return
      e.preventDefault()
      if (stepRef.current !== 'turn') return
      const right = (e.deltaX || e.deltaY) > 0
      setTurns((t) => {
        const n = right ? { ...t, right: t.right + 1 } : { ...t, left: t.left + 1 }
        if (n.left >= TURNS_NEEDED && n.right >= TURNS_NEEDED) next.current()
        return n
      })
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [])

  // the screen: a tap, one-finger swipes, a two-finger swipe
  const touch = useRef<{ x: number; y: number; fingers: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!touch.current) touch.current = { x: t.clientX, y: t.clientY, fingers: e.touches.length }
    else touch.current.fingers = Math.max(touch.current.fingers, e.touches.length)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = touch.current
    if (!s || stepRef.current !== 'two' || e.touches.length < 2) return
    if (Math.abs(e.touches[0].clientY - s.y) > 40) {
      touch.current = null
      next.current()
    }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current
    if (!s || e.touches.length > 0) return
    touch.current = null
    const t = e.changedTouches[0]
    swipeOrTap(t.clientX - s.x, t.clientY - s.y, s.fingers)
  }
  // the desktop simulator has a mouse: a drag is a one-finger swipe
  const mouse = useRef<{ x: number; y: number } | null>(null)
  const swipeOrTap = (dx: number, dy: number, fingers: number) => {
    const id = stepRef.current
    if (id === 'tap' && Math.abs(dx) < 20 && Math.abs(dy) < 20) next.current()
    if (id === 'swipe' && fingers === 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      setSwiped((s) => {
        const n = dx < 0 ? { ...s, left: true } : { ...s, right: true }
        if (n.left && n.right) next.current()
        return n
      })
    }
  }

  return (
    <SetupScene>
      <div
        className={styles.root}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={(e) => {
          if (e.button === 0) mouse.current = { x: e.clientX, y: e.clientY }
        }}
        onMouseUp={(e) => {
          const s = mouse.current
          mouse.current = null
          if (s) swipeOrTap(e.clientX - s.x, e.clientY - s.y, 1)
        }}
        role="dialog"
        aria-label="Controls tutorial"
      >
        <CarThing part={step.part} nice={nice} presets={presets} />

        <div className={styles.text} key={step.id}>
          <div className={styles.count}>
            {at + 1} of {STEPS.length}
          </div>
          <h1 className={styles.title}>{step.title}</h1>
          <p className={styles.body}>{step.body}</p>
          <div className={`${styles.task} ${nice ? styles.taskDone : ''}`}>
            {nice ? 'Nice' : step.task}
            {step.id === 'turn' && !nice ? (
              <span className={styles.meter}>
                Left <Pips n={turns.left} /> Right <Pips n={turns.right} />
              </span>
            ) : null}
            {step.id === 'swipe' && !nice ? (
              <span className={styles.meter}>
                Left {swiped.left ? '✓' : '○'} Right {swiped.right ? '✓' : '○'}
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.dots} aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s.id} className={i <= at ? styles.dotOn : undefined} />
          ))}
        </div>

        <div className={styles.skips}>
          {at < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => next.current()}
              onMouseUp={(e) => e.stopPropagation()}
            >
              Skip step
            </button>
          ) : null}
          <button type="button" onClick={onDone} onMouseUp={(e) => e.stopPropagation()}>
            Skip tutorial
          </button>
        </div>
      </div>
    </SetupScene>
  )
}

function Pips({ n }: { n: number }) {
  return (
    <span className={styles.pips}>
      {Array.from({ length: TURNS_NEEDED }, (_, i) => (
        <i key={i} className={i < n ? styles.pipOn : undefined} />
      ))}
    </span>
  )
}

/**
 * The Car Thing face on, drawn to match the website's picture of it: the black
 * body with its screen, the big dial hanging over the right edge, back as a
 * ringed circle under it, four buttons along the top and a shorter one at the
 * right. Drawn rather than a photo so each control can light up, and tiny.
 */
function CarThing({ part, nice, presets }: { part: Part; nice: boolean; presets: boolean[] }) {
  const lit = (p: Part) => (part === p ? `${styles.lit} ${nice ? styles.litDone : ''}` : '')
  return (
    <svg className={styles.device} viewBox="60 90 1520 800" aria-hidden>
      <defs>
        <linearGradient id="ctDial" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5e5f64" />
          <stop offset="1" stopColor="#3c3d41" />
        </linearGradient>
        <linearGradient id="ctScreen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24121f" />
          <stop offset="0.6" stopColor="#120a14" />
          <stop offset="1" stopColor="#0b0a10" />
        </linearGradient>
      </defs>
      {/* top buttons: four presets, then the shorter one at the right */}
      {[237, 497, 756, 1015].map((x, i) => (
        <rect
          key={x}
          x={x}
          y={112}
          width={122}
          height={26}
          rx={8}
          className={`${styles.btn} ${lit('presets')} ${presets[i] && part === 'presets' ? styles.pressed : ''}`}
        />
      ))}
      <rect
        x={1267}
        y={112}
        width={81}
        height={26}
        rx={8}
        className={`${styles.btn} ${lit('power')}`}
      />
      {/* the body, with its slightly lighter edge */}
      <rect x={97} y={128} width={1406} height={722} rx={78} className={styles.body} />
      {/* the screen, with a hint of the player on it */}
      <rect
        x={150}
        y={172}
        width={1055}
        height={633}
        rx={22}
        className={`${styles.screen} ${lit('screen')}`}
      />
      <g className={styles.screenUi}>
        <rect x={182} y={204} width={263} height={263} rx={16} />
        <rect x={182} y={492} width={210} height={26} rx={8} />
        <rect x={182} y={536} width={150} height={20} rx={8} opacity={0.6} />
        <rect x={480} y={230} width={480} height={30} rx={10} opacity={0.5} />
        <rect x={480} y={310} width={300} height={30} rx={10} />
        <rect x={480} y={390} width={360} height={30} rx={10} opacity={0.5} />
        <rect x={266} y={624} width={822} height={8} rx={4} opacity={0.4} />
        <circle cx={677} cy={716} r={46} />
      </g>
      {part === 'mic' ? (
        <g className={`${styles.lit} ${nice ? styles.litDone : ''}`}>
          <circle cx={677} cy={488} r={90} className={styles.micRing} />
          <circle cx={677} cy={488} r={170} className={styles.micRing} />
        </g>
      ) : null}
      {/* the dial over the right edge, and back under it */}
      {part === 'dial' ? (
        <circle cx={1342} cy={416} r={232} className={`${styles.ring} ${lit('dial')}`} />
      ) : null}
      <circle cx={1342} cy={416} r={205} fill="url(#ctDial)" className={styles.dial} />
      <circle cx={1342} cy={743} r={43} className={`${styles.back} ${lit('back')}`} />
    </svg>
  )
}
