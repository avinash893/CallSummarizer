import React, { useState } from 'react';
import { midiToNoteName } from '../audio/sargamEngine';

export function taskHasTime(task) {
  if (!task) return false;
  if (task.startTime && typeof task.startTime === 'string' && !isNaN(new Date(task.startTime).getTime()) && task.startTime !== 'null' && task.startTime !== 'undefined') {
    return true;
  }
  const text = `${task.due || ''} ${task.title || ''} ${task.description || ''}`;
  return (
    /\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/i.test(text) ||
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
  onReconnectCalendar = null,
  capturedPeerIds = [],
  remotePeers = [],
  onToggleCapturePeer,
  onClearSession,
  user = { name: 'You' },
  jamState = null,
  summaryBullets = [],
  interimSpeech = null,
  captureNotice = ''
}) {
  const [activeTab, setActiveTab] = useState('notes');
  const [actionFilter, setActionFilter] = useState('all');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTranscriptText, setNewTranscriptText] = useState('');
  const [confirmingTaskId, setConfirmingTaskId] = useState(null);
  const [calendarLoadingId, setCalendarLoadingId] = useState(null);
  const [calendarSuccessMap, setCalendarSuccessMap] = useState({});
  const [calendarError, setCalendarError] = useState(null);
  const [reconnectingCalendar, setReconnectingCalendar] = useState(false);

  if (!isOpen) return null;

  const userKey = String(user?.email || user?.sessionId || user?.name || 'You').trim().toLowerCase();

  const isTaskInMyCalendar = (task) => {
    if (!task) return false;
    if (calendarSuccessMap[task.id]) return true;
    if (Array.isArray(task.calendarAddedBy)) {
      return task.calendarAddedBy.some((k) => String(k).trim().toLowerCase() === userKey);
    }
    return false;
  };

  const getTaskCalendarLink = (task) => {
    if (!task) return null;
    if (calendarSuccessMap[task.id]?.htmlLink) return calendarSuccessMap[task.id].htmlLink;
    if (task.calendarLinks && typeof task.calendarLinks === 'object') {
      return task.calendarLinks[userKey] || null;
    }
    return null;
  };

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
    if (calendarLoadingId !== null || isTaskInMyCalendar(task)) {
      return;
    }
    setCalendarError(null);
    setConfirmingTaskId(task.id);
  };

  const handleConfirmAddToCalendar = async (task) => {
    if (!task || task.id === undefined || task.id === null) return;
    if (!taskHasTime(task)) return;
    if (calendarLoadingId !== null || isTaskInMyCalendar(task)) {
      return;
    }
    setCalendarLoadingId(task.id);
    setConfirmingTaskId(null);
    try {
      if (onAddToCalendar) {
        const result = await onAddToCalendar(task);
        if (result && result.success) {
          setCalendarSuccessMap((prev) => ({
            ...prev,
            [task.id]: {
              htmlLink: result.event?.htmlLink || null,
              mode: result.mode || 'google'
            }
          }));
          setCalendarError(null);
        } else {
          setCalendarError({
            taskId: task.id,
            needsCalendarAuth: Boolean(result?.needsCalendarAuth),
            message: result?.error || 'Failed to add event to Google Calendar'
          });
        }
      } else {
        setCalendarSuccessMap((prev) => ({ ...prev, [task.id]: { htmlLink: null, mode: 'google' } }));
      }
    } catch (err) {
      setCalendarError({
        taskId: task.id,
        needsCalendarAuth: false,
        message: err.message || 'Error connecting to Google Calendar'
      });
    } finally {
      setCalendarLoadingId(null);
    }
  };

  const handleReconnectClick = async () => {
    if (!onReconnectCalendar || reconnectingCalendar) return;
    setReconnectingCalendar(true);
    try {
      const result = await onReconnectCalendar();
      if (result && result.success) {
        const pendingTaskId = calendarError?.taskId;
        setCalendarError(null);
        if (pendingTaskId !== undefined && pendingTaskId !== null) {
          const targetTask = tasks.find((t) => t.id === pendingTaskId);
          if (targetTask) {
            await handleConfirmAddToCalendar(targetTask);
          }
        }
      } else if (result?.error) {
        setCalendarError((prev) => ({ ...(prev || {}), message: result.error, needsCalendarAuth: true }));
      }
    } finally {
      setReconnectingCalendar(false);
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
              {capturedPeerIds.length > 0 && (
                <span className="badge bg-danger ms-1" style={{ fontSize: '0.6rem', padding: '2px 5px' }}>
                  LIVE
                </span>
              )}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onClearSession && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger btn-clear-session"
              onClick={onClearSession}
              title="Clear all transcripts, notes, and actions for this session"
              aria-label="Clear session notes and transcripts"
              data-testid="btn-clear-session"
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            >
              <i className="bi bi-trash3" style={{ marginRight: '4px' }}></i>
              <span>Clear</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary drawer-close-btn"
              onClick={onClose}
              title="Close drawer"
              aria-label="Close notes drawer"
              data-testid="btn-close-drawer"
            >
              <i className="bi bi-x-lg"></i>
            </button>
          )}
        </div>
      </div>

      <div className="drawer-body">
        {activeTab === 'notes' ? (
          <div
            id="tabpanel-notes"
            role="tabpanel"
            aria-labelledby="tab-notes"
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            {/* Active Jam Settings Snapshot */}
            {jamState && (
              <div className="notes-card notes-raga-snapshot">
                <div className="notes-card-title">
                  <i className="bi bi-music-note-beamed" style={{ marginRight: '6px', color: 'var(--accent-primary)' }}></i>
                  <span>Session Tempo & Scale</span>
                </div>
                <div className="d-flex flex-wrap gap-2" style={{ fontSize: '0.78rem', color: 'var(--text-main)' }}>
                  <span className="notes-snap-chip accent">Scale: {midiToNoteName(jamState.tonicMidi || 60)}</span>
                  <span className="notes-snap-chip">{jamState.bpm || 96} BPM</span>
                  <span className="notes-snap-chip">Tanpura {jamState.isTanpuraOn ? 'ON' : 'OFF'}</span>
                </div>
              </div>
            )}

            {/* Discussion Summary */}
            <div className="notes-card">
              <div className="notes-card-title">
                <i className="bi bi-file-text" style={{ marginRight: '6px' }}></i>
                <span>Summary</span>
              </div>
              {summaryBullets && summaryBullets.length > 0 ? (
                <ul className="notes-list" data-testid="nlp-summary-list">
                  {summaryBullets.map((bullet, idx) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>
              ) : transcript.length > 0 ? (
                <ul className="notes-list" data-testid="nlp-summary-list">
                  <li>
                    {Array.from(new Set(transcript.map((t) => t.speaker).filter(Boolean))).length} active speaker(s) across {transcript.length} statement{transcript.length === 1 ? '' : 's'}.
                  </li>
                  {transcript.slice(-2).map((item) => (
                    <li key={item.id}>
                      <strong>{item.speaker}:</strong> {item.text}
                    </li>
                  ))}
                  {tasks.length > 0 && (
                    <li>{tasks.length} action item{tasks.length === 1 ? '' : 's'} tracked ({tasks.filter((t) => t.completed).length} done).</li>
                  )}
                </ul>
              ) : (
                <ul className="notes-list">
                  <li>Meeting room active and ready for discussion.</li>
                  <li>Click <strong>Capture</strong> on a video tile or type in Transcript to capture notes and action items.</li>
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
                  <i className="bi bi-exclamation-triangle-fill notes-error-icon"></i>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span className="notes-error-text">{calendarError.message}</span>
                    {calendarError.needsCalendarAuth && onReconnectCalendar && (
                      <div>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                          onClick={handleReconnectClick}
                          disabled={reconnectingCalendar}
                          data-testid="btn-reconnect-calendar"
                        >
                          <i className="bi bi-google me-1"></i>
                          {reconnectingCalendar ? 'Connecting...' : 'Reconnect Google Calendar'}
                        </button>
                      </div>
                    )}
                  </div>
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
                      ? 'No personal action items for you yet. Switch to All or extract from transcript.'
                      : 'No action items yet. Add one above or extract from transcript.'}
                  </p>
                ) : (
                  displayedTasks.map((task) => {
                    const calLink = getTaskCalendarLink(task);
                    return (
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
                          {isTaskInMyCalendar(task) ? (
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <span className="calendar-badge-success" title="Added to Google Calendar with 5-minute popup alarm reminder">
                                <i className="bi bi-calendar-check-fill" style={{ marginRight: '4px' }}></i>
                                In Calendar
                              </span>
                              {calLink && (
                                <a
                                  href={calLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-outline-secondary btn-sm"
                                  style={{ fontSize: '0.7rem', padding: '2px 7px' }}
                                >
                                  <i className="bi bi-box-arrow-up-right me-1"></i>
                                  Open
                                </a>
                              )}
                            </div>
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
                  );
                  })
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
            {capturedPeerIds.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {capturedPeerIds.map((peerId) => {
                  const isLocalCapture = peerId === 'local';
                  const peerName = isLocalCapture
                    ? (user?.name || 'You')
                    : (remotePeers.find((p) => p.peerId === peerId)?.name || 'Participant');
                  return (
                    <div
                      key={peerId}
                      className="notes-capture-card p-2 rounded-2 d-flex align-items-center justify-content-between"
                      data-testid={isLocalCapture ? 'live-capture-indicator' : `active-captured-peer-${peerId}`}
                    >
                      <span className="notes-capture-sub d-flex align-items-center gap-2">
                        <i className="bi bi-disc-fill pulse-record-dot"></i>
                        <span>
                          {isLocalCapture
                            ? 'Transcribing live speech & extracting action items...'
                            : `Transcribing ${peerName}...`}
                        </span>
                      </span>
                      {onToggleCapturePeer && (
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm"
                          style={{ padding: '2px 7px', fontSize: '0.7rem' }}
                          onClick={() => onToggleCapturePeer(peerId)}
                          data-testid={`btn-stop-capture-${peerId}`}
                          title="Stop transcribing"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {captureNotice && (
              <div className="calendar-error-banner" role="status" data-testid="transcript-notice-banner">
                <i className="bi bi-info-circle-fill notes-error-icon"></i>
                <span className="notes-error-text">{captureNotice}</span>
              </div>
            )}

            {transcript.length === 0 && !interimSpeech?.text ? (
              <div className="transcript-message">
                <p className="message-text" style={{ color: 'var(--text-muted)' }}>
                  No transcript lines recorded yet. Click <strong>Capture</strong> on a tile or type a meeting statement below.
                </p>
              </div>
            ) : (
              <>
                {transcript.map((item) => (
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
                ))}
                {interimSpeech?.text && (
                  <div className="transcript-message" style={{ opacity: 0.72 }} data-testid="live-interim-speech">
                    <div className="speaker-line">
                      <span className="speaker-name">
                        <i className="bi bi-soundwave" style={{ marginRight: '4px' }}></i>
                        {interimSpeech.speaker || 'You'}
                      </span>
                      <span className="speaker-time">Listening...</span>
                    </div>
                    <p className="message-text">"{interimSpeech.text}"</p>
                  </div>
                )}
              </>
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
