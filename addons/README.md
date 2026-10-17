# Wisp add-ons

Add-ons are small pages that open full-screen on the Car Thing, from
**Home → Add-ons**: a forecast, a big clock, trip gauges, whatever you'd like
on your dash. People install them from **Home → Add-ons → Get add-ons**, which
lists what's in [`catalog.json`](catalog.json) here.

**The full guide is on the website: [Make an add-on](https://picovrfbt.github.io/WispOS/addons.html).**
The quickest way, with no code and nothing to install, is the
[Add-on Studio](https://picovrfbt.github.io/WispOS/studio.html): build one from
tiles or write it, try it on a Car Thing screen with a working knob, and
download it ready to send in.

## Make one

Start from a template:

```
node new.mjs trip-stats --template gauge --name "Trip stats" --author "Your name"
```

| Template | |
| --- | --- |
| `blank` | The least an add-on needs: the knob, a press, saving a value |
| `gauge` | One big number, a bar and three small ones (your speed) |
| `list` | Rows the knob scrolls, the one under it shown in full |
| `tiles` | A dashboard: the weather, the song, the time, a site's data |
| `ambient` | Slow colour and the song that's playing |

Each comes with `style.css`, Wisp's style kit (`templates/kit.css`): the look
of the Car Thing's own screens and ready-made pieces (`.card`, `.row`, `.chip`,
`.big`, `.eyebrow`, `.grid-2`, `.grid-3`, and `.on` for what the knob is on).

Then try it as you edit, on a Car Thing screen in your browser, run the way the
Car Thing runs it (sandboxed, the real bridge, sample data; the arrow keys turn
the knob, Enter presses):

```
node preview.mjs trip-stats --serve
```

An add-on is a folder with three files:

```
addons/my-addon/
  addon.json    what it is and what it may use
  index.html    the page (800 × 480, dark, the knob to move)
  preview.png   its picture, shown in the list and the catalog
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
  "network": ["api.example.com"],
  "image": "preview.png"
}
```

| Field | |
| --- | --- |
| `id` | Lowercase letters, digits and dashes; the folder's name |
| `permissions` | Any of `now_playing`, `weather`, `location` (rounded to about a kilometre), `nav` (Google Maps directions from the phone). Ask only for what you use; people see the list before installing. |
| `network` | The sites it fetches from, by name. Nothing else is reachable. |
| `entry` | The page, if it isn't `index.html` |
| `image` | Its picture: a png, jpg or webp in the folder, up to 200 KB, ideally 400 × 240 (the screen's shape). People see it, with the name, author and description, before installing. |

### Its picture

Run `node preview.mjs my-addon` for a screenshot: it opens the add-on at the
Car Thing's size with sample data (a song, a drive in Long Beach, directions,
the weather) and saves `preview.png`. Add `--storage '{"key": value}'` to show
it mid-use, or `--wait 5` if it takes a while to load. Or make your own picture
and name it in `image`.

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

Made it in the Studio? Download it and drop the zip into the
[add-on form](https://github.com/picovrfbt/WispOS/issues/new?template=addon.yml).
Otherwise:

1. Add your folder here and run `python pack.py`. It checks the rules above,
   zips each add-on into `dist/`, puts its picture beside the zip, and updates
   `catalog.json` with both checksums.
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
| [Odometer](odometer) | Your location (speed) |
| [Parking timer](parking-timer) | Nothing (your time zone) |
| [Sun & moon](sun-moon) | Your location; [Open-Meteo](https://open-meteo.com) for sunrise and sunset |
| [World clocks](world-clocks) | Nothing (your time zone) |
| [Plate spotter](plate-spotter) | Nothing |
