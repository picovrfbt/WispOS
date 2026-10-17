// Wisp's add-on bridge: include it with <script src="/addons/sdk.js"></script>.
// An add-on runs sandboxed; everything it learns from or asks of the Car Thing
// goes through here, and the Car Thing checks it against the add-on's manifest.
//
//   Wisp.on('knob', ({ delta }) => ...)   the knob turned (+1 clockwise, -1 back)
//   Wisp.on('press', () => ...)           the knob was pressed
//   Wisp.on('nowplaying', (np) => ...)    the song changed ("now_playing" permission)
//   await Wisp.nowPlaying()               { name, artist, album, image, playing }
//   await Wisp.weather()                  { temp, unit, summary } ("weather")
//   await Wisp.location()                 { lat, lng, speed_mph }, to about 1 km ("location")
//   await Wisp.nav()                      { active, distance, instruction, arrival } ("nav")
//   await Wisp.timezoneOffset()           minutes from UTC where you are (the Car Thing runs on UTC)
//   await Wisp.fetch(url)                 { status, body } from a site the manifest lists
//   await Wisp.storage.get(key)           a small value this add-on saved (16 KB in all)
//   await Wisp.storage.set(key, value)
//   Wisp.close()                          back to Home (the back button does it too)
(function () {
  'use strict'
  var pending = {}
  var seq = 0
  var handlers = {}
  function call(type, data) {
    return new Promise(function (resolve, reject) {
      var id = ++seq
      pending[id] = { resolve: resolve, reject: reject }
      parent.postMessage({ wisp: 1, id: id, type: type, data: data || null }, '*')
      setTimeout(function () {
        if (pending[id]) {
          delete pending[id]
          reject(new Error('Wisp did not answer'))
        }
      }, 15000)
    })
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return
    var m = e.data
    if (!m || m.wisp !== 1) return
    if (m.reply) {
      var p = pending[m.reply]
      if (!p) return
      delete pending[m.reply]
      if (m.error) p.reject(new Error(m.error))
      else p.resolve(m.data)
    } else if (m.event) {
      ;(handlers[m.event] || []).forEach(function (fn) {
        try {
          fn(m.data)
        } catch (err) {
          console.error(err)
        }
      })
    }
  })
  window.Wisp = {
    on: function (event, fn) {
      ;(handlers[event] = handlers[event] || []).push(fn)
    },
    nowPlaying: function () { return call('now_playing') },
    weather: function () { return call('weather') },
    location: function () { return call('location') },
    nav: function () { return call('nav') },
    timezoneOffset: function () { return call('timezone') },
    fetch: function (url) { return call('fetch', { url: String(url) }) },
    storage: {
      get: function (key) { return call('storage_get', { key: String(key) }) },
      set: function (key, value) { return call('storage_set', { key: String(key), value: value }) },
    },
    close: function () { return call('close') },
  }
  parent.postMessage({ wisp: 1, type: 'ready' }, '*')
})()
