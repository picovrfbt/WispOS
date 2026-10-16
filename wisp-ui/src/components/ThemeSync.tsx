import { useEffect } from 'react'
import { useColorExtract } from '@/hooks/useColorExtract'
import { useSettings } from '@/settings'
import { ACCENTS, applyAccent, readableAccent } from '@/theme'

/** keeps the accent colour in step with Settings → Accent colour (and the cover, for "album") */
export function ThemeSync({ art }: { art: string | undefined }) {
  const { accentTheme } = useSettings()
  // only sampled when it's wanted: it loads the cover a second time
  const sampled = useColorExtract(accentTheme === 'album' ? art : undefined)
  const r = sampled[0]
  const g = sampled[1]
  const b = sampled[2]
  useEffect(() => {
    applyAccent(
      accentTheme === 'album'
        ? art
          ? readableAccent([r, g, b])
          : ACCENTS.green
        : ACCENTS[accentTheme],
    )
  }, [accentTheme, art, r, g, b])
  return null
}
