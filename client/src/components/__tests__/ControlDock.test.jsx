import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ControlDock from '../ControlDock';

describe('ControlDock Component', () => {
  it('renders all control actions with appropriate icons', () => {
    render(
      <ControlDock
        isAudioOn={true}
        toggleAudio={vi.fn()}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isScreenSharing={false}
        toggleScreenShare={vi.fn()}
        isNotesOpen={true}
        setIsNotesOpen={vi.fn()}
        onLeaveCall={vi.fn()}
      />
    );

    expect(screen.getByTitle('Turn off microphone')).toBeInTheDocument();
    expect(screen.getByTitle('Turn off camera')).toBeInTheDocument();
    expect(screen.getByTitle('Present screen')).toBeInTheDocument();
    expect(screen.getByTitle('Meeting notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave call/i })).toBeInTheDocument();
  });

  it('handles microphone, video, and screen share toggles', () => {
    const handleToggleAudio = vi.fn();
    const handleToggleVideo = vi.fn();
    const handleToggleScreen = vi.fn();

    render(
      <ControlDock
        isAudioOn={false}
        toggleAudio={handleToggleAudio}
        isVideoOn={false}
        toggleVideo={handleToggleVideo}
        isScreenSharing={true}
        toggleScreenShare={handleToggleScreen}
        isNotesOpen={false}
        setIsNotesOpen={vi.fn()}
        onLeaveCall={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('Turn on microphone'));
    expect(handleToggleAudio).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Turn on camera'));
    expect(handleToggleVideo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Stop presenting'));
    expect(handleToggleScreen).toHaveBeenCalledTimes(1);
  });

  it('triggers leave call when the Leave call button is clicked', () => {
    const handleLeave = vi.fn();

    render(
      <ControlDock
        isAudioOn={true}
        toggleAudio={vi.fn()}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isScreenSharing={false}
        toggleScreenShare={vi.fn()}
        isNotesOpen={true}
        setIsNotesOpen={vi.fn()}
        onLeaveCall={handleLeave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Leave call/i }));
    expect(handleLeave).toHaveBeenCalledTimes(1);
  });
});
