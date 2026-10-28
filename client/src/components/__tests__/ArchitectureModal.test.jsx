import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ArchitectureModal from '../ArchitectureModal';

describe('ArchitectureModal Component', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ArchitectureModal isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders microservices breakdown when open and triggers onClose', () => {
    const handleClose = vi.fn();
    render(<ArchitectureModal isOpen={true} onClose={handleClose} />);

    expect(screen.getByText('Services Architecture & Status')).toBeInTheDocument();
    expect(screen.getByText('React Client')).toBeInTheDocument();
    expect(screen.getByText('API Gateway')).toBeInTheDocument();
    expect(screen.getByText('Signaling Service')).toBeInTheDocument();
    expect(screen.getByText('NLP Task Service')).toBeInTheDocument();
    expect(screen.getByText('Meeting Service')).toBeInTheDocument();
    expect(screen.getByText('MongoDB Database')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
