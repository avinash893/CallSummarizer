import React, { useRef, useEffect } from 'react';

export default function VideoCanvas({
  isVideoOn,
  isAudioOn,
  localStream,
  remoteSpeaking
}) {
  const localVideoRef = useRef(null);

  useEffect(() => {
    if (localVideoRef.current) {
      if (localStream && isVideoOn) {
        localVideoRef.current.srcObject = localStream;
        try {
          const playPromise = localVideoRef.current.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        } catch (e) {
          // Ignore autoplay restriction or JSDOM stub
        }
      } else {
        localVideoRef.current.srcObject = null;
      }
    }
  }, [localStream, isVideoOn]);

  return (
    <div className="video-canvas">
      <div className="video-flex-container">
        {/* Local Video Tile */}
        <div className="video-tile">
          {localStream && isVideoOn ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video-element"
            />
          ) : (
            <div className="avatar-standby">
              <div className="avatar-circle host">You</div>
              <span className="standby-text">
                {isVideoOn ? 'Camera on' : 'Camera off'}
              </span>
            </div>
          )}

          <div className="tile-footer">
            <span className="user-name-tag">You</span>
          </div>

          <div
            className={`tile-mic-tag ${!isAudioOn ? 'muted' : ''}`}
            title={isAudioOn ? 'Microphone active' : 'Microphone muted'}
          >
            <i className={`bi ${isAudioOn ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`}></i>
          </div>
        </div>

        {/* Remote Video Tile (Rohan Sharma) */}
        <div className={`video-tile ${remoteSpeaking ? 'speaking' : ''}`}>
          <div className="avatar-standby">
            <div className="avatar-circle">RS</div>
            <span className="standby-text">Rohan Sharma</span>
          </div>

          <div className="tile-footer">
            <span className="user-name-tag">
              Rohan Sharma {remoteSpeaking && <span style={{ color: '#5c93e6' }}>●</span>}
            </span>
          </div>

          <div className="tile-mic-tag" title="Microphone active">
            <i className="bi bi-mic-fill"></i>
          </div>
        </div>
      </div>
    </div>
  );
}
