import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import VideoCanvas from '../VideoCanvas';

describe('VideoCanvas Component', () => {
  it('renders local participant tile and remote participant tile with Rohan Sharma', () => {
    render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remoteSpeaking={false}
      />
    );

    // Host indicators
    expect(screen.getByText('You', { selector: '.avatar-circle' })).toBeInTheDocument();
    expect(screen.getByText('You', { selector: '.user-name-tag' })).toBeInTheDocument();

    // Remote participant indicators (Rohan Sharma)
    expect(screen.getByText('RS')).toBeInTheDocument();
    expect(screen.getByText(/Rohan Sharma/i, { selector: '.standby-text' })).toBeInTheDocument();
  });

  it('displays microphone mute status when audio is off', () => {
    render(
      <VideoCanvas
        isVideoOn={false}
        isAudioOn={false}
        localStream={null}
        remoteSpeaking={false}
      />
    );

    const mutedBadge = screen.getByTitle('Microphone muted');
    expect(mutedBadge).toBeInTheDocument();
    expect(mutedBadge).toHaveClass('muted');
  });

  it('indicates speaking state when remote participant speaks', () => {
    const { container } = render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remoteSpeaking={true}
      />
    );

    const speakingTile = container.querySelector('.video-tile.speaking');
    expect(speakingTile).toBeInTheDocument();
  });
});
