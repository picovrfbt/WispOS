/*
 * Knob scrolling for lists. The lists scroll smoothly (scroll-behavior:
 * smooth), so mid-glide their scrollTop is somewhere on the way; a fast spin
 * that counted from there would lose ground every notch. These count from
 * where the list is headed instead, as long as it's still on its way.
 */

// a glide is about this long in Chrome; after it the list is where it was sent
const GLIDE_MS = 450

const heading = new WeakMap<HTMLElement, { top: number; at: number }>()

function headedTo(el: HTMLElement): number {
  const h = heading.get(el)
  return h && Date.now() - h.at < GLIDE_MS ? h.top : el.scrollTop
}

function glideTo(el: HTMLElement, top: number): void {
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const to = Math.round(Math.max(0, Math.min(max, top)))
  heading.set(el, { top: to, at: Date.now() })
  el.scrollTop = to
}

/** scrolls [el] by [dy], on from where it's headed */
export function glideBy(el: HTMLElement, dy: number): void {
  glideTo(el, headedTo(el) + dy)
}

/** scrolls [el] just enough that [row] is in view, with [pad] to spare */
export function glideIntoView(el: HTMLElement, row: HTMLElement, pad = 0): void {
  const top = headedTo(el)
  // the row's place in the list's content (layout px, scroll left out)
  const rowTop = pageOffset(row).top - pageOffset(el).top - el.clientTop
  const rowBottom = rowTop + row.offsetHeight
  if (rowTop - pad < top) glideTo(el, rowTop - pad)
  else if (rowBottom + pad > top + el.clientHeight) glideTo(el, rowBottom + pad - el.clientHeight)
}

/**
 * Where [el] sits in the page in layout px, scrolling left out. Unlike
 * getBoundingClientRect it reads the same under the display-size zoom on
 * Chrome 69 and on a current Chrome.
 */
export function pageOffset(el: HTMLElement): { top: number; left: number } {
  let top = 0
  let left = 0
  for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) {
    top += e.offsetTop
    left += e.offsetLeft
  }
  return { top, left }
}
