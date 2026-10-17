// Try an add-on on your computer, or take its picture.
//
//   node preview.mjs <id> --serve      open it in your browser, like on the Car Thing
//   node preview.mjs <id>              save its picture as preview.png (400 × 240)
//
// Options:
//   --storage '{"key": value}'  start Wisp.storage with these (to picture it mid-use)
//   --wait 5                    seconds to wait before the picture (default 3)
//   --chrome path/to/chrome     for pictures, if Chrome or Edge isn't found
//   --port 4848                 for --serve
//
// <id> is a folder here (my-addon) or a path to one (templates/list).
//
// It runs the add-on the way the Car Thing does: in a sandboxed frame, with
// the same content rules and the real bridge (/addons/sdk.js), answered with
// sample data: a song, a drive in Long Beach with directions, the weather.
// Wisp.fetch reaches only the sites in "network", and asking for something
// not in "permissions" fails, as it would on the Car Thing.
//
// Needs Node 22+; pictures also need Chrome or Edge.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const valued = new Set(['--storage', '--wait', '--chrome', '--port'])
const target = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]))
const folder = target && resolve(existsSync(join(HERE, target)) ? join(HERE, target) : target)
if (!folder || !existsSync(join(folder, 'addon.json'))) {
  console.error('usage: node preview.mjs <add-on folder> [--serve] [--storage json] [--wait s] [--chrome path] [--port n]')
  process.exit(2)
}
const readManifest = () => JSON.parse(readFileSync(join(folder, 'addon.json'), 'utf8'))
let manifest = readManifest()
const serve = args.includes('--serve')
const waitMs = Number(opt('--wait') ?? 3) * 1000
const seed = opt('--storage') ? JSON.parse(opt('--storage')) : {}

const SDK_PATH = join(HERE, '..', 'wisp-daemon', 'daemon', 'addon_sdk.js')
if (!existsSync(SDK_PATH)) {
  console.error(`The bridge isn't at ${SDK_PATH}; run this from Wisp's repo`)
  process.exit(2)
}

// what the Car Thing would answer
const SAMPLE = {
  now_playing: { name: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", image: '', playing: true },
  next_song: { name: 'Feel It Still', artist: 'Portugal. The Man', album: 'Woodstock', image: '', playing: true },
  weather: { temp: 68, unit: 'F', summary: 'Mostly clear' },
  location: { lat: 33.77, lng: -118.19, speed_mph: 38 },
  nav: { active: true, distance: '600 ft', instruction: 'Turn left onto Pine Ave', arrival: '12 min · 5.1 mi · 3:45 PM' },
  timezone: -new Date().getTimezoneOffset(),
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
}

// the Car Thing's rules for an add-on's files (wisp-daemon/daemon/addons.go addonPolicy)
const policy = (base) => {
  const own = `'self' ${base}`
  return `default-src 'none'; script-src 'unsafe-inline' ${own}; style-src 'unsafe-inline' ${own}` +
    `; img-src data: blob: ${own}; font-src data: ${own}; media-src data: ${own}` +
    "; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'"
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/' || u.pathname === '/index.html') {
    manifest = readManifest()
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    return res.end(page(u.searchParams.has('bare')))
  }
  if (u.pathname === '/addons/sdk.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
    return res.end(readFileSync(SDK_PATH))
  }
  if (u.pathname === '/__fetch') {
    let t
    try {
      t = new URL(u.searchParams.get('url'))
    } catch {
      res.writeHead(400)
      return res.end('not a web address')
    }
    if (t.protocol !== 'https:' || !(manifest.network ?? []).includes(t.hostname)) {
      res.writeHead(403)
      return res.end(`${t.hostname} isn't one of this add-on's sites`)
    }
    try {
      const r = await fetch(t, { signal: AbortSignal.timeout(8000) })
      const body = (await r.text()).slice(0, 256 << 10)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ status: r.status, content_type: r.headers.get('content-type') ?? '', body }))
    } catch (e) {
      res.writeHead(502)
      return res.end(String(e))
    }
  }
  const prefix = '/addons/files/addon/'
  if (u.pathname.startsWith(prefix)) {
    const rel = normalize(decodeURIComponent(u.pathname.slice(prefix.length)))
    const file = join(folder, rel)
    if (!file.startsWith(folder + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Security-Policy': policy(`http://${req.headers.host}/addons/`),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    return res.end(readFileSync(file))
  }
  res.writeHead(404)
  res.end()
})

