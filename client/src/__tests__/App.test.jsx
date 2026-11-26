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

    expect(screen.queryByRole('button', { name: /Leave call/i })).not.toBeInTheDocument();
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

    expect(screen.getByText('SargamJam Studio')).toBeInTheDocument();
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

      expect(screen.queryByRole('button', { name: /Leave call/i })).not.toBeInTheDocument();
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

  it('switches cleanly between Jam Stage and Pitch & Lyrics workspaces without Studio DAW and toggles music controls', async () => {
    render(<App />);

    // Select instrument role in Lobby
    const guitarChip = screen.getByRole('button', { name: 'Guitarist' });
    fireEvent.click(guitarChip);
    expect(guitarChip).toHaveAttribute('aria-pressed', 'true');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    });

    // Musical control strip & local role badge visible on stage
    expect(screen.getByTestId('musical-control-strip')).toBeInTheDocument();
    expect(screen.getByTestId('local-video-tile')).toHaveTextContent('Guitarist');

    // Toggle Tanpura & Beat & Raw Audio without affecting action item checkbox count
    fireEvent.click(screen.getByTestId('btn-toggle-tanpura'));
    expect(screen.getByTestId('btn-toggle-tanpura')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('btn-toggle-metronome'));
    expect(screen.getByTestId('btn-toggle-metronome')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('btn-toggle-raw-audio'));
    expect(screen.getByTestId('btn-toggle-raw-audio')).toHaveAttribute('aria-pressed', 'true');

    // Switch to Pitch & Lyrics tab; Studio DAW tab should be removed and VideoCanvas stays mounted for peer audio
    expect(screen.queryByTestId('tab-studio-daw')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tab-studio-pitch'));
    expect(screen.getByTestId('pitch-lyrics-view')).toBeInTheDocument();
    expect(screen.getByTestId('local-video-tile')).toBeInTheDocument();

    // Return to Stage
    fireEvent.click(screen.getByTestId('tab-studio-stage'));
    expect(screen.getByTestId('local-video-tile')).toBeInTheDocument();
  });

  it('toggles local Capture button for live SpeechRecognition (interim + final) without audio clip storage and extracts NLP tasks + summary', async () => {
    let activeRecInstance = null;
    class MockSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = '';
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        activeRecInstance = this;
      }
      start() {}
      stop() {}
    }
    window.SpeechRecognition = MockSpeechRecognition;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/nlp-tasks/extract-tasks')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              summary: ['Avinash agreed to upload stems tomorrow.'],
              tasks: [{ id: 'nlp-1', title: 'Upload stems', assignee: 'Rohan Sharma', due: 'Tomorrow at 5 PM' }]
            })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    try {
      render(<App />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
      });

      const captureBtn = screen.getByTestId('btn-capture-local');
      expect(captureBtn).toHaveTextContent('Capture');

      // Start local speech capture (must stay active and NOT show any Captured Audio Library tab)
      fireEvent.click(captureBtn);
      expect(captureBtn).toHaveTextContent('Capturing');
      expect(screen.getByTestId('capture-badge-local')).toBeInTheDocument();
      expect(screen.queryByTestId('tab-captured-audio')).not.toBeInTheDocument();

      // Switch to Transcript tab and check interim speech -> final speech
      fireEvent.click(screen.getByRole('button', { name: /^Transcript/i }));
      expect(screen.getByTestId('live-capture-indicator')).toBeInTheDocument();

      await act(async () => {
        const interimItem = [{ transcript: 'I will upload' }];
        interimItem.isFinal = false;
        activeRecInstance.onresult({
          resultIndex: 0,
          results: [interimItem]
        });
      });
      expect(screen.getByTestId('live-interim-speech')).toHaveTextContent(/I will upload/i);

      await act(async () => {
        const finalItem = [{ transcript: 'Rohan will upload the stems tomorrow at 5 pm' }];
        finalItem.isFinal = true;
        activeRecInstance.onresult({
          resultIndex: 0,
          results: [finalItem]
        });
      });

      expect(screen.queryByTestId('live-interim-speech')).not.toBeInTheDocument();
      expect(screen.getByText(/Rohan will upload the stems tomorrow at 5 pm/i)).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Extract Tasks from Transcript/i }));
      });

      // Extracted task for Rohan Sharma must be visible immediately under default 'All' filter!
      fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
      expect(screen.getByText('Upload stems')).toBeInTheDocument();
      expect(screen.getByText('Avinash agreed to upload stems tomorrow.')).toBeInTheDocument();

      // Stop capture cleanly
      fireEvent.click(screen.getByTestId('btn-capture-local'));
      expect(screen.getByTestId('btn-capture-local')).toHaveTextContent('Capture');
      expect(screen.queryByTestId('capture-badge-local')).not.toBeInTheDocument();
    } finally {
      delete window.SpeechRecognition;
      global.fetch = originalFetch;
    }
  });
});
