import React from 'react';

export default function MetaStrip({ activeRoom, clientId, aiStatus }) {
  return (
    <div className="meta-strip">
      <div className="meta-item">
        <span>Room:</span>
        <strong>{activeRoom || 'None'}</strong>
      </div>
      <span className="meta-separator">•</span>
      <div className="meta-item">
        <span>Your ID:</span>
        <strong>{clientId}</strong>
      </div>
      <span className="meta-separator">•</span>
      <div className="meta-item">
        <span>Notes Service:</span>
        <strong>{aiStatus}</strong>
      </div>
    </div>
  );
}
