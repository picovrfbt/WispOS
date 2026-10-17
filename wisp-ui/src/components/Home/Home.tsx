import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  fetchContextTracks,
  fetchLibraryList,
  fetchRecents,
  isBrowsable,
  LIKED_SONGS_URI,
  playFromLibrary,
  PlayError,
  type LibraryItem,
  type PlayOptions,
} from '@/api/library'
import type { NotifyFn } from '@/notify/notifyContext'
import { ArrowIcon } from '@/components/Navigation'
import { useNav } from '@/hooks/navContext'
import { useConnectDevices } from '@/hooks/useConnectDevices'
import { useDragScroll } from '@/hooks/useDragScroll'
import { useSettled } from '@/hooks/useSettled'
import { wakeSpotify } from '@/api/nav'
import { ArtBackdrop } from '@/components/ArtBackdrop'
import { ArtGlow } from '@/components/ArtGlow'
import { DeviceChooser } from './DeviceChooser'
import { DJArt, LikedArt, ListStatus, SkeletonCards, TrackList } from './TrackList'
import { DJ_PLAYLIST_URI } from '@/hooks/useDJNarration'
import { useDial } from './useDial'
import { readHomeMemory, writeHomeMemory } from './homeMemory'
import { useLibraryLists, type ListSource, type ListState } from './useLibraryLists'
import {
  fetchServicePage,
  isServiceUri,
  playService,
  serviceBrowsable,
  serviceOf,
  type MusicService,
} from '@/api/services'
import { getSettings } from '@/settings'
import { ServiceIcon } from '@/components/ServiceIcon'
import styles from './Home.module.scss'
import { coverUrl, prefetchCovers } from '@/api/covers'
import { SteeringIcon } from '@/components/DriveMode/SteeringIcon'

// load the next page when the focused card gets this close to the end
const PREFETCH_CARDS = 5
// card width + gap, kept in step with .card in Home.module.scss
const CARD_STRIDE = 276
// rail row height, kept in step with .railItem
const RAIL_STRIDE = 96
// how long the dial rests on a card before its artwork is baked for the background
const SETTLE_MS = 220
// cards built past the focused one: three fit on screen, the rest only cost a
// rail step (Chrome 69 lays out and layers every one of a 50-card page)
const CARDS_AHEAD = 4

export interface NowPlayingCard {
  title: string
  artist: string
  image?: string
}

// Spotify's tabs, the source switch, and a service's sections ('svc-<section>')
type CategoryId = string

interface Category {
  id: CategoryId
  label: string
  icon: ReactNode
  source?: ListSource
}

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor" aria-hidden>
    <path d={d} />
  </svg>
)

