import React, { useState } from 'react';

export default function NotesDrawer({
  isOpen,
  tasks = [],
  transcript = [],
  onToggleTask,
  onAddTask,
  onAddTranscript,
  onExportPdf,
  onExtractTasks,
  isExtracting = false,
  onAddToCalendar
}) {
  const [activeTab, setActiveTab] = useState('notes');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTranscriptText, setNewTranscriptText] = useState('');
  const [confirmingTaskId, setConfirmingTaskId] = useState(null);
  const [calendarLoadingId, setCalendarLoadingId] = useState(null);
  const [calendarSuccessIds, setCalendarSuccessIds] = useState([]);
  const [calendarError, setCalendarError] = useState(null);

  if (!isOpen) return null;

  const handleRequestAddToCalendar = (task) => {
    if (!task || task.id === undefined || task.id === null) return;
    if (calendarLoadingId !== null || calendarSuccessIds.includes(task.id) || task.calendarAdded) {
      return;
    }
    setCalendarError(null);
    setConfirmingTaskId(task.id);
  };

  const handleConfirmAddToCalendar = async (task) => {
    if (!task || task.id === undefined || task.id === null) return;
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
        <div className="drawer-tabs nav nav-tabs" role="tablist">
          <button
            type="button"
            className={`nav-link drawer-tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => setActiveTab('notes')}
          >
            <i className="bi bi-card-checklist" style={{ marginRight: '6px' }}></i>
            <span>Notes</span>
          </button>
          <button
            type="button"
            className={`nav-link drawer-tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
          >
            <i className="bi bi-chat-left-text" style={{ marginRight: '6px' }}></i>
            <span>Transcript</span>
          </button>
        </div>
      </div>

      <div className="drawer-body">
        {activeTab === 'notes' ? (
          <>
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
              <div className="notes-card-title">
                <i className="bi bi-check2-square" style={{ marginRight: '6px' }}></i>
                <span>Action Items</span>
              </div>

              {onAddTask && (
                <form onSubmit={handleTaskSubmit} className="input-group input-group-sm">
                  <input
                    type="text"
                    className="form-control lobby-input"
                    style={{ flex: 1, padding: '7px 10px', fontSize: '0.8rem' }}
                    placeholder="Add action item..."
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
                {tasks.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    No action items yet. Add one above or extract from transcript.
                  </p>
                ) : (
                  tasks.map((task) => (
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

                      <div className="task-calendar-controls">
                        {task.calendarAdded || calendarSuccessIds.includes(task.id) ? (
                          <span className="calendar-badge-success" title="Added to Google Calendar with 15-minute popup alarm reminder">
                            <i className="bi bi-calendar-check-fill" style={{ marginRight: '4px' }}></i>
                            In Calendar
                          </span>
                        ) : confirmingTaskId === task.id ? (
                          <div className="calendar-confirm-box" role="dialog" aria-label="Confirm adding event to Google Calendar">
                            <span className="calendar-confirm-prompt">
                              <i className="bi bi-bell-fill" style={{ marginRight: '4px' }}></i>
                              Add to Google Calendar? (15m reminder)
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
          </>
        ) : (
          <div className="transcript-box">
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
