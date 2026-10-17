# Wisp add-ons

Add-ons are small pages that open full-screen on the Car Thing, from
**Home → Add-ons**: a forecast, a big clock, trip gauges, whatever you'd like
on your dash. People install them from **Home → Add-ons → Get add-ons**, which
lists what's in [`catalog.json`](catalog.json) here.

## Make one

An add-on is a folder with two files:

```
addons/my-addon/
  addon.json    what it is and what it may use
  index.html    the page (800 × 480, dark, the knob to move)
```

`addon.json`:

```json
{
  "id": "my-addon",
  "name": "My add-on",
  "version": "1.0.0",
  "author": "Your name",
  "description": "One line on what it shows.",
  "permissions": ["weather"],
  "network": ["api.example.com"]
}
```

| Field | |
| --- | --- |
| `id` | Lowercase letters, digits and dashes; the folder's name |
| `permissions` | Any of `now_playing`, `weather`, `location` (rounded to about a kilometre), `nav` (Google Maps directions from the phone). Ask only for what you use; people see the list before installing. |
| `network` | The sites it fetches from, by name. Nothing else is reachable. |
| `entry` | The page, if it isn't `index.html` |

In the page, load the bridge and use it:

```html
<script src="/addons/sdk.js"></script>
<script>
  Wisp.on('knob', ({ delta }) => { /* +1 clockwise, -1 back */ })
  Wisp.on('press', () => { /* the knob was pressed */ })
  Wisp.on('nowplaying', (song) => { /* the song changed (now_playing) */ })

  const song = await Wisp.nowPlaying()      // { name, artist, album, image, playing }
  const weather = await Wisp.weather()      // { temp, unit, summary }
  const where = await Wisp.location()       // { lat, lng, speed_mph }
  const trip = await Wisp.nav()             // { active, distance, instruction, arrival }
  const offset = await Wisp.timezoneOffset() // minutes from UTC (the Car Thing runs on UTC)
  const res = await Wisp.fetch('https://api.example.com/x') // { status, body }
  await Wisp.storage.set('key', 'value')    // up to 16 KB, kept on the Car Thing
  Wisp.close()                              // back to Home; the back button does this too
</script>
```

## The rules it runs under

- It runs in a **sandbox**: no access to Wisp's settings, sign-ins or controls,
  and no way to reach the Car Thing's API.
- It **can't make requests of its own**. Images, scripts and styles come from
  its own folder (or `data:` URLs); data comes through `Wisp.fetch`, only from
  the sites in `network`, only over https, at most 256 KB a page.
- It exists only while it's open, so it costs no memory otherwise. Keep it
  light: the Car Thing has a slow processor and very little memory. No
  frameworks needed; plain HTML, CSS and a little script go a long way.
- At most 64 files and 2 MB zipped.

## Share it

1. Add your folder here and run `python pack.py`. It checks the rules above,
   zips each add-on into `dist/` and updates `catalog.json` with each zip's
   checksum.
2. Open a pull request with the folder, `dist/` and `catalog.json`.

Every add-on is reviewed before it's merged, and the Car Thing only installs
what the catalog lists, checking each zip against its checksum. An update is a
new `version` and a new zip.

## Try it on your Car Thing first

Copy the folder to `/var/local/wisp/addons/<id>/` on the Car Thing (over SSH)
and open Home → Add-ons; it's listed alongside the installed ones.

## The ones here

| Add-on | Uses |
| --- | --- |
| [Forecast](forecast) | Your location and the weather unit; [Open-Meteo](https://open-meteo.com) for the hours ahead |
| [Big clock](big-clock) | Nothing (your time zone) |
| [Trip](trip) | Your location (speed) and directions |