const CATEGORIES: Category[] = [
  {
    id: 'now',
    label: 'Now Playing',
    icon: svg(
      'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-2 4.3 6 3.7-6 3.7z',
    ),
  },
  {
    id: 'nav',
    label: 'Navigation',
    icon: svg('M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z'),
  },
  {
    id: 'recents',
    label: 'Recents',
    icon: svg(
      'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v4.6l3.2 1.9-1 1.7L11 12.7V7z',
    ),
    source: { key: 'recents', fetch: (o, l) => fetchRecents(o, l) },
  },
  {
    id: 'library',
    label: 'Library',
    icon: svg(
      'M4 3h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v4h4V5zm9-2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v4h4V5zM4 13h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zm1 2v4h4v-4zm9-2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zm1 2v4h4v-4z',
    ),
    source: { key: 'playlists', fetch: (o, l) => fetchLibraryList('playlists', o, l) },
  },
  {
    id: 'albums',
    label: 'Albums',
    icon: svg(
      'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    ),
    source: { key: 'albums', fetch: (o, l) => fetchLibraryList('albums', o, l) },
  },
  {
    id: 'artists',
    label: 'Artists',
    icon: svg(
      'M12 2a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v5a2 2 0 1 0 4 0V6a2 2 0 0 0-2-2zM5 11h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-3.1A7 7 0 0 1 5 11z',
    ),
    source: { key: 'artists', fetch: (o, l) => fetchLibraryList('artists', o, l) },
  },
  {
    // a doorway, like Settings: Drive Mode opens over everything
    id: 'drive',
    label: 'Drive Mode',
    icon: <SteeringIcon size={34} />,
  },
  {
    // a doorway, like Drive Mode: the community's add-ons
    id: 'addons',
    label: 'Add-ons',
    icon: svg(
      'M10.5 2a2.5 2.5 0 0 1 2.5 2.5V5h4a1 1 0 0 1 1 1v4h.5a2.5 2.5 0 1 1 0 5H18v4a1 1 0 0 1-1 1h-4v-.5a2.5 2.5 0 1 0-5 0v.5H4a1 1 0 0 1-1-1v-4h.5a2.5 2.5 0 1 0 0-5H3V6a1 1 0 0 1 1-1h4v-.5A2.5 2.5 0 0 1 10.5 2z',
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: svg(
      'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    ),
  },
]

// the switch at the top of the rail, when another music service is signed in
const SOURCE_SWITCH: Category = { id: 'source', label: 'Source', icon: null }

const SECTION_ICONS: Record<string, ReactNode> = {
  liked: svg(
    'M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6z',
  ),
  playlists: svg('M3 5h13v2H3zm0 6h13v2H3zm0 6h8v2H3zm15-3.5V8l5 4.5-5 4.5z'),
  history: svg(
    'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v5.4l3.5 2.1-1 1.7L11 13.5V7z',
  ),
  albums: svg('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'),
  artists: svg(
    'M12 2a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zM5 11h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.9V21h-2v-3.1A7 7 0 0 1 5 11z',
  ),
}

// other services' names for the same kinds of row
const SECTION_ALIASES: Record<string, string> = { likes: 'liked', following: 'artists' }

/** Home's rail for a source: Spotify's tabs, or a service's library sections */
function categoriesFor(service: MusicService | null, switchable: boolean): Category[] {
  const head = switchable ? [SOURCE_SWITCH] : []
  if (!service) return [...head, ...CATEGORIES]
  const now = CATEGORIES.find((c) => c.id === 'now')!
  const drive = CATEGORIES.find((c) => c.id === 'drive')!
  const addons = CATEGORIES.find((c) => c.id === 'addons')!
  const settings = CATEGORIES.find((c) => c.id === 'settings')!
  const sections = (service.sections ?? []).map<Category>((sec) => ({
    id: `svc-${sec.id}`,
    label: sec.name,
    icon: SECTION_ICONS[SECTION_ALIASES[sec.id] ?? sec.id] ?? SECTION_ICONS.playlists,
    source: {
      key: `svc:${service.id}:${sec.id}`,
      // one page: the phone sends the whole section at once
      fetch: (offset) =>
        offset > 0
          ? Promise.resolve({ items: [], total: 0 })
          : fetchServicePage(service.id, sec.id),
    },
  }))
  return [...head, now, ...sections, drive, addons, settings]
}

const LIKED_ITEM: LibraryItem = {
  name: 'Liked Songs',
  artist: 'Your saved tracks',
  uri: LIKED_SONGS_URI,
}

// Spotify's AI DJ, pinned beside Liked Songs; a press starts it
const DJ_ITEM: LibraryItem = {
  name: 'DJ',
  artist: 'Picks and talks you through',
  uri: DJ_PLAYLIST_URI,
}

const tracksSource = (uri: string): ListSource => ({
  key: `tracks:${uri}`,
  fetch: (o, l) => fetchContextTracks(uri, o, l),
})

interface Props {
  nowPlaying: NowPlayingCard | null
  onClose: () => void
  /** closes home and opens the map */
  onOpenNav: () => void
  /** opens the Settings page over Home; back from it returns here */
  onOpenSettings?: () => void
  /** opens Drive Mode (its warning first) */
  onOpenDrive?: () => void
  onOpenAddons?: () => void
  /** something (Settings) is open on top: the dial and back are its, not Home's */
  covered?: boolean
  notify: NotifyFn
}

// the one card under Navigation
const NAV_URI = 'nav'

/**
 * The Car Thing home: a category rail on the left, a row of cover cards on the
 * right, and the focused cover blurred behind it all. The dial moves through the
 * rail, a press steps into the cards, and back steps out again; back from the
 * rail returns to Now Playing.
 */
export function Home({
  nowPlaying,
  onClose,
  onOpenNav,
  onOpenSettings,
  onOpenDrive,
  onOpenAddons,
  covered = false,
  notify,
}: Props) {
  const lists = useLibraryLists()
  const nav = useNav()
  // the music services signed in on the phone, beside Spotify
  const services = useMemo(
    // switched on in the companion app shows here; signing in there fills the library
    () => (nav.services ?? []).filter((s) => s.enabled),
    [nav.services],
  )
  // which library Home shows: where it was left, else Settings → Home opens on
  const [sourcePick, setSourcePick] = useState<string>(
    () => readHomeMemory().source ?? getSettings().homeSource,
  )
  const service = services.find((s) => s.id === sourcePick) ?? null
  const source = service ? service.id : 'spotify'
  const categories = useMemo(
    () => categoriesFor(service, services.length > 0),
    [service, services.length],
  )
  // picks up where it was left, across a rebuild as much as a reopen
  const [catIndex, setCatIndex] = useState(() => readHomeMemory().catIndex)
  const [focus, setFocus] = useState<'rail' | 'cards'>(() => readHomeMemory().focus)
  // the card each category was left on, so stepping back in lands where you were
  const [cardIndexes, setCardIndexes] = useState<Partial<Record<CategoryId, number>>>(
    () => readHomeMemory().cardIndexes,
  )
  const [opened, setOpened] = useState<LibraryItem | null>(() => readHomeMemory().opened)
  useEffect(() => {
    writeHomeMemory({ catIndex, focus, cardIndexes, opened, source })
  }, [catIndex, focus, cardIndexes, opened, source])
  const railRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  const category = categories[Math.min(catIndex, categories.length - 1)]
  const cardIndex = cardIndexes[category.id] ?? 0
  const list: ListState | null = category.source ? lists.get(category.source.key) : null

  const cards: LibraryItem[] = useMemo(() => {
    if (category.id === 'now') {
      return nowPlaying
        ? [
            {
              name: nowPlaying.title,
              artist: nowPlaying.artist,
              uri: 'now',
              image: nowPlaying.image,
            },
          ]
        : []
    }
    if (category.id === 'nav') {
      return [
        nav.active
          ? {
              name: nav.title || 'Navigating',
              artist: nav.text ?? '',
              uri: NAV_URI,
              image: nav.icon,
            }
          : {
              name: 'Map',
              artist: nav.connected ? 'Not navigating' : 'Phone not connected',
              uri: NAV_URI,
            },
      ]
    }
    const items = list?.items ?? []
    // liked songs isn't a libraryV3 playlist entry on every account; pin it first
    if (category.id === 'library')
      return [
        LIKED_ITEM,
        DJ_ITEM,
        ...items.filter((i) => i.uri !== LIKED_SONGS_URI && i.uri !== DJ_PLAYLIST_URI),
      ]
    return items
  }, [category.id, list, nowPlaying, nav])

  // the first page of whatever the rail lands on; the next one's too, so it's ready
  useEffect(() => {
    const here = categories[Math.min(catIndex, categories.length - 1)].source
    const next = categories[catIndex + 1]?.source
    if (here) lists.ensure(here)
    if (next) lists.ensure(next)
    // and again when the source flips: the rail under the cursor is new
  }, [catIndex, categories, lists])

  const setCardIndex = useCallback(
    (i: number) => setCardIndexes((m) => ({ ...m, [category.id]: i })),
    [category.id],
  )

  // drag the cards sideways and the rail up and down; the cards settle on the
  // nearest one and the dial carries on from there
  useDragScroll(cardsRef, {
    axis: 'x',
    enabled: opened === null,
    onRelease: (rest) => {
      const i = Math.max(0, Math.min(cards.length - 1, Math.round(rest / CARD_STRIDE)))
      if (cardsRef.current) cardsRef.current.scrollLeft = i * CARD_STRIDE
      setCardIndex(i)
      setFocus('cards')
    },
  })
  useDragScroll(railRef, { axis: 'y', enabled: opened === null })

  // keep the rail cursor and the focused card in view, and page ahead of the cards
  useEffect(() => {
    if (railRef.current) railRef.current.scrollTop = Math.max(0, (catIndex - 1) * RAIL_STRIDE)
  }, [catIndex])
  useEffect(() => {
    if (cardsRef.current) cardsRef.current.scrollLeft = cardIndex * CARD_STRIDE
    if (category.source && cardIndex >= cards.length - PREFETCH_CARDS)
      lists.loadMore(category.source)
  }, [cardIndex, cards.length, category.source, lists])

  // the cards just past the screen, into the cover cache before the dial gets there
  const aheadKey = cards
    .slice(cardIndex + CARDS_AHEAD + 1, cardIndex + CARDS_AHEAD + 8)
    .map((c) => c.image ?? '')
    .join('|')
  useEffect(() => {
    if (aheadKey.replace(/\|/g, '')) prefetchCovers(aheadKey.split('|'), 300)
  }, [aheadKey])

  // a play that found no device to go to, waiting on the device chooser
  const [pending, setPending] = useState<{ uri: string; label: string; opts: PlayOptions } | null>(
    null,
  )
  const devices = useConnectDevices()
  const [waking, setWaking] = useState<boolean | null>(null)

  const play = useCallback(
    (contextUri: string, label: string, opts: PlayOptions = {}) => {
      playFromLibrary(contextUri, opts)
        .then(() => {
          notify(`Playing ${label}`, { icon: 'playlist' })
          onClose()
        })
        .catch((e: unknown) => {
          // nothing active and no remembered device: ask where to play
          if (e instanceof PlayError && e.status === 404 && !opts.deviceId) {
            setPending({ uri: contextUri, label, opts })
            // the phone is likely asleep in Spotify's eyes; the list fills in as it wakes
            setWaking(null)
            void wakeSpotify().then(setWaking)
          } else {
            notify(`Couldn't play ${label}`, { variant: 'error' })
          }
        })
    },
    [notify, onClose],
  )

  const playFromService = (item: LibraryItem, startAt?: LibraryItem) => {
    const svc = serviceOf(item.uri)
    if (!svc) return
    const from = startAt ? serviceOf(startAt.uri)?.item : undefined
    void playService(svc.service, svc.item, from).then((ok) => {
      if (ok) {
        notify(`Playing ${startAt?.name ?? item.name}`, { icon: 'playlist' })
        onClose()
      } else notify(`Couldn't play ${item.name}`, { variant: 'error' })
    })
  }

  const activateCard = (item: LibraryItem) => {
    if (category.id === 'now') onClose()
    else if (category.id === 'nav') onOpenNav()
    else if (isServiceUri(item.uri)) {
      if (serviceBrowsable(item.uri)) setOpened(item)
      else playFromService(item)
    } else if (isBrowsable(item.uri)) setOpened(item)
    else play(item.uri, item.name)
  }

  const flipSource = () => {
    // round the libraries: Spotify, then each signed-in service
    const order = ['spotify', ...services.map((s) => s.id)]
    const next = order[(order.indexOf(source) + 1) % order.length] ?? 'spotify'
    setSourcePick(next)
  }
  // one press handler for every card that never changes, so the memoised cards
  // stay put while the dial moves; it always runs the latest render's version
  const pressLatest = useRef((i: number) => activateCard(cards[i]))
  useLayoutEffect(() => {
    pressLatest.current = (i: number) => {
      setCardIndex(i)
      setFocus('cards')
      activateCard(cards[i])
    }
  })
  const pressCard = useCallback((i: number) => pressLatest.current(i), [])

  const pressRail = () => {
    if (category.id === 'source') flipSource()
    else if (category.id === 'now') onClose()
    else if (category.id === 'nav') onOpenNav()
    else if (category.id === 'settings') onOpenSettings?.()
    else if (category.id === 'drive') onOpenDrive?.()
    else if (category.id === 'addons') onOpenAddons?.()
    else if (cards.length > 0) setFocus('cards')
  }

  // a row with no cards (Settings, Drive Mode, nothing playing) is worked from the
  // rail whatever the focus was left as: a remembered "in the cards" from another
  // row, or the rail shifting under it, left the knob turning and pressing nothing
  const onRail = focus === 'rail' || cards.length === 0
  useEffect(() => {
    if (focus === 'cards' && !category.source && cards.length === 0) setFocus('rail')
  }, [focus, category.source, cards.length])

  useDial({
    enabled: opened === null && pending === null && !covered,
    onStep: (dir) => {
      if (onRail) {
        // from where the rail shows, which a shorter rail may have pulled in
        setCatIndex((i) =>
          Math.max(0, Math.min(categories.length - 1, Math.min(i, categories.length - 1) + dir)),
        )
      } else {
        setCardIndex(Math.max(0, Math.min(cards.length - 1, cardIndex + dir)))
      }
    },
    onPress: () => {
      if (onRail) pressRail()
      else if (cards[cardIndex]) activateCard(cards[cardIndex])
    },
    onBack: () => {
      if (focus === 'cards') setFocus('rail')
      else onClose()
    },
  })

  const openedSource = opened
    ? isServiceUri(opened.uri)
      ? serviceTracksSource(opened.uri)
      : tracksSource(opened.uri)
    : null
  useEffect(() => {
    if (openedSource) lists.ensure(openedSource)
    // keyed on the uri: a fresh source object every render is the same list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.uri, lists])

  const backdropArt = opened
    ? (opened.image ?? lists.get(`tracks:${opened.uri}`).items[0]?.image)
    : category.id === 'nav'
      ? nowPlaying?.image
      : (cards[cardIndex]?.image ?? cards.find((c) => c.image)?.image ?? nowPlaying?.image)

  // the backdrop and the card glow follow the card you stop on, not every card
  // the dial passes: each new cover means a bake the Car Thing would waste
  const settledBackdrop = useSettled(backdropArt, SETTLE_MS)
  const glowIndex = useSettled(cardIndex, SETTLE_MS)

  // load ahead what a press would open: the playlist the dial stopped on, and
  // Liked Songs from the start, so opening one shows tracks rather than Loading
  const settledUri = cards[glowIndex]?.uri
  useEffect(() => {
    if (opened === null && settledUri && isBrowsable(settledUri))
      lists.ensure(tracksSource(settledUri))
  }, [settledUri, opened, lists])
  useEffect(() => {
    lists.ensure(tracksSource(LIKED_SONGS_URI))
  }, [lists])

  return (
    <div
      className={`${styles.root} ${source === 'spotify' ? '' : styles.otherSource} ${
        source === 'soundcloud' ? styles.soundcloudSource : ''
      }`}
      role="dialog"
      aria-label="Home"
    >
      <ArtBackdrop src={settledBackdrop} className={styles.backdropLayer} />

      {opened && openedSource ? (
        <TrackList
          context={opened}
          list={lists.get(openedSource.key)}
          onPlay={({ skipTo, shuffle }) =>
            isServiceUri(opened.uri)
              ? playFromService(opened, skipTo)
              : play(opened.uri, skipTo ? skipTo.name : opened.name, {
                  skipToUri: skipTo?.uri,
                  shuffle,
                })
          }
          onLoadMore={() => lists.loadMore(openedSource)}
          onRetry={() => lists.retry(openedSource)}
          onBack={() => setOpened(null)}
          dialEnabled={pending === null}
        />
      ) : (
        <div className={styles.layout}>
          <nav className={styles.rail} ref={railRef} aria-label="Categories">
            <div className={styles.railTrack}>
              {categories.map((c, i) => {
                const current = i === Math.min(catIndex, categories.length - 1)
                if (c.id === 'source') {
                  return (
                    <SourceSwitch
                      key="source"
                      current={current}
                      focused={current && focus === 'rail'}
                      source={source}
                      services={services}
                      onPick={(id) => {
                        setSourcePick(id)
                        setCatIndex(i)
                        setFocus('rail')
                      }}
                    />
                  )
                }
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.railItem} ${current ? styles.railCurrent : ''} ${
                      current && focus === 'rail' ? styles.railFocused : ''
                    }`}
                    aria-current={current}
                    onClick={() => {
                      if (current) pressRail()
                      setCatIndex(i)
                      setFocus('rail')
                    }}
                  >
                    <span className={styles.railTile}>{c.icon}</span>
                    <span className={styles.railLabel}>{c.label}</span>
                  </button>
                )
              })}
            </div>
          </nav>

          {category.id === 'source' ? (
            <div className={styles.cardsEmpty}>
              {source === 'spotify'
                ? `Press to switch to ${services[0]?.name ?? 'your other music'}`
                : `Press to switch to ${
                    services[services.findIndex((s) => s.id === source) + 1]?.name ?? 'Spotify'
                  }`}
            </div>
          ) : category.id === 'drive' ? (
            <button type="button" className={styles.settingsDoor} onClick={() => onOpenDrive?.()}>
              <span className={styles.settingsDoorIcon} aria-hidden>
                <SteeringIcon size={34} />
              </span>
              <span className={styles.settingsDoorTitle}>Drive Mode</span>
              <span className={styles.settingsDoorHint}>Beta · Press to start</span>
            </button>
          ) : category.id === 'addons' ? (
            <button type="button" className={styles.settingsDoor} onClick={() => onOpenAddons?.()}>
              <span className={styles.settingsDoorIcon} aria-hidden>
                {CATEGORIES.find((c) => c.id === 'addons')?.icon}
              </span>
              <span className={styles.settingsDoorTitle}>Add-ons</span>
              <span className={styles.settingsDoorHint}>From the community · Press to open</span>
            </button>
          ) : category.id === 'settings' ? (
            // a doorway: Settings is a page of its own
            <button
              type="button"
              className={styles.settingsDoor}
              onClick={() => onOpenSettings?.()}
            >
              <span className={styles.settingsDoorIcon} aria-hidden>
                {CATEGORIES.find((c) => c.id === 'settings')?.icon}
              </span>
              <span className={styles.settingsDoorTitle}>Settings</span>
              <span className={styles.settingsDoorHint}>Press to open</span>
            </button>
          ) : (
            <div className={styles.cards} ref={cardsRef}>
              <div className={styles.track}>
                {cards.slice(0, cardIndex + CARDS_AHEAD + 1).map((item, i) => (
                  // memoised: a dial notch re-renders the two cards it moves between, not the row
                  <Card
                    key={`${item.uri}:${i}`}
                    item={item}
                    index={i}
                    focused={focus === 'cards' && i === cardIndex}
                    glow={
                      i === cardIndex && i === glowIndex && item.uri !== NAV_URI
                        ? focus === 'cards'
                          ? 1
                          : 0.55
                        : 0
                    }
                    onPress={pressCard}
                  />
                ))}
                {category.id === 'now' && !nowPlaying ? (
                  <div className={styles.cardsEmpty}>Nothing playing</div>
                ) : null}
                {list && category.source ? (
                  list.total === null && !list.error ? (
                    <SkeletonCards />
                  ) : (
                    <div className={styles.cardsEmpty}>
                      <ListStatus list={list} onRetry={() => lists.retry(category.source!)} />
                    </div>
                  )
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
      {pending ? (
        <DeviceChooser
          label={pending.label}
          devices={devices}
          waking={waking}
          onCancel={() => setPending(null)}
          onPick={(d) => {
            setPending(null)
            play(pending.uri, pending.label, { ...pending.opts, deviceId: d.id })
          }}
        />
      ) : null}
    </div>
  )
}

interface CardProps {
  item: LibraryItem
  index: number
  focused: boolean
  /** the glow behind the cover's strength; 0 for none */
  glow: number
  onPress: (index: number) => void
}

const Card = memo(function Card({ item, index, focused, glow, onPress }: CardProps) {
  const round = item.uri.startsWith('spotify:artist:')
  return (
    <button
      type="button"
      className={`${styles.card} ${focused ? styles.cardFocused : ''}`}
      onClick={() => onPress(index)}
    >
      <span className={`${styles.cardArtWrap} ${round ? styles.roundWrap : ''}`}>
        {/* the selected card glows; softer while the rail has the dial */}
        {glow > 0 ? <ArtGlow src={item.image} spread={122} strength={glow} /> : null}
        <span className={`${styles.cardArt} ${round ? styles.round : ''}`}>
          {item.uri === NAV_URI ? (
            <span className={styles.navArt}>
              {item.image ? <img src={item.image} alt="" /> : <ArrowIcon />}
            </span>
          ) : item.uri === LIKED_SONGS_URI ? (
            <LikedArt />
          ) : item.uri === DJ_PLAYLIST_URI ? (
            <DJArt />
          ) : item.image ? (
            <img src={coverUrl(item.image, 300)} alt="" loading="lazy" />
          ) : null}
        </span>
      </span>
      <span className={styles.cardTitle}>{item.name}</span>
      {item.artist ? <span className={styles.cardSub}>{item.artist}</span> : null}
    </button>
  )
})

// a service's own page (a playlist, album or artist) as a list
function serviceTracksSource(uri: string): ListSource {
  const svc = serviceOf(uri)
  return {
    key: `svc-tracks:${uri}`,
    fetch: (offset) =>
      offset > 0 || !svc?.item.id
        ? Promise.resolve({ items: [], total: 0 })
        : fetchServicePage(svc.service, svc.item.id),
  }
}

// the top of the rail: Spotify or another library, picked by tap or by press.
// With three, the ones not picked shrink to their dot so all fit the rail
function SourceSwitch({
  current,
  focused,
  source,
  services,
  onPick,
}: {
  current: boolean
  focused: boolean
  source: string
  services: MusicService[]
  onPick: (id: string) => void
}) {
  if (services.length === 0) return null
  const options = [
    { id: 'spotify', name: 'Spotify' },
    ...services.map((s) => ({
      id: s.id,
      name: s.name === 'YouTube Music' ? 'YT Music' : s.name,
    })),
  ]
  const picked = options.find((o) => o.id === source) ?? options[0]
  return (
    <div className={styles.sourceSwitch}>
      {/* the pill wraps just the marks; the name sits outside it */}
      <div
        className={`${styles.sourceGroup} ${focused ? styles.sourceFocused : ''}`}
        role="radiogroup"
        aria-label="Music source"
        aria-current={current}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={source === o.id}
            aria-label={o.name}
            className={`${styles.sourceOption} ${source === o.id ? styles.sourceOn : ''}`}
            onClick={() => onPick(o.id)}
          >
            <ServiceIcon service={o.id} size={28} />
          </button>
        ))}
      </div>
      {/* which one is picked, in words, while the switch has the focus */}
      <span className={`${styles.sourceBubble} ${focused ? styles.bubbleShown : ''}`} aria-hidden>
        {picked.name}
      </span>
    </div>
  )
}
