import { API_BASE } from '@/config'
import { getSettings } from '@/settings'

/**
 * What Wisp says out loud. "confirm" lines (what a voice command did) are
 * spoken when Settings → Wisp's voice is Confirmations or Everything; "extra"
 * lines (notifications, arrival) only on Everything. The phone does the
 * speaking, at Settings → Voice speed; with no phone it just stays quiet.
 */
export type SpeechKind = 'confirm' | 'extra'

export function shouldSpeak(kind: SpeechKind, mode = getSettings().wispVoice): boolean {
  if (mode === 'everything') return true
  return mode === 'confirmations' && kind === 'confirm'
}

export function speak(text: string, kind: SpeechKind): void {
  if (!text.trim() || !shouldSpeak(kind)) return
  void sayNow(text)
}

/** speaks regardless of the setting: the Voice speed preview */
export async function sayNow(text: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/phone/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        speed: getSettings().voiceSpeed,
        volume: getSettings().voiceVolumePct / 100,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** "Midnight City - M83" (the daemon's label) as it's said: "Midnight City, by M83" */
export function spokenTrack(label: string): string {
  const i = label.lastIndexOf(' - ')
  return i > 0 ? `${label.slice(0, i)}, by ${label.slice(i + 3)}` : label
}
