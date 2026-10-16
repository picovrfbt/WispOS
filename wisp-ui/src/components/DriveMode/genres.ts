import type { DriveGenre } from '@/api/drive'

export interface GenreLook {
  id: DriveGenre
  name: string
  blurb: string
  /** the cover: a gradient, since these tracks have no artwork */
  cover: string
  /** the glowing bar's colours, low end to high */
  glow: [string, string]
  /** the glow's colour as r, g, b for the shadows */
  glowRgb: string
}

export const GENRES: GenreLook[] = [
  {
    id: 'ethereal',
    name: 'Ethereal',
    blurb: 'Strings, choir and piano in a wide, dreamy hall',
    cover:
      'radial-gradient(circle at 30% 25%, rgba(255, 214, 240, 0.85) 0%, rgba(255, 214, 240, 0) 42%),' +
      'radial-gradient(circle at 75% 80%, rgba(80, 230, 220, 0.75) 0%, rgba(80, 230, 220, 0) 50%),' +
      'linear-gradient(150deg, #6d4bd8 0%, #3b2a8f 45%, #12204f 100%)',
    glow: ['#8f7bff', '#7ff0e6'],
    glowRgb: '143, 160, 255',
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Brass, big drums and soaring strings',
    cover:
      'radial-gradient(circle at 70% 22%, rgba(255, 196, 92, 0.9) 0%, rgba(255, 196, 92, 0) 40%),' +
      'radial-gradient(circle at 25% 85%, rgba(200, 30, 60, 0.7) 0%, rgba(200, 30, 60, 0) 55%),' +
      'linear-gradient(160deg, #e0642a 0%, #8c1f3a 50%, #141a3a 100%)',
    glow: ['#ff5a3c', '#ffc65c'],
    glowRgb: '255, 140, 70',
  },
  {
    id: 'lofi',
    name: 'Lo-fi',
    blurb: 'Warm keys, soft beats and a dusty groove',
    cover:
      'radial-gradient(circle at 28% 24%, rgba(255, 222, 170, 0.85) 0%, rgba(255, 222, 170, 0) 42%),' +
      'radial-gradient(circle at 78% 78%, rgba(232, 143, 160, 0.7) 0%, rgba(232, 143, 160, 0) 52%),' +
      'linear-gradient(155deg, #3f7f7a 0%, #2a4d5e 50%, #1a1f33 100%)',
    glow: ['#6fd3b8', '#ffd59e'],
    glowRgb: '150, 215, 190',
  },
]

export function genreLook(id: DriveGenre): GenreLook {
  return GENRES.find((g) => g.id === id) ?? GENRES[0]
}
