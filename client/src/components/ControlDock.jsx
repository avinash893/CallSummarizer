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
  onLeaveCall
}) {
  return (
    <div className="bottom-dock">
      {/* Mic button */}
      <button
        className={`dock-icon-btn ${!isAudioOn ? 'muted' : ''}`}
        onClick={toggleAudio}
        title={isAudioOn ? 'Turn off microphone' : 'Turn on microphone'}
      >
        <i className={`bi ${isAudioOn ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`}></i>
      </button>

      {/* Camera button */}
      <button
        className={`dock-icon-btn ${!isVideoOn ? 'muted' : ''}`}
        onClick={toggleVideo}
        title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
      >
        <i className={`bi ${isVideoOn ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`}></i>
      </button>

      {/* Screen share button */}
      <button
        className={`dock-icon-btn ${isScreenSharing ? 'active' : ''}`}
        onClick={toggleScreenShare}
        title={isScreenSharing ? 'Stop presenting' : 'Present screen'}
      >
        <i className="bi bi-display"></i>
      </button>

      {/* Notes button */}
      <button
        className={`dock-icon-btn ${isNotesOpen ? 'active' : ''}`}
        onClick={() => setIsNotesOpen(!isNotesOpen)}
        title="Meeting notes"
      >
        <i className="bi bi-journal-text"></i>
      </button>

      {/* End call button */}
      <button
        className="dock-leave-btn"
        onClick={onLeaveCall}
        title="Leave call"
      >
        <i className="bi bi-telephone-x-fill"></i>
        <span>Leave call</span>
      </button>
    </div>
  );
}
