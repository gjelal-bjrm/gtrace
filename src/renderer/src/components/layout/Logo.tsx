import type { JSX } from 'react'

/**
 * Icône GTrace « G-rewind » : arc ambre (retour en arrière) dont l'ouverture
 * accueille un double chevron ⏪ ivoire. Version vectorielle inline de
 * build/icon.svg (même géométrie, ids préfixés pour éviter les collisions).
 */
export function LogoIcon({ size = 24 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="gt-amber" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffd977" />
          <stop offset="0.5" stopColor="#f0a93e" />
          <stop offset="1" stopColor="#d07a1e" />
        </linearGradient>
        <linearGradient id="gt-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4252" />
          <stop offset="0.55" stopColor="#232935" />
          <stop offset="1" stopColor="#161a22" />
        </linearGradient>
        <linearGradient id="gt-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="gt-ivory" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c8cdd6" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="118" fill="url(#gt-dark)" />
      <rect width="512" height="266" rx="118" fill="url(#gt-sheen)" />
      <rect
        x="6"
        y="6"
        width="500"
        height="500"
        rx="112"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="8"
      />
      <path
        d="M 256 123 A 143 143 0 1 0 399 266"
        fill="none"
        stroke="url(#gt-amber)"
        strokeWidth="59"
        strokeLinecap="round"
      />
      <polygon points="307,215 307,317 225,266" fill="url(#gt-ivory)" />
      <polygon points="389,215 389,317 307,266" fill="url(#gt-ivory)" />
    </svg>
  )
}

/** Lockup « M2 » : l'icône fait office de « G », suivie de « Trace » + légende. */
export function Wordmark(): JSX.Element {
  return (
    <span className="wordmark">
      <LogoIcon size={26} />
      <span className="wordmark-name">Trace</span>
      <span className="wordmark-tagline">TIME-TRAVEL T-SQL</span>
    </span>
  )
}
