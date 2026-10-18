// first: move saved data from Mira's names before anything reads it
import './storageMigration'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/_global.scss'
import App from './App.tsx'
import { DevOverlay, DevScreenProvider } from '@/dev/DevScreens'
import { NotifyProvider } from '@/notify/NotifyProvider'
import { WispCaption } from '@/voice/WispCaption'
import { VoiceGlow } from '@/components/VoiceGlow'
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary'
import { startUiScaleSync } from '@/uiScale'
import { API_BASE } from '@/config'
import { NavProvider } from '@/hooks/NavProvider'
import { NightShade } from '@/components/NightShade'
import { ArrivalCard } from '@/components/ArrivalCard'
import { installDaemonFetchTimeout } from '@/api/fetchTimeout'
import { getSettings } from '@/settings'
import { ThermalBadge } from '@/components/ThermalBadge'
import { PhoneBatteryWarnings } from '@/components/PhoneBattery'
import { ACCENTS, applyAccent } from '@/theme'
import { PHONE } from '@/phone'
import { PhoneRail } from '@/components/PhoneRail'

// before anything talks to the daemon
installDaemonFetchTimeout()

let uiErrorsSent = 0
function reportUiError(message: string) {
  if (uiErrorsSent >= 10) return
  uiErrorsSent++
  void fetch(`${API_BASE}/debug/ui-error`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message.slice(0, 300) }),
  }).catch(() => {})
}

window.addEventListener('error', (e) => {
  console.error('uncaught:', e.error ?? e.message)
  const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''
  reportUiError(String(e.error ?? e.message) + where)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('unhandled rejection:', e.reason)
  reportUiError('unhandled rejection: ' + String(e.reason))
})

// Wisp Phone: the page is the whole phone screen, with the button strip beside Wisp
if (PHONE) document.documentElement.classList.add('phone')

// before render, so the ui never paints at the wrong size
startUiScaleSync()
// and in the chosen colour; "album" settles once the cover is sampled
{
  const theme = getSettings().accentTheme
  if (theme !== 'album') applyAccent(ACCENTS[theme])
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <DevScreenProvider>
        <NotifyProvider>
          <NavProvider>
            <App />
            <ArrivalCard />
            <NightShade />
          </NavProvider>
          <ThermalBadge />
          <PhoneBatteryWarnings />
          <WispCaption />
          <VoiceGlow />
        </NotifyProvider>
        <DevOverlay />
      </DevScreenProvider>
    </ErrorBoundary>
  </StrictMode>,
)

// outside #root, so the screens' zoom doesn't size the strip
if (PHONE) {
  const rail = document.createElement('div')
  document.body.appendChild(rail)
  createRoot(rail).render(<PhoneRail />)
}
