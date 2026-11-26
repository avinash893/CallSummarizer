import React, { useRef, useEffect, useState } from 'react';

function RemotePeerTile({ peer, isCaptured = false, onToggleCapture, telemetry = null, langMode = 'en' }) {
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const [peerGain, setPeerGain] = useState(1);
  const [isLocalMuted, setIsLocalMuted] = useState(false);

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

  useEffect(() => {
    if (remoteAudioRef.current && peer.stream) {
      remoteAudioRef.current.srcObject = peer.stream;
      try {
        const playPromise = remoteAudioRef.current.play?.();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch (e) {}
    }
  }, [peer.stream]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = isLocalMuted ? 0 : Math.max(0, Math.min(1, peerGain));
      remoteAudioRef.current.muted = isLocalMuted;
    }
  }, [peerGain, isLocalMuted]);

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

  const pitchActive = Boolean(telemetry && telemetry.note);
  const inTune = Boolean(pitchActive && telemetry.inTune);
  const noteBadgeText = pitchActive ? telemetry.note : '';

  return (
    <div
      className={`video-tile ${peer.speaking ? 'speaking' : ''} ${inTune ? 'sur-halo' : ''} ${isCaptured ? 'captured-tile' : ''}`}
      data-testid={`peer-tile-${peer.peerId}`}
    >
      {/* Hidden dedicated audio element to guarantee remote audio playback on mobile browsers */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      {peer.stream && peer.isVideoOn !== false ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="video-element"
          aria-label={`${peer.name || 'Participant'} video stream`}
        />
      ) : (
        <div className="avatar-standby">
          <div className="avatar-circle">{initials}</div>
          <span className="standby-text">{peer.name || 'Participant'}</span>
          {peer.instrument && <span className="tile-role-sub">{peer.instrument}</span>}
        </div>
      )}

      {/* Live Jam Pitch Badge */}
      {pitchActive && (
        <div className={`tile-pitch-badge ${inTune ? 'in-sur' : ''}`}>
          <i className="bi bi-music-note-beamed"></i>
          <span>{noteBadgeText}</span>
          <small>{inTune ? 'IN TUNE' : `${telemetry.cents > 0 ? '+' : ''}${telemetry.cents}c`}</small>
        </div>
      )}

      {/* Private Audio Capture indicator badge on top-left if active */}
      {isCaptured && (
        <div
          className="tile-capture-badge"
          title="Private audio capture active (listening privately)"
          data-testid={`capture-badge-${peer.peerId}`}
        >
          <i className="bi bi-disc-fill pulse-record-dot"></i>
          <span>Listening Privately</span>
        </div>
      )}

      {/* Selective Audio Capture Button on top-right */}
      <button
        type="button"
        className={`btn btn-sm tile-capture-btn ${isCaptured ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (onToggleCapture) onToggleCapture(peer.peerId);
        }}
        title={
          isCaptured
            ? `Stop capturing audio from ${peer.name || 'participant'}`
            : `Capture audio from ${peer.name || 'participant'} privately`
        }
        aria-label={
          isCaptured
            ? `Stop capturing ${peer.name || 'participant'}`
            : `Capture audio from ${peer.name || 'participant'}`
        }
        data-testid={`btn-capture-${peer.peerId}`}
      >
        <i className={`bi ${isCaptured ? 'bi-record-circle-fill' : 'bi-soundwave'}`}></i>
        <span>{isCaptured ? 'Capturing' : 'Capture'}</span>
      </button>

      <div className="tile-footer">
        <span className="user-name-tag">
          {peer.name || 'Participant'}
          {peer.instrument && <span className="tile-inst-chip">{peer.instrument}</span>}
          {peer.speaking && (
            <i
              className="bi bi-circle-fill"
              style={{ fontSize: '0.45rem', color: 'var(--accent-primary)', marginLeft: '4px' }}
              title="Playing / Speaking"
            ></i>
          )}
        </span>

        {/* Per-Musician Mix Gain Control */}
        <div className="tile-peer-mixer" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`tile-peer-mute ${isLocalMuted ? 'muted' : ''}`}
            onClick={() => setIsLocalMuted(!isLocalMuted)}
            title={isLocalMuted ? 'Unmute musician locally' : 'Mute musician locally'}
          >
            <i className={`bi ${isLocalMuted ? 'bi-volume-mute-fill' : 'bi-volume-up-fill'}`}></i>
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isLocalMuted ? 0 : peerGain}
            onChange={(e) => {
              setIsLocalMuted(false);
              setPeerGain(Number(e.target.value));
            }}
            className="tile-peer-gain"
            aria-label={`Mix volume for ${peer.name || 'participant'}`}
          />
        </div>
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
  localUser = { name: 'You', initials: 'You', instrument: 'Vocalist' },
  remotePeers = [],
  capturedPeerIds = [],
  onToggleCapturePeer,
  localPitchInfo = null,
  peerTelemetry = {},
  langMode = 'en',
  isRawAudio = false
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

  const localInTune = Boolean(localPitchInfo && localPitchInfo.inTune);
  const localNoteText = localPitchInfo ? localPitchInfo.noteName : '';

  return (
    <div className="video-canvas">
      <div className={`video-grid-container ${countClass}`}>
        {/* Local Participant Video Tile */}
        <div
          className={`video-tile ${isSingleParticipant ? 'solo-tile' : ''} ${localInTune ? 'sur-halo' : ''} ${capturedPeerIds.includes('local') ? 'captured-tile' : ''}`}
          data-testid="local-video-tile"
        >
          {showLocalVideo ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video-element"
              aria-label={isScreenSharing ? 'Your screen share preview' : 'Your video preview'}
            />
          ) : (
            <div className="avatar-standby">
              <div className="avatar-circle host">{displayInitials}</div>
              <span className="standby-text">
                {isVideoOn ? 'Camera on' : 'Camera off'}
              </span>
              {localUser?.instrument && <span className="tile-role-sub">{localUser.instrument}</span>}
            </div>
          )}

          {/* Local Live Jam Pitch Badge */}
          {localPitchInfo && (
            <div className={`tile-pitch-badge ${localInTune ? 'in-sur' : ''}`}>
              <i className="bi bi-music-note-beamed"></i>
              <span>{localNoteText}</span>
              <small>{localInTune ? 'IN TUNE' : `${localPitchInfo.cents > 0 ? '+' : ''}${localPitchInfo.cents}c`}</small>
            </div>
          )}

          {isRawAudio && (
            <div className="tile-raw-badge" title="Raw Instrument/Vocal mode enabled">
              <i className="bi bi-stars"></i>
              <span>Raw Audio</span>
            </div>
          )}

          {/* Local Speech Capture indicator */}
          {capturedPeerIds.includes('local') && (
            <div
              className="tile-capture-badge"
              title="Speech recognition active"
              data-testid="capture-badge-local"
            >
              <i className="bi bi-disc-fill pulse-record-dot"></i>
              <span>Recognizing Speech</span>
            </div>
          )}

          {/* Selective Speech Capture Toggle on Local Tile */}
          <button
            type="button"
            className={`btn btn-sm tile-capture-btn ${capturedPeerIds.includes('local') ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (onToggleCapturePeer) onToggleCapturePeer('local');
            }}
            title={
              capturedPeerIds.includes('local')
                ? 'Stop recognizing your speech'
                : 'Recognize your speech into transcript'
            }
            aria-label={
              capturedPeerIds.includes('local')
                ? 'Stop recognizing your speech'
                : 'Recognize your speech'
            }
            data-testid="btn-capture-local"
          >
            <i className={`bi ${capturedPeerIds.includes('local') ? 'bi-record-circle-fill' : 'bi-soundwave'}`}></i>
            <span>{capturedPeerIds.includes('local') ? 'Capturing' : 'Capture'}</span>
          </button>

          <div className="tile-footer">
            <span className="user-name-tag">
              {displayName}
              {localUser?.instrument && <span className="tile-inst-chip">{localUser.instrument}</span>}
            </span>
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
          <RemotePeerTile
            key={peer.peerId}
            peer={peer}
            isCaptured={Array.isArray(capturedPeerIds) && capturedPeerIds.includes(peer.peerId)}
            onToggleCapture={onToggleCapturePeer}
            telemetry={peerTelemetry[peer.peerId] || null}
            langMode={langMode}
          />
        ))}
      </div>
    </div>
  );
}
