import React, { useState } from 'react';

function getInitials(name = 'User') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function taskHasTime(task) {
  if (!task) return false;
  if (task.startTime) return true;
  const text = `${task.due || ''} ${task.title || ''} ${task.description || ''}`;
  return (
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text) ||
    /\b(?:at\s+)?([01]?\d|2[0-3]):[0-5]\d\b/i.test(text) ||
    /\bat\s+\d{1,2}\b/i.test(text)
  );
}

export default function NotesDrawer({
  isOpen,
  onClose,
  tasks = [],
  transcript = [],
  onToggleTask,
  onAddTask,
  onAddTranscript,
  onExportPdf,
  onExtractTasks,
  isExtracting = false,
  onAddToCalendar,
  capturedPeerIds = [],
  capturedAudioClips = [],
  remotePeers = [],
  onToggleCapturePeer,
  onDeleteClip,
  user = { name: 'You' }
}) {
  const [activeTab, setActiveTab] = useState('notes');
  const [actionFilter, setActionFilter] = useState(user?.email ? 'mine' : 'all'); // 'mine' for logged in users, 'all' default for overview
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTranscriptText, setNewTranscriptText] = useState('');
  const [confirmingTaskId, setConfirmingTaskId] = useState(null);
  const [calendarLoadingId, setCalendarLoadingId] = useState(null);
  const [calendarSuccessIds, setCalendarSuccessIds] = useState([]);
  const [calendarError, setCalendarError] = useState(null);

  if (!isOpen) return null;

  const isTaskMine = (task) => {
    if (!task || !task.assignee) return true;
    const assignee = String(task.assignee).toLowerCase().trim();
    const myName = String(user?.name || 'You').toLowerCase().trim();
    if (assignee === 'you' || assignee === myName) return true;
    if (myName !== 'you' && (assignee.includes(myName) || myName.includes(assignee))) return true;
    return false;
  };

  const displayedTasks = actionFilter === 'mine' ? tasks.filter(isTaskMine) : tasks;

  const handleRequestAddToCalendar = (task) => {
    if (!task || task.id === undefined || task.id === null) return;
    if (!taskHasTime(task)) return;
    if (calendarLoadingId !== null || calendarSuccessIds.includes(task.id) || task.calendarAdded) {
      return;
    }
    setCalendarError(null);
    setConfirmingTaskId(task.id);
  };

  const handleConfirmAddToCalendar = async (task) => {
    if (!task || task.id === undefined || task.id === null) return;
    if (!taskHasTime(task)) return;
    if (calendarLoadingId !== null || calendarSuccessIds.includes(task.id) || task.calendarAdded) {
      return;
    }
    setCalendarLoadingId(task.id);
    setConfirmingTaskId(null);
    try {
      if (onAddToCalendar) {
        const result = await onAddToCalendar(task);
        if (result && result.success) {
          setCalendarSuccessIds((prev) => [...prev, task.id]);
          setCalendarError(null);
        } else {
          setCalendarError({
            taskId: task.id,
            message: result?.error || 'Failed to add event to Google Calendar'
          });
        }
      } else {
        setCalendarSuccessIds((prev) => [...prev, task.id]);
      }
    } catch (err) {
      setCalendarError({
        taskId: task.id,
        message: err.message || 'Error connecting to Google Calendar'
      });
    } finally {
      setCalendarLoadingId(null);
    }
  };

  const handleTaskSubmit = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !onAddTask) return;
    onAddTask(newTaskTitle.trim());
    setNewTaskTitle('');
  };

  const handleTranscriptSubmit = (e) => {
    e.preventDefault();
    if (!newTranscriptText.trim() || !onAddTranscript) return;
    onAddTranscript(newTranscriptText.trim());
    setNewTranscriptText('');
  };

  return (
    <aside className="right-drawer">
      <div className="drawer-top">
        <div className="drawer-tabs nav nav-tabs" role="tablist" aria-label="Meeting notes and transcript tabs">
          <div
            role="tab"
            id="tab-notes"
            aria-selected={activeTab === 'notes'}
            aria-controls="tabpanel-notes"
            tabIndex={activeTab === 'notes' ? 0 : -1}
          >
            <button
              type="button"
              className={`nav-link drawer-tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
              onClick={() => setActiveTab('notes')}
              aria-selected={activeTab === 'notes'}
              aria-controls="tabpanel-notes"
            >
              <i className="bi bi-card-checklist" style={{ marginRight: '6px' }}></i>
              <span>Notes</span>
            </button>
          </div>
          <div
            role="tab"
            id="tab-transcript"
            aria-selected={activeTab === 'transcript'}
            aria-controls="tabpanel-transcript"
            tabIndex={activeTab === 'transcript' ? 0 : -1}
          >
            <button
              type="button"
              className={`nav-link drawer-tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcript')}
              aria-selected={activeTab === 'transcript'}
              aria-controls="tabpanel-transcript"
            >
              <i className="bi bi-chat-left-text" style={{ marginRight: '6px' }}></i>
              <span>Transcript</span>
            </button>
          </div>
          {capturedAudioClips && capturedAudioClips.length > 0 && (
            <div
              role="tab"
              id="tab-captured"
              aria-selected={activeTab === 'captured'}
              aria-controls="tabpanel-captured"
              tabIndex={activeTab === 'captured' ? 0 : -1}
            >
              <button
                type="button"
                className={`nav-link drawer-tab-btn ${activeTab === 'captured' ? 'active' : ''}`}
                onClick={() => setActiveTab('captured')}
                aria-selected={activeTab === 'captured'}
                aria-controls="tabpanel-captured"
                data-testid="tab-captured-audio"
              >
                <i className="bi bi-soundwave" style={{ marginRight: '6px' }}></i>
                <span>Captured</span>
                {capturedPeerIds.length > 0 && (
                  <span className="badge bg-danger ms-1" style={{ fontSize: '0.6rem', padding: '2px 5px' }}>
                    REC
                  </span>
                )}
                <span className="badge bg-secondary ms-1" style={{ fontSize: '0.6rem', padding: '2px 5px' }}>
                  {capturedAudioClips.length}
                </span>
              </button>
            </div>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary drawer-close-btn ms-2"
            onClick={onClose}
            title="Close drawer"
            aria-label="Close notes drawer"
            data-testid="btn-close-drawer"
          >
            <i className="bi bi-x-lg"></i>
          </button>
        )}
      </div>

      <div className="drawer-body">
        {activeTab === 'captured' ? (
          <div
            id="tabpanel-captured"
            role="tabpanel"
            aria-labelledby="tab-captured"
            className="captured-audio-view"
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {/* Active selective capture status */}
            <div className="notes-card">
              <div className="notes-card-title">
                <i className="bi bi-broadcast" style={{ marginRight: '6px', color: '#ef4444' }}></i>
                <span>Active Private Capture</span>
              </div>
              {capturedPeerIds.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
                  <i className="bi bi-info-circle me-1"></i> No participants currently captured.
                  In group calls, click the <strong>Capture</strong> button on any participant's video tile to privately listen and record their audio.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {capturedPeerIds.map((peerId) => {
                    const peer = remotePeers.find((p) => p.peerId === peerId) || { name: 'Participant', peerId };
                    return (
                      <div
                        key={peerId}
                        className="d-flex align-items-center justify-content-between p-2 rounded"
                        style={{ background: 'var(--bg-surface)', border: '1px solid rgba(239, 68, 68, 0.35)' }}
                        data-testid={`active-captured-peer-${peerId}`}
                      >
                        <div className="d-flex align-items-center gap-2">
                          <i className="bi bi-disc-fill pulse-record-dot"></i>
                          <div>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
                              {peer.name || 'Participant'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#fca5a5' }}>
                              Listening privately • Recording
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                          onClick={() => onToggleCapturePeer && onToggleCapturePeer(peerId)}
                          data-testid={`btn-stop-capture-${peerId}`}
                          title="Stop private capture"
                        >
                          <i className="bi bi-stop-fill me-1"></i> Stop
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recorded Audio Clips */}
            <div className="notes-card">
              <div className="notes-card-title">
                <i className="bi bi-music-note-list" style={{ marginRight: '6px' }}></i>
                <span>Captured Audio Library ({capturedAudioClips.length})</span>
              </div>

              {capturedAudioClips.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  No recorded clips yet. Completed audio captures will be stored here with playback and download options.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {capturedAudioClips.map((clip) => (
                    <div key={clip.id} className="captured-clip-card" data-testid={`captured-clip-${clip.id}`}>
                      <div className="clip-header">
                        <div className="clip-participant-info">
                          <span className="clip-peer-avatar">{getInitials(clip.peerName)}</span>
                          <div>
                            <div className="clip-peer-name">{clip.peerName}</div>
                            <div className="clip-meta">{clip.time} • {clip.duration}</div>
                          </div>
                        </div>
                        <span className="badge bg-dark border border-secondary text-secondary" style={{ fontSize: '0.65rem' }}>
                          Private
                        </span>
                      </div>

                      {clip.url && (
                        <div className="clip-audio-player">
                          <audio controls src={clip.url} data-testid={`audio-player-${clip.id}`} />
                        </div>
                      )}

                      <div className="clip-actions btn-group btn-group-sm w-100">
                        {clip.url && (
                          <a
                            href={clip.url}
                            download={`capture-${(clip.peerName || 'audio').replace(/\s+/g, '_')}-${clip.id}.webm`}
                            className="btn btn-outline-secondary btn-sm"
                            title="Download audio recording"
                          >
                            <i className="bi bi-download me-1"></i> Download
                          </a>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() =>
                            onAddTranscript &&
                            onAddTranscript(`[Private Capture - ${clip.peerName} (${clip.duration}) at ${clip.time}]`)
                          }
                          title="Add reference to transcript"
                          data-testid={`btn-add-note-${clip.id}`}
                        >
                          <i className="bi bi-journal-plus me-1"></i> Note
                        </button>
                        {onDeleteClip && (
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm text-danger"
                            onClick={() => onDeleteClip(clip.id)}
                            title="Delete audio clip"
                            data-testid={`btn-delete-clip-${clip.id}`}
                          >
                            <i className="bi bi-trash"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'notes' ? (
          <div
            id="tabpanel-notes"
            role="tabpanel"
            aria-labelledby="tab-notes"
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            {/* Discussion Summary */}
            <div className="notes-card">
              <div className="notes-card-title">
                <i className="bi bi-file-text" style={{ marginRight: '6px' }}></i>
                <span>Summary</span>
              </div>
              {transcript.length > 0 ? (
                <ul className="notes-list">
                  {transcript.slice(-3).map((item) => (
                    <li key={item.id}>
                      <strong>{item.speaker}:</strong> {item.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="notes-list">
                  <li>Meeting room active and ready for discussion.</li>
                  <li>Use the Transcript tab or microphone to capture notes and action items.</li>
                </ul>
              )}
            </div>

            {/* Action Items */}
            <div className="notes-card">
              <div className="notes-card-title d-flex align-items-center justify-content-between" style={{ flexWrap: 'wrap', gap: '6px' }}>
                <div className="d-flex align-items-center">
                  <i className="bi bi-check2-square" style={{ marginRight: '6px' }}></i>
                  <span>Action Items</span>
                </div>
                <div className="btn-group btn-group-sm" role="group" aria-label="Action items filter">
                  <button
                    type="button"
                    className={`btn btn-xs ${actionFilter === 'mine' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => setActionFilter('mine')}
                    data-testid="filter-my-actions"
                  >
                    Personal ({tasks.filter(isTaskMine).length})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${actionFilter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => setActionFilter('all')}
                    data-testid="filter-all-actions"
                  >
                    All ({tasks.length})
                  </button>
                </div>
              </div>

              {onAddTask && (
                <form onSubmit={handleTaskSubmit} className="input-group input-group-sm">
                  <input
                    type="text"
                    className="form-control lobby-input"
                    style={{ flex: 1, padding: '7px 10px', fontSize: '0.8rem' }}
                    placeholder="Add action item..."
                    aria-label="Add action item"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn btn-outline-secondary btn-secondary-action"
                    style={{ padding: '7px 12px' }}
                    title="Add task"
                  >
                    <i className="bi bi-plus-lg"></i>
                  </button>
                </form>
              )}

              {calendarError && (
                <div className="calendar-error-banner" role="alert" data-testid="calendar-error-alert">
                  <i className="bi bi-exclamation-triangle-fill" style={{ color: '#ef4444', marginRight: '6px' }}></i>
                  <span style={{ flex: 1, fontSize: '0.78rem', color: '#fca5a5' }}>{calendarError.message}</span>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm btn-dismiss-alert"
                    onClick={() => setCalendarError(null)}
                    title="Dismiss"
                    aria-label="Dismiss error"
                  >
                    <i className="bi bi-x"></i>
                  </button>
                </div>
              )}

              <div className="list-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {displayedTasks.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {actionFilter === 'mine'
                      ? 'No personal action items for you yet. Add one above or extract from transcript.'
                      : 'No action items yet. Add one above or extract from transcript.'}
                  </p>
                ) : (
                  displayedTasks.map((task) => (
                    <div key={task.id} className="list-group-item task-item-container" data-testid={`task-item-${task.id}`}>
                      <label className="task-row">
                        <input
                          type="checkbox"
                          className="task-checkbox"
                          checked={Boolean(task.completed)}
                          onChange={() => onToggleTask && onToggleTask(task.id)}
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

                      {taskHasTime(task) && (
                        <div className="task-calendar-controls">
                          {task.calendarAdded || calendarSuccessIds.includes(task.id) ? (
                            <span className="calendar-badge-success" title="Added to Google Calendar with 5-minute popup alarm reminder">
                              <i className="bi bi-calendar-check-fill" style={{ marginRight: '4px' }}></i>
                              In Calendar
                            </span>
                          ) : confirmingTaskId === task.id ? (
                            <div className="calendar-confirm-box" role="dialog" aria-label="Confirm adding event to Google Calendar">
                              <span className="calendar-confirm-prompt">
                                <i className="bi bi-bell-fill" style={{ marginRight: '4px' }}></i>
                                Add to Google Calendar? (5m reminder)
                              </span>
                              <div className="calendar-confirm-btns btn-group btn-group-sm">
                                <button
                                  type="button"
                                  className="btn btn-calendar-confirm"
                                  onClick={() => handleConfirmAddToCalendar(task)}
                                  disabled={calendarLoadingId !== null}
                                >
                                  <i className="bi bi-check2" style={{ marginRight: '4px' }}></i>
                                  <span>{calendarLoadingId === task.id ? 'Adding...' : 'Confirm'}</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline-secondary btn-calendar-cancel"
                                  onClick={() => setConfirmingTaskId(null)}
                                  disabled={calendarLoadingId !== null}
                                >
                                  <i className="bi bi-x" style={{ marginRight: '4px' }}></i>
                                  <span>Cancel</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm btn-add-calendar"
                              title="Add to Google Calendar"
                              aria-label="Add to Google Calendar"
                              onClick={() => handleRequestAddToCalendar(task)}
                              disabled={calendarLoadingId !== null}
                            >
                              <i className="bi bi-calendar-plus" style={{ marginRight: '4px' }}></i>
                              <span>{calendarLoadingId === task.id ? 'Adding...' : 'Add to Google Calendar'}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="notes-action-footer">
              <button type="button" className="btn btn-outline-secondary btn-export-pdf" onClick={onExportPdf}>
                <i className="bi bi-file-earmark-pdf" style={{ marginRight: '6px' }}></i>
                <span>Download PDF Summary</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            id="tabpanel-transcript"
            role="tabpanel"
            aria-labelledby="tab-transcript"
            className="transcript-box"
          >
            {transcript.length === 0 ? (
              <div className="transcript-message">
                <p className="message-text" style={{ color: 'var(--text-muted)' }}>
                  No transcript lines recorded yet. Speak into your microphone or add a meeting statement below.
                </p>
              </div>
            ) : (
              transcript.map((item) => (
                <div key={item.id} className="transcript-message">
                  <div className="speaker-line">
                    <span className="speaker-name">
                      <i className="bi bi-person-badge" style={{ marginRight: '4px' }}></i>
                      {item.speaker}
                    </span>
                    <span className="speaker-time">{item.time}</span>
                  </div>
                  <p className="message-text">"{item.text}"</p>
                </div>
              ))
            )}

            {onAddTranscript && (
              <form onSubmit={handleTranscriptSubmit} className="input-group input-group-sm" style={{ marginTop: '6px' }}>
                <input
                  type="text"
                  className="form-control lobby-input"
                  style={{ flex: 1, padding: '8px 10px', fontSize: '0.8rem' }}
                  placeholder="Type a meeting note or commitment..."
                  aria-label="Type a meeting note or commitment"
                  value={newTranscriptText}
                  onChange={(e) => setNewTranscriptText(e.target.value)}
                />
                <button type="submit" className="btn btn-outline-secondary btn-secondary-action" title="Send to transcript">
                  <i className="bi bi-send"></i>
                </button>
              </form>
            )}

            {onExtractTasks && (
              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-export-pdf"
                  onClick={onExtractTasks}
                  disabled={isExtracting}
                >
                  <i className="bi bi-cpu" style={{ marginRight: '6px' }}></i>
                  <span>{isExtracting ? 'Extracting tasks...' : 'Extract Tasks from Transcript'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
