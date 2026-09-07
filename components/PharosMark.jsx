"use client";

/**
 * PharosMark — the app logo (same artwork as app/icon.svg, inlined so no
 * basePath/asset-path issues on the static export).
 */
export default function PharosMark({ className = "h-5 w-5" }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="pharos-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
        <clipPath id="pharos-c">
          <path d="M216 208h80l40 240H176Z" />
        </clipPath>
      </defs>
      {/* light beam as sound waves */}
      <g fill="none" strokeWidth="20" strokeLinecap="round">
        <path d="M297 135A64 64 0 0 1 297 233" stroke="#34d399" />
        <path d="M323 104A104 104 0 0 1 323 264" stroke="#10b981" />
        <path d="M349 74A144 144 0 0 1 349 294" stroke="#10b981" opacity=".45" />
      </g>
      {/* tower */}
      <path d="M216 208h80l40 240H176Z" fill="url(#pharos-g)" />
      <g clipPath="url(#pharos-c)" fill="#0b0f0e">
        <rect x="160" y="286" width="192" height="34" />
        <rect x="160" y="366" width="192" height="34" />
      </g>
      {/* gallery, roof, lamp */}
      <rect x="222" y="196" width="68" height="18" rx="9" fill="#10b981" />
      <path d="M256 108 282 162H230Z" fill="#10b981" />
      <circle cx="256" cy="186" r="20" fill="#34d399" />
      {/* base */}
      <rect x="152" y="440" width="208" height="28" rx="14" fill="#10b981" />
    </svg>
  );
}
