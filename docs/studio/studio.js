// Wisp's Add-on Studio. Build an add-on from tiles or write it, run it the
// way the Car Thing does (a sandboxed frame, the real bridge, the same content
// rules) against sample data, take its picture, and download it as a zip
// that's ready to send in. Everything stays in this browser.

const $ = (id) => document.getElementById(id)
const SAVE_KEY = 'wisp.studio.v1'
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/
const MAX_PICTURE = 200 * 1024

// what the Car Thing would answer (the same as addons/preview.mjs)
const SAMPLE = {
  now_playing: { name: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", image: '', playing: true },
  next_song: { name: 'Feel It Still', artist: 'Portugal. The Man', album: 'Woodstock', image: '', playing: true },
  weather: { temp: 68, unit: 'F', summary: 'Mostly clear' },
  location: { lat: 33.77, lng: -118.19, speed_mph: 38 },
  nav: { active: true, distance: '600 ft', instruction: 'Turn left onto Pine Ave', arrival: '12 min · 5.1 mi · 3:45 PM' },
}

const TILES = {
  clock: { name: 'Clock', label: 'Time' },
  speed: { name: 'Speed', label: 'Speed', perm: 'location' },
  weather: { name: 'Weather', label: 'Outside', perm: 'weather' },
  song: { name: "What's playing", label: 'Playing', perm: 'now_playing' },
  turn: { name: 'Next turn', label: 'Next turn', perm: 'nav' },
  arrival: { name: 'Arrival time', label: 'Arrival', perm: 'nav' },
  timer: { name: 'Timer', label: 'Parking', opts: [['minutes', 'Minutes', 'number']] },
  counter: { name: 'Counter', label: 'Count' },
  note: { name: 'Note', label: 'Note', opts: [['text', 'What it says', 'text', true]] },
  web: {
    name: 'Number from a website',
    label: 'Wind',
    opts: [
      ['url', 'Address (https, returns JSON)', 'url', true],
      ['path', 'Which value (like current.wind_speed_10m)', 'text', true],
      ['suffix', 'After it (like mph)', 'text'],
      ['every', 'Look again every (minutes)', 'number'],
    ],
  },
}

const ACCENTS = ['#1ed760', '#3b82f6', '#a855f7', '#f43f5e', '#f59e0b', '#14b8a6']

const STARTER = () => ({
  mode: 'build',
  build: {
    title: 'My dash',
    tiles: [
      { type: 'speed', label: 'Speed' },
      { type: 'clock', label: 'Time' },
      { type: 'song', label: 'Playing' },
      { type: 'weather', label: 'Outside' },
    ],
    accent: '#1ed760',
    bg: 'glow',
  },
  code: null, // { 'index.html', 'style.css' } once in Code mode
  codeFile: 'index.html',
  codeEdited: false,
  details: { name: '', author: '', desc: '', id: '', idTouched: false, version: '1.0.0', perms: [], sites: '' },
  picture: null, // { data: data URL, ext }
})

let state = load()
const assets = {}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY))
    if (s && s.build && s.details) return Object.assign(STARTER(), s)
  } catch {}
  return STARTER()
}
let saveTimer = 0
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state))
    } catch {}
  }, 300)
}

// ---------------------------------------------------------------- build mode

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function buildPerms() {
  const perms = new Set()
  const sites = new Set()
  for (const t of state.build.tiles) {
    if (TILES[t.type]?.perm) perms.add(TILES[t.type].perm)
    if (t.type === 'web' && t.url) {
      try {
        sites.add(new URL(t.url).hostname)
      } catch {}
    }
  }
  return { perms: [...perms], sites: [...sites] }
}

