# Queued for later

What the owner has asked for but not yet said to start. Build an item when
they say so; show options first where it changes a screen.

## Keep Spotify awake while Maps is open

With Spotify playing and Google Maps navigating on the phone, Spotify
sometimes closes by itself, and the Car Thing drops to its "Pick up where you
left off" screen. Likely Android (Samsung especially) clearing Spotify from
memory while Maps is in front.

Ideas to look at:
- The Wisp app noticing Spotify's media session vanish while it was playing,
  and waking it again where it left off (`SpotifyWaker.kt` already wakes it
  for voice and the Car Thing's play button).
- The Car Thing resuming on its own after such a drop, instead of waiting on
  the Resume button, when the music was playing a moment before.
- Telling the driver to set Spotify's battery to Unrestricted, as the Wisp
  app's setup already does for itself.

## Search for an address on the Car Thing

Today Where to? offers kinds of place (gas, food, coffee…) and recent places;
an address only by voice ("Okay Wisp, take me to 123 Main Street").
Wanted: look up any address, such as a friend's house, and navigate there.

Already there:
- Address lookup: Wisp's own directions find places by name or address
  through Photon (`ownNav.geocode` in `wisp-daemon/daemon/own_nav.go`), the
  same lookup voice uses.
- Sharing a place from the phone to Wisp (`ShareToWispActivity.kt`): worth
  checking whether sharing a Maps place or a contact's address already works.

To decide with the owner (show options first):
- How to enter it without a keyboard: an on-screen keyboard driven by the
  knob, voice with a list of matches to pick from, typing it on the phone
  in the Wisp app, or a contact's address from the phone's contacts.

## Better notifications on the Car Thing

The banners at the top (the phone's notifications, and the turn banner while
directions are on) should behave like an iPhone's:
- **Swiped away stays away.** The turn banner, swiped, comes back straight
  away; it should stay hidden until the next turn. Other notifications,
  swiped, stay gone.
- **The turn banner goes by itself** (owner's call): it shows for a set time
  (5 seconds by default, a setting) and hides, or hides once the turn is made,
  whichever comes first, and comes back for the next turn.
  The turn banner already means to (`dismissedFor` in
  `components/Navigation/NavBanner.tsx`, keyed to the turn): find why it
  doesn't hold, likely the key changing while the instruction updates.
- **Swipe left or right** to dismiss, not only up (`hooks/useSwipeDismiss.ts`,
  used by `components/TopBanner` and `NavBanner`).
- **Icons in the theme's colour** (Settings → Accent colour), not each app's own.
- **Several at once stack** instead of replacing one another, with the newest
  on top and a count; swipe them away one by one or together.

Show the owner a couple of looks before building.

## Better voice: Wisp should understand more, and hear you out

The owner: Wisp stops listening halfway through a request, and doesn't
understand when something should play on YouTube Music (or SoundCloud).

Leads:
- **Stops listening halfway.** The listener ends a command after 0.6 s of
  quiet (`voiceHangSecs` in `wisp-daemon/daemon/voice.go`, cut from 0.8 s to
  answer faster), so a pause mid-sentence ("play… Midnight City") ends it.
  Options: a longer pause again, a longer one only while the words so far
  don't make a whole request, or Wisp's bar showing it's still listening so
  the driver knows to carry on. Car-noise and music (see "Quieter music while
  Wisp listens", 1.0.5) may also cut it off.
- **YouTube Music / SoundCloud.** Only one shape is understood: a play word
  first and the service last ("play X on YouTube Music",
  `serviceVoiceRe` in `voice_services.go`). Not: "on YouTube Music play X",
  "YouTube Music, play X", "play X in YT Music please now", or the service
  misheard ("you two music", "u tube"). Also check the order in
  `TriggerVoice`: Wisp's own rules (`understand`, e.g. "play my liked songs
  on YouTube Music") run before the service check and can take the request
  for Spotify. The phone's model could also be asked which service is meant.
- **Generally better:** collect requests Wisp got wrong (the debug screen's
  log, or a "that's not what I meant" by voice) to see what to teach it next.

## Also in progress

- Wisp Phone, Wisp on a phone alone: on the `phone-app` branch, with where
  it stands in `PHONE-APP.md` there.
