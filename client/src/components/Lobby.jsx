import React, { useRef, useEffect, useState } from 'react';
import TurnstileWidget from './TurnstileWidget';

const DEFAULT_GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export function extractRoomCode(input) {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const url = new URL(trimmed);
      const fromQuery = url.searchParams.get('room') || url.searchParams.get('code');
      if (fromQuery) return fromQuery.trim();
      const pathPart = url.pathname.replace(/^\/+/, '');
      if (pathPart) return pathPart.trim();
    } else if (trimmed.includes('?room=')) {
      return trimmed.split('?room=')[1].split('&')[0].trim();
    }
  } catch (e) {
    // Keep raw string if not a valid URL
  }
  return trimmed;
}

export function generateClientMeetingCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const seg = (len) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg(3)}-${seg(4)}-${seg(3)}`;
}

export default function Lobby({
  roomName,
  setRoomName,
  onJoinCall,
  isVideoOn,
  toggleVideo,
  isAudioOn,
  toggleAudio,
  localStream,
  user = { name: 'You', email: '', initials: 'YO' },
  onUserChange,
  googleClientId = DEFAULT_GOOGLE_CLIENT_ID,
  turnstileSiteKey,
  isTurnstileVerified = false,
  onTurnstileVerified
}) {
  const previewRef = useRef(null);
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [googleName, setGoogleName] = useState(user?.name && user.name !== 'You' ? user.name : '');
  const [googleEmail, setGoogleEmail] = useState(user?.email || '');
  const [authLoading, setAuthLoading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [turnstileVerified, setTurnstileVerified] = useState(false);
  const [authError, setAuthError] = useState('');

  const effectiveTurnstileVerified = Boolean(turnstileVerified || isTurnstileVerified);

  useEffect(() => {
    if (previewRef.current) {
      if (localStream && isVideoOn) {
        previewRef.current.srcObject = localStream;
        try {
          const playPromise = previewRef.current.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
        } catch (e) {
          // Ignore autoplay restriction or JSDOM stub
        }
      } else {
        previewRef.current.srcObject = null;
      }
    }
  }, [localStream, isVideoOn]);

  // Load Google Identity Services SDK
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scriptId = 'google-gsi-client';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  const handleGoogleSignInClick = () => {
    if (typeof window !== 'undefined' && window.google?.accounts?.oauth2 && googleClientId) {
      try {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'openid email profile https://www.googleapis.com/auth/calendar.events',
          callback: async (response) => {
            if (response && response.access_token) {
              setAuthLoading(true);
              try {
                const res = await fetch('/api/auth/google', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ accessToken: response.access_token })
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.user && onUserChange) {
                    onUserChange(data.user);
                    setShowGoogleModal(false);
                    setAuthError('');
                    return;
                  }
                } else {
                  const errData = await res.json().catch(() => ({}));
                  setAuthError(errData.error || 'Google token authorization rejected');
                }
              } catch (e) {
                // Fallback to manual Google Account modal
              } finally {
                setAuthLoading(false);
              }
            }
            setShowGoogleModal(true);
          },
          error_callback: () => {
            setShowGoogleModal(true);
          }
        });
        tokenClient.requestAccessToken();
        return;
      } catch (e) {
        // Fallback to inline Google Account sign-in modal
      }
    }
    setShowGoogleModal(true);
  };

  const handleGoogleAccountSubmit = async (e) => {
    e.preventDefault();
    if (!googleName.trim() || !googleEmail.trim()) return;
    const cleanName = googleName.trim();
    const cleanEmail = googleEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setAuthError('Please enter a valid Google email address.');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, email: cleanEmail })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.authenticated && data.user) {
        if (onUserChange) {
          onUserChange(data.user);
        }
        setShowGoogleModal(false);
        setAuthError('');
      } else {
        setAuthError(data.error || 'Failed to authenticate with Google');
      }
    } catch (err) {
      setAuthError('Network error connecting to authentication service');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    const currentSessionId = user?.sessionId;
    if (onUserChange) {
      onUserChange({ name: 'You', email: '', initials: 'YO' });
    }
    setGoogleName('');
    setGoogleEmail('');
    setAuthError('');
    try {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(currentSessionId ? { 'X-Session-ID': currentSessionId } : {})
        },
        credentials: 'include',
        body: JSON.stringify({ sessionId: currentSessionId })
      }).catch(() => {});
    } catch (e) {}
  };

  const handleNewMeeting = async () => {
    if (!isSignedInWithGoogle) {
      setAuthError('Sign in with Google is required to create a new meeting.');
      setShowGoogleModal(true);
      return;
    }
    if (!effectiveTurnstileVerified) {
      setAuthError('Cloudflare Turnstile verification required to create a meeting.');
      return;
    }
    setAuthError('');
    const newCode = generateClientMeetingCode();
    setRoomName(newCode);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set('room', newCode);
      window.history.replaceState({}, '', url.toString());
    }
    try {
      await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: newCode, host: user?.name || 'You' })
      });
    } catch (e) {}
  };

  const handleCopyShareLink = () => {
    const cleanCode = extractRoomCode(roomName) || 'strategy-sync';
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://callsummarizer.onrender.com';
    const shareUrl = `${origin}/?room=${encodeURIComponent(cleanCode)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleRoomInputChange = (e) => {
    const rawVal = e.target.value;
    if (rawVal.includes('?room=') || rawVal.startsWith('http://') || rawVal.startsWith('https://')) {
      setRoomName(extractRoomCode(rawVal));
    } else {
      setRoomName(rawVal);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isSignedInWithGoogle) {
      setAuthError('Sign in with Google is required to join a meeting.');
      setShowGoogleModal(true);
      return;
    }
    if (!effectiveTurnstileVerified) {
      setAuthError('Cloudflare Turnstile verification required to join.');
      return;
    }
    setAuthError('');
    const code = extractRoomCode(roomName);
    if (!code) return;
    if (code !== roomName) {
      setRoomName(code);
    }
    onJoinCall();
  };

  const isSignedInWithGoogle = Boolean(user?.email);
  const displayInitials = user?.initials || (user?.name === 'You' ? 'You' : user?.name?.slice(0, 2).toUpperCase() || 'You');

  return (
    <div className="lobby-screen">
      <div className="lobby-box">
        <div className="lobby-header-row">
          <div>
            <h2 className="lobby-title">Ready to join?</h2>
            <p className="lobby-subtitle">Check your camera and microphone</p>
          </div>

          {/* Google Account Badge or Sign-In Button */}
          <div className="google-auth-section">
            {isSignedInWithGoogle ? (
              <div className="google-user-pill" data-testid="google-user-pill">
                <div className="google-avatar-mini">{displayInitials}</div>
                <div className="google-user-meta">
                  <span className="google-user-name">{user.name}</span>
                  <span className="google-user-email">{user.email}</span>
                </div>
                <button
                  type="button"
                  className="btn-signout-mini"
                  onClick={handleSignOut}
                  title="Sign out of Google"
                >
                  <i className="bi bi-box-arrow-right"></i>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-google-login"
                onClick={handleGoogleSignInClick}
              >
                <i className="bi bi-google"></i>
                <span>Sign in with Google</span>
              </button>
            )}
          </div>
        </div>

        {authError && (
          <div className="lobby-auth-error-banner" role="alert" data-testid="lobby-auth-error">
            <i className="bi bi-shield-exclamation" style={{ marginRight: '8px', color: '#ef4444', fontSize: '1.1rem' }}></i>
            <span>{authError}</span>
          </div>
        )}

        {/* Inline Google Sign-In Form when clicked */}
        {showGoogleModal && !isSignedInWithGoogle && (
          <form onSubmit={handleGoogleAccountSubmit} className="google-signin-card" data-testid="google-signin-form">
            <div className="google-signin-title">
              <i className="bi bi-google" style={{ color: '#3b82f6' }}></i>
              <span>Continue with Google Account</span>
            </div>
            <input
              type="text"
              className="lobby-input"
              placeholder="Your Full Name (e.g. Avinash)"
              value={googleName}
              onChange={(e) => setGoogleName(e.target.value)}
              required
            />
            <input
              type="email"
              className="lobby-input"
              placeholder="Google Email (e.g. name@gmail.com)"
              value={googleEmail}
              onChange={(e) => setGoogleEmail(e.target.value)}
              required
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" className="btn-join" style={{ flex: 1, padding: '9px' }} disabled={authLoading}>
                {authLoading ? 'Signing in...' : 'Continue'}
              </button>
              <button
                type="button"
                className="btn-secondary-action"
                onClick={() => setShowGoogleModal(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Camera Preview */}
        <div className="lobby-camera-preview">
          {localStream && isVideoOn ? (
            <video
              ref={previewRef}
              autoPlay
              muted
              playsInline
              className="video-element"
            />
          ) : (
            <div className="avatar-standby">
              <div className="avatar-circle host">{displayInitials}</div>
              <span className="standby-text">
                {isVideoOn ? 'Camera on' : 'Camera off'}
              </span>
            </div>
          )}

          <div className="lobby-controls-bar">
            <button
              type="button"
              className={`dock-icon-btn ${!isAudioOn ? 'muted' : ''}`}
              onClick={toggleAudio}
              title={isAudioOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              <i className={`bi ${isAudioOn ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`}></i>
            </button>
            <button
              type="button"
              className={`dock-icon-btn ${!isVideoOn ? 'muted' : ''}`}
              onClick={toggleVideo}
              title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
            >
              <i className={`bi ${isVideoOn ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`}></i>
            </button>
          </div>
        </div>

        {/* Meeting Management Form (New Meeting, Code or Shareable Link) */}
        <form onSubmit={handleSubmit} className="lobby-form">
          <div className="meeting-actions-row">
            <button
              type="button"
              className="btn-secondary-action"
              onClick={handleNewMeeting}
              title="Generate a new meeting code"
            >
              <i className="bi bi-plus-lg"></i>
              <span>New meeting</span>
            </button>

            <button
              type="button"
              className="btn-secondary-action"
              onClick={handleCopyShareLink}
              title="Copy shareable meeting link"
            >
              <i className={`bi ${linkCopied ? 'bi-check2' : 'bi-link-45deg'}`}></i>
              <span>{linkCopied ? 'Link copied' : 'Copy link'}</span>
            </button>
          </div>

          <input
            type="text"
            className="lobby-input"
            placeholder="Meeting name, code, or link (e.g. abc-defg-hij)"
            value={roomName}
            onChange={handleRoomInputChange}
            required
          />

          <button type="submit" className="btn-join" disabled={!roomName.trim()}>
            Join now
          </button>
        </form>

        {/* Cloudflare Turnstile Security Verification */}
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          onVerified={(token) => {
            setTurnstileVerified(true);
            if (onTurnstileVerified) onTurnstileVerified(token);
            setAuthError((prev) => (prev && prev.includes('Turnstile') ? '' : prev));
          }}
        />
      </div>
    </div>
  );
}
