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

## Also in progress

- Wisp Phone, Wisp on a phone alone: on the `phone-app` branch, with where
  it stands in `PHONE-APP.md` there.
