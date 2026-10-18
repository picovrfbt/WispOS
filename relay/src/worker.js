// Wisp's relay for "passengers pick the music": a tiny stand-in for the parts
// of ntfy (https://ntfy.sh) that Wisp uses, on Cloudflare's free tier.
//
//   POST /<topic>                 publish a message (the body, up to 4 KB)
//   GET  /<topic>/json?since=…    the messages as a stream, one JSON per line (the Car Thing)
//   GET  /<topic>/sse?since=…     the same as server-sent events (the passengers' page)
//   GET  /v1/health               {"healthy": true}
//
// since: "all", a message id, or a duration like "2m". Each topic is a Durable
// Object holding its last few minutes of messages and the open streams; it's
// forgotten once nobody has used it for a while. Nothing is logged or kept
// beyond that: song searches and picks only, never an account.

const TOPIC = /^[A-Za-z0-9_-]{1,64}$/
const MAX_MESSAGE = 4096
const KEEP_MESSAGES = 200
const KEEP_FOR_MS = 15 * 60 * 1000
const KEEPALIVE_MS = 25 * 1000
// per topic: at most this many messages a minute, so one session can't eat the day
const PER_MINUTE = 120

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    const url = new URL(request.url)
    if (url.pathname === '/v1/health') return json({ healthy: true })
    if (url.pathname === '/' || url.pathname === '') {
      return new Response('Wisp relay: messages for "passengers pick the music". https://picovrfbt.github.io/WispOS/\n', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      })
    }
    const parts = url.pathname.split('/').filter(Boolean)
    const topic = parts[0]
    if (!topic || !TOPIC.test(topic) || parts.length > 2) return json({ error: 'not found' }, 404)
    const kind = parts[1] || ''
    const stub = env.TOPICS.get(env.TOPICS.idFromName(topic))
    if (request.method === 'POST' && kind === '') {
      const body = await request.text()
      if (body.length > MAX_MESSAGE) return json({ error: 'message too long' }, 413)
      return stub.fetch('https://topic/publish', { method: 'POST', body })
    }
    if (request.method === 'GET' && (kind === 'json' || kind === 'sse')) {
      const since = encodeURIComponent(url.searchParams.get('since') || '')
      return stub.fetch(`https://topic/${kind}?since=${since}`, { signal: request.signal })
    }
    return json({ error: 'not found' }, 404)
  },
}

function newId() {
  const a = new Uint8Array(9)
  crypto.getRandomValues(a)
  return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, '').slice(0, 12)
}

export class Topic {
  constructor(state) {
    this.state = state
    this.messages = [] // {id, time (s), event: 'message', message}
    this.streams = new Set() // {write(ev), close()}
    this.recent = [] // publish times, for PER_MINUTE
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/publish') return this.publish(await request.text())
    return this.listen(request)
  }

  // POST: keep it and hand it to everyone listening
  async publish(body) {
    const now = Date.now()
    this.recent = this.recent.filter((t) => now - t < 60_000)
    if (this.recent.length >= PER_MINUTE) return json({ error: 'too many messages' }, 429)
    this.recent.push(now)
    const ev = { id: newId(), time: Math.floor(now / 1000), event: 'message', message: body }
    this.messages.push(ev)
    this.messages = this.messages.filter((m) => now - m.time * 1000 < KEEP_FOR_MS).slice(-KEEP_MESSAGES)
    for (const s of this.streams) s.write(ev)
    return json(ev)
  }

  // GET: what's kept since `since`, then each new message as it comes
  listen(request) {
    const url = new URL(request.url)
    const sse = url.pathname === '/sse'
    const since = url.searchParams.get('since') || ''
    const encoder = new TextEncoder()
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const send = (text) => writer.write(encoder.encode(text)).catch(() => stream.close())
    const line = (ev) => (sse ? `event: ${ev.event}\ndata: ${JSON.stringify(ev)}\n\n` : JSON.stringify(ev) + '\n')
    let timer = 0
    const stream = {
      write: (ev) => send(line(ev)),
      close: () => {
        if (!this.streams.has(stream)) return
        this.streams.delete(stream)
        clearInterval(timer)
        writer.close().catch(() => {})
      },
    }
    this.streams.add(stream)
    request.signal?.addEventListener('abort', () => stream.close())

    send(line({ id: newId(), time: Math.floor(Date.now() / 1000), event: 'open' }))
    for (const ev of this.since(since)) stream.write(ev)
    timer = setInterval(() => send(sse ? ': keepalive\n\n' : JSON.stringify({ event: 'keepalive', time: Math.floor(Date.now() / 1000) }) + '\n'), KEEPALIVE_MS)

    return new Response(readable, {
      headers: {
        'Content-Type': sse ? 'text/event-stream' : 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        ...CORS,
      },
    })
  }

  since(since) {
    if (since === 'all') return this.messages
    const d = /^(\d+)([smh])$/.exec(since)
    if (d) {
      const ms = Number(d[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[d[2]]
      return this.messages.filter((m) => Date.now() - m.time * 1000 <= ms)
    }
    const i = this.messages.findIndex((m) => m.id === since)
    return i >= 0 ? this.messages.slice(i + 1) : []
  }
}
