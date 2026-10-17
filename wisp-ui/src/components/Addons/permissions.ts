import { PERMISSION_WORDS, type AddonManifest } from '@/api/addons'

/** "what's playing and the weather" */
export function permissionLine(a: AddonManifest): string {
  const words = (a.permissions ?? []).map((p) => PERMISSION_WORDS[p])
  const sites = a.network?.length ? [`talks to ${a.network.join(', ')}`] : []
  const all = [...(words.length ? [`knows ${joinAnd(words)}`] : []), ...sites]
  return all.length ? all.join('; ') : 'Asks for nothing'
}

function joinAnd(xs: string[]) {
  return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}
