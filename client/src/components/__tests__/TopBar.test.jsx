import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TopBar from '../TopBar';

describe('TopBar Component', () => {
  it('renders brand name, room chip, call duration, and navigation buttons', () => {
    const handleCopy = vi.fn();
    const handleOpenArch = vi.fn();
    const handleSetNotes = vi.fn();

    render(
      <TopBar
        roomName="strategy-sync"
        callDuration="04:15"
        isNotesOpen={true}
        setIsNotesOpen={handleSetNotes}
        onOpenArchModal={handleOpenArch}
        onCopyRoom={handleCopy}
      />
    );

    expect(screen.getByText('CallSummarizer')).toBeInTheDocument();
    expect(screen.getByText('strategy-sync')).toBeInTheDocument();
    expect(screen.getByText('04:15')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('Close Notes')).toBeInTheDocument();
  });

  it('triggers copy callback when room chip is clicked', () => {
    const handleCopy = vi.fn();

    render(
      <TopBar
        roomName="strategy-sync"
        callDuration="00:10"
        isNotesOpen={true}
        setIsNotesOpen={vi.fn()}
        onOpenArchModal={vi.fn()}
        onCopyRoom={handleCopy}
      />
    );

    fireEvent.click(screen.getByTitle('Copy meeting link'));
    expect(handleCopy).toHaveBeenCalledTimes(1);
  });

  it('toggles notes and opens services modal on respective button clicks', () => {
    const handleOpenArch = vi.fn();
    const handleSetNotes = vi.fn();

    render(
      <TopBar
        roomName="strategy-sync"
        callDuration="01:30"
        isNotesOpen={false}
        setIsNotesOpen={handleSetNotes}
        onOpenArchModal={handleOpenArch}
        onCopyRoom={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('View Services Status'));
    expect(handleOpenArch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Toggle Meeting Notes'));
    expect(handleSetNotes).toHaveBeenCalledWith(true);
  });
});
