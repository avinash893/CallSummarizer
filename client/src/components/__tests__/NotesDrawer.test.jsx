import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NotesDrawer from '../NotesDrawer';

describe('NotesDrawer Component', () => {
  const sampleTasks = [
    { id: 1, title: 'Review microservice signaling service', assignee: 'Rohan', due: 'Tomorrow', completed: false },
    { id: 2, title: 'Complete frontend usability review', assignee: 'You', due: 'Today', completed: true }
  ];

  const sampleTranscript = [
    { id: 't1', speaker: 'You', time: '10:00 AM', text: 'Welcome to the meeting.' },
    { id: 't2', speaker: 'Rohan Sharma', time: '10:01 AM', text: 'Sounds good, I have the architecture ready.' }
  ];

  it('renders null when isOpen is false', () => {
    const { container } = render(
      <NotesDrawer
        isOpen={false}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders Summary and Action Items when active tab is notes', () => {
    const handleToggle = vi.fn();
    const handleExport = vi.fn();

    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={handleToggle}
        onExportPdf={handleExport}
      />
    );

    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Action Items')).toBeInTheDocument();
    expect(screen.getByText('Review microservice signaling service')).toBeInTheDocument();
    expect(screen.getByText('Complete frontend usability review')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
    fireEvent.click(checkboxes[0]);
    expect(handleToggle).toHaveBeenCalledWith(1);

    const pdfBtn = screen.getByRole('button', { name: /Download PDF Summary/i });
    fireEvent.click(pdfBtn);
    expect(handleExport).toHaveBeenCalledTimes(1);
  });

  it('switches between Notes and Transcript tabs', () => {
    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByText('Rohan Sharma')).toBeInTheDocument();
    expect(screen.getByText(/Sounds good, I have the architecture/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });

  it('triggers onExtractTasks when Extract Tasks button is clicked in Transcript tab', () => {
    const handleExtract = vi.fn();
    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
        onExtractTasks={handleExtract}
        isExtracting={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    const extractBtn = screen.getByRole('button', { name: /Extract Tasks from Transcript/i });
    expect(extractBtn).toBeInTheDocument();
    fireEvent.click(extractBtn);
    expect(handleExtract).toHaveBeenCalledTimes(1);
  });

  it('displays Add to Calendar button and handles approval confirmation to create event', async () => {
    const handleAddToCalendar = vi.fn().mockResolvedValue({ success: true, event: { id: 'evt-1' } });

    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
        onAddToCalendar={handleAddToCalendar}
      />
    );

    const addCalButtons = screen.getAllByRole('button', { name: /Add to Google Calendar/i });
    expect(addCalButtons.length).toBe(2);

    // Click trigger on first task
    fireEvent.click(addCalButtons[0]);

    // Confirmation popover appears
    expect(screen.getByText(/Add to Google Calendar\? \(15m reminder\)/i)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    expect(confirmBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();

    // Confirm adding to calendar
    fireEvent.click(confirmBtn);

    expect(handleAddToCalendar).toHaveBeenCalledWith(sampleTasks[0]);
    expect(await screen.findByText(/In Calendar/i)).toBeInTheDocument();
  });

  it('displays user-facing error feedback when calendar creation fails without crashing', async () => {
    const handleAddToCalendar = vi.fn().mockResolvedValue({
      success: false,
      error: 'Google Calendar API error: User calendar access revoked'
    });

    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
        onAddToCalendar={handleAddToCalendar}
      />
    );

    const addCalButtons = screen.getAllByRole('button', { name: /Add to Google Calendar/i });
    fireEvent.click(addCalButtons[0]);

    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    fireEvent.click(confirmBtn);

    const errorAlert = await screen.findByTestId('calendar-error-alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert).toHaveTextContent(/Google Calendar API error: User calendar access revoked/i);

    // Dismiss error
    const dismissBtn = screen.getByRole('button', { name: /Dismiss error/i });
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('calendar-error-alert')).not.toBeInTheDocument();
  });

  it('prevents multiple in-flight calendar requests on rapid consecutive clicks', async () => {
    let resolvePromise;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    const handleAddToCalendar = vi.fn().mockReturnValue(pendingPromise);

    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
        onAddToCalendar={handleAddToCalendar}
      />
    );

    const addCalButtons = screen.getAllByRole('button', { name: /Add to Google Calendar/i });
    fireEvent.click(addCalButtons[0]);

    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    // Rapid duplicate clicks
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(handleAddToCalendar).toHaveBeenCalledTimes(1);

    // Resolve in-flight request
    resolvePromise({ success: true, event: { id: 'evt-2' } });
    expect(await screen.findByText(/In Calendar/i)).toBeInTheDocument();
  });

  it('handles tasks with id 0 properly without treating them as invalid', async () => {
    const zeroIdTasks = [
      { id: 0, title: 'Zero id action item', assignee: 'Dev', due: 'Tomorrow', completed: false }
    ];
    const handleAddToCalendar = vi.fn().mockResolvedValue({ success: true, event: { id: 'cal-zero-1' } });

    render(
      <NotesDrawer
        isOpen={true}
        tasks={zeroIdTasks}
        transcript={[]}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
        onAddToCalendar={handleAddToCalendar}
      />
    );

    const addBtn = screen.getByRole('button', { name: /Add to Google Calendar/i });
    fireEvent.click(addBtn);

    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    fireEvent.click(confirmBtn);

    expect(handleAddToCalendar).toHaveBeenCalledWith(zeroIdTasks[0]);
    expect(await screen.findByText(/In Calendar/i)).toBeInTheDocument();
  });

  it('disables all add to calendar trigger buttons while an event creation is in-flight', async () => {
    let resolvePromise;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    const handleAddToCalendar = vi.fn().mockReturnValue(pendingPromise);

    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
        onAddToCalendar={handleAddToCalendar}
      />
    );

    const addCalButtons = screen.getAllByRole('button', { name: /Add to Google Calendar/i });
    expect(addCalButtons.length).toBe(2);

    // Trigger on first task
    fireEvent.click(addCalButtons[0]);
    const confirmBtn = screen.getByRole('button', { name: /Confirm/i });
    fireEvent.click(confirmBtn);

    // Second task's add button should now be disabled
    const remainingAddBtns = screen.getAllByRole('button', { name: /Add to Google Calendar/i });
    expect(remainingAddBtns[0]).toBeDisabled();

    // Resolve in-flight request
    resolvePromise({ success: true, event: { id: 'evt-resolved' } });
    expect(await screen.findByText(/In Calendar/i)).toBeInTheDocument();
  });

  it('renders Captured Audio tab and allows stopping active capture and managing clips', () => {
    const handleToggleCapture = vi.fn();
    const handleDeleteClip = vi.fn();
    const handleAddTranscript = vi.fn();

    const sampleClips = [
      {
        id: 'clip-1',
        peerId: 'peer-alice',
        peerName: 'Alice Smith',
        url: 'blob:mock-audio-alice',
        duration: '14s',
        time: '10:05:00 AM'
      }
    ];

    const remotePeers = [
      { peerId: 'peer-alice', name: 'Alice Smith' },
      { peerId: 'peer-bob', name: 'Bob Jones' }
    ];

    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        transcript={sampleTranscript}
        capturedPeerIds={['peer-alice']}
        capturedAudioClips={sampleClips}
        remotePeers={remotePeers}
        onToggleCapturePeer={handleToggleCapture}
        onDeleteClip={handleDeleteClip}
        onAddTranscript={handleAddTranscript}
      />
    );

    // Switch to Captured tab
    const capturedTabBtn = screen.getByTestId('tab-captured-audio');
    expect(capturedTabBtn).toBeInTheDocument();
    fireEvent.click(capturedTabBtn);

    // Verify active capture section
    expect(screen.getByTestId('active-captured-peer-peer-alice')).toBeInTheDocument();
    const stopBtn = screen.getByTestId('btn-stop-capture-peer-alice');
    fireEvent.click(stopBtn);
    expect(handleToggleCapture).toHaveBeenCalledWith('peer-alice');

    // Verify audio clip card
    expect(screen.getByTestId('captured-clip-clip-1')).toBeInTheDocument();
    expect(screen.getByTestId('audio-player-clip-1')).toBeInTheDocument();

    // Verify note creation from clip
    const noteBtn = screen.getByTestId('btn-add-note-clip-1');
    fireEvent.click(noteBtn);
    expect(handleAddTranscript).toHaveBeenCalled();

    // Verify delete clip
    const deleteBtn = screen.getByTestId('btn-delete-clip-clip-1');
    fireEvent.click(deleteBtn);
    expect(handleDeleteClip).toHaveBeenCalledWith('clip-1');
  });

  it('renders close button in drawer top and triggers onClose when clicked', () => {
    const handleClose = vi.fn();
    render(
      <NotesDrawer
        isOpen={true}
        onClose={handleClose}
        tasks={sampleTasks}
        transcript={sampleTranscript}
      />
    );

    const closeBtn = screen.getByTestId('btn-close-drawer');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
