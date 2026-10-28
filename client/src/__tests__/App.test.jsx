import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';

describe('App Main Flow', () => {
  beforeEach(() => {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockImplementation(() =>
          Promise.resolve({
            getTracks: () => [{ stop: vi.fn() }],
            getVideoTracks: () => [{ enabled: true, stop: vi.fn() }],
            getAudioTracks: () => [{ enabled: true, stop: vi.fn() }]
          })
        )
      },
      writable: true,
      configurable: true
    });
  });

  it('renders Lobby initially and navigates into active call stage upon join', async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText('Ready to join?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join now/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    expect(screen.getByText('CallSummarizer')).toBeInTheDocument();
    expect(screen.getByText('RS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave call/i })).toBeInTheDocument();
    expect(screen.getByText('Action Items')).toBeInTheDocument();
  });

  it('supports leaving call and returning to lobby', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });
    expect(screen.getByRole('button', { name: /Leave call/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Leave call/i }));
    });
    expect(screen.getByText('Ready to join?')).toBeInTheDocument();
  });

  it('allows toggling tasks in active call', async () => {
    await act(async () => {
      render(<App />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);

    const firstCheckbox = checkboxes[0];
    const initialChecked = firstCheckbox.checked;
    await act(async () => {
      fireEvent.click(firstCheckbox);
    });
    expect(firstCheckbox.checked).toBe(!initialChecked);
  });
});
