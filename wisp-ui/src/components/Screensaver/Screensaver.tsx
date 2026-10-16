import { memo, useEffect, useState } from 'react'
import styles from './Screensaver.module.scss'
import { useWeather, weatherKind, type Weather, type WeatherKind } from '@/api/weather'
import { useSettings } from '@/settings'
import { coverUrl } from '@/api/covers'
import { useLeaving } from '@/overlays/leavingContext'

// double press of the power button opens this screensaver w clock
// also auto opens from the idle after 10 mins

interface Props {
  /** shown when there's no real weather (the dev screen) */
  sampleWeather?: Weather
  artUrl?: string | null
  utcOffsetMin?: number | null
  onClose: () => void
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function displayNow(utcOffsetMin: number | null | undefined): Date {
  const d = new Date()
  if (typeof utcOffsetMin !== 'number') return d
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  return new Date(utcMs + utcOffsetMin * 60_000)
}

// chrome 69 on the device has no locale data, so toLocaleDateString ignores the format options
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const POWER_KEY_CODE = 'KeyM'
const ART_FADE_MS = 900

function ScreensaverImpl({ artUrl, utcOffsetMin, onClose, sampleWeather }: Props) {
  const [now, setNow] = useState(() => displayNow(utcOffsetMin))

  useEffect(() => {
    setNow(displayNow(utcOffsetMin))
    const id = window.setInterval(() => {
      setNow((prev) => {
        const d = displayNow(utcOffsetMin)
        return d.getMinutes() !== prev.getMinutes() || d.getHours() !== prev.getHours() ? d : prev
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [utcOffsetMin])

  const [shownArt, setShownArt] = useState<string | null>(artUrl ?? null)
  const [prevArt, setPrevArt] = useState<string | null>(null)
  useEffect(() => {
    // full size: the screensaver shows it big
    const next = coverUrl(artUrl ?? undefined, 640) ?? null
    if (next === shownArt) return
    if (!next) {
      setShownArt(null)
      setPrevArt(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setPrevArt(shownArt)
      setShownArt(next)
    }
    img.onerror = () => {
      if (cancelled) return
      setShownArt(next)
    }
    img.src = next
    return () => {
      cancelled = true
    }
  }, [artUrl, shownArt])
  useEffect(() => {
    if (prevArt == null) return
    const t = window.setTimeout(() => setPrevArt(null), ART_FADE_MS)
    return () => window.clearTimeout(t)
  }, [prevArt])

  // swallow every key, until it's fading out
  const leaving = useLeaving()
  useEffect(() => {
    if (leaving) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === POWER_KEY_CODE) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === POWER_KEY_CODE) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
    }
  }, [onClose, leaving])

  let hours = now.getHours() % 12
  if (hours === 0) hours = 12
  const ampm = now.getHours() < 12 ? 'AM' : 'PM'
  const date = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`
  const { tempUnit } = useSettings()
  const weather = useWeather(tempUnit) ?? sampleWeather ?? null

  return (
    <div className={styles.container} onClick={onClose}>
      {prevArt ? (
        <div className={styles.art} style={{ backgroundImage: `url(${prevArt})` }} aria-hidden />
      ) : null}
      {shownArt ? (
        <div
          key={shownArt}
          className={`${styles.art} ${styles.artEnter}`}
          style={{ backgroundImage: `url(${shownArt})` }}
          aria-hidden
        />
      ) : (
        <div className={styles.plain} aria-hidden />
      )}
      <div className={styles.scrim} aria-hidden />
      <div className={styles.content}>
        <div className={styles.date}>
          {date}
          {weather ? (
            <span className={styles.weather}>
              <WeatherIcon kind={weatherKind(weather)} />
              {weather.temp}°{weather.unit}
              {weather.summary ? (
                <span className={styles.weatherWords}>{weather.summary}</span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className={styles.clock}>
          {hours}:{pad2(now.getMinutes())}
          <span className={styles.ampm}>{ampm}</span>
        </div>
      </div>
    </div>
  )
}

export const Screensaver = memo(ScreensaverImpl)

// drawn, not emoji: the Car Thing has no colour emoji font
const CLOUD = 'M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.3 9 4.5 4.5 0 0 1 17 18z'
function WeatherIcon({ kind }: { kind: WeatherKind }) {
  const sun = (
    <g>
      <circle cx="12" cy="12" r="4.2" fill="#ffc83d" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect
          key={a}
          x="11.2"
          y="1.5"
          width="1.6"
          height="3.4"
          rx="0.8"
          fill="#ffc83d"
          transform={`rotate(${a} 12 12)`}
        />
      ))}
    </g>
  )
  const drops = (color: string, dy = 0) => (
    <g fill={color}>
      <rect x="8" y={19 + dy} width="1.8" height="3.2" rx="0.9" />
      <rect x="12" y={19.5 + dy} width="1.8" height="3.2" rx="0.9" />
      <rect x="16" y={19 + dy} width="1.8" height="3.2" rx="0.9" />
    </g>
  )
  return (
    <svg
      className={styles.weatherGlyph}
      width="30"
      height="30"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {kind === 'sun' ? sun : null}
      {kind === 'moon' ? <path d="M15 3a8 8 0 1 0 6 13.5A7 7 0 0 1 15 3z" fill="#e8e4ff" /> : null}
      {kind === 'partly' ? (
        <>
          <g transform="translate(-3 -3) scale(0.8)">{sun}</g>
          <path d={CLOUD} fill="#fff" transform="translate(1 1)" />
        </>
      ) : null}
      {kind === 'cloud' ||
      kind === 'rain' ||
      kind === 'snow' ||
      kind === 'storm' ||
      kind === 'fog' ? (
        <path d={CLOUD} fill="#e6e9ef" transform={kind === 'cloud' ? '' : 'translate(0 -3)'} />
      ) : null}
      {kind === 'rain' ? drops('#6cb6ff', -2) : null}
      {kind === 'snow' ? drops('#ffffff', -2) : null}
      {kind === 'storm' ? <path d="M12 15h3l-2 4h2.5L11 24l1.5-4H10z" fill="#ffd23d" /> : null}
      {kind === 'fog' ? (
        <g fill="#c9ced8">
          <rect x="4" y="17" width="16" height="1.6" rx="0.8" />
          <rect x="6" y="20" width="12" height="1.6" rx="0.8" />
        </g>
      ) : null}
    </svg>
  )
}
