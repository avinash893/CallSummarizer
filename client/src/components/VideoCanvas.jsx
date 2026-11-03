import React, { useRef, useEffect } from 'react';

function RemotePeerTile({ peer }) {
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (remoteVideoRef.current) {
      if (peer.stream && peer.isVideoOn !== false) {
        remoteVideoRef.current.srcObject = peer.stream;
        try {
          const playPromise = remoteVideoRef.current.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        } catch (e) {}
      } else {
        remoteVideoRef.current.srcObject = null;
      }
    }
  }, [peer.stream, peer.isVideoOn]);

  const initials =
    peer.initials ||
    (peer.name
      ? peer.name
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : 'P');

  return (
    <div className={`video-tile ${peer.speaking ? 'speaking' : ''}`} data-testid={`peer-tile-${peer.peerId}`}>
      {peer.stream && peer.isVideoOn !== false ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="video-element"
        />
      ) : (
        <div className="avatar-standby">
          <div className="avatar-circle">{initials}</div>
          <span className="standby-text">{peer.name || 'Participant'}</span>
        </div>
      )}

      <div className="tile-footer">
        <span className="user-name-tag">
          {peer.name || 'Participant'}
          {peer.speaking && (
            <i
              className="bi bi-circle-fill"
              style={{ fontSize: '0.45rem', color: '#5c93e6', marginLeft: '4px' }}
              title="Speaking"
            ></i>
          )}
        </span>
      </div>

      <div
        className={`tile-mic-tag ${peer.isAudioOn === false ? 'muted' : ''}`}
        title={peer.isAudioOn === false ? 'Microphone muted' : 'Microphone active'}
      >
        <i className={`bi ${peer.isAudioOn === false ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
      </div>
    </div>
  );
}

export default function VideoCanvas({
  isVideoOn,
  isAudioOn,
  localStream,
  screenStream = null,
  isScreenSharing = false,
  localUser = { name: 'You', initials: 'You' },
  remotePeers = []
}) {
  const localVideoRef = useRef(null);
  const activeLocalStream = isScreenSharing && screenStream ? screenStream : localStream;
  const showLocalVideo = Boolean(activeLocalStream && (isVideoOn || isScreenSharing));

  useEffect(() => {
    if (localVideoRef.current) {
      if (showLocalVideo) {
        localVideoRef.current.srcObject = activeLocalStream;
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
  }, [activeLocalStream, showLocalVideo]);

  const isSingleParticipant = remotePeers.length === 0;
  const displayName = localUser?.name && localUser.name !== 'You' ? `${localUser.name} (You)` : 'You';
  const displayInitials =
    localUser?.name && localUser.name !== 'You'
      ? localUser.initials || localUser.name.slice(0, 2).toUpperCase()
      : 'You';

  const totalParticipants = 1 + remotePeers.length;
  const countClass = totalParticipants <= 6 ? `count-${totalParticipants}` : 'count-many';

  return (
    <div className="video-canvas">
      <div className={`video-grid-container ${countClass}`}>
        {/* Local Participant Video Tile */}
        <div className={`video-tile ${isSingleParticipant ? 'solo-tile' : ''}`} data-testid="local-video-tile">
          {showLocalVideo ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video-element"
            />
          ) : (
            <div className="avatar-standby">
              <div className="avatar-circle host">{displayInitials}</div>
              <span className="standby-text">
                {isVideoOn ? 'Camera on' : 'Camera off'}
              </span>
            </div>
          )}

          <div className="tile-footer">
            <span className="user-name-tag">{displayName}</span>
          </div>

          <div
            className={`tile-mic-tag ${!isAudioOn ? 'muted' : ''}`}
            title={isAudioOn ? 'Microphone active' : 'Microphone muted'}
          >
            <i className={`bi ${isAudioOn ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`}></i>
          </div>
        </div>

        {/* Remote Participant Video Tiles (Rendered ONLY when real participants join) */}
        {remotePeers.map((peer) => (
          <RemotePeerTile key={peer.peerId} peer={peer} />
        ))}
      </div>
    </div>
  );
}
