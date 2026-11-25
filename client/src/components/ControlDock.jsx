import React from 'react';

export default function ControlDock({
  isAudioOn,
  toggleAudio,
  isVideoOn,
  toggleVideo,
  isScreenSharing,
  toggleScreenShare,
  isNotesOpen,
  setIsNotesOpen,
  onLeaveCall,
  isTanpuraOn = false,
  onToggleTanpura = null,
  isMetronomeOn = false,
  onToggleMetronome = null
}) {
  return (
    <div className="bottom-dock">
      <div className="btn-group btn-group-sm" role="group" aria-label="Media controls">
        {/* Mic button */}
        <button
          type="button"
          className={`btn btn-outline-secondary dock-icon-btn ${!isAudioOn ? 'muted' : ''}`}
          onClick={toggleAudio}
          title={isAudioOn ? 'Turn off microphone' : 'Turn on microphone'}
        >
          <i className={`bi ${isAudioOn ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`}></i>
        </button>

        {/* Camera button */}
        <button
          type="button"
          className={`btn btn-outline-secondary dock-icon-btn ${!isVideoOn ? 'muted' : ''}`}
          onClick={toggleVideo}
          title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
        >
          <i className={`bi ${isVideoOn ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`}></i>
        </button>

        {/* Screen share button */}
        <button
          type="button"
          className={`btn btn-outline-secondary dock-icon-btn ${isScreenSharing ? 'active' : ''}`}
          onClick={toggleScreenShare}
          title={isScreenSharing ? 'Stop presenting' : 'Present screen'}
        >
          <i className="bi bi-display"></i>
        </button>

        {onToggleTanpura && (
          <button
            type="button"
            className={`btn btn-outline-secondary dock-icon-btn dock-tanpura-btn ${isTanpuraOn ? 'active' : ''}`}
            onClick={onToggleTanpura}
            title={isTanpuraOn ? 'Stop Tanpura drone' : 'Start Tanpura drone'}
            aria-label="Toggle Tanpura drone"
          >
            <i className="bi bi-vinyl-fill"></i>
          </button>
        )}

        {onToggleMetronome && (
          <button
            type="button"
            className={`btn btn-outline-secondary dock-icon-btn dock-beat-btn ${isMetronomeOn ? 'active' : ''}`}
            onClick={onToggleMetronome}
            title={isMetronomeOn ? 'Stop Taal rhythm' : 'Start Taal rhythm'}
            aria-label="Toggle Taal rhythm"
          >
            <i className="bi bi-disc"></i>
          </button>
        )}

        {/* Notes, Transcript & Actions button */}
        <button
          type="button"
          className={`btn btn-outline-secondary dock-icon-btn ${isNotesOpen ? 'active' : ''}`}
          onClick={() => setIsNotesOpen(!isNotesOpen)}
          title="Meeting notes"
          aria-label="Toggle transcript, notes and action items"
          data-testid="dock-btn-notes"
        >
          <i className="bi bi-journal-text"></i>
        </button>
      </div>

      {/* End call button */}
      <button
        type="button"
        className="btn dock-leave-btn"
        onClick={onLeaveCall}
        title="Leave call"
        aria-label="Leave call"
      >
        <i className="bi bi-telephone-x-fill"></i>
        <span className="leave-text">Leave call</span>
      </button>
    </div>
  );
}
