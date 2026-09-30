import React, { useState } from 'react';

export default function NotesDrawer({
  isOpen,
  tasks,
  onToggleTask,
  onExportPdf
}) {
  const [activeTab, setActiveTab] = useState('notes');

  if (!isOpen) return null;

  return (
    <aside className="right-drawer">
      <div className="drawer-top">
        <div className="drawer-tabs">
          <button
            className={`drawer-tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            Notes
          </button>
          <button
            className={`drawer-tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
          >
            Transcript
          </button>
        </div>
      </div>

      <div className="drawer-body">
        {activeTab === 'notes' ? (
          <>
            {/* Discussion Summary */}
            <div className="notes-card">
              <div className="notes-card-title">Summary</div>
              <ul className="notes-list">
                <li>Reviewed project architecture and frontend migration to React.</li>
                <li>Fixed video tile spacing to prevent layout overlap.</li>
                <li>Simplified meeting interface to a clean, familiar format.</li>
              </ul>
            </div>

            {/* Action Items */}
            <div className="notes-card">
              <div className="notes-card-title">Action Items</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {tasks.map((task) => (
                  <label key={task.id} className="task-row">
                    <input
                      type="checkbox"
                      className="task-checkbox"
                      checked={task.completed}
                      onChange={() => onToggleTask(task.id)}
                    />
                    <div className="task-info">
                      <span className={`task-text ${task.completed ? 'done' : ''}`}>
                        {task.title}
                      </span>
                      <span className="task-meta">
                        {task.assignee} • {task.due}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="notes-action-footer">
              <button className="btn-export-pdf" onClick={onExportPdf}>
                <i className="bi bi-file-earmark-pdf" style={{ marginRight: '6px' }}></i>
                Download PDF Summary
              </button>
            </div>
          </>
        ) : (
          <div className="transcript-box">
            <div className="transcript-message">
              <div className="speaker-line">
                <span className="speaker-name">You</span>
                <span className="speaker-time">10:00 AM</span>
              </div>
              <p className="message-text">
                "Welcome to the meeting. Let's discuss today's project milestones and action items."
              </p>
            </div>

            <div className="transcript-message">
              <div className="speaker-line">
                <span className="speaker-name">Rohan Sharma</span>
                <span className="speaker-time">10:01 AM</span>
              </div>
              <p className="message-text">
                "Sounds good, I have the architecture and task breakdown ready for review."
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
