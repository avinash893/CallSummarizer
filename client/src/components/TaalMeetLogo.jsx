import React, { useId } from 'react';

/**
 * Vector emblem for TaalMeet combining a rhythm-pulse waveform and live studio beacon.
 */
export default function TaalMeetLogo({ size = 28, className = '' }) {
  const uid = useId().replace(/:/g, '');
  const bgId = `tm-bg-${uid}`;
  const ringId = `tm-ring-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={`taalmeet-logo-svg ${className}`.trim()}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
        <linearGradient id={ringId} x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fed7aa" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${bgId})`} />
      <circle cx="24" cy="24" r="15.5" stroke={`url(#${ringId})`} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.55" />
      <path
        d="M12.5 25.5V22.5M17.5 30V18M23 34V14M28.5 29.5V18.5M34 26V21"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="35.5" cy="14" r="3" fill="#fff7ed" />
    </svg>
  );
}
