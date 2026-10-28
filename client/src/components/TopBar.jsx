import React from 'react';

export default function TopBar({
  roomName,
  callDuration,
  isNotesOpen,
  setIsNotesOpen,
  onOpenArchModal,
  onCopyRoom
}) {
  return (
    <header className="top-nav">
      <div className="top-nav-left">
        <div className="brand-title">
          <span>CallSummarizer</span>
        </div>

        <button type="button" className="room-chip" onClick={onCopyRoom} title="Copy meeting link">
          <span>{roomName}</span>
          <i className="bi bi-clipboard" style={{ fontSize: '0.75rem', opacity: 0.7 }}></i>
        </button>
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
