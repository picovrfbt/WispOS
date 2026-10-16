/** Drive Mode's mark: a steering wheel, in the current text colour */
export function SteeringIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path
        d="M3.5 10.5c3-1 5.8-1.5 8.5-1.5s5.5.5 8.5 1.5M10.5 13.5 7 20M13.5 13.5 17 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
