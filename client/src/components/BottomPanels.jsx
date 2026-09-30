import React from 'react';

export default function BottomPanels({ isInRoom, clientId }) {
  return (
    <div className="bottom-grid">
      <div className="panel-card">
        <h3>Participants</h3>
        <ul className="participants-list">
          <li>
            <span>You ({clientId})</span>
            <span className="role-tag">Host</span>
          </li>
          {isInRoom && (
            <li>
              <span>Alex Miller</span>
              <span className="role-tag" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                Participant
              </span>
            </li>
          )}
        </ul>
      </div>

      <div className="panel-card">
        <h3>Architecture Overview</h3>
        <ol className="guide-steps">
          <li><strong>Client:</strong> React 18 + Vite running with clean state hooks.</li>
          <li><strong>API Gateway:</strong> Unified routing for services on port 5000.</li>
          <li><strong>Services:</strong> WebRTC Signaling, NLP Task Extraction, and Meeting DB.</li>
        </ol>
      </div>
    </div>
  );
}
