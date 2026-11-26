import { useId } from 'react';

/*
 * The landing page's illustrations as SVG (no images to download): a graduation cap, a stack of books,
 * the school building and the EduTrack mark. Gradients and highlights give them depth; the page's CSS
 * floats and lights them. All are decorative (aria-hidden).
 */

/** The EduTrack mark: a gold mortarboard. */
export function EduTrackMark({ className }) {
  const id = useId();
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd86f" />
          <stop offset="1" stopColor="#e8a11b" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9a420" />
          <stop offset="1" stopColor="#b97609" />
        </linearGradient>
      </defs>
      <path d="M24 7 2 17.5 24 28l22-10.5Z" fill={`url(#${id}t)`} />
      <path d="M11 22.5v9.2c0 3.6 5.8 6.8 13 6.8s13-3.2 13-6.8v-9.2L24 29Z" fill={`url(#${id}b)`} />
      <path d="M41 19.5v10.5" stroke="#ffd86f" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="41" cy="32" r="2.6" fill="#ffd86f" />
    </svg>
  );
}

/** A navy mortarboard with a gold band and tassel, seen from slightly above. */
export function GraduationCap() {
  const id = useId();
  return (
    <svg viewBox="0 0 320 230" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a5a8f" />
          <stop offset="0.45" stopColor="#1a2f55" />
          <stop offset="1" stopColor="#0b1a33" />
        </linearGradient>
        <linearGradient id={`${id}skull`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#142a4d" />
          <stop offset="1" stopColor="#060f1f" />
        </linearGradient>
        <linearGradient id={`${id}gold`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b8780c" />
          <stop offset="0.5" stopColor="#ffd36b" />
          <stop offset="1" stopColor="#c58410" />
        </linearGradient>
        <radialGradient id={`${id}shine`} cx="0.35" cy="0.3" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* skull cap */}
      <path d="M78 104 C78 150 120 172 168 172 C216 172 252 150 252 106 L168 140 Z" fill={`url(#${id}skull)`} />
      {/* gold band */}
      <path d="M80 112 C92 150 128 166 168 166 C210 166 242 150 250 114 L250 124 C240 160 210 178 168 178 C124 178 90 160 80 124 Z" fill={`url(#${id}gold)`} />
      {/* board */}
      <path d="M160 22 L312 82 L172 146 L8 86 Z" fill={`url(#${id}top)`} />
      <path d="M160 22 L312 82 L172 146 L8 86 Z" fill={`url(#${id}shine)`} />
      <path d="M8 86 L172 146 L172 156 L8 95 Z" fill="#0a1830" />
      <path d="M172 146 L312 82 L312 91 L172 156 Z" fill="#132a4e" />
      {/* button and cord */}
      <ellipse cx="162" cy="84" rx="10" ry="6" fill={`url(#${id}gold)`} />
      <path d="M162 84 C120 96 70 108 52 120 L50 170" stroke={`url(#${id}gold)`} strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* tassel */}
      <path d="M50 166 l-12 50 h26 Z" fill={`url(#${id}gold)`} />
      <rect x="43" y="160" width="14" height="12" rx="3" fill="#e9a420" />
      <path d="M41 182 l-4 30 M47 182 l-2 32 M53 182 l1 32 M59 182 l3 30" stroke="#8a5a08" strokeWidth="1.2" opacity="0.6" />
    </svg>
  );
}

/** A stack of three books: blue covers, cream pages, gold spines. */
export function BookStack({ variant = 'hero' }) {
  const id = useId();
  const books =
    variant === 'hero'
      ? [
          { y: 118, w: 230, x: 6, cover: 'gold' },
          { y: 72, w: 220, x: 18, cover: 'blue' },
          { y: 28, w: 206, x: 26, cover: 'blue' },
        ]
      : [
          { y: 118, w: 280, x: 4, cover: 'blue' },
          { y: 74, w: 262, x: 16, cover: 'gold' },
        ];
  return (
    <svg viewBox="0 0 300 170" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}blue`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d78d8" />
          <stop offset="1" stopColor="#173e86" />
        </linearGradient>
        <linearGradient id={`${id}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd36b" />
          <stop offset="1" stopColor="#c8860f" />
        </linearGradient>
        <linearGradient id={`${id}pages`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff8e6" />
          <stop offset="1" stopColor="#e2d3b0" />
        </linearGradient>
      </defs>
      {books.map((b) => (
        <g key={b.y}>
          <rect x={b.x} y={b.y} width={b.w} height="42" rx="7" fill={`url(#${id}${b.cover})`} />
          <rect x={b.x + 14} y={b.y + 8} width={b.w - 22} height="26" rx="3" fill={`url(#${id}pages)`} />
          <path d={`M${b.x + 14} ${b.y + 15} h${b.w - 22} M${b.x + 14} ${b.y + 21} h${b.w - 22} M${b.x + 14} ${b.y + 27} h${b.w - 22}`} stroke="#cdbb91" strokeWidth="1" />
          <rect x={b.x} y={b.y} width="16" height="42" rx="6" fill={b.cover === 'gold' ? '#b8780c' : '#122f66'} />
          <rect x={b.x + 4} y={b.y + 6} width="2" height="30" rx="1" fill={b.cover === 'gold' ? '#ffe39a' : '#f5b82e'} />
          <rect x={b.x} y={b.y} width={b.w} height="6" rx="3" fill="#ffffff" opacity="0.18" />
        </g>
      ))}
    </svg>
  );
}

