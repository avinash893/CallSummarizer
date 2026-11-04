import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Lobby, { extractRoomCode } from '../Lobby';

describe('Lobby Component', () => {
  it('renders pre-join title, Google Sign-In button, Cloudflare Turnstile security, and join button', () => {
    const handleJoin = vi.fn();
    const handleSetRoom = vi.fn();
    const handleToggleAudio = vi.fn();
    const handleToggleVideo = vi.fn();

    render(
      <Lobby
        roomName="strategy-sync"
        setRoomName={handleSetRoom}
        onJoinCall={handleJoin}
        isVideoOn={true}
        toggleVideo={handleToggleVideo}
        isAudioOn={true}
        toggleAudio={handleToggleAudio}
        localStream={null}
      />
    );

    expect(screen.getByText('Ready to join?')).toBeInTheDocument();
    expect(screen.getByText('Check your camera and microphone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in with Google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New meeting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument();
    expect(screen.getByTestId('turnstile-security-box')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join now/i })).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Meeting name, code, or link/i);
    expect(input).toHaveValue('strategy-sync');
  });

  it('extracts meeting code cleanly when a full meeting link is pasted', () => {
    expect(extractRoomCode('https://callsummarizer.onrender.com/?room=abc-defg-hij')).toBe('abc-defg-hij');
    expect(extractRoomCode('abc-defg-hij')).toBe('abc-defg-hij');
  });

  it('blocks joining and prompts for sign-in when user is unauthenticated', () => {
    const handleJoin = vi.fn();

    render(
      <Lobby
        roomName="team-standup"
        setRoomName={vi.fn()}
        onJoinCall={handleJoin}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
        user={{ name: 'You', email: '', initials: 'YO' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    expect(handleJoin).not.toHaveBeenCalled();
    expect(screen.getByTestId('lobby-auth-error')).toHaveTextContent(/Sign in with Google is required to join a meeting/i);
    expect(screen.getByTestId('google-signin-form')).toBeInTheDocument();
  });

  it('blocks creating a new meeting when user is unauthenticated', () => {
    render(
      <Lobby
        roomName="team-standup"
        setRoomName={vi.fn()}
        onJoinCall={vi.fn()}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
        user={{ name: 'You', email: '', initials: 'YO' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /New meeting/i }));
    expect(screen.getByTestId('lobby-auth-error')).toHaveTextContent(/Sign in with Google is required to create a new meeting/i);
    expect(screen.getByTestId('google-signin-form')).toBeInTheDocument();
  });

  it('triggers onJoinCall when form is submitted by authenticated and turnstile-verified user', () => {
    const handleJoin = vi.fn();

    render(
      <Lobby
        roomName="team-standup"
        setRoomName={vi.fn()}
        onJoinCall={handleJoin}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
        user={{ name: 'Avinash', email: 'avinash@gmail.com', initials: 'AK' }}
        isTurnstileVerified={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    expect(handleJoin).toHaveBeenCalledTimes(1);
  });

  it('blocks joining when Cloudflare Turnstile verification is not complete', () => {
    const handleJoin = vi.fn();

    render(
      <Lobby
        roomName="team-standup"
        setRoomName={vi.fn()}
        onJoinCall={handleJoin}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
        user={{ name: 'Avinash', email: 'avinash@gmail.com', initials: 'AK' }}
        isTurnstileVerified={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    expect(handleJoin).not.toHaveBeenCalled();
    expect(screen.getByTestId('lobby-auth-error')).toHaveTextContent(/Cloudflare Turnstile verification required/i);
  });

  it('toggles audio and video via control buttons', () => {
    const handleToggleAudio = vi.fn();
    const handleToggleVideo = vi.fn();

    render(
      <Lobby
        roomName="dev-room"
        setRoomName={vi.fn()}
        onJoinCall={vi.fn()}
        isVideoOn={true}
        toggleVideo={handleToggleVideo}
        isAudioOn={true}
        toggleAudio={handleToggleAudio}
        localStream={null}
      />
    );

    const muteBtn = screen.getByTitle('Mute microphone');
    fireEvent.click(muteBtn);
    expect(handleToggleAudio).toHaveBeenCalledTimes(1);

    const camBtn = screen.getByTitle('Turn off camera');
    fireEvent.click(camBtn);
    expect(handleToggleVideo).toHaveBeenCalledTimes(1);
  });

  it('validates email format in Google sign-in modal', async () => {
    render(
      <Lobby
        roomName="dev-room"
        setRoomName={vi.fn()}
        onJoinCall={vi.fn()}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
        user={{ name: 'You', email: '', initials: 'YO' }}
      />
    );

    // Open sign-in modal
    fireEvent.click(screen.getByRole('button', { name: /Join now/i }));
    expect(screen.getByTestId('google-signin-form')).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/Your Full Name/i);
    const emailInput = screen.getByPlaceholderText(/Google Email/i);

    fireEvent.change(nameInput, { target: { value: 'Avinash' } });
    fireEvent.change(emailInput, { target: { value: 'notanemail' } });

    fireEvent.submit(screen.getByTestId('google-signin-form'));
    expect(screen.getByTestId('lobby-auth-error')).toHaveTextContent(/Please enter a valid Google email address/i);
  });

  it('signs out user and dispatches logout request with sessionId', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({ ok: true }));
    const handleUserChange = vi.fn();

    render(
      <Lobby
        roomName="dev-room"
        setRoomName={vi.fn()}
        onJoinCall={vi.fn()}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
        user={{ name: 'Avinash', email: 'avinash@gmail.com', initials: 'AK', sessionId: 'sess-abc-123' }}
        onUserChange={handleUserChange}
      />
    );

    const signoutBtn = screen.getByTitle('Sign out of Google');
    fireEvent.click(signoutBtn);

    expect(handleUserChange).toHaveBeenCalledWith({ name: 'You', email: '', initials: 'YO' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ sessionId: 'sess-abc-123' })
      })
    );
    fetchSpy.mockRestore();
  });

  it('renders View Meeting Notes & Actions button when hasSessionNotes is true and invokes onToggleNotes', () => {
    const handleToggleNotes = vi.fn();

    render(
      <Lobby
        roomName="dev-room"
        setRoomName={vi.fn()}
        onJoinCall={vi.fn()}
        isVideoOn={true}
        toggleVideo={vi.fn()}
        isAudioOn={true}
        toggleAudio={vi.fn()}
        localStream={null}
        user={{ name: 'Avinash', email: 'avinash@gmail.com', initials: 'AK' }}
        hasSessionNotes={true}
        isNotesOpen={false}
        onToggleNotes={handleToggleNotes}
      />
    );

    const notesBtn = screen.getByTestId('lobby-session-notes-btn');
    expect(notesBtn).toBeInTheDocument();
    expect(notesBtn).toHaveTextContent(/View Meeting Notes & Actions/i);

    fireEvent.click(notesBtn);
    expect(handleToggleNotes).toHaveBeenCalledTimes(1);
  });
});
