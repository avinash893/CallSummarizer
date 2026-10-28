import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NotesDrawer from '../NotesDrawer';

describe('NotesDrawer Component', () => {
  const sampleTasks = [
    { id: 1, title: 'Review microservice signaling service', assignee: 'Rohan', due: 'Tomorrow', completed: false },
    { id: 2, title: 'Complete frontend usability review', assignee: 'You', due: 'Today', completed: true }
  ];

  it('renders null when isOpen is false', () => {
    const { container } = render(
      <NotesDrawer
        isOpen={false}
        tasks={sampleTasks}
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
        onToggleTask={handleToggle}
        onExportPdf={handleExport}
      />
    );

    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Action Items')).toBeInTheDocument();
    expect(screen.getByText('Review microservice signaling service')).toBeInTheDocument();
    expect(screen.getByText('Complete frontend usability review')).toBeInTheDocument();

    // Checkbox interaction
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
    fireEvent.click(checkboxes[0]);
    expect(handleToggle).toHaveBeenCalledWith(1);

    // Export PDF button
    const pdfBtn = screen.getByRole('button', { name: /Download PDF Summary/i });
    fireEvent.click(pdfBtn);
    expect(handleExport).toHaveBeenCalledTimes(1);
  });

  it('switches between Notes and Transcript tabs', () => {
    render(
      <NotesDrawer
        isOpen={true}
        tasks={sampleTasks}
        onToggleTask={vi.fn()}
        onExportPdf={vi.fn()}
      />
    );

    // Click Transcript tab
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    // Verify transcript conversation appears
    expect(screen.getByText('Rohan Sharma')).toBeInTheDocument();
    expect(screen.getByText(/Sounds good, I have the architecture/i)).toBeInTheDocument();

    // Switch back to Notes tab
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });
});
