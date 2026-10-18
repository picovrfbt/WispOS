# Wisp relay

The go-between for **passengers pick the music**: passengers' phones and the
Car Thing aren't on the same network, so their messages (song searches, picks
and skip votes, never anyone's account) go through a relay. Wisp uses this
one when it's up and [ntfy.sh](https://ntfy.sh) otherwise. ntfy.sh's free tier
allows 250 messages a day from each address; this one runs on Cloudflare's
free plan (100,000 requests a day).

It speaks the small part of ntfy's protocol Wisp uses (`POST /<topic>`,
`GET /<topic>/json`, `GET /<topic>/sse`, `GET /v1/health`), so either works
for the Car Thing and the passengers' page.

## Put it online (once)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
Node.js.

```sh
cd relay
npm install
npx wrangler login
npx wrangler deploy
```

`deploy` prints the relay's address, like
`https://wisp-relay.<your-name>.workers.dev`. Put it in
[`docs/relay.json`](../docs/relay.json) and push:

```json
{ "relays": ["https://wisp-relay.<your-name>.workers.dev"] }
```

Car Things read that list from Wisp's website every 30 minutes and use the
first relay that answers, so it can change without an update. Running
sessions keep the relay they started on.

## Try it on your computer

```sh
npm run dev
```

## Limits

Each session (topic) keeps its last 15 minutes of messages, up to 200, and
takes at most 120 messages a minute. Messages are up to 4 KB. Nothing is
stored beyond that.