function buildFiles() {
  const b = state.build
  const n = Math.min(6, Math.max(1, b.tiles.length))
  const bg =
    b.bg === 'glow'
      ? 'radial-gradient(70% 90% at 8% 0%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 70%), var(--bg)'
      : b.bg === 'deep'
        ? 'linear-gradient(160deg, #151a24, #07080a)'
        : 'var(--bg)'
  const css = `  :root { --accent: ${b.accent}; }
  body { background: ${bg}; }
  #board { flex: 1; min-height: 0; display: grid; gap: 12px;${b.title ? ' margin-top: 16px;' : ''} }
  .n1 { --vs: 120px; grid-template-columns: 1fr; }
  .n2 { --vs: 76px; grid-template-columns: 1fr 1fr; }
  .n3 { --vs: 56px; grid-template-columns: repeat(3, 1fr); }
  .n4 { --vs: 54px; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .n5, .n6 { --vs: 42px; grid-template-columns: repeat(3, 1fr); grid-template-rows: 1fr 1fr; }
  .tile { min-width: 0; display: flex; flex-direction: column; padding: 18px 22px; border-radius: var(--radius); background: var(--panel); border: 2px solid transparent; transition: border-color .15s, background .15s; }
  .tile.on { background: var(--panel-on); border-color: var(--accent); }
  .tile .v { margin-top: auto; font-size: var(--vs); font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; font-variant-numeric: tabular-nums; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .tile .v small { margin-left: 6px; font-size: 0.4em; font-weight: 600; color: var(--fg-3); letter-spacing: 0; }
  .t-song .v, .t-note .v, .t-arrival .v { font-size: calc(var(--vs) * 0.6); }
  .tile .s { margin-top: 4px; font-size: 17px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`
  const board = JSON.stringify({ tiles: b.tiles.slice(0, 6) }, null, 2).replace(/</g, '\\u003c')
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(state.details.name || 'My add-on')}</title>
<link rel="stylesheet" href="style.css">
<style>
${css}
</style>
</head>
<body>
<!-- Made with Wisp's Add-on Studio. BOARD lists the tiles; the script after it draws them. -->
<main class="screen">
${b.title ? `  <h1 class="title">${esc(b.title)}</h1>\n` : ''}  <div id="board" class="n${n}"></div>
</main>
<script src="/addons/sdk.js"></script>
<script>
var BOARD = ${board}
</script>
<script>
${assets.board}
</script>
</body>
</html>
`
  return { 'index.html': html, 'style.css': assets.kit }
}

function files() {
  return state.mode === 'code' && state.code ? state.code : buildFiles()
}

function renderTiles() {
  const list = $('b-tiles')
  list.innerHTML = ''
  state.build.tiles.forEach((t, i) => {
    const def = TILES[t.type]
    const li = document.createElement('li')
    li.innerHTML = `<div class="tile-top"><b>${esc(def.name)}</b>
      <button data-a="up" title="Move up" aria-label="Move ${esc(def.name)} up">↑</button>
      <button data-a="down" title="Move down" aria-label="Move ${esc(def.name)} down">↓</button>
      <button data-a="del" title="Remove" aria-label="Remove ${esc(def.name)}">✕</button></div>
      <div class="tile-opts"><input data-k="label" value="${esc(t.label)}" placeholder="Label" aria-label="Label" maxlength="30">
      ${(def.opts || [])
        .map(([k, ph, type, full]) => `<input data-k="${k}" type="${type}" value="${esc(t[k] ?? '')}" placeholder="${esc(ph)}" aria-label="${esc(ph)}"${full ? ' class="full"' : ''}${type === 'number' ? ' min="1" max="600"' : ''}>`)
        .join('')}</div>`
    li.querySelectorAll('button').forEach((btn) =>
      btn.addEventListener('click', () => {
        const tiles = state.build.tiles
        if (btn.dataset.a === 'del') tiles.splice(i, 1)
        if (btn.dataset.a === 'up' && i > 0) [tiles[i - 1], tiles[i]] = [tiles[i], tiles[i - 1]]
        if (btn.dataset.a === 'down' && i < tiles.length - 1) [tiles[i + 1], tiles[i]] = [tiles[i], tiles[i + 1]]
        changed(true)
      }),
    )
    li.querySelectorAll('input').forEach((inp) =>
      inp.addEventListener('input', () => {
        const k = inp.dataset.k
        t[k] = inp.type === 'number' ? (inp.value === '' ? undefined : Number(inp.value)) : inp.value
        changed(false)
      }),
    )
    list.appendChild(li)
  })
  $('b-add').disabled = state.build.tiles.length >= 6
  $('b-add').options[0].textContent = state.build.tiles.length >= 6 ? 'Six tiles is the most' : '+ Add a tile…'
}

function renderTheme() {
  const box = $('b-accent')
  box.innerHTML = ''
  for (const c of ACCENTS) {
    const b = document.createElement('button')
    b.style.background = c
    b.setAttribute('aria-label', `Accent ${c}`)
    b.setAttribute('aria-pressed', String(state.build.accent === c))
    b.addEventListener('click', () => {
      state.build.accent = c
      renderTheme()
      changed(false)
    })
    box.appendChild(b)
  }
  const pick = document.createElement('input')
  pick.type = 'color'
  pick.value = state.build.accent
  pick.setAttribute('aria-label', 'Any colour')
  pick.addEventListener('input', () => {
    state.build.accent = pick.value
    changed(false)
  })
  box.appendChild(pick)
  document.querySelectorAll('#b-bg button').forEach((b) => b.setAttribute('aria-pressed', String(state.build.bg === b.dataset.v)))
}

// ---------------------------------------------------------------- code mode

function renderCode() {
  const ed = $('c-editor')
  if (state.code) ed.value = state.code[state.codeFile] ?? ''
  document.querySelectorAll('.filetabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.file === state.codeFile)))
}

async function loadTemplate(name) {
  if (state.codeEdited && !confirm('Replace your code with this template?')) return
  const base = `studio/templates/${name}/`
  const [html, css, manifest] = await Promise.all([
    fetch(base + 'index.html').then((r) => r.text()),
    fetch(base + 'style.css').then((r) => r.text()),
    fetch(base + 'addon.json').then((r) => r.json()),
  ])
  state.code = { 'index.html': html, 'style.css': css }
  state.codeEdited = false
  state.codeFile = 'index.html'
  state.details.perms = manifest.permissions ?? []
  state.details.sites = (manifest.network ?? []).join('\n')
  if (!state.details.desc) state.details.desc = manifest.description
  renderDetails()
  renderCode()
  changed(false)
}

function setMode(mode) {
  if (mode === state.mode) return
  if (mode === 'code' && !state.code) {
    // your tiles become code to start from
    state.code = buildFiles()
    state.codeEdited = false
    const p = buildPerms()
    state.details.perms = p.perms
    state.details.sites = p.sites.join('\n')
  }
  if (mode === 'build' && state.codeEdited && !confirm('Go back to Build? Your code changes are set aside; Build makes the add-on from your tiles again.')) return
  if (mode === 'build') {
    state.code = null
    state.codeEdited = false
  }
  state.mode = mode
  renderMode()
  changed(false)
}

function renderMode() {
  const code = state.mode === 'code'
  $('tab-build').setAttribute('aria-selected', String(!code))
  $('tab-code').setAttribute('aria-selected', String(code))
  $('build-pane').hidden = code
  $('code-pane').hidden = !code
  if (code) renderCode()
  renderDetails()
}

// ---------------------------------------------------------------- details

function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function manifest() {
  const d = state.details
  const p = state.mode === 'build' ? buildPerms() : { perms: d.perms, sites: d.sites.split(/\s+/).filter(Boolean) }
  const m = {
    id: d.id || slug(d.name),
    name: d.name.trim(),
    version: d.version.trim() || '1.0.0',
    author: d.author.trim(),
    description: d.desc.trim(),
  }
  if (p.perms.length) m.permissions = p.perms
  if (p.sites.length) m.network = p.sites
  m.image = 'preview.' + (state.picture?.ext ?? 'png')
  return m
}

function renderDetails() {
  const d = state.details
  $('d-name').value = d.name
  $('d-author').value = d.author
  $('d-desc').value = d.desc
  $('d-id').value = d.idTouched ? d.id : slug(d.name)
  $('d-version').value = d.version
  $('d-desc-count').textContent = `${d.desc.length} / 200`
  const locked = state.mode === 'build'
  const p = locked ? buildPerms() : { perms: d.perms, sites: d.sites.split(/\s+/).filter(Boolean) }
  document.querySelectorAll('#d-perms input').forEach((c) => {
    c.checked = p.perms.includes(c.value)
    c.disabled = locked
  })
  $('d-perms').classList.toggle('locked', locked)
  $('d-sites').value = p.sites.join('\n')
  $('d-sites').readOnly = locked
  $('perm-note').textContent = locked ? '(set by your tiles)' : '(only what it uses)'
}

function bindDetails() {
  const d = state.details
  $('d-name').addEventListener('input', (e) => {
    d.name = e.target.value
    if (!d.idTouched) $('d-id').value = slug(d.name)
    changed(false, true)
  })
  $('d-author').addEventListener('input', (e) => {
    d.author = e.target.value
    changed(false, true)
  })
  $('d-desc').addEventListener('input', (e) => {
    d.desc = e.target.value
    $('d-desc-count').textContent = `${d.desc.length} / 200`
    changed(false, true)
  })
  $('d-id').addEventListener('input', (e) => {
    d.id = e.target.value.toLowerCase()
    d.idTouched = d.id !== ''
    changed(false, true)
  })
  $('d-version').addEventListener('input', (e) => {
    d.version = e.target.value
    changed(false, true)
  })
  document.querySelectorAll('#d-perms input').forEach((c) =>
    c.addEventListener('change', () => {
      d.perms = [...document.querySelectorAll('#d-perms input:checked')].map((x) => x.value)
      changed(false)
    }),
  )
  $('d-sites').addEventListener('input', (e) => {
    d.sites = e.target.value
    changed(false)
  })
}

// ---------------------------------------------------------------- the screen

let frameReady = false
let song = SAMPLE.now_playing
let store = {}

function srcdoc(f, extra = '') {
  // the Car Thing's rules (its files are inlined here, so no address of their own)
  const csp =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"
  let html = f['index.html']
  const inlineScript = (code) => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`
  html = html.replace(/<script\s+src=["']\/addons\/sdk\.js["']\s*><\/script>/i, () => inlineScript(assets.sdk))
  html = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']style\.css["']\s*\/?>/i, () => `<style>${f['style.css'] ?? ''}</style>`)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + meta) : meta + html
  return extra ? html.replace(/<\/body>/i, extra + '</body>') : html + extra
}

