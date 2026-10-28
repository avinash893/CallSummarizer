import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Lobby from '../Lobby';

describe('Lobby Component', () => {
  it('renders pre-join title, input, and join button', () => {
    const handleJoin = vi.fn();
    const handleSetRoom = vi.fn();
    const handleToggleAudio = vi.fn();
    const handleToggleVideo = vi.fn();

    render(
      <Lobby
        roomName="strategy-sync"
        setRoomName={handleSetRoom}
        onJoinCall={handleJoin}
        isVideoOn={true}
        toggleVideo={handleToggleVideo}
        isAudioOn={true}
        toggleAudio={handleToggleAudio}
        localStream={null}
      />
    );

    expect(screen.getByText('Ready to join?')).toBeInTheDocument();
    expect(screen.getByText('Check your camera and microphone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join now/i })).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Meeting name/i);
    expect(input).toHaveValue('strategy-sync');
  });

  it('triggers onJoinCall when form is submitted with valid room name', () => {
    const handleJoin = vi.fn();

    render(
      <Lobby
        roomName="team-standup"
        setRoomName={vi.fn()}
        onJoinCall={handleJoin}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    expect(handleJoin).toHaveBeenCalledTimes(1);
  });

  it('toggles audio and video via control buttons', () => {
    const handleToggleAudio = vi.fn();
    const handleToggleVideo = vi.fn();

    render(
      <Lobby
        roomName="dev-room"
        setRoomName={vi.fn()}
        onJoinCall={vi.fn()}
        isVideoOn={true}
        toggleVideo={handleToggleVideo}
        isAudioOn={true}
        toggleAudio={handleToggleAudio}
        localStream={null}
      />
    );

    const muteBtn = screen.getByTitle('Mute microphone');
    fireEvent.click(muteBtn);
    expect(handleToggleAudio).toHaveBeenCalledTimes(1);

    const camBtn = screen.getByTitle('Turn off camera');
    fireEvent.click(camBtn);
    expect(handleToggleVideo).toHaveBeenCalledTimes(1);
  });
});
