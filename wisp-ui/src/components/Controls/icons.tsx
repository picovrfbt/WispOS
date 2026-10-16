// svgs for our button icons
// filled icons

function PathIcon16({ size, paths }: { size: number; paths: string[] }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} fillRule="evenodd" clipRule="evenodd" d={d} />
      ))}
    </svg>
  )
}

const SHUFFLE_ARC =
  'm7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z'
const SHUFFLE_MAIN =
  'M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z'
const SMART_STARS =
  'M4.502 0a.637.637 0 0 1 .634.58 4.84 4.84 0 0 0 .81 2.184c.515.739 1.297 1.356 2.487 1.486a.637.637 0 0 1 0 1.267c-1.19.13-1.972.747-2.487 1.487a4.8 4.8 0 0 0-.81 2.185.637.637 0 0 1-1.268 0 4.8 4.8 0 0 0-.81-2.185C2.543 6.265 1.76 5.648.57 5.518a.637.637 0 0 1 0-1.268c1.19-.13 1.972-.747 2.487-1.486a4.84 4.84 0 0 0 .81-2.185A.637.637 0 0 1 4.502 0m4.765 11.878c.056.065.126.15.198.236l.33.397.013.015A3 3 0 0 0 12.1 13.59h1.009l-.444.443a.75.75 0 0 0 1.061 1.06l2.254-2.253-2.254-2.254a.75.75 0 0 0-1.06 1.06l.443.444H12.1a1.5 1.5 0 0 1-1.146-.533l-.004-.005-.333-.4-.288-.343-.031-.035-.02-.021-.037-.037-.974 1.16Z'

const REPEAT =
  'M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75z'
const REPEAT_ONE_LOOP =
  'M0 4.75A3.75 3.75 0 0 1 3.75 1h.75v1.5h-.75A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75zM12.25 2.5a2.25 2.25 0 0 1 2.25 2.25v5A2.25 2.25 0 0 1 12.25 12H9.81l1.018-1.018a.75.75 0 0 0-1.06-1.06L6.939 12.75l2.829 2.828a.75.75 0 1 0 1.06-1.06L9.811 13.5h2.439A3.75 3.75 0 0 0 16 9.75v-5A3.75 3.75 0 0 0 12.25 1h-.75v1.5z'
const REPEAT_ONE_DIGIT =
  'm8 1.85.77.694H6.095V1.488q1.046-.077 1.507-.385.474-.308.583-.913h1.32V8H8z'
const REPEAT_ONE_DIGIT_SERIF = 'M8.77 2.544 8 1.85v.693z'

// podcast seek buttons
const SEEK_BACK_ARC =
  'M2.464 4.5h1.473a.75.75 0 0 1 0 1.5H0V2.063a.75.75 0 0 1 1.5 0v1.27a8.25 8.25 0 1 1 10.539 12.554.75.75 0 0 1-.828-1.25A6.75 6.75 0 1 0 2.464 4.5'
const SEEK_BACK_15 =
  'M0 10.347V9.291q1.045-.077 1.507-.385.473-.308.583-.913h1.32v7.81H1.903v-5.456zm7.322 5.643q-.814 0-1.463-.297a2.46 2.46 0 0 1-1.023-.869q-.375-.583-.396-1.386h1.518q.01.363.176.638.165.274.45.43.287.153.66.153.385 0 .672-.176.297-.176.45-.495.165-.319.166-.726 0-.407-.165-.715a1.14 1.14 0 0 0-.451-.495 1.25 1.25 0 0 0-.671-.176q-.43 0-.748.21a1.23 1.23 0 0 0-.462.516H4.56L5 7.993h4.642V9.39H6.207l-.211 2.134q.086-.162.237-.319a1.8 1.8 0 0 1 .616-.407q.373-.154.814-.154.681 0 1.22.308.55.309.859.88.308.572.308 1.331 0 .792-.33 1.441-.33.639-.957 1.012-.616.375-1.441.374'
const SEEK_FWD_ARC =
  'M13.536 4.488h-1.473a.75.75 0 1 0 0 1.5H16V2.051a.75.75 0 0 0-1.5 0v1.27A8.25 8.25 0 1 0 3.962 15.876a.75.75 0 0 0 .826-1.252 6.75 6.75 0 1 1 8.747-10.136Z'
const SEEK_FWD_15 =
  'M11.81 15.681q.65.297 1.464.297.825 0 1.44-.374.628-.374.958-1.012.33-.649.33-1.44 0-.76-.308-1.332a2.16 2.16 0 0 0-.858-.88 2.4 2.4 0 0 0-1.221-.308q-.44 0-.814.154a1.8 1.8 0 0 0-.616.407q-.15.157-.237.319l.211-2.134h3.436V7.981h-4.642l-.44 4.61h1.474a1.24 1.24 0 0 1 .462-.518q.318-.21.748-.209.384 0 .67.176.298.177.452.495.165.309.165.715 0 .408-.165.726a1.14 1.14 0 0 1-.451.495 1.25 1.25 0 0 1-.671.176q-.375 0-.66-.154a1.16 1.16 0 0 1-.451-.429 1.3 1.3 0 0 1-.176-.638h-1.518q.021.804.396 1.386a2.46 2.46 0 0 0 1.023.87Zm-5.858-5.346V9.28q1.045-.077 1.507-.385.473-.308.583-.913h1.32v7.81H7.855v-5.456z'