let renderTimer = 0
function renderScreen(now) {
  clearTimeout(renderTimer)
  renderTimer = setTimeout(
    () => {
      store = {}
      frameReady = false
      $('closed').hidden = true
      $('frame').hidden = false
      $('frame').srcdoc = srcdoc(files())
      log('— started —')
    },
    now ? 0 : 450,
  )
}

function fitScreen() {
  const box = $('screen-box')
  $('frame').style.transform = `scale(${box.clientWidth / 800})`
}

function log(text, cls) {
  const el = $('log')
  const line = document.createElement('div')
  if (cls) line.className = cls
  line.textContent = text
  el.appendChild(line)
  while (el.childNodes.length > 200) el.removeChild(el.firstChild)
  el.scrollTop = el.scrollHeight
}
const short = (v) => {
  const s = JSON.stringify(v)
  return s && s.length > 110 ? s.slice(0, 107) + '…' : s
}

function send(msg) {
  $('frame').contentWindow?.postMessage({ wisp: 1, ...msg }, '*')
}

async function answer(type, data) {
  const m = manifest()
  const needs = (p) => {
    if (!(m.permissions ?? []).includes(p)) throw new Error(`this add-on didn't ask for ${p}`)
  }
  const phone = $('s-phone').checked
  switch (type) {
    case 'now_playing':
      needs('now_playing')
      return phone && $('s-playing').checked ? song : { playing: false }
    case 'weather':
      needs('weather')
      return SAMPLE.weather
    case 'location':
      needs('location')
      return phone ? SAMPLE.location : null
    case 'nav':
      needs('nav')
      return phone ? SAMPLE.nav : { active: false, distance: '', instruction: '', arrival: '' }
    case 'timezone':
      return -new Date().getTimezoneOffset()
    case 'fetch': {
      const url = String(data?.url ?? '')
      let u
      try {
        u = new URL(url)
      } catch {
        throw new Error('not a web address')
      }
      if (!(m.network ?? []).includes(u.hostname)) throw new Error(`${u.hostname} isn't one of this add-on's sites`)
      if (u.protocol !== 'https:') throw new Error('only https')
      let r
      try {
        r = await fetch(u, { credentials: 'omit' })
      } catch {
        throw new Error(`${u.hostname} doesn't let browsers read it directly, so the Studio can't show it; the Car Thing fetches it itself, so it may still work there`)
      }
      const body = (await r.text()).slice(0, 256 * 1024)
      return { status: r.status, content_type: r.headers.get('content-type') ?? '', body }
    }
    case 'storage_get':
      return store[String(data?.key)] ?? null
    case 'storage_set': {
      const next = { ...store, [String(data.key)]: data.value }
      if (JSON.stringify(next).length > 16384) throw new Error('add-on storage is full')
      store = next
      return true
    }
  }
  throw new Error(`unknown request ${type}`)
}

