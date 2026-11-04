import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import VideoCanvas from '../VideoCanvas';

describe('VideoCanvas Component', () => {
  it('renders ONLY the single local participant tile when no remote peers have joined', () => {
    const { container } = render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remotePeers={[]}
      />
    );

    const tiles = container.querySelectorAll('.video-tile');
    expect(tiles.length).toBe(1);
    expect(screen.getByText('You', { selector: '.avatar-circle' })).toBeInTheDocument();
    expect(screen.getByText('You', { selector: '.user-name-tag' })).toBeInTheDocument();
    expect(screen.queryByText(/Rohan Sharma/i)).not.toBeInTheDocument();
  });

  it('renders remote participant tiles dynamically when real peers join the meeting', () => {
    const remotePeers = [
      { peerId: 'peer-1', name: 'Rohan Sharma', initials: 'RS', isAudioOn: true, isVideoOn: false, speaking: true }
    ];

    const { container } = render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remotePeers={remotePeers}
      />
    );

    const tiles = container.querySelectorAll('.video-tile');
    expect(tiles.length).toBe(2);
    expect(screen.getByText('RS')).toBeInTheDocument();
    expect(screen.getByText('Rohan Sharma', { selector: '.standby-text' })).toBeInTheDocument();

    const speakingTile = container.querySelector('.video-tile.speaking');
    expect(speakingTile).toBeInTheDocument();
  });

  it('displays microphone mute status when audio is off', () => {
    render(
      <VideoCanvas
        isVideoOn={false}
        isAudioOn={false}
        localStream={null}
        remotePeers={[]}
      />
    );

    const mutedBadge = screen.getByTitle('Microphone muted');
    expect(mutedBadge).toBeInTheDocument();
    expect(mutedBadge).toHaveClass('muted');
  });

  it('renders selective capture button for remote peers and triggers toggle callback', () => {
    let capturedId = null;
    const remotePeers = [
      { peerId: 'peer-alice', name: 'Alice Smith', initials: 'AS', isAudioOn: true }
    ];

    render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remotePeers={remotePeers}
        capturedPeerIds={[]}
        onToggleCapturePeer={(id) => {
          capturedId = id;
        }}
      />
    );

    const captureBtn = screen.getByTestId('btn-capture-peer-alice');
    expect(captureBtn).toBeInTheDocument();
    expect(captureBtn).toHaveTextContent(/Capture/i);

    captureBtn.click();
    expect(capturedId).toBe('peer-alice');
  });

  it('displays private listening badge and active state when peer audio is being captured', () => {
    const remotePeers = [
      { peerId: 'peer-bob', name: 'Bob Jones', initials: 'BJ', isAudioOn: true }
    ];

    render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remotePeers={remotePeers}
        capturedPeerIds={['peer-bob']}
      />
    );

    const badge = screen.getByTestId('capture-badge-peer-bob');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/Listening Privately/i);

    const captureBtn = screen.getByTestId('btn-capture-peer-bob');
    expect(captureBtn).toHaveClass('active');
    expect(captureBtn).toHaveTextContent(/Capturing/i);
  });

  it('renders capture button on local participant tile and triggers toggle callback with local', () => {
    let capturedId = null;
    render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remotePeers={[]}
        capturedPeerIds={[]}
        onToggleCapturePeer={(id) => {
          capturedId = id;
        }}
      />
    );

    const localCaptureBtn = screen.getByTestId('btn-capture-local');
    expect(localCaptureBtn).toBeInTheDocument();
    localCaptureBtn.click();
    expect(capturedId).toBe('local');
  });

  it('renders dedicated hidden audio element for remote peers for continuous mobile audio', () => {
    const remotePeers = [
      { peerId: 'peer-cathy', name: 'Cathy Lee', initials: 'CL', isAudioOn: true, isVideoOn: false }
    ];

    const { container } = render(
      <VideoCanvas
        isVideoOn={true}
        isAudioOn={true}
        localStream={null}
        remotePeers={remotePeers}
      />
    );

    const audioEl = container.querySelector('audio');
    expect(audioEl).toBeInTheDocument();
    expect(audioEl).toHaveAttribute('playsinline');
  });
});
