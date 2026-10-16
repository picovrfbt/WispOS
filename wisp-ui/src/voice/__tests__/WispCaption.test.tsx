import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../__tests__/msw-server'
import type { ApiEvent } from '@/api/types'
import { __resetSettings, updateSettings } from '@/settings'
import { shouldSpeak, spokenTrack } from '../speak'

const bus = vi.hoisted(() => ({ listener: null as ((event: ApiEvent) => void) | null }))
vi.mock('@/api/eventBus', () => ({
  subscribeEvents: (listener: (event: ApiEvent) => void) => {
    bus.listener = listener
    return () => {
      bus.listener = null
    }
  },
}))

import { WispCaption } from '../WispCaption'

const voice = (state: string, text?: string) =>
  act(() => bus.listener?.({ type: 'voice', data: { state, text } } as ApiEvent))

function captureSay() {
  const said: Array<{ text: string; speed: number; volume: number }> = []
  server.use(
    http.post('*/phone/say', async ({ request }) => {
      said.push((await request.json()) as { text: string; speed: number; volume: number })
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('*/settings', () => HttpResponse.json({})),
  )
  return said
}

afterEach(() => {
  localStorage.clear()
  __resetSettings()
})

describe('WispCaption', () => {
  it('shows what Wisp did along the bottom, and stays quiet with the voice off', async () => {
    const said = captureSay()
    render(<WispCaption />)
    voice('playing', 'Midnight City - M83')
    expect(screen.getByText('Midnight City')).toBeInTheDocument()
    expect(screen.getByText('Wisp')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(said).toEqual([])
  })

  it('says it out loud at the chosen speed when the voice is on', async () => {
    const said = captureSay()
    updateSettings({ wispVoice: 'confirmations', voiceSpeed: 1.4, voiceVolumePct: 60 })
    render(<WispCaption />)
    voice('playing', 'Midnight City - M83')
    await waitFor(() =>
      expect(said).toEqual([{ text: 'Playing Midnight City, by M83', speed: 1.4, volume: 0.6 }]),
    )
    voice('error', "Couldn't find that")
    await waitFor(() => expect(said).toHaveLength(2))
  })

  it('keeps "thinking" on screen but never says it', async () => {
    const said = captureSay()
    updateSettings({ wispVoice: 'everything' })
    render(<WispCaption />)
    voice('thinking')
    expect(screen.getByText('Wisp')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(said).toEqual([])
  })
})

describe('what Wisp speaks', () => {
  it('confirmations always, extras only on Everything', () => {
    expect(shouldSpeak('confirm', 'off')).toBe(false)
    expect(shouldSpeak('confirm', 'confirmations')).toBe(true)
    expect(shouldSpeak('extra', 'confirmations')).toBe(false)
    expect(shouldSpeak('extra', 'everything')).toBe(true)
  })

  it('reads a track the way a person would', () => {
    expect(spokenTrack('Midnight City - M83')).toBe('Midnight City, by M83')
    expect(spokenTrack('Intro')).toBe('Intro')
  })
})