window.addEventListener('message', (e) => {
  if (e.source !== $('frame').contentWindow) return
  const m = e.data
  if (m && m.wispStudio === 'shot') return gotPicture(m)
  if (!m || m.wisp !== 1) return
  if (m.type === 'ready') {
    frameReady = true
    return log('ready')
  }
  if (m.type === 'close') {
    log('close')
    $('frame').hidden = true
    $('closed').hidden = false
    return
  }
  answer(m.type, m.data).then(
    (data) => {
      log(`${m.type}${m.data?.url ? ' ' + m.data.url : m.data?.key ? ' ' + m.data.key : ''} → ${short(data)}`)
      send({ reply: m.id, data })
    },
    (err) => {
      log(`${m.type} ✗ ${err.message}`, 'no')
      send({ reply: m.id, error: err.message })
    },
  )
})

function knob(d) {
  send({ event: 'knob', data: { delta: d } })
  log(`knob ${d > 0 ? '+1' : '-1'}`, 'ev')
}
function press() {
  send({ event: 'press' })
  log('press', 'ev')
}

// ---------------------------------------------------------------- picture

// the add-on draws itself: its page, as it is after a moment, into an SVG
// picture and onto a canvas. It stays inside its sandbox, like on the Car Thing
const SHOOT = `<script>
setTimeout(function () {
  var html = new XMLSerializer().serializeToString(document.documentElement)
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><foreignObject x="0" y="0" width="800" height="480">' + html + '</foreignObject></svg>'
  var img = new Image()
  img.onload = function () {
    try {
      var c = document.createElement('canvas')
      c.width = 400
      c.height = 240
      var x = c.getContext('2d')
      x.fillStyle = getComputedStyle(document.body).backgroundColor || '#0d0f12'
      x.fillRect(0, 0, 400, 240)
      x.drawImage(img, 0, 0, 400, 240)
      parent.postMessage({ wispStudio: 'shot', data: c.toDataURL('image/png') }, '*')
    } catch (e) {
      parent.postMessage({ wispStudio: 'shot', error: String(e) }, '*')
    }
  }
  img.onerror = function () { parent.postMessage({ wispStudio: 'shot', error: 'the page could not be drawn' }, '*') }
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}, 2500)
<\/script>`

