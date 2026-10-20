# Changelog

What changed in each Wisp release, newest first. Each version is on the
[releases page](https://github.com/picovrfbt/WispOS/releases) with its downloads.

## Unreleased

- **Spotify keeps playing while Maps is open.** With the Car Thing connected and Spotify playing, the Wisp app holds on to Spotify so Android is far less likely to close it to make room for Google Maps. If it's closed anyway mid-song, the Wisp app starts it again and carries on (up to 3 times in 10 minutes), instead of the Car Thing dropping to "Pick up where you left off".
- **Wisp hears you out.** Wisp waits a full second of quiet before it takes your request, so a pause mid-sentence ("play… Midnight City") no longer cuts you off.
- **Search for any address.** Where to? has a Search row: type with the knob (turn to a letter, press to type; turn back from A for the matches as you type) or tap the keys. "Okay Wisp, take me to 1420 Oak Street" now shows the matches to pick from when there's more than one. And in the Wisp app, "Find a place on the Car Thing" sends an address you type on the phone to the Car Thing's Where to?. Needs the Wisp app update for the phone part.
- **Music turns right down while Wisp listens.** With Settings → Wisp's voice → Music while listening on "Lower it", the Wisp app turns the phone's music volume down to about a third, and back when Wisp has your request (before it answers). Spotify barely got quieter before. Turn the volume yourself meanwhile and yours stays. Needs the Wisp app update.
- **YouTube Music and SoundCloud, however you say it.** "On YouTube Music play X", "YouTube Music, play X", "play X in YT Music please" and misheard names ("you two music", "u tube") all work, and asking for a service always goes to that service, even for "play my liked songs on YouTube Music".
- **The turn banner gets out of the way.** While directions are on, the next turn shows at the top for 5 seconds when it comes up, and again as you near it. Swiped away, it stays away until the next turn. Choose 5 seconds, 10 seconds or until the turn in Settings → Navigation → Turn banner.
- **Swipe notifications away any way**: up, left or right.
- **Notifications stack.** Several at once pile up with the newest on top and a count; swipe them away one by one. Their icons follow your accent colour.

## v1.0.6 (2026-10-19)

The Car Thing finds your phone again by itself: when the car starts, and after a drop.

- **Reconnects after the phone drops the link.** When the phone ended the Bluetooth link by itself mid-drive (phones do, to save power), the Car Thing took it as you disconnecting on purpose and waited 10 minutes before trying again. Now it tries again after a minute; disconnecting from the Car Thing's own Bluetooth menu still waits the full 10.
- **Clearer setup on Samsung phones.** The Wisp app's "Never sleeping apps" step only shows when the app isn't already set to run in the background (Unrestricted): Samsung leaves Unrestricted apps out of that list, so the step sent you looking for something that wasn't there.
- **No more "pick a connection" when the car starts.** If the screen asked for your paired phone before the Car Thing's Bluetooth was up, it never asked again and showed first-time setup until a phone connected. It now asks again, and says "Reconnecting…" meanwhile.
- **Wisp app 1.0.5.**

## v1.0.5 (2026-10-18)

Pick up where you left off, see every update coming, and talk to Wisp over the music.

- **Pick up where you left off.** The "Nothing playing" screen now shows the last song you played, big, with a Resume button, buttons to choose which phone or speaker plays it, and a reminder that the back button goes Home.
- **Updates ask first again.** A new Wisp shows its "Update available" card as soon as it's found (the Car Thing looks every hour), even while music plays, so you see what's new. Tick "Download and install updates automatically" on the card and later updates install by themselves, without the card. Automatic installs are off for everyone once, including those 1.0.4 turned on.
- **A cloud by the battery** pulses while an update downloads in the background.
- **Quieter music while Wisp listens.** After "Okay Wisp" the music dips (or pauses) until Wisp has your request, so the mics hear you. Settings → Wisp's voice → Music while listening: Lower it, Pause it or Leave it. Needs the Wisp app on your phone.
- **Tap off Wisp to close it.** A tap anywhere above Wisp's bar closes it at once, stops it listening and drops what it was working on.
- **"Play my liked songs"** and its cousins ("play my likes", "shuffle my favourites", "play my Discover Weekly", "Release Radar", "Daily Mix 2", "On Repeat") work on the Car Thing's own rules, without the phone's model. "Shuffle" or "on shuffle" turns shuffle on.
- **Wisp app 1.0.4.**

## v1.0.4 (2026-10-18)

Updates take care of themselves, on the Car Thing and on your phone.

- **The Car Thing updates itself.** "Install updates automatically" and "Update in the background" are now on by default: a new Wisp installs while you drive, without taking over the screen, and is there the next time it starts. Settings that were still on the old defaults move once; turn either off in Settings → Software update and it stays off.
- **The Wisp app updates itself too.** It looks for a new version every few hours while it runs in the background and installs it by itself, where Android lets an app update itself without asking (Android 12 and up, once it has updated itself the first time). Turn it off in Options → Update the app automatically.
- **When an update needs you**, the Wisp app says so: a notification ("tap to update"), once per version, and a pop-up when you open the app.
- **The Wisp link comes back by itself** after the app updates and after the phone restarts.
- **Wisp app 1.0.3.**

## v1.0.3 (2026-10-18)

Wisp's thinking gets ready and answers, and Wisp's voice is on from the start.

- **Wisp's thinking gets ready.** The Wisp app could stay on "Getting Gemini Nano ready…" for good when Android had already started fetching it; it now follows Android's download and checks again every 30 seconds. Until Gemini Nano is there, the open model (Qwen) answers if it's downloaded.
- **The open model answers the first time.** It loads as soon as it's the one in use, instead of on the first question, and the Car Thing waits up to 20 seconds for an answer rather than 8.
- **Wisp's voice is on by default**, saying what your voice commands did (Confirmations), at 1.1x. Settings that were still on the old default (off) move once; if you turn it off, it stays off.
- **Wisp app 1.0.2.**

## v1.0.2 (2026-10-18)

Voice commands work again, passengers' playlists save, and the passengers' page is quicker and fits phones.

- **Voice commands work again** on Car Things flashed with Wisp OS over an older Wisp: the old settings pointed at a speech model Wisp OS doesn't ship, so speech never started. Wisp now uses the one that's there (and the smarter-voice matcher, which old settings left off).
- **Saving the passengers' songs works.** Spotify kept refusing the playlist ("too many requests") through the shared web route; Wisp now makes it the way Spotify's own apps do, and says it couldn't within 45 seconds instead of waiting.
- **The passengers' QR code shows right away** instead of sometimes sitting on "Starting…".
- **The passengers' page fits phones**: long YouTube Music lines no longer make it wider than the screen, and they show just the artist.
- **Wisp's own relay** for passengers' messages, on Cloudflare's free tier (relay/), with ntfy.sh as the backup; the Car Thing also sends far fewer messages (no reply to the page's "still here", and one message per added song).

