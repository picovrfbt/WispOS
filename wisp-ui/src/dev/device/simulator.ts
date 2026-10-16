// Car Thing simulator (device.html): the real UI in an 800x480 frame, driven
// by the same input events the hardware produces.
//   dial turn  -> WheelEvent on window, REL_HWHEEL: clockwise is negative deltaX
//   dial press -> Enter, back -> Escape, presets -> Digit1..4, top button -> KeyM
import './simulator.css'

const screen = document.getElementById('screen') as HTMLIFrameElement
const statusEl = document.getElementById('status') as HTMLElement
const knob = document.getElementById('knob') as HTMLElement

// the UI runs in the iframe; its listeners are on its own window
function target(): Window | null {
  return screen.contentWindow
}

function focusScreen() {
  // events go to the frame's window, so it must not lose them to a focused button here
  target()?.focus()
}

let knobAngle = 0

function turn(dir: 1 | -1) {
  const win = target() as (Window & typeof globalThis) | null
  if (!win) return
  win.dispatchEvent(new win.WheelEvent('wheel', { deltaX: dir === 1 ? -1 : 1, cancelable: true }))
  knobAngle += dir * 15
  knob.style.transform = `rotate(${knobAngle}deg)`
}

function key(type: 'keydown' | 'keyup', code: string) {
  const win = target() as (Window & typeof globalThis) | null
  if (!win) return
  const keyName =
    code === 'Enter'
      ? 'Enter'
      : code === 'Escape'
        ? 'Escape'
        : code.replace(/^(Digit|Key)/, '').toLowerCase()
  win.dispatchEvent(
    new win.KeyboardEvent(type, { key: keyName, code, bubbles: true, cancelable: true }),
  )
}

function tap(code: string) {
  key('keydown', code)
  key('keyup', code)
}

// the dial: wheel over the knob, or the nudge buttons. The UI drops notches
// closer together than 55ms, so a fast scroll is spaced out to match the hardware
let lastTurn = 0
knob.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const now = Date.now()
    if (now - lastTurn < 60) return
    lastTurn = now
    turn(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1)
  },
  { passive: false },
)
knob.addEventListener('click', () => {
  tap('Enter')
  knob.classList.add('pressed')
  window.setTimeout(() => knob.classList.remove('pressed'), 120)
})
document.getElementById('cw')!.addEventListener('click', () => turn(1))
document.getElementById('ccw')!.addEventListener('click', () => turn(-1))
document.getElementById('back')!.addEventListener('click', () => tap('Escape'))

// presets and the top button hold: down on press, up on release, so "hold 2s to save" works
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-code]')) {
  const code = btn.dataset.code!
  btn.addEventListener('mousedown', () => key('keydown', code))
  btn.addEventListener('mouseup', () => key('keyup', code))
  btn.addEventListener('mouseleave', (e) => {
    if (e.buttons) key('keyup', code)
  })
}

// keyboard on this page; arrows also work once a tap has moved focus into the screen
const held = new Set<string>()
screen.addEventListener('load', () => {
  target()?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') turn(1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') turn(-1)
    else if (e.key === 'Backspace') tap('Escape')
    else return
    e.preventDefault()
  })
})
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement

window.addEventListener('keydown', (e) => {
  // typing a voice command, not driving the device
  if (typing(e)) return
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') turn(1)
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') turn(-1)
  else if (e.key === 'Enter') tap('Enter')
  else if (e.key === 'Escape' || e.key === 'Backspace') tap('Escape')
  else if (/^Digit[1-4]$/.test(e.code) || e.code === 'KeyM') {
    if (held.has(e.code)) return
    held.add(e.code)
    key('keydown', e.code)
  } else return
  e.preventDefault()
})
window.addEventListener('keyup', (e) => {
  if (typing(e)) return
  if (held.delete(e.code)) key('keyup', e.code)
})

for (const b of document.querySelectorAll('button')) b.addEventListener('mouseup', focusScreen)

// a one-line read of what the daemon thinks the device is doing
async function poll() {
  try {
    const auth = await fetch('/auth/status', { cache: 'no-store' }).then((r) =>
      r.ok ? r.json() : null,
    )
    if (auth?.required) {
      statusEl.textContent = `Spotify sign-in needed: open ${auth.url ?? 'the QR on screen'}`
      statusEl.dataset.state = 'warn'
      return
    }
    const res = await fetch('/observer/status', { cache: 'no-store' })
    const st = res.status === 200 ? await res.json() : null
    if (st?.active) {
      const state = st.is_paused ? 'Paused' : 'Playing'
      statusEl.textContent = `${state}: ${st.track_name} by ${st.track_artist} on ${st.device_name}`
      statusEl.dataset.state = 'ok'
    } else {
      statusEl.textContent = 'Signed in, nothing playing. Start Spotify on your phone or PC'
      statusEl.dataset.state = 'idle'
    }
  } catch {
    statusEl.textContent = 'Daemon not reachable on 127.0.0.1:3678'
    statusEl.dataset.state = 'err'
  }
}
void poll()
window.setInterval(poll, 2000)

// "Okay Wisp": the real voice flow from the transcript on. The Car Thing hears
// the wake word and transcribes on device; here the daemon plays "listening"
// for a moment and then takes the typed command.
const voiceForm = document.getElementById('voice') as HTMLFormElement
const voiceText = document.getElementById('voice-text') as HTMLInputElement
const voiceResult = document.getElementById('voice-result') as HTMLElement
async function sendVoice(e: SubmitEvent) {
  e.preventDefault()
  const transcript = voiceText.value.trim()
  if (!transcript) return
  voiceResult.textContent = 'listening…'
  try {
    const res = await fetch('/voice/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, wake: true }),
    })
    if (res.status === 503) voiceResult.textContent = 'voice is off in dev-device/config/config.yml'
    else if (!res.ok) voiceResult.textContent = "Wisp didn't catch that"
    else {
      const body = (await res.json()) as { text?: string }
      voiceResult.textContent = body.text ? `→ ${body.text}` : 'done'
      voiceText.value = ''
    }
  } catch {
    voiceResult.textContent = 'daemon not reachable'
  }
}
voiceForm.addEventListener('submit', (e) => void sendVoice(e))