function takePicture() {
  const btn = $('p-take')
  btn.disabled = true
  $('p-note').textContent = 'Starting it again and taking the picture in a moment…'
  store = {}
  $('closed').hidden = true
  $('frame').hidden = false
  $('frame').srcdoc = srcdoc(files(), SHOOT)
  setTimeout(() => {
    if (btn.disabled) {
      btn.disabled = false
      $('p-note').textContent = "The picture didn't come back. Try again, or upload your own."
    }
  }, 12000)
}

function gotPicture(m) {
  $('p-take').disabled = false
  if (m.error || !m.data) {
    $('p-note').textContent = `The picture didn't work (${m.error ?? 'empty'}). Upload your own instead.`
    return
  }
  setPicture(m.data, 'png', 'A picture of the screen, 400 × 240.')
}

function setPicture(data, ext, note) {
  const bytes = Math.round((data.length - data.indexOf(',') - 1) * 0.75)
  if (bytes > MAX_PICTURE) {
    $('p-note').textContent = `That picture is ${Math.round(bytes / 1024)} KB; it needs to be 200 KB or less.`
    return
  }
  state.picture = { data, ext }
  $('p-note').textContent = `${note} ${Math.round(bytes / 1024)} KB.`
  renderPicture()
  changed(false, true)
}

