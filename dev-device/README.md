# Car Thing simulator

Runs the **real** wisp-daemon on this PC, logged into your Spotify, with the
**real** UI inside a Car Thing frame. Everything it shows is your live account:
playlists, Recents, and whatever is playing on your phone or PC.

```
powershell -ExecutionPolicy Bypass -File dev-device\start.ps1
```

Then open http://localhost:5173/device.html (the script opens it for you).

Add `-FakePhone` to also replay a drive through San Francisco, so navigation
(the turn banner, the map, Home → Navigation) has something to show without a
phone. With the real phone app, see `wisp-companion/README.md`.

| Car Thing   | Simulator                                      |
| ----------- | ---------------------------------------------- |
| Dial turn   | scroll over the knob, the ⟲ ⟳ buttons, or ← →  |
| Dial press  | click the knob, or Enter                       |
| Back        | the back button, Esc or Backspace              |
| Presets 1–4 | the top buttons, or keys 1–4 (hold 2s to save) |
| Top button  | ⏻, or M (double-press for the clock)           |
| Touchscreen | click/drag on the screen                       |
| "Okay Wisp" | type in the "Say to Wisp" box under the device |

Differences from a real device:

- Internet comes from this PC, not the phone's Bluetooth tether, so the
  Bluetooth pairing screens can't do anything here.
- Voice skips the wake word and speech-to-text (they're Car Thing ARM
  binaries): the "Say to Wisp" box sends typed words through the rest of the
  real voice flow, green glow included. A real command plays on your account.
- Dev runs don't send check-ins or crash reports.
- The UI runs in your desktop browser, not the Car Thing's Chrome 69, so
  check performance-sensitive changes on the device too.

`config/state.json` holds the daemon's Spotify login. Delete it to sign in
again, and don't share it.