/** The school: a white building with columns, a blue roof, a gold flag and trees. */
export function SchoolBuilding() {
  const id = useId();
  return (
    <svg viewBox="0 0 320 250" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}wall`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbf3e2" />
          <stop offset="1" stopColor="#d9c8a6" />
        </linearGradient>
        <linearGradient id={`${id}roof`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4d82d6" />
          <stop offset="1" stopColor="#1f4b97" />
        </linearGradient>
        <linearGradient id={`${id}win`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#f0a92a" />
        </linearGradient>
        <radialGradient id={`${id}tree`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#6fcf5a" />
          <stop offset="1" stopColor="#1f7a33" />
        </radialGradient>
      </defs>
      {/* ground */}
      <ellipse cx="170" cy="232" rx="150" ry="14" fill="#0a1f3d" opacity="0.8" />
      {/* side wings */}
      <rect x="20" y="118" width="80" height="104" fill={`url(#${id}wall)`} />
      <rect x="240" y="118" width="74" height="104" fill={`url(#${id}wall)`} />
      <path d="M12 120 L104 102 L104 120 Z" fill={`url(#${id}roof)`} />
      <path d="M236 102 L322 120 L236 120 Z" fill={`url(#${id}roof)`} />
      {[30, 62].map((x) => [134, 176].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="24" height="28" rx="2" fill={`url(#${id}win)`} />))}
      {[250, 282].map((x) => [134, 176].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="22" height="28" rx="2" fill={`url(#${id}win)`} />))}
      {/* main block */}
      <rect x="94" y="96" width="150" height="126" fill={`url(#${id}wall)`} />
      {/* pediment */}
      <path d="M82 100 L169 48 L256 100 Z" fill={`url(#${id}wall)`} stroke="#c9b48a" strokeWidth="2" />
      <path d="M76 102 L169 42 L262 102 L256 106 L169 50 L82 106 Z" fill={`url(#${id}roof)`} />
      <circle cx="169" cy="80" r="11" fill="#f5b82e" stroke="#b8780c" strokeWidth="2" />
      <path d="M169 72 v8 l5 4" stroke="#7a4f00" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* name */}
      <rect x="112" y="102" width="114" height="22" rx="3" fill="#f3e6c8" stroke="#c9b48a" />
      <text x="169" y="118" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="800" fontSize="15" letterSpacing="2" fill="#1f3b6e">
        SCHOOL
      </text>
      {/* columns */}
      {[104, 128, 200, 224].map((x) => (
        <rect key={x} x={x} y="128" width="11" height="90" fill="#fffaf0" stroke="#d6c39c" />
      ))}
      {/* door */}
      <rect x="150" y="150" width="38" height="70" rx="3" fill="#7a4a1d" />
      <rect x="153" y="154" width="15" height="62" fill={`url(#${id}win)`} opacity="0.9" />
      <rect x="170" y="154" width="15" height="62" fill={`url(#${id}win)`} opacity="0.9" />
      {/* steps */}
      <rect x="128" y="218" width="82" height="6" fill="#e9dcc0" />
      <rect x="120" y="224" width="98" height="6" fill="#d5c39f" />
      {/* flag */}
      <rect x="168" y="6" width="3" height="40" fill="#d9c8a6" />
      <path d="M171 8 C185 4 192 14 206 10 L206 28 C192 32 185 22 171 26 Z" fill="#f5b82e" />
      {/* trees */}
      <rect x="10" y="196" width="6" height="28" fill="#6b4421" />
      <circle cx="13" cy="186" r="20" fill={`url(#${id}tree)`} />
      <rect x="296" y="192" width="7" height="32" fill="#6b4421" />
      <circle cx="300" cy="178" r="24" fill={`url(#${id}tree)`} />
    </svg>
  );
}

/** A fingerprint drawn with arcs (for the check-in illustration). */
export function FingerprintArt() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M14 26c3-8 10-13 18-13s15 5 18 13" />
      <path d="M19 44c-2-4-3-8-3-12 0-9 7-16 16-16s16 7 16 16c0 3-1 6-2 8" />
      <path d="M25 50c-3-5-4-10-4-15 0-6 5-11 11-11s11 5 11 11c0 5-1 9-3 13" />
      <path d="M32 54c-3-6-5-12-5-19 0-3 2-5 5-5s5 2 5 5c0 6-1 11-3 16" />
      <path d="M32 35c0 8 2 14 6 19" />
      <path d="M44 50c1-2 2-4 2-6" />
      <path d="M17 52c-3-4-5-9-6-14" />
    </svg>
  );
}