function renderPicture() {
  const box = $('pic-box')
  box.innerHTML = state.picture ? `<img src="${state.picture.data}" alt="Your add-on's picture">` : '<span class="faint">No picture yet</span>'
}

function uploadPicture(file) {
  if (!file) return
  const img = new Image()
  img.onload = () => {
    // fitted to 400 × 240, the screen's shape, cropping what doesn't fit
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 240
    const s = Math.max(400 / img.width, 240 / img.height)
    const w = img.width * s
    const h = img.height * s
    c.getContext('2d').drawImage(img, (400 - w) / 2, (240 - h) / 2, w, h)
    let data = c.toDataURL('image/png')
    let ext = 'png'
    if (data.length * 0.75 > MAX_PICTURE) {
      data = c.toDataURL('image/jpeg', 0.86)
      ext = 'jpg'
    }
    URL.revokeObjectURL(img.src)
    setPicture(data, ext, 'Your picture, fitted to 400 × 240.')
  }
  img.onerror = () => ($('p-note').textContent = "That file isn't a picture this browser can read.")
  img.src = URL.createObjectURL(file)
}

// ---------------------------------------------------------------- download

function checks() {
  const m = manifest()
  const d = state.details
  return [
    [m.name.length > 0, 'It has a name'],
    [m.author.length > 0, 'It says who made it'],
    [m.description.length >= 10, 'It has a one-line description'],
    [ID_RE.test(m.id), 'Its id is 2 to 40 lowercase letters, digits and dashes'],
    [/^\d+(\.\d+){0,2}$/.test(m.version), 'Its version is like 1.0.0'],
    [!!state.picture, 'It has a picture'],
    [state.mode === 'code' || state.build.tiles.length > 0, 'It shows something'],
    [state.mode === 'build' || !d.sites.split(/\s+/).filter(Boolean).some((h) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)), 'Its sites are plain host names'],
  ]
}

function renderChecks() {
  const list = checks()
  $('checks').innerHTML = list.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${esc(t)}</li>`).join('')
  $('dl').disabled = !list.every(([ok]) => ok)
  const name = state.details.name.trim()
  $('send').href = `https://github.com/picovrfbt/WispOS/issues/new?template=addon.yml${name ? '&title=' + encodeURIComponent('Add-on: ' + name) : ''}`
}

