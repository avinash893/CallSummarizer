import React, { useState } from 'react';

export default function TopBar({
  roomName,
  callDuration,
  isNotesOpen,
  setIsNotesOpen,
  onOpenArchModal,
  onCopyRoom,
  participantCount = 1
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
          <span>CallSummarizer</span>
        </div>

        <button
          type="button"
          className="room-chip"
          onClick={handleCopyClick}
          title="Copy meeting link"
        >
          <span>{copied ? 'Link copied!' : roomName}</span>
          <i
            className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'}`}
            style={{ fontSize: '0.75rem', opacity: 0.7 }}
          ></i>
        </button>

        <span className="participant-count-badge" title="Active participants in meeting">
          <i className="bi bi-people-fill" style={{ fontSize: '0.75rem' }}></i>
          <span>{participantCount}</span>
        </span>
      </div>

      <div className="top-nav-center">
        <span className="call-timer">{callDuration}</span>
      </div>

      <div className="top-nav-right">
        <button
          type="button"
          className="nav-btn"
          onClick={onOpenArchModal}
          title="View Services Status"
        >
          <i className="bi bi-hdd-network"></i>
          <span>Services</span>
        </button>

        <button
          type="button"
          className={`nav-btn ${isNotesOpen ? 'active' : ''}`}
          onClick={() => setIsNotesOpen(!isNotesOpen)}
          title="Toggle Meeting Notes"
        >
          <i className="bi bi-journal-text"></i>
          <span>{isNotesOpen ? 'Close Notes' : 'Notes'}</span>
        </button>
      </div>
    </header>
  );
}
