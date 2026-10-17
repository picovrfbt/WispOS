import { afterEach, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../__tests__/msw-server'
import type { AddonManifest } from '@/api/addons'
import { answer, forgetAddon, NotAllowed } from '../bridge'
import { permissionLine } from '../permissions'

const clock: AddonManifest = { id: 'clock', name: 'Big clock', version: '1' }
const forecast: AddonManifest = {
  id: 'forecast',
  name: 'Forecast',
  version: '1',
  permissions: ['location', 'weather'],
  network: ['api.open-meteo.com'],
}

const ask = (a: AddonManifest, type: string, data?: unknown) => answer(a, { wisp: 1, type, data })

afterEach(() => localStorage.clear())

describe("an add-on's bridge", () => {
  it('refuses what the manifest did not ask for', async () => {
    for (const type of ['now_playing', 'weather', 'location', 'nav']) {
      await expect(ask(clock, type)).rejects.toBeInstanceOf(NotAllowed)
    }
    await expect(ask(forecast, 'now_playing')).rejects.toBeInstanceOf(NotAllowed)
    await expect(ask(clock, 'settings')).rejects.toBeInstanceOf(NotAllowed)
  })

  it('only fetches from its own sites', async () => {
    await expect(ask(forecast, 'fetch', { url: 'https://evil.example.com/x' })).rejects.toThrow(/isn't one of/)
    await expect(ask(clock, 'fetch', { url: 'https://api.open-meteo.com/v1' })).rejects.toThrow(/isn't one of/)
    await expect(ask(forecast, 'fetch', { url: 'not a url' })).rejects.toThrow(/web address/)
    server.use(http.post('*/addons/fetch', () => HttpResponse.json({ status: 200, body: '{"ok":1}' })))
    await expect(ask(forecast, 'fetch', { url: 'https://api.open-meteo.com/v1/forecast' })).resolves.toEqual({
      status: 200,
      body: '{"ok":1}',
    })
  })

  it('tells roughly where, never exactly', async () => {
    server.use(
      http.get('*/nav/status', () =>
        HttpResponse.json({ connected: true, active: false, updated_at: 0, location: { lat: 33.768912, lng: -118.195403, speed: 13.4 } }),
      ),
    )
    await expect(ask(forecast, 'location')).resolves.toEqual({ lat: 33.77, lng: -118.2, speed_mph: 30 })
  })

  it('keeps each add-on its own small storage', async () => {
    await ask(clock, 'storage_set', { key: 'face', value: 'analog' })
    await expect(ask(clock, 'storage_get', { key: 'face' })).resolves.toBe('analog')
    await expect(ask(forecast, 'storage_get', { key: 'face' })).resolves.toBeNull()
    await expect(ask(clock, 'storage_set', { key: 'big', value: 'x'.repeat(20000) })).rejects.toThrow(/full/)
    forgetAddon(clock)
    await expect(ask(clock, 'storage_get', { key: 'face' })).resolves.toBeNull()
  })

  it('says plainly what an add-on can know', () => {
    expect(permissionLine(forecast)).toBe('knows roughly where you are and the weather; talks to api.open-meteo.com')
    expect(permissionLine(clock)).toBe('Asks for nothing')
  })
})
