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
          <i className="bi bi-terminal-split"></i>
          <span className="brand-text-full">CallSummarizer</span>
          <span className="brand-text-short">CS</span>
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

        <span className="participant-count-badge" title="Active participants in meeting">
          <i className="bi bi-people-fill"></i>
          <span>{participantCount}</span>
        </span>
      </div>

      <div className="top-nav-center">
        <span className="call-timer">
          <i className="bi bi-clock" style={{ marginRight: '6px' }}></i>
          {callDuration}
        </span>
      </div>

      <div className="top-nav-right">
        <div className="btn-group btn-group-sm" role="group" aria-label="Workspace actions">
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