async function download() {
  if (!window.JSZip) return alert("The zip tool didn't load; check your connection and reload.")
  const m = manifest()
  const f = files()
  const zip = new window.JSZip()
  const dir = zip.folder(m.id)
  dir.file('addon.json', JSON.stringify(m, null, 2) + '\n')
  dir.file('index.html', f['index.html'])
  dir.file('style.css', f['style.css'] ?? '')
  dir.file(m.image, state.picture.data.split(',')[1], { base64: true })
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${m.id}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

// ---------------------------------------------------------------- wiring

function changed(rerenderTiles, detailsOnly) {
  if (rerenderTiles) renderTiles()
  if (!detailsOnly) {
    renderDetails()
    renderScreen()
  } else if (state.mode === 'build') {
    // the page's <title> follows the name
    renderScreen()
  }
  renderChecks()
  save()
}

async function start() {
  const [kit, board, sdk] = await Promise.all(['studio/kit.css', 'studio/board.js', 'studio/sdk.js'].map((u) => fetch(u).then((r) => r.text())))
  Object.assign(assets, { kit, board, sdk })

  $('tab-build').addEventListener('click', () => setMode('build'))
  $('tab-code').addEventListener('click', () => setMode('code'))
  $('b-title').value = state.build.title
  $('b-title').addEventListener('input', (e) => {
    state.build.title = e.target.value
    changed(false)
  })
  $('b-add').addEventListener('change', (e) => {
    const type = e.target.value
    e.target.value = ''
    if (!type || state.build.tiles.length >= 6) return
    const t = { type, label: TILES[type].label }
    if (type === 'timer') t.minutes = 60
    if (type === 'note') t.text = 'Gate code 4512'
    if (type === 'web') {
      t.url = 'https://api.open-meteo.com/v1/forecast?latitude=34.05&longitude=-118.24&current=wind_speed_10m&wind_speed_unit=mph'
      t.path = 'current.wind_speed_10m'
      t.suffix = 'mph'
      t.every = 15
    }
    state.build.tiles.push(t)
    changed(true)
  })
  document.querySelectorAll('#b-bg button').forEach((b) =>
    b.addEventListener('click', () => {
      state.build.bg = b.dataset.v
      renderTheme()
      changed(false)
    }),
  )

  $('c-template').addEventListener('change', (e) => {
    const t = e.target.value
    e.target.value = ''
    if (t) loadTemplate(t)
  })
  document.querySelectorAll('.filetabs button').forEach((b) =>
    b.addEventListener('click', () => {
      state.codeFile = b.dataset.file
      renderCode()
      save()
    }),
  )
  $('c-editor').addEventListener('input', (e) => {
    if (!state.code) return
    state.code[state.codeFile] = e.target.value
    state.codeEdited = true
    renderScreen()
    renderChecks()
    save()
  })
  // Tab indents in the editor
  $('c-editor').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const ed = e.target
    const { selectionStart: a, selectionEnd: b } = ed
    ed.setRangeText('  ', a, b, 'end')
    ed.dispatchEvent(new Event('input'))
  })

  bindDetails()
  $('k-back').addEventListener('click', () => knob(-1))
  $('k-fwd').addEventListener('click', () => knob(1))
  $('k-press').addEventListener('click', press)
  $('k-reload').addEventListener('click', () => renderScreen(true))
  $('reopen').addEventListener('click', () => renderScreen(true))
  $('k-song').addEventListener('click', () => {
    song = song === SAMPLE.now_playing ? SAMPLE.next_song : SAMPLE.now_playing
    if ((manifest().permissions ?? []).includes('now_playing')) {
      send({ event: 'nowplaying', data: song })
      log(`nowplaying ${song.name}`, 'ev')
    }
  })
  // the knob from the keyboard, when you're not typing
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
    if (e.key === 'ArrowRight') knob(1)
    else if (e.key === 'ArrowLeft') knob(-1)
    else if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') press()
    else return
    e.preventDefault()
  })
  $('p-take').addEventListener('click', takePicture)
  $('p-upload').addEventListener('change', (e) => uploadPicture(e.target.files[0]))
  $('dl').addEventListener('click', download)
  $('startover').addEventListener('click', () => {
    if (!confirm('Start over? This clears your add-on from this browser.')) return
    state = STARTER()
    try {
      localStorage.removeItem(SAVE_KEY)
    } catch {}
    location.reload()
  })

  new ResizeObserver(fitScreen).observe($('screen-box'))
  fitScreen()
  renderTiles()
  renderTheme()
  renderMode()
  renderPicture()
  renderChecks()
  renderScreen(true)
}

start().catch((e) => {
  console.error(e)
  document.querySelector('.studio .lead-doc').textContent = "The Studio couldn't load its files. Reload the page to try again."
})