## v1.0.1 (2026-10-17)

Passengers pick the music, from any of your music services, and clearer messages everywhere.

- **Passengers pick the music.** A QR code on the Car Thing (the player's menu, or "Okay Wisp, let the passengers pick") lets everyone in the car search, add songs to Up next and vote to skip from their own phones, without signing in to your Spotify. A note on the Car Thing says who added what.
  - **From any of your music services.** Passengers search Spotify and, when you're signed in to them in the Wisp app, YouTube Music and SoundCloud, all at once or one at a time. Every song shows where it plays, and the page shows Up next in order with who added each. Wisp keeps the line itself: a YouTube Music or SoundCloud pick starts in its app as the song before it ends, and Spotify carries on where it was afterwards.
  - **Autoplay from their songs.** When Spotify runs out and starts its own autoplay, it plays the radio of the last passenger song that played on Spotify instead (a switch on the QR screen).
  - **Keep their songs.** When a session ends, the Car Thing asks whether to save every song the passengers added as a private Spotify playlist, "Car jam · Oct 17". Their YouTube Music and SoundCloud picks are matched on Spotify; any that aren't there are counted.
- **Clearer messages.** "Nothing playing" says what to do; a failed update says why in plain words (no internet, a damaged download, no room) on the Car Thing and in the Wisp app; directions say when nothing is close by; and button errors say what didn't work.

## v1.0.0 (2026-10-17)

Wisp 1.0: open source, on its own modern system, with its own directions, a smarter voice, community add-ons and new Drive Mode music.

- **Wisp's own directions.** Settings → Navigation → Directions by: Wisp. The map screen with nothing navigating is now **Where to?**: gas, food, coffee, parking, EV charging and groceries nearby, and your recent places, or "Okay Wisp, take me to…" for anywhere. Up to three routes with their times and roads, avoid highways or tolls, then **Start** for turn-by-turn on the Car Thing (spoken through Wisp's voice, rerouting when you leave the route) or **Google Maps** to drive it there with live traffic. From OpenStreetMap: no account, no key. Spoken directions: every turn, just the turns, or muted (the speaker on the map, or Settings).
- **A new map screen.** A big turn card with the turn after it, your speed, and the time, miles and arrival along the bottom, for Wisp's directions and Google Maps' alike.
- **Add-ons, grown up.** Each now has a picture, shown with its name, author and description; the catalog shows the one under the knob in full. Eight to start: Forecast, Big clock, Trip, Odometer, Parking timer, Sun & moon, World clocks and Plate spotter.
- **Make your own add-on** in the [Add-on Studio](https://picovrfbt.github.io/WispOS/studio.html) in your browser, no code needed, or from five templates; the [guide](https://picovrfbt.github.io/WispOS/addons.html) covers the rest.
- **Choose the phone's model.** On phones with Gemini Nano, the Wisp app can use the open model instead; phones without Nano are offered it once, on the Car Thing or in setup.
- **A how-to for everything** on the [website](https://picovrfbt.github.io/WispOS/use.html).

- **Open source.** Everything is public at [picovrfbt/WispOS](https://github.com/picovrfbt/WispOS), with a website at [picovrfbt.github.io/WispOS](https://picovrfbt.github.io/WispOS/). Updates need no GitHub token any more; the Wisp app forgets the one it kept.
- **Wisp OS.** Wisp now runs on its own system: a current Linux kernel, the screen drawn by the GPU in a modern Chromium, and Wisp's own boot logo and start-up animation. Flash it once over USB; updates come over the air from then on.
- **A lighter on-device voice.** A smaller speech model (about half the memory, about three times faster) that steps aside when memory runs short and comes back when there's room.
- **A smarter voice.** Ask the way you'd ask a person: "I wanna hear Daft Punk", "who sings this?", "play the album", "no, the other one", "when do we get there?", "take me home", "call Mom", "dim the screen". Answers show on the Car Thing and are spoken through your phone. Everyday requests are understood on the Car Thing; with the Wisp app, a language model on your phone handles anything looser: Gemini Nano where the phone has it, or an open model (Qwen3 0.6B, about 345 MB) you can download from Options → Wisp's thinking.
- **Add-ons.** Small pages from the community, from Home → Add-ons. Each is reviewed before it's listed, checked when it downloads, and sandboxed so it sees only what it asks for.
- **Call by voice** needs a new, optional setup step in the Wisp app.
- **The knob turns the right way** on Wisp OS.
- **YouTube Music signs in with a code** at google.com/device, through YouTube's official API: your playlists (private ones too) and the music you've liked. Google no longer allows signing in inside apps. SoundCloud signs in with your email and password.
- **New Drive Mode music.** All three sounds, Ethereal, Cinematic and Lo-fi, remade with cleaner stems.
- **A new setup.** Wisp's own welcome screens, guide links and QR codes, start to finish.

## v0.2.29 (2026-10-15)

The route on the map, the Car Thing's settings on your phone, and a smoother, snappier Home.

- **The route on the map.** Google Maps keeps its route to itself, so the Wisp app works one out and the Car Thing draws it in blue; the part you've driven drops away behind the arrow.
  - **The whole trip:** in Google Maps, tap **Share** on your destination and pick **Route on Car Thing**. If you go off it, it's worked out again.
  - **Automatically:** with nothing shared, the road to the next turn and a little of the street you turn onto. When it can't place the turn, it draws nothing rather than a wrong line.
- **Car Thing settings in the Wisp app.** A page of its own (main screen → Car Thing settings): brightness, night mode, display size, accent colour, lyrics, Wisp's voice, updates and more. Changes show on the Car Thing right away, and changes made on the Car Thing show on the page.
- **A smoother Home.** Fewer hitches turning the knob along the bar and through the cards (measured on a Car Thing: about 25% more frames while gliding through cards).
- **Screens fade out** instead of snapping away when you go back: Home, the map, Drive Mode, the full-screen visualizer, the screensaver and more.
- **The knob works in Settings and Up next.** In Settings, turn to move between settings and press to change one; on a slider, press, turn to set it, and press again when done. In Up next, turn and press to play a song.
- **Lists glide** with the knob, even when you spin it fast.
- **Fixed:** with Settings opened from a top button, turning the knob also changed the volume.

Install from Settings → Software update. **Update the Wisp app too** (0.9.17, attached below): the route and the settings page need both.

## v0.2.28 (2026-10-15)

Drive Mode is easier to reach, Settings opens from Home's bar again, and the Glow visualizer follows the music.

- **Drive Mode moves out of Settings** to three places: a **Drive Mode** row on Home's bar, just above Settings; the first button in the **power-button menu**, next to Sleep, Restart and Reset; and an option for any of the **four top buttons** (Settings → Top buttons, press a button's row until it says Drive Mode)
- **Settings opens with the knob from Home's bar again**: if Home had last been left in the cards on another row, turning and pressing on Settings did nothing
- **Glow visualizer** (behind the cover and full screen) starts small and dim and swells with the music, instead of a big bright halo all the time
- **README** now has pictures of the Car Thing and the Wisp app

The Wisp app stays at 0.9.16, so there's nothing to update on the phone. Install from Settings → Software update.

## v0.2.27 (2026-10-14)

Snappier Drive Mode, a visualizer with range, and lists that scroll on YouTube Music and SoundCloud.

- **Drive Mode follows the car more closely**: it feels a pull or a stop from the phone's motion sensors as it happens instead of waiting about a second for GPS, and the music responds within a fraction of a second. For the first few pulls or stops of a drive it learns which way your phone faces in the car, then it's at full speed. If you move the phone in its mount, it learns again
- **No more bass hit** when braking hard
- **Visualizer with range**: quiet parts sit low and loud ones reach the top, instead of the bars staying near full the whole time
- **YouTube Music and SoundCloud lists scroll with the knob**: on Home, the list now follows the cursor down, as Spotify's does
- **Without the Wisp app**, the Car Thing still works with Spotify as before; the map and Drive Mode now say they need the app

Update the Wisp app to 0.9.16 first (from inside it, or the APK below), then install from Settings → Software update.

## v0.2.26 (2026-10-14)

A new Drive Mode sound: Lo-fi.

- **Lo-fi** (warm keys, soft beats and a dusty groove) joins Ethereal and Cinematic in Drive Mode, with two songs. Like the others, it downloads the first time you pick it (about 22 MB, over your phone's data if you're not on Wi-Fi)
- **Delete Drive Mode music** in the Wisp app (Options → Drive Mode music): see how much space the songs take and delete them; each sound downloads again the next time you pick it. The app also keeps less after Drive Mode stops (about half)
- **Visualizer fixed**: it stayed still because the Wisp app was missing a sound permission Android needs. Restart your phone once after updating the app so Android picks it up
- **SoundCloud's Up next and waveform** work again when your SoundCloud sign-in has lapsed (sign in again in the Wisp app to like songs)
- The sound picker's covers are a little smaller so all three fit on the Car Thing's screen

Update the Wisp app to 0.9.15 first (from inside it, or the APK below), then install from Settings → Software update. Without the new app, picking Lo-fi won't play.

## v0.2.25 (2026-10-13)

Asking Wisp to play now wakes the app on your phone, plus fixes across the Wisp app.

- **Wake on play**: when you ask Wisp for a song and Spotify on your phone has gone to sleep, Wisp shows "Waking Spotify…", starts it in the background without covering your map, opens it if that isn't enough, and plays as soon as it's back (up to about 15 seconds). If it still can't reach Spotify, it says "Open Spotify on your phone"
- **YouTube Music and SoundCloud**: if Android won't let Wisp open the app from the background, you get a "Play on …" notification to tap instead of nothing happening. Turning on "Display over other apps" in the Wisp app's setup avoids the tap
- **Wisp app 0.9.11**: no more overlap with the status and navigation bars, even padding and dividers on every row, centred labels in the app icon picker, and sheets that reach the bottom of the screen

Update the Wisp app to 0.9.11 first (from inside it, or the APK below), then install from Settings → Software update.

## v0.2.24 (2026-10-13)

A visualizer, a new look and logo for the Wisp app, and the phone's battery only where it fits.

- **Visualizer**: four styles (Glow, Bars, Wave, Particles) behind the cover on Now Playing, for Spotify, YouTube Music, SoundCloud and other phone apps, in the cover's colours. Turn it on in the player's ⋯ menu ("Visualizer"). "Full-screen visualizer" in the same menu shows each style across the whole screen; turn the knob to change style. Your phone measures what it's playing, only while a visualizer is showing: in the Wisp app, allow "Visualizer" once (Android lists it under the microphone, but it only reads the phone's own sound)
- **Phone battery** now shows only where the top-right corner is free (the players and the idle screen, not over lyrics, the map or Settings), and Settings → Phone → Phone battery turns it and the low-battery warnings off
- **The Wisp app, redesigned**: a wisp of light linking your phone to the Car Thing, soft blurred colour behind everything, compact lists, setup steps only while something's left, and the GitHub token, diagnostics and app icon in sheets of their own
- **A new logo and app icon**, with a choice of four in the Wisp app (Options → App icon): Wisp, Green, Light or Classic. On Android 13 and later it follows your themed icons

Update the Wisp app to 0.9.10 first (from inside it, or the APK below), then install from Settings → Software update. If the Wisp shortcut disappears from your home screen after updating the app, add it again from the app drawer: the new icon picker moved it.


**Companion 0.9.10** fixes the "wisp" wordmark being cut off at the top of the app, and its underline showing black instead of green.

## v0.2.23 (2026-10-13)

Calls on the Car Thing, your phone's battery, night mode at real sunset, safer updates, and more Drive Mode music.

- **Calls**: when your phone rings, the Car Thing shows who's calling with Decline and Answer (turn the knob to pick, press to choose; back hides it and leaves the phone ringing). Once answered, a small pill at the top shows a timer and End; your car's hands-free does the talking. In the Wisp app, allow "Show calls on the Car Thing" once
- **Phone battery**: a small battery shows in the top right while your phone isn't charging, red when it's low, with a heads-up at 15% and at 5%
- **Night mode "Auto" follows the real sunset and sunrise** where you are (worked out on the Car Thing, no connection needed), shown in Settings, e.g. "Auto · 7:42pm–7:05am"
- **Safer updates**: if an update doesn't start properly, the Car Thing goes back to the update you had before (not all the way back to the version installed over USB) and tells you once it's back
- **Drive Mode**: two songs per sound, one fading into the next. The music now downloads to your phone the first time you pick a sound (about 26 MB, once; the warning says it uses data), so the Wisp app is back down to about 36 MB. Tuned from real drives: hard pulls and wobbles of the wheel come through, a phone shaking in its mount doesn't

Update the Wisp app on your phone to 0.9.8 first (from inside it, or the APK below), then install from Settings → Software update. Wisp Drive Recorder 1.1 (for anyone helping tune Drive Mode) has the same tuning.

## v0.2.22 (2026-10-13)

A small update to Drive Mode.

- **Drive Mode on your car's screen**: it now shows as "Drive Mode · Ethereal" (or Cinematic) from Wisp with its cover, on the car's display and the phone's lock screen, instead of the last Spotify song. The steering wheel's play/pause and stop work, and the Car Thing follows
- **Recording each drive for tuning**: the Wisp app keeps a record of your last five Drive Mode drives (speed, braking, turns and what the music did, never where you were). In the app, Options → "Share the last Drive Mode drive" saves it to Downloads/Wisp and lets you send it, so Drive Mode can be tuned from a real drive

Update the companion app to 0.9.6 (from inside it, or the APK below), then install from Settings → Software update.


**Companion app 0.9.7** tunes Drive Mode from a first real drive: the bass hit only on a properly hard stop (and once per stop), turns measured by how hard they pull sideways (highway shake and the phone being moved no longer swing the music), and everything open by highway speed.

**Wisp Drive Recorder 1.0** (wisp-drive-recorder-v1.0.apk): a small separate app that only records a drive, for anyone helping tune Drive Mode, no Car Thing needed. Start, drive, Stop, then Share the drive. No location is kept.

## v0.2.21 (2026-10-13)

Drive Mode (beta), a steadier link with the phone in your pocket, and temperatures.

- **Drive Mode (beta)**: Settings → Navigation → Drive Mode. Music that follows your driving, played by your phone: calm and far away when you're stopped, clearing as you speed up, everything when you push. A bass hit when you brake hard, the music swings to the outside of a turn, and a wah follows the accelerator. Two sounds, Ethereal and Cinematic. The Car Thing shows a glowing bar and the four parts (drums, bass, melody, choir) as they play. It uses the phone's GPS and motion sensors the whole time, so keep the phone charging. The first start of each sound takes a few seconds while the phone unpacks it
- **With the phone in your pocket**: the Wisp app keeps the phone awake while the Car Thing is linked, so the Bluetooth tether doesn't stall when the screen goes off ("connected, no internet"). The Car Thing gives a slow phone a moment longer before calling it offline, notices a dropped link in seconds and reconnects quickly
- **Temperatures**: Settings → Display → Temperatures lists the Car Thing's sensors. A red thermometer shows at the top right if the processor reaches 85 °C, and Performance mode eases off until it cools to 75 °C
- **Performance mode** is now on by default
- **Updating through your phone**: the update screen can switch between downloading on the Car Thing and through the phone, both ways, mid-download

Update the companion app to 0.9.5 first (from inside it, or install the APK below), then install from Settings → Software update. Drive Mode needs both.

## v0.2.20 (2026-10-12)

A simpler screensaver.

- **Just the date, the weather and the clock**, on the screensaver that comes on by itself and the one you open with the power button
- **No music bar and no directions on it** any more

Install from Settings → Software update. The companion app stays at 0.9.3.


**Companion app 0.9.4** fixes 0.9.3 crashing as soon as it opened.

## v0.2.19 (2026-10-12)

A faster Car Thing, an idle screen with the weather, and lyrics for your own music.

- **Covers kept on the Car Thing**: each cover downloads once, at the size it's shown, and loads from the Car Thing after that, even offline. Updates no longer wipe them. The next songs' covers load ahead. Old covers clear themselves: 100 MB at most, unused ones go after 30 days
- **Lyrics and Home remembered**: lyrics you've had come back instantly (offline too), and Home shows your rows at once after a restart
- **Performance mode** (Settings → Display, experimental, off by default): the graphics chip draws the screen, the processor stays at full speed, the screen comes first, and compressed swap gives the browser more room. It runs a bit warmer, and the screen restarts once when you switch it
- **Settings → Storage**: see how much is saved, and clear covers and lyrics
- **Idle screen**: the weather where you are (°F/°C in Settings → Display) and, while navigating, your next turn
- **"Add this to my road trip playlist"** by voice, for Spotify and YouTube Music playlists
- **Lyrics for your own music** (VLC, the phone's music app): a small Lyrics button, off until you turn it on, with the cover and controls on one side. Untagged files get their name from the file name ("Artist - Title"), and a cover is looked up when the file has none
- **YouTube Music**: a Recently played row; covers from YouTube when the app doesn't share its own
- **Volume and Samsung**: the volume bar starts at your phone's real level. If the Wisp app on your phone isn't connected, the Car Thing says so. The companion app has new setup steps for Samsung's "sleeping apps" and for background data, the usual reasons it drops out
- **Home's source switch**: the SoundCloud name no longer gets cut off

Update the companion app to 0.9.3 first (from inside it), then install from Settings → Software update.

## v0.2.18 (2026-10-12)

Fixes from your list.

- **YT Music plays the song you pick**: picking a song straight from Liked music (or any list) now plays that song, not whatever YT Music was already on
- **"Download on the Car Thing instead"**: a small button at the bottom of the update screen while an update comes through your phone; press it and the Car Thing fetches the rest from GitHub itself
- **Volume shows just the bar**: no more "Phone volume +" flash before it
- **YT Music's rows move with the knob** after switching over from Spotify
- **No more "New playlist" card** in YT Music's Playlists
- **SoundCloud and YT Music show on Home when they're switched on** in the companion app, signed in or not; until you sign in, their rows say to sign in on your phone. The companion's rows now say whether each one is signed in, and finds SoundCloud's sign-in wherever SoundCloud keeps it

Update the companion app to 0.9.2 first (from inside it), then install from Settings → Software update.

## v0.2.17 (2026-10-11)

Fixes for YouTube Music and SoundCloud.

- **YT Music: picking a song from Up next plays that song** instead of going back to the one the radio started from
- **SoundCloud covers** now show, on the player and Home
- **Signing in with Google** (SoundCloud or YouTube Music) no longer leaves a white page: Google's sign-in window opens over the page, and the app notices once you're in
- **Home's source switch** is just the services' icons in one small pill, with the picked one's name in a bubble beside it
- **Paused YouTube Music and SoundCloud stay on screen** like Spotify; only other phone apps (YouTube, podcasts) drop off after 5 paused minutes

Update the companion app to 0.9.1 first (from inside it), then install from Settings → Software update.

## v0.2.16 (2026-10-11)

YouTube Music and SoundCloud, properly, and updates that survive mobile data.

- **YouTube Music and SoundCloud get the full player**: the same layout as Spotify (cover, lyrics beside it, progress bar and controls), each in its own colours. YT Music is red with a thumbs-up; SoundCloud is orange with a heart, and its progress bar is the song's real waveform
- **Like, Up next and lyrics** for both: liking saves to your YouTube Music or SoundCloud likes, Up next (SoundCloud: Related tracks) lets you jump ahead, and lyrics are found by song name
- **Voice**: "play Midnight City on YouTube Music", "play the album … on YouTube Music", "play some Fred again on SoundCloud". Without a service named, it's Spotify as before
- **SoundCloud library on Home**: sign in to SoundCloud in the companion app (Music services) and Home's switch goes round Spotify, YT Music and SoundCloud, with each service's icon
- **Phone playback lets go**: something left paused on your phone for 5 minutes stops showing as Now Playing; it comes back the moment it plays again
- **Updates through your phone**: the companion app now downloads Wisp updates itself and hands them over Bluetooth, so carriers no longer throttle or cut them as hotspot traffic. Any broken download, through the phone or not, picks up where it stopped
- **Companion app 0.9.0**: SoundCloud sign-in, service icons, and the update relay. SoundCloud, like YT Music, is read the way its website does it; a change on their side can break it until Wisp is updated

Update the companion app first (from inside it), then install from Settings → Software update, or flash wisp_firmware_v0.2.16.zip over USB. This update itself still downloads the old way; the next one comes through your phone.

## v0.2.15 (2026-10-11)

Your YouTube Music library on the Car Thing.

- **A Spotify / YT Music switch at the top of Home's rail**: turn onto it and press (or tap a side) to flip. On YT Music the rail shows Liked music, Playlists, Albums and Artists from your own library, with a red tint so you always know which side you're on
- **Open a playlist or album** to see its songs; pick one and it plays in YouTube Music on your phone (Morphe and ReVanced builds included)
- **Settings → Playback → Home opens on**: Spotify or YouTube Music, whichever you want first
- **Companion app 0.8.0**: Music services → **Sign in to see your YT Music library**. You sign in on Google's own page inside the app; the sign-in stays on your phone (never on the Car Thing), and Sign out deletes it. YouTube Music won't share its library with other apps directly, so this reads it the way music.youtube.com does. It's unofficial: a change on YouTube's side can break it until Wisp is updated

Install from Settings → Software update (about 5.5 MB from this version on), update the companion app from inside it, or flash wisp_firmware_v0.2.15.zip over USB.

## v0.2.14 (2026-10-11)

Much faster updates, and a steadier companion app.

- **Updates are about 5× smaller**: each release now also comes in two parts, a 5–6 MB core (the daemon and app) and the fonts (22 MB). The fonts almost never change, so a Car Thing that already has them copies them instead of downloading. Updating from this version on fetches about 5.5 MB instead of 28 MB over Bluetooth. *This one update still arrives the old, full-size way, because the updater that does the splitting is new in it*
- **Companion app 0.7.1 keeps running in the background**: a quiet "Wisp Companion" notification keeps the link alive on phones that clear background apps. A new setup step lets it skip battery saving, and **Options → Keep running in the background** turns it off
- **Opening Spotify for the Car Thing**: with the new "Allow opening Spotify for you" step (Android's "Display over other apps"), the app opens Spotify by itself when the Car Thing needs it. Without it, it starts Spotify playing in the background and shows a tap-to-open notification
- **Music services lists only music apps**: YouTube Music (including Morphe and ReVanced builds, shown as YouTube Music), YouTube, SoundCloud and other music apps; no more Bluetooth, Bixby or assistants

Install from Settings → Software update (and update the companion app from inside it), or flash wisp_firmware_v0.2.14.zip over USB.

## v0.2.13 (2026-10-11)

A better Settings, and a first look at your other music apps.

- **Settings is its own page**: full screen, with a back arrow at the top; the back button does the same. Press Settings on Home's rail to open it, and the dial scrolls it
- **Tidier layout**: Display, Playback, Navigation, Top buttons, Wisp's voice, Phone and Software update, each setting on its own card
- **Brightness** has a big Auto / Manual switch instead of the small sun icon
- **Companion app 0.7.0: Music services** finds the music apps on your phone (YouTube Music, SoundCloud and others), lets you switch each on or off, and shows what each one lets Wisp see: its library, or playback only. This is the groundwork for YouTube Music and SoundCloud on Home

Install from Settings → Software update (and update the companion app from inside it), or flash wisp_firmware_v0.2.13.zip over USB.

## v0.2.12 (2026-10-11)

Seeking fixed, and Wisp gets his own volume.

- **Seeking works on Spotify again**: Wisp now sends seeks the way current Spotify apps expect them (position from the start), so dragging the progress bar moves the song on your phone, PC or speaker. Seeking to 0:00 works too
- **Wisp's voice volume** (Settings → Wisp's voice): 10% to 100%, separate from the music. The music still dips under him while he talks and comes back after
- Companion app 0.6.1 plays Wisp at that volume

Install from Settings → Software update (and update the companion app from inside it), or flash wisp_firmware_v0.2.12.zip over USB.

## v0.2.11 (2026-10-11)

Wisp talks.

- **Wisp's words at the bottom**: answers to voice commands ("Playing Midnight City by M83", "Liked Reka", "Couldn't find that") now appear as subtitles over the Wisp bar, which glows under them, instead of a banner at the top
- **Wisp's voice**: Alan (a Piper voice, raised a little), spoken through your phone into the car while the music dips. Settings → Wisp's voice → Speak: Off, Confirmations (what a voice command did) or Everything (also notifications and arrival). Off by default
- **Voice speed** from 0.5× to 2×, with a spoken preview; the pitch stays the same
- The voice (about 67 MB) downloads to your phone once, from wisp-voice-alan-v1.zip on this release, the first time you turn it on; Settings shows its progress

Needs companion app 0.6.0 (attached, or update from inside the app). Install Wisp from Settings → Software update, or flash wisp_firmware_v0.2.11.zip over USB.

## v0.2.10 (2026-10-11)

A Wisp bar that moves with your voice, and full-screen updates.

- **The Wisp bar** is now a band of soft colour along the bottom (your accent, cyan, violet, pink), in the style of Spotify's voice and DJ screens. It rises and falls with your voice while you talk and swirls faster while Wisp works out what you said. *Following your voice needs this release's USB zip (it updates the voice listener); over the air, the bar breathes instead.*
- **Updates take over the screen**: a full-screen Updating view with a progress bar, the four stages (Download, Check, Install, Restart), MB done, speed and time left. Everything else stops while it runs, so the download gets all the Bluetooth bandwidth, and it restarts by itself. If it fails: Try again or Not now.
- **Settings → Update in the background** brings back the old quiet install.
- Releases now carry the latest companion app forward automatically.

Flash wisp_firmware_v0.2.10.zip over USB for everything, or install from Settings → Software update.

## v0.2.9 (2026-10-11)

Night mode follows your own time zone.

- One time zone for all of Wisp: your phone's, with daylight saving already applied. It drives the screensaver clock, night mode's Auto and arrival times, and the Car Thing keeps it across restarts
- Fixes the clock and Auto night mode running on UTC when the phone hadn't connected yet (Wisp's old source for the time zone was the Mira check-in, which Wisp keeps off)
- Settings → Night mode shows the zone it's using, e.g. "Auto · 7pm–7am UTC−4", so you can see it's right

Install from Settings → Software update, or flash wisp_firmware_v0.2.9.zip over USB. Companion app 0.5.0 (from v0.2.8) already sends your time zone.

## v0.2.8 (2026-10-10)

Volume, voice likes, the queue, arrival, themes and a settings backup.

- **Spotify volume fixed** for phones that won't take Spotify's remote volume: the knob turns the phone's own music volume through the companion app, and the volume bar shows the real level
- **"Like this"** by voice ("like this", "save this song", "add this to my liked songs"); the heart on the player follows
- **Up next**: a queue button beside ⋯ on the player; tap a song to jump to it
- **Arrival**: a card when directions end at your destination (time and trip length); Settings → When you arrive can also pause the music. Cancelled routes show nothing
- **Accent colour** (Settings): Green, Blue, Purple, Orange, Pink, Red, or Album colours from the current cover
- **Smoother loading**: placeholder cards and rows instead of "Loading…"
- **Settings backup**: your phone keeps a copy of your Car Thing settings and restores them after a reflash or reset
- Night mode's Auto now works before the phone has ever connected

Install from Settings → Software update, or flash wisp_firmware_v0.2.8.zip over USB. Install wisp-companion-v0.5.0.apk on your phone (or update it from inside the app).

## v0.2.7 (2026-10-10)

New settings, phone features and smarter voice.

- **Night mode** (Settings): Off, On, or Auto from 7pm to 7am on your phone's clock
- **Phone notifications** (Settings, off by default): banners on the Car Thing; nothing leaves the phone while it's off
- **Install updates automatically** (Settings, off by default): only while nothing is playing and you're not navigating
- **Seek phone media**: drag or tap the progress bar on the YouTube/podcast screen
- **Voice search for anything**: "play the album …", "play … radio" and "play the … playlist" now search Spotify when it isn't in your library; "play X by Y" copes better with misheard titles
- **DJ** pinned in Library, beside Liked Songs
- **Navigation**: time left, distance and arrival as chips, plus your current speed in mph or km/h
- **Companion app 0.4.0**: required for notifications, seek and Auto night mode, and it can now update itself from these releases

Install from Settings → Software update. Install wisp-companion-v0.4.0.apk on your phone.

## v0.2.6 (2026-10-10)

Smoother Home screen on the Car Thing.

- Turning the dial through the Home rail no longer stalls: steps measure 30–75 ms, down from as much as 400 ms
- Stepping through covers is steadier: about 100 ms per step, no spikes over 200 ms (was up to 390 ms)
- The blurred cover behind Home and the glow behind the focused card cost a third of what they did
- Only the covers near the cursor are built, so switching categories doesn't lay out a whole 50-card page

Install from Settings → Software update (needs v0.2.5 or later), or flash wisp_firmware_v0.2.6.zip over USB.

## v0.2.5 (2026-10-10)

- Fix: the updater could lock up once a GitHub token arrived, which then stalled everything (sign-in check, playlists, lyrics) until a restart
- No request to the daemon can hang the UI any more (35s limit)
- Reconnects to Spotify within seconds after the Bluetooth tether drops, instead of after 2 minutes
- Faster Spotify connection at boot

Flash wisp_firmware_v0.2.5.zip by USB: the v0.2.4 updater cannot install this one because of the lock-up it fixes.

## v0.2.4 (2026-10-10)

- Over-the-air updates from this repo (Settings > Software update)
- Playlists open faster and never hang on Loading
- Long playlist and song names stay inside their card
- YouTube covers and steadier phone media
- Settings tab no longer squished

Flash wisp_firmware_v0.2.4.zip once; later versions install over the air.
