// Wisp Add-on Studio's widgets: what an add-on made in the Studio's Build mode
// runs. It reads BOARD (the tiles you picked) and draws them; the knob moves
// between tiles and a press acts on the one it's on (a timer starts or
// stops, a counter counts). Everything it learns comes through window.Wisp.
(function () {
  'use strict'
  var B = window.BOARD || { tiles: [] }
  var tiles = B.tiles || []
  var focus = 0
  var offset = 0
  var store = {}
  var nav = null
  var board = document.getElementById('board')
  board.className = 'board n' + Math.min(6, Math.max(1, tiles.length))

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }
  function clock(ms, withAmPm) {
    var d = new Date(ms + offset * 60000), h = d.getUTCHours(), m = d.getUTCMinutes()
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (withAmPm ? '<small>' + (h < 12 ? 'AM' : 'PM') + '</small>' : '')
  }
  function pick(obj, path) {
    return String(path || '').split('.').reduce(function (o, k) {
      if (o == null || k === '') return o
      return o[/^\d+$/.test(k) ? Number(k) : k]
    }, obj)
  }

  // each tile: its element, what it shows now, and what a press does
  var cells = tiles.map(function (t, i) {
    var el = document.createElement('div')
    el.className = 'tile t-' + t.type
    board.appendChild(el)
    return { t: t, el: el, v: '–', s: '', i: i }
  })
  function paint(c) {
    var label = c.t.label || ''
    c.el.innerHTML = '<div class="eyebrow">' + esc(label) + '</div><div class="v">' + c.v + '</div><div class="s">' + c.s + '</div>'
    c.el.classList.toggle('on', c.i === focus && cells.length > 1)
  }
  function paintAll() { cells.forEach(paint) }

  var kinds = {
    clock: function (c) {
      c.v = clock(Date.now(), true)
      var d = new Date(Date.now() + offset * 60000)
      c.s = esc(d.toUTCString().slice(0, 11))
    },
    speed: function (c) {
      return Wisp.location().then(function (loc) {
        c.v = loc ? Math.round(loc.speed_mph) + '<small>mph</small>' : '–'
        c.s = loc ? '' : 'Waiting for your phone'
      })
    },
    weather: function (c) {
      return Wisp.weather().then(function (w) {
        c.v = w ? Math.round(w.temp) + '°' : '–'
        c.s = w ? esc(w.summary || '') : ''
      })
    },
    song: function (c) {
      return Wisp.nowPlaying().then(function (np) { song(c, np) })
    },
    turn: function (c) {
      return navNow().then(function (n) {
        c.v = n && n.active ? esc(n.distance) : '–'
        c.s = n && n.active ? esc(n.instruction) : 'No directions'
      })
    },
    arrival: function (c) {
      return navNow().then(function (n) {
        var parts = n && n.active ? String(n.arrival || '').split(' · ') : []
        c.v = parts.length ? esc(parts[parts.length - 1]) : '–'
        c.s = parts.length > 1 ? esc(parts.slice(0, -1).join(' · ')) : n && n.active ? '' : 'No directions'
      })
    },
    timer: function (c) {
      var end = store['timer' + c.i] || 0
      var left = end - Date.now()
      if (!end) { c.v = (c.t.minutes || 30) + '<small>min</small>'; c.s = 'Press to start' }
      else if (left > 0) {
        var s = Math.ceil(left / 1000)
        c.v = Math.floor(s / 60) + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60)
        c.s = 'Ends ' + clock(end, false) + ' · press to stop'
      } else { c.v = "Time's up"; c.s = 'Press to reset' }
    },
    counter: function (c) {
      c.v = String(store['count' + c.i] || 0)
      c.s = 'Press to count'
    },
    note: function (c) {
      c.v = esc(c.t.text || '')
      c.s = ''
    },
    web: function (c) {
      if (!c.t.url) { c.v = '–'; c.s = 'No address set'; return }
      return Wisp.fetch(c.t.url).then(function (res) {
        var val = pick(JSON.parse(res.body), c.t.path)
        if (typeof val === 'number') val = Math.round(val * 10) / 10
        c.v = val == null ? '–' : esc(val) + (c.t.suffix ? '<small>' + esc(c.t.suffix) + '</small>' : '')
        c.s = ''
      }).catch(function () { c.v = '–'; c.s = 'Offline' })
    },
  }

  var navAt = 0
  function navNow() {
    if (nav && Date.now() - navAt < 1500) return nav
    navAt = Date.now()
    nav = Wisp.nav()
    return nav
  }
  function song(c, np) {
    c.v = np && np.name ? esc(np.name) : 'Nothing playing'
    c.s = np && np.artist ? esc(np.artist) : ''
  }

  function refresh(c) {
    var r = kinds[c.t.type] && kinds[c.t.type](c)
    if (r && r.then) r.then(function () { paint(c) }, function () { paint(c) })
    else paint(c)
  }
  // how often each kind looks again, in seconds
  var every = { clock: 5, speed: 2, weather: 600, song: 0, turn: 3, arrival: 10, timer: 1, counter: 0, note: 0, web: 0 }
  cells.forEach(function (c) {
    refresh(c)
    var s = c.t.type === 'web' ? Math.max(1, c.t.every || 15) * 60 : every[c.t.type]
    if (s) setInterval(function () { refresh(c) }, s * 1000)
  })

  Wisp.on('knob', function (e) {
    if (cells.length < 2) return
    focus = (focus + e.delta + cells.length) % cells.length
    paintAll()
  })
  Wisp.on('press', function () {
    var c = cells[focus]
    if (!c) return
    if (c.t.type === 'timer') {
      var end = store['timer' + c.i] || 0
      store['timer' + c.i] = end ? 0 : Date.now() + (c.t.minutes || 30) * 60000
    } else if (c.t.type === 'counter') {
      store['count' + c.i] = (store['count' + c.i] || 0) + 1
    } else return
    Wisp.storage.set('board', store).catch(function () {})
    refresh(c)
  })
  Wisp.on('nowplaying', function (np) {
    cells.forEach(function (c) { if (c.t.type === 'song') { song(c, np); paint(c) } })
  })

  Wisp.timezoneOffset().then(function (m) {
    offset = m || 0
    cells.forEach(function (c) { if (c.t.type === 'clock' || c.t.type === 'timer') refresh(c) })
  }).catch(function () {})
  Wisp.storage.get('board').then(function (s) {
    if (s && typeof s === 'object') store = s
    cells.forEach(function (c) { if (c.t.type === 'timer' || c.t.type === 'counter') refresh(c) })
  }).catch(function () {})
})()
