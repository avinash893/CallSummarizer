import React from 'react';

export default function Header({ isInRoom }) {
  return (
    <header className="app-header">
      <div className="brand-area">
        <h1>
          <span className="logo-icon">C</span>
          CallSummarizer
        </h1>
        <p className="subtitle">Quiet, focused video meetings with automated notes</p>
      </div>
      <div className="header-status-badge">
        <span className={`status-dot ${isInRoom ? 'online' : ''}`}></span>
        <span>{isInRoom ? 'In Meeting' : 'Ready'}</span>
      </div>
    </header>
  );
}
