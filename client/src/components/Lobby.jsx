import React, { useRef, useEffect } from 'react';

export default function Lobby({
  roomName,
  setRoomName,
  onJoinCall,
  isVideoOn,
  toggleVideo,
  isAudioOn,
  toggleAudio,
  localStream
}) {
  const previewRef = useRef(null);

  useEffect(() => {
    if (previewRef.current) {
      if (localStream && isVideoOn) {
        previewRef.current.srcObject = localStream;
        try {
          const playPromise = previewRef.current.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        } catch (e) {
          // Ignore autoplay restriction or JSDOM stub
        }
      } else {
        previewRef.current.srcObject = null;
      }
    }
  }, [localStream, isVideoOn]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    onJoinCall();
  };

  return (
    <div className="lobby-screen">
      <div className="lobby-box">
        <div>
          <h2 className="lobby-title">Ready to join?</h2>
          <p className="lobby-subtitle">Check your camera and microphone</p>
        </div>

        {/* Camera Preview */}
        <div className="lobby-camera-preview">
          {localStream && isVideoOn ? (
            <video
              ref={previewRef}
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

          <div className="lobby-controls-bar">
            <button
              type="button"
              className={`dock-icon-btn ${!isAudioOn ? 'muted' : ''}`}
              onClick={toggleAudio}
              title={isAudioOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              <i className={`bi ${isAudioOn ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`}></i>
            </button>
            <button
              type="button"
              className={`dock-icon-btn ${!isVideoOn ? 'muted' : ''}`}
              onClick={toggleVideo}
              title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
            >
              <i className={`bi ${isVideoOn ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`}></i>
            </button>
          </div>
        </div>

        {/* Meeting Form */}
        <form onSubmit={handleSubmit} className="lobby-form">
          <input
            type="text"
            className="lobby-input"
            placeholder="Meeting name (e.g. strategy-sync)"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            required
          />

          <button type="submit" className="btn-join" disabled={!roomName.trim()}>
            Join now
          </button>
        </form>
      </div>
    </div>
  );
}
