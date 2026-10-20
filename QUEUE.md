# Queued for later

What the owner has asked for but not yet said to start. Build an item when
they say so; show options first where it changes a screen.

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

- On the `next` branch, waiting to be released: Spotify kept awake while
  Maps is open, better voice (hears you out; YouTube Music and SoundCloud
  however it's said) and better notifications (turn banner for 5 seconds,
  swipe any way, stacking, accent-coloured icons). See "Unreleased" in
  CHANGELOG.md.
- Wisp Phone, Wisp on a phone alone: on the `phone-app` branch, with where
  it stands in `PHONE-APP.md` there.
