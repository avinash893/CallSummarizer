import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';

const authUser = {
  name: 'Avinash Kumar',
  email: 'avinash@gmail.com',
  initials: 'AK',
  sessionId: 'test-session-123'
};

let store = {};

describe('App Main Flow', () => {
  beforeEach(() => {
    store = {
      cs_google_user: JSON.stringify(authUser)
    };

    const mockStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, val) => {
        store[key] = String(val);
      }),
      removeItem: vi.fn((key) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      })
    };

    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true
    });

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

  it('blocks unauthenticated user from joining call and displays sign-in prompt', async () => {
    store = {}; // unauthenticated user
    render(<App />);

    expect(screen.getByText('Ready to join?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join now/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    expect(screen.queryByText('CallSummarizer')).not.toBeInTheDocument();
    expect(screen.getByTestId('lobby-auth-error')).toHaveTextContent(/Sign in with Google is required to join a meeting/i);
    expect(screen.getByTestId('google-signin-form')).toBeInTheDocument();
  });

  it('renders Lobby initially and navigates into active call stage showing only the single joined user', async () => {
    const { container } = render(<App />);

    expect(screen.getByText('Ready to join?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join now/i })).toBeInTheDocument();

    // Allow Turnstile fallback to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    expect(screen.getByText('CallSummarizer')).toBeInTheDocument();
    // Only 1 video tile when only 1 person has joined (no fake demo tile)
    expect(container.querySelectorAll('.video-tile').length).toBe(1);
    expect(screen.queryByText('RS')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave call/i })).toBeInTheDocument();
    expect(screen.getByText('Action Items')).toBeInTheDocument();
  });

  it('supports leaving call and returning to lobby', async () => {
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
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

  it('allows adding and toggling tasks independently without checking other tasks', async () => {
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    const addInput = screen.getByPlaceholderText(/Add action item/i);
    await act(async () => {
      fireEvent.change(addInput, { target: { value: 'Finalize deployment checklist' } });
      fireEvent.submit(addInput.closest('form'));
    });

    await act(async () => {
      fireEvent.change(addInput, { target: { value: 'Schedule security review' } });
      fireEvent.submit(addInput.closest('form'));
    });

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);

    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(false);

    await act(async () => {
      fireEvent.click(checkboxes[0]);
    });
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });

  it('resets stale user state when server session check returns 401 on startup', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (String(url).includes('/api/auth/session')) {
        return Promise.resolve({
          status: 401,
          ok: false,
          json: () => Promise.resolve({ authenticated: false, error: 'Session expired' })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    // Stale local user should have been cleared, so clicking Join now prompts for sign-in
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    expect(screen.getByTestId('lobby-auth-error')).toHaveTextContent(/Sign in with Google is required to join a meeting/i);
    fetchSpy.mockRestore();
  });

  it('blocks joining call if Turnstile is not verified even if user is signed in', async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        render(<App />);
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
      });

      expect(screen.queryByText('CallSummarizer')).not.toBeInTheDocument();
      expect(screen.getByTestId('lobby-auth-error')).toHaveTextContent(/Cloudflare Turnstile verification required/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes Notes and Transcript tabs in NotesDrawer during active call without fake tasks', async () => {
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    // Notes tab is visible with Action Items
    expect(screen.getByText('Action Items')).toBeInTheDocument();
    // No demo tasks
    expect(screen.queryByText('Review frontend responsiveness')).not.toBeInTheDocument();
    expect(screen.queryByText('Connect signaling service')).not.toBeInTheDocument();

    // Transcript tab is accessible
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));
    expect(screen.getByText(/No transcript lines recorded yet/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type a meeting note or commitment/i)).toBeInTheDocument();
  });
});
