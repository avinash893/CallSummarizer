import React from 'react';

export default function ScaleWatcherDial({
  title = 'Live Mic Watcher',
  subtitle = 'Mic Sur',
  pitchInfo = null,
  langMode = 'en',
  accentColor = '#ff7b24',
  emptyLabel = 'Sing or play a note...'
}) {
  const hasPitch = Boolean(pitchInfo && pitchInfo.freq > 0);
  const cents = hasPitch ? Math.max(-50, Math.min(50, Number(pitchInfo.cents) || 0)) : 0;
  const inTune = hasPitch && Math.abs(cents) <= 15;
  const needleDeg = cents * 1.65; // -82.5deg to +82.5deg

  const primaryLabel = hasPitch
    ? langMode === 'hi'
      ? pitchInfo.devanagari || pitchInfo.sargam
      : pitchInfo.sargam || pitchInfo.noteName
    : '--';

  const secondaryLabel = hasPitch
    ? `${pitchInfo.noteName || ''}${pitchInfo.octaveLabel || ''}`
    : emptyLabel;

  const dialAccent = inTune ? '#10b981' : accentColor;

  return (
    <div
      className={`scale-watcher-card ${inTune ? 'sur-locked' : ''}`}
      data-testid="scale-watcher-dial"
    >
      <div className="sw-header">
        <div>
          <span className="sw-title">{title}</span>
          <span className="sw-sub">{subtitle}</span>
        </div>
        <span
          className={`sw-sur-pill ${inTune ? 'active' : hasPitch ? 'off-center' : 'idle'}`}
          data-testid="sur-status-badge"
        >
          {inTune ? 'SUR MILA' : hasPitch ? `${cents > 0 ? '+' : ''}${cents}c` : 'STANDBY'}
        </span>
      </div>

      <div className="sw-dial-wrap">
        <svg viewBox="0 0 220 132" className="sw-svg" aria-label={title}>
          <defs>
            <linearGradient id={`arc-${title.replace(/\W+/g, '')}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.85" />
              <stop offset="35%" stopColor="#f59e0b" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#10b981" stopOpacity="1" />
              <stop offset="65%" stopColor="#f59e0b" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.85" />
            </linearGradient>
          </defs>

          {/* Background track arc */}
          <path
            d="M 24 112 A 86 86 0 0 1 196 112"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Colored intonation spectrum arc */}
          <path
            d="M 24 112 A 86 86 0 0 1 196 112"
            fill="none"
            stroke={`url(#arc-${title.replace(/\W+/g, '')})`}
            strokeWidth="6"
            strokeLinecap="round"
          />

          {/* Center Sweet Spot Glow */}
          <path
            d="M 92 27.5 A 86 86 0 0 1 128 27.5"
            fill="none"
            stroke="#10b981"
            strokeWidth="11"
            strokeOpacity={inTune ? '0.6' : '0.18'}
            strokeLinecap="round"
          />

          {/* Tick labels */}
          <text x="16" y="126" fill="#7a8299" fontSize="10" fontWeight="600">-50c</text>
          <text x="103" y="15" fill={inTune ? '#10b981' : '#8b93a8'} fontSize="10" fontWeight="700" textAnchor="middle">0</text>
          <text x="184" y="126" fill="#7a8299" fontSize="10" fontWeight="600">+50c</text>

          {/* Animated Needle */}
          <g transform={`translate(110, 112) rotate(${needleDeg})`} style={{ transition: 'transform 85ms ease-out' }}>
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="-72"
              stroke={hasPitch ? dialAccent : '#4b5563'}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle cx="0" cy="-70" r="4" fill={hasPitch ? dialAccent : '#4b5563'} />
          </g>
          <circle cx="110" cy="112" r="7" fill="#181b22" stroke={hasPitch ? dialAccent : '#4b5563'} strokeWidth="2.5" />
        </svg>

        <div className="sw-readout">
          <div className="sw-main-note" style={{ color: hasPitch ? dialAccent : '#8b93a8' }}>
            {primaryLabel}
          </div>
          <div className="sw-sub-note">{secondaryLabel}</div>
          <div className="sw-freq-line">
            {hasPitch ? `${pitchInfo.freq} Hz` : '0.0 Hz'}
          </div>
        </div>
      </div>
    </div>
  );
}
