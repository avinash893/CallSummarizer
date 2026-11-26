import React, { useState } from 'react';

export default function TopBar({
  roomName,
  callDuration,
  isNotesOpen,
  setIsNotesOpen,
  onOpenArchModal,
  onCopyRoom,
  participantCount = 1,
  activeTab = 'stage',
  onChangeTab = null,
  activeScaleBadge = '',
  theme = 'light',
  onToggleTheme = null
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyClick = () => {
    if (onCopyRoom) {
      onCopyRoom();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="top-nav">
      <div className="top-nav-left">
        <div className="brand-title">
          <i className="bi bi-music-note-beamed brand-icon-accent"></i>
          <span className="brand-text-full">SargamJam Studio</span>
          <span className="brand-text-short">SJ</span>
        </div>

        <button
          type="button"
          className="btn btn-outline-secondary btn-sm room-chip"
          onClick={handleCopyClick}
          title="Copy meeting link"
        >
          <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'}`}></i>
          <span>{copied ? 'Copied' : roomName}</span>
        </button>

        <span className="participant-count-badge" title="Active jammers in room">
          <i className="bi bi-people-fill"></i>
          <span>{participantCount}</span>
        </span>
      </div>

      <div className="top-nav-center">
        {onChangeTab && (
          <div className="studio-mode-switcher" role="tablist" aria-label="Studio workspace views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'stage'}
              className={`studio-mode-tab ${activeTab === 'stage' ? 'active' : ''}`}
              onClick={() => onChangeTab('stage')}
              data-testid="tab-studio-stage"
            >
              <i className="bi bi-camera-video-fill"></i>
              <span>Jam Stage</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'pitch'}
              className={`studio-mode-tab ${activeTab === 'pitch' ? 'active' : ''}`}
              onClick={() => onChangeTab('pitch')}
              data-testid="tab-studio-pitch"
            >
              <i className="bi bi-soundwave"></i>
              <span>Pitch & Lyrics</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'daw'}
              className={`studio-mode-tab ${activeTab === 'daw' ? 'active' : ''}`}
              onClick={() => onChangeTab('daw')}
              data-testid="tab-studio-daw"
            >
              <i className="bi bi-sliders2"></i>
              <span>Studio DAW</span>
            </button>
          </div>
        )}

        <span className="call-timer" title="Active Jam Duration">
          <i className="bi bi-clock" style={{ marginRight: '6px' }}></i>
          {callDuration}
        </span>

        {activeScaleBadge && (
          <span className="top-scale-chip" title="Current Scale & Tempo">
            <i className="bi bi-music-note"></i>
            <span>{activeScaleBadge}</span>
          </span>
        )}
      </div>

      <div className="top-nav-right">
        <div className="btn-group btn-group-sm" role="group" aria-label="Workspace actions">
          {onToggleTheme && (
            <button
              type="button"
              className="btn btn-outline-secondary nav-btn"
              onClick={onToggleTheme}
              title={theme === 'light' ? 'Switch to Dark Stage theme' : 'Switch to Light Studio theme'}
              aria-label={theme === 'light' ? 'Switch to Dark Stage theme' : 'Switch to Light Studio theme'}
              data-testid="btn-toggle-theme"
            >
              <i className={`bi ${theme === 'light' ? 'bi-moon-stars' : 'bi-sun'}`}></i>
              <span className="nav-theme-label">{theme === 'light' ? 'Dark' : 'Light'}</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary nav-btn nav-btn-services"
            onClick={onOpenArchModal}
            title="View Services Status"
          >
            <i className="bi bi-hdd-network"></i>
            <span>Services</span>
          </button>

          <button
            type="button"
            className={`btn btn-outline-secondary nav-btn nav-btn-notes ${isNotesOpen ? 'active' : ''}`}
            onClick={() => setIsNotesOpen(!isNotesOpen)}
            title="Toggle Meeting Notes"
            aria-label="Toggle meeting notes, transcript and action items"
          >
            <i className="bi bi-journal-text"></i>
            <span>{isNotesOpen ? 'Close Notes' : 'Notes'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
