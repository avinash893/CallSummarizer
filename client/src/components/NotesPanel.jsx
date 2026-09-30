import React, { useState } from 'react';

export default function NotesPanel({ activeRoom }) {
  const [activeTab, setActiveTab] = useState('notes');

  const handleExport = () => {
    alert(
      `Exporting meeting notes for room "${activeRoom || 'Current Session'}".\n(In full implementation, the backend REST endpoint generates and downloads the PDF summary).`
    );
  };

  return (
    <div className="notes-panel">
      <div className="notes-nav">
        <button
          className={`tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
          onClick={() => setActiveTab('notes')}
        >
          Meeting Notes
        </button>
        <button
          className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
          onClick={() => setActiveTab('transcript')}
        >
          Transcript
        </button>
      </div>

      <div className="notes-body">
        {activeTab === 'notes' ? (
          <div className="summary-block">
            <div className="section-card">
              <h4>Discussion Overview</h4>
              <ul>
                <li>Discussed the simplified, distraction-free meeting interface.</li>
                <li>Reviewed automated note-taking and NLP task extraction pipeline.</li>
                <li>Confirmed media controls and local camera preview states.</li>
              </ul>
            </div>

            <div className="section-card action-card">
              <h4>Action Items (NLP Formed)</h4>
              <ul>
                <li>Review React component structure with team members.</li>
                <li>Connect WebSocket signaling service in next milestone.</li>
              </ul>
            </div>

            <div className="notes-footer">
              <button
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleExport}
              >
                Export Notes (PDF)
              </button>
            </div>
          </div>
        ) : (
          <div className="transcript-list">
            <div className="transcript-bubble">
              <div className="transcript-header">
                <span className="speaker-name">You</span>
                <span className="timestamp">10:00 AM</span>
              </div>
              <p className="transcript-text">
                Let's keep this interface simple and calming so people can focus on the conversation.
              </p>
            </div>

            <div className="transcript-bubble">
              <div className="transcript-header">
                <span className="speaker-name">Alex Miller</span>
                <span className="timestamp">10:01 AM</span>
              </div>
              <p className="transcript-text">
                Agreed. The soft slate colors and clean spacing feel much more natural and comfortable to look at.
              </p>
            </div>

            <div className="transcript-bubble">
              <div className="transcript-header">
                <span className="speaker-name">You</span>
                <span className="timestamp">10:02 AM</span>
              </div>
              <p className="transcript-text">
                Notes and actionable to-do items are automatically captured here quietly on the side as we talk.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
