import React from 'react';

export default function ControlsBar({
  roomName,
  setRoomName,
  isInRoom,
  handleJoinRoom,
  handleLeaveRoom,
  isVideoOn,
  toggleVideo,
  isAudioOn,
  toggleAudio
}) {
  return (
    <div className="controls-bar">
      <div className="room-controls">
        <input
          type="text"
          className="room-input"
          placeholder="Meeting room name"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          disabled={isInRoom}
        />
        <button
          className="btn-primary"
          onClick={handleJoinRoom}
          disabled={isInRoom}
        >
          Join Room
        </button>
        <button
          className="btn-secondary"
          onClick={handleLeaveRoom}
          disabled={!isInRoom}
        >
          Leave
        </button>
      </div>

      <div className="media-controls">
        <button
          className={`btn-outline ${isVideoOn ? 'active-media' : 'muted-media'}`}
          onClick={toggleVideo}
        >
          {isVideoOn ? 'Camera On' : 'Camera Off'}
        </button>
        <button
          className={`btn-outline ${isAudioOn ? 'active-media' : 'muted-media'}`}
          onClick={toggleAudio}
        >
          {isAudioOn ? 'Mic On' : 'Mic Muted'}
        </button>
      </div>
    </div>
  );
}