export function SeekBack15Icon({ size = 18 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[SEEK_BACK_ARC, SEEK_BACK_15]} />
}

export function SeekForward15Icon({ size = 18 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[SEEK_FWD_ARC, SEEK_FWD_15]} />
}

export function PrevIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 5h2v14H6zM20 5l-12 7 12 7z" />
    </svg>
  )
}

export function NextIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16 5h2v14h-2zM4 5l12 7-12 7z" />
    </svg>
  )
}

export function ShuffleIcon({ size = 18 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[SHUFFLE_MAIN, SHUFFLE_ARC]} />
}

export function SmartShuffleIcon({ size = 18 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[SMART_STARS, SHUFFLE_ARC]} />
}

const DJ =
  'M7.813 14.497A6.5 6.5 0 0 1 1.5 8.016c.008-3.553 2.71-5.744 5.043-6.078.85-.121 1.288.037 1.564.246.312.238.553.639.822 1.276q.115.277.239.602c.451 1.167 1.05 2.717 2.505 3.81 1.01.76 1.46 1.529 1.592 2.209.13.679-.037 1.375-.468 2.03-.88 1.34-2.793 2.388-4.844 2.388zm-.037 1.5A8 8 0 1 0 0 8.032c0 4.34 3.464 7.87 7.776 7.965m6.666-7.124c-.358-.788-.979-1.532-1.868-2.2-1.082-.813-1.51-1.9-1.967-3.06a31 31 0 0 0-.296-.736 6.3 6.3 0 0 0-.605-1.151 6.53 6.53 0 0 1 4.39 4.01 6.5 6.5 0 0 1 .346 3.137'

export function DJIcon({ size = 18 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[DJ]} />
}

export function RepeatIcon({ size = 18 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[REPEAT]} />
}

export function RepeatOneIcon({ size = 18 }: { size?: number }) {
  return (
    <PathIcon16 size={size} paths={[REPEAT_ONE_LOOP, REPEAT_ONE_DIGIT, REPEAT_ONE_DIGIT_SERIF]} />
  )
}

export function PlayIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 4l14 8-14 8z" />
    </svg>
  )
}

export function PauseIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

export function QueueIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 5h13v2H3zm0 6h13v2H3zm0 6h8v2H3zm15-3.5V8l5 4.5-5 4.5z" />
    </svg>
  )
}

export function MoreIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

const SAVE_RING = 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8'
const SAVE_PLUS =
  'M11.75 8a.75.75 0 0 1-.75.75H8.75V11a.75.75 0 0 1-1.5 0V8.75H5a.75.75 0 0 1 0-1.5h2.25V5a.75.75 0 0 1 1.5 0v2.25H11a.75.75 0 0 1 .75.75'
const SAVE_FILLED =
  'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m11.748-1.97a.75.75 0 0 0-1.06-1.06l-4.47 4.47-1.405-1.406a.75.75 0 1 0-1.061 1.06l2.466 2.467 5.53-5.53z'

export function SaveOutlineIcon({ size = 24 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[SAVE_RING, SAVE_PLUS]} />
}

export function SaveFilledIcon({ size = 24 }: { size?: number }) {
  return <PathIcon16 size={size} paths={[SAVE_FILLED]} />
}

export function MusicIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {/* the stems and beam are a line; filled, they turned into a solid flag */}
      <path
        d="M9 17V5l11-2v12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="17" r="3" />
      <circle cx="17" cy="15" r="3" />
    </svg>
  )
}

// YouTube Music's like and SoundCloud's, in 24-unit paths
function PathIcon24({ size, d }: { size: number; d: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const THUMB_OUTLINE =
  'M9 21h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.58 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2zM9 9l4.34-4.34L12 10h9v2l-3 7H9V9zM1 9h4v12H1z'
const THUMB_FILLED =
  'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z'
const HEART_OUTLINE =
  'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z'
const HEART_FILLED =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'

export function ThumbOutlineIcon({ size = 24 }: { size?: number }) {
  return <PathIcon24 size={size} d={THUMB_OUTLINE} />
}

export function ThumbFilledIcon({ size = 24 }: { size?: number }) {
  return <PathIcon24 size={size} d={THUMB_FILLED} />
}

export function HeartOutlineIcon({ size = 24 }: { size?: number }) {
  return <PathIcon24 size={size} d={HEART_OUTLINE} />
}

export function HeartFilledIcon({ size = 24 }: { size?: number }) {
  return <PathIcon24 size={size} d={HEART_FILLED} />
}