// the page around the add-on: the frame, the knob, the sample data, what it asked for
function page(bare) {
  const entry = manifest.entry || 'index.html'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(manifest.name)} · Wisp add-on</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #08080a; color: #fff; font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  ${bare ? 'iframe { position: fixed; left: 0; top: 0; }' : ''}
  .wrap { max-width: 1240px; margin: 0 auto; padding: 28px 24px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 28px; align-items: start; }
  .wrap > div { min-width: 0; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .sub { margin: 0 0 18px; color: rgba(255,255,255,.6); }
  .device { padding: 16px; border-radius: 30px; background: linear-gradient(#3a3a3e, #1c1c1f); width: max-content; }
  iframe { display: block; width: 800px; height: 480px; border: 0; background: #000; border-radius: ${bare ? 0 : 10}px; }
  .closed { display: none; width: 800px; height: 480px; place-items: center; text-align: center; background: #000; border-radius: 10px; color: rgba(255,255,255,.7); }
  .knob { display: flex; gap: 8px; margin-top: 14px; }
  button { font: inherit; font-weight: 600; color: #fff; background: #26262b; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 9px 16px; cursor: pointer; }
  button:hover { background: #303036; }
  button.primary { background: #1ed760; color: #000; border-color: transparent; }
  .keys { margin-top: 10px; color: rgba(255,255,255,.55); font-size: 13.5px; }
  kbd { font: 12px ui-monospace, monospace; padding: 2px 6px; border-radius: 6px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); }
  .panel { padding: 18px 20px; border-radius: 18px; background: #131316; border: 1px solid rgba(255,255,255,.08); margin-bottom: 14px; }
  .panel h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.55); }
  label { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
  .facts { margin: 0; padding: 0; list-style: none; color: rgba(255,255,255,.75); }
  .facts li { margin: 4px 0; }
  #log { height: 220px; overflow: auto; font: 12.5px/1.5 ui-monospace, monospace; color: rgba(255,255,255,.75); white-space: pre-wrap; overflow-wrap: anywhere; }
  #log .no { color: #ff7a7e; }
  #log .ev { color: #7cc4ff; }
  @media (max-width: 1100px) { .wrap { grid-template-columns: 1fr; } }
</style></head><body>
${bare ? '' : `<div class="wrap"><div>
  <h1>${esc(manifest.name)}</h1>
  <p class="sub">${esc(manifest.author ? 'by ' + manifest.author + ' · ' : '')}v${esc(manifest.version)} · ${esc(manifest.description ?? '')}</p>
  <div class="device">`}
    <iframe id="f" sandbox="allow-scripts" src="/addons/files/addon/${encodeURI(entry)}" title="${esc(manifest.name)}"></iframe>
    ${bare ? '' : `<div class="closed" id="closed"><div><b>The add-on closed itself</b> (Wisp.close)<br>On the Car Thing that's back to Home.<br><br><button onclick="reopen()">Open it again</button></div></div>
  </div>
  <div class="knob">
    <button onclick="knob(-1)">⟲ Turn back</button>
    <button class="primary" onclick="press()">Press</button>
    <button onclick="knob(1)">Turn ⟳</button>
    <button onclick="nextSong()">Next song</button>
    <button onclick="reopen()">Reload</button>
  </div>
  <p class="keys">Knob: <kbd>←</kbd> <kbd>→</kbd> or the mouse wheel · press: <kbd>Enter</kbd> or <kbd>Space</kbd> · back: <kbd>Esc</kbd> · reload: <kbd>R</kbd>. Click outside the screen first so the keys come here.</p>
</div>
<div>
  <div class="panel"><h2>Sample data</h2>
    <label><input type="checkbox" id="phone" checked> Phone connected (location, directions, the song)</label>
    <label><input type="checkbox" id="playing" checked> Something playing</label>
    <ul class="facts">
      <li>Song: <b id="song"></b></li>
      <li>Weather: 68°F, mostly clear</li>
      <li>Location: Long Beach, 38 mph</li>
      <li>Directions: 600 ft, turn left onto Pine Ave</li>
    </ul>
  </div>
  <div class="panel"><h2>It asks for</h2>
    <ul class="facts">
      <li>Permissions: <b>${esc((manifest.permissions ?? []).join(', ') || 'none')}</b></li>
      <li>Sites: <b>${esc((manifest.network ?? []).join(', ') || 'none')}</b></li>
    </ul>
  </div>
  <div class="panel"><h2>Bridge</h2><div id="log"></div>
    <p class="keys">What it asked the Car Thing and what it got. For its own errors, open your browser's console on the frame.</p></div>
</div></div>`}
<script>
  var manifest = ${JSON.stringify(manifest)}
  var sample = ${JSON.stringify(SAMPLE)}
  var store = ${JSON.stringify(seed)}
  var frame = document.getElementById('f')
  var song = sample.now_playing
  var $ = function (id) { return document.getElementById(id) }
  var on = function (id) { var el = $(id); return el ? el.checked : true }

  function log(text, cls) {
    var el = $('log')
    if (!el) return
    var line = document.createElement('div')
    if (cls) line.className = cls
    line.textContent = text
    el.appendChild(line)
    el.scrollTop = el.scrollHeight
  }
  function send(msg) {
    msg.wisp = 1
    frame.contentWindow && frame.contentWindow.postMessage(msg, '*')
  }
  function needs(p) {
    if ((manifest.permissions || []).indexOf(p) < 0) throw new Error("this add-on didn't ask for " + p)
  }
  async function answer(type, data) {
    switch (type) {
      case 'now_playing': needs('now_playing'); return on('phone') && on('playing') ? song : { playing: false }
      case 'weather': needs('weather'); return sample.weather
      case 'location': needs('location'); return on('phone') ? sample.location : null
      case 'nav': needs('nav'); return on('phone') ? sample.nav : { active: false, distance: '', instruction: '', arrival: '' }
      case 'timezone': return sample.timezone
      case 'fetch': {
        var url = String((data || {}).url || ''), host
        try { host = new URL(url).hostname } catch (e) { throw new Error('not a web address') }
        if ((manifest.network || []).indexOf(host) < 0) throw new Error(host + " isn't one of this add-on's sites")
        var r = await fetch('/__fetch?url=' + encodeURIComponent(url))
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      }
      case 'storage_get': return store[String((data || {}).key)] ?? null
      case 'storage_set': {
        var next = Object.assign({}, store)
        next[String(data.key)] = data.value
        if (JSON.stringify(next).length > 16384) throw new Error('add-on storage is full')
        store = next
        return true
      }
    }
    throw new Error('unknown request ' + type)
  }

  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow) return
    var m = e.data
    if (!m || m.wisp !== 1) return
    if (m.type === 'ready') { log('ready'); return }
    if (m.type === 'close') {
      log('close')
      if ($('closed')) { frame.style.display = 'none'; $('closed').style.display = 'grid' }
      return
    }
    answer(m.type, m.data).then(function (data) {
      log(m.type + (m.data && m.data.url ? ' ' + m.data.url : m.data && m.data.key ? ' ' + m.data.key : '') + ' → ' + short(data))
      send({ reply: m.id, data: data })
    }, function (err) {
      log(m.type + ' ✗ ' + err.message, 'no')
      send({ reply: m.id, error: err.message })
    })
  })
  function short(v) { var s = JSON.stringify(v); return s && s.length > 120 ? s.slice(0, 117) + '…' : s }

  function knob(d) { send({ event: 'knob', data: { delta: d } }); log('knob ' + (d > 0 ? '+1' : '-1'), 'ev') }
  function press() { send({ event: 'press' }); log('press', 'ev') }
  function nextSong() {
    song = song === sample.now_playing ? sample.next_song : sample.now_playing
    if ($('song')) $('song').textContent = song.name + ' · ' + song.artist
    if ((manifest.permissions || []).indexOf('now_playing') >= 0) { send({ event: 'nowplaying', data: song }); log('nowplaying ' + song.name, 'ev') }
  }
  function reopen() {
    if ($('closed')) $('closed').style.display = 'none'
    frame.style.display = 'block'
    frame.src = frame.src
    log('— reloaded —')
  }
  if ($('song')) $('song').textContent = song.name + ' · ' + song.artist

  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT' && e.key !== 'Enter') return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') knob(1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') knob(-1)
    else if (e.key === 'Enter' || e.key === ' ') press()
    else if (e.key === 'Escape') { log('back: closes it on the Car Thing'); reopen() }
    else if (e.key === 'r' || e.key === 'R') reopen()
    else return
    e.preventDefault()
  })
  var wheelAt = 0
  window.addEventListener('wheel', function (e) {
    var now = Date.now()
    if (now - wheelAt < 120) return
    wheelAt = now
    knob(e.deltaY > 0 ? 1 : -1)
  }, { passive: true })
</script></body></html>`
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

const port = serve ? Number(opt('--port') ?? 4848) : 0
await new Promise((r) => server.listen(port, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

if (serve) {
  console.log(`${manifest.name}: ${base}`)
  console.log('Edit its files and press R (or Reload) to see the change. Ctrl+C to stop.')
} else {
  await picture()
}

async function picture() {
  const chromePath =
    opt('--chrome') ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ].find((p) => existsSync(p))
  if (!chromePath) {
    console.error('No Chrome found; pass --chrome path/to/chrome')
    process.exit(2)
  }
  const profile = mkdtempSync(join(tmpdir(), 'wisp-preview-'))
  const dport = 9300 + Math.floor(Math.random() * 500)
  const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let tab
  for (let i = 0; i < 60 && !tab; i++) {
    await sleep(250)
    try {
      tab = (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find((t) => t.type === 'page')
    } catch {}
  }
  if (!tab) {
    console.error("Chrome didn't start")
    process.exit(1)
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++seq
      pending.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 480, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: base + '?bare' })
  await sleep(waitMs)
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 800, height: 480, scale: 0.5 } })
  const png = Buffer.from(shot.result.data, 'base64')
  writeFileSync(join(folder, 'preview.png'), png)
  if (manifest.image !== 'preview.png') {
    manifest.image = 'preview.png'
    writeFileSync(join(folder, 'addon.json'), JSON.stringify(manifest, null, 2) + '\n')
  }
  console.log(`${basename(folder)}: preview.png (${Math.round(png.length / 1024)} KB)`)
  ws.close()
  chrome.kill()
  server.close()
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
  process.exit(0)
}
