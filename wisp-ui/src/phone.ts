// Wisp Phone: the same screens in a phone app, the phone held sideways. The
// app loads the UI with ?phone, and the Car Thing's physical buttons become a
// strip down the right edge (PhoneRail)

export const PHONE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('phone')

/** the strip's share of the phone's height, so it's the same size on every phone */
export const RAIL_VH = 24

/** what's left of the phone's screen for Wisp, beside the strip, in device px */
export function phonePanel(): { w: number; h: number } {
  const h = window.innerHeight
  return { w: Math.max(1, window.innerWidth - Math.round((h * RAIL_VH) / 100)), h }
}

/** a button on the strip, as the Car Thing's own buttons would press it */
export type PhoneButton = 'home' | 'voice' | 'back'

export const PHONE_BUTTON_EVENT = 'wisp:phone-button'

export function pressPhoneButton(b: PhoneButton): void {
  if (b === 'back') {
    // the Car Thing's back button is Escape
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    return
  }
  window.dispatchEvent(new CustomEvent<PhoneButton>(PHONE_BUTTON_EVENT, { detail: b }))
}
