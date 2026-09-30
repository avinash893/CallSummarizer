import React, { useRef, useEffect } from 'react';

export default function VideoStage({
  isVideoOn,
  isInRoom,
  localStream
}) {
  const localVideoRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = isVideoOn ? localStream : null;
    }
  }, [localStream, isVideoOn]);

  return (
    <div className="video-section">
      <div className="video-grid">
        {/* Local Video Card */}
        <div className="video-card">
          <div className="video-card-topbar">
            <span className="user-tag">You (Host)</span>
            <span className={`live-indicator ${isVideoOn ? 'active' : ''}`}>
              {isVideoOn ? (localStream ? 'Camera live' : 'Camera active') : 'Camera off'}
            </span>
          </div>
          <div className="video-view">
            {localStream && isVideoOn ? (
              <video ref={localVideoRef} autoPlay muted playsInline />
            ) : (
              <div className="video-standby">
                <div className="avatar-circle">You</div>
                <span>{isVideoOn ? 'Camera Standby' : 'Camera Muted'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Remote Participant Card */}
        <div className="video-card">
          <div className="video-card-topbar">
            <span className="user-tag">{isInRoom ? 'Alex Miller' : 'Guest'}</span>
            <span className={`live-indicator ${isInRoom ? 'active' : ''}`}>
              {isInRoom ? 'Connected' : 'Waiting for participant...'}
            </span>
          </div>
          <div className="video-view">
            <div className="video-standby">
              <div className="avatar-circle" style={{ background: '#1e293b', color: '#94a3b8' }}>
                {isInRoom ? 'AM' : '—'}
              </div>
              <span>
                {isInRoom ? 'Alex Miller (Remote)' : 'Waiting for someone to join...'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
