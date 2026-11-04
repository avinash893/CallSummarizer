import React, { useState, useEffect, useRef, useCallback } from 'react';
import { jsPDF } from 'jspdf';
import TopBar from './components/TopBar';
import VideoCanvas from './components/VideoCanvas';
import ControlDock from './components/ControlDock';
import NotesDrawer from './components/NotesDrawer';
import Lobby, { extractRoomCode } from './components/Lobby';
import ArchitectureModal from './components/ArchitectureModal';

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

function ensureUniqueTaskIds(taskList = []) {
  const seen = new Set();
  return taskList.map((t, idx) => {
    let id =
      t.id !== undefined && t.id !== null && t.id !== ''
        ? t.id
        : `task-${idx + 1}-${Date.now()}`;
    if (seen.has(id)) {
      id = `${id}-${idx + 1}`;
    }
    seen.add(id);
    return {
      ...t,
      id,
      completed: Boolean(t.completed)
    };
  });
}

function getInitialRoomFromUrl() {
  if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room') || params.get('code');
    if (roomParam && roomParam.trim()) {
      return extractRoomCode(roomParam);
    }
  }
  return 'strategy-sync';
}

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000; // 10 days in milliseconds

function getInitialUser() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem('cs_google_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name && parsed.email) {
          const age = Date.now() - (parsed.savedAt || 0);
          if (!parsed.savedAt || age < TEN_DAYS_MS) {
            return parsed;
          }
        }
      }
    } catch (e) {}
  }
  return { name: 'You', email: '', initials: 'You' };
}

export default function App() {
  const [user, setUser] = useState(getInitialUser);
  const [isInCall, setIsInCall] = useState(false);
  const [roomName, setRoomName] = useState(getInitialRoomFromUrl);
  const [isTurnstileVerified, setIsTurnstileVerified] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(true);
  const [isArchModalOpen, setIsArchModalOpen] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [isExtracting, setIsExtracting] = useState(false);

  // Real room state (no fake demo second participant)
  const [remotePeers, setRemotePeers] = useState([]);
  const [capturedPeerIds, setCapturedPeerIds] = useState([]);
  const [capturedAudioClips, setCapturedAudioClips] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [appConfig, setAppConfig] = useState({
    googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    turnstileSiteKey: import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || '',
    iceServers: DEFAULT_ICE_SERVERS
  });

  const wsRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const peerAudioRecordersRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const localRecognitionRef = useRef(null);
  const isCapturingLocalRef = useRef(false);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const capturedAudioClipsRef = useRef(capturedAudioClips);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    screenStreamRef.current = screenStream;
  }, [screenStream]);

  useEffect(() => {
    capturedAudioClipsRef.current = capturedAudioClips;
  }, [capturedAudioClips]);

  useEffect(() => {
    return () => {
      const clips = capturedAudioClipsRef.current || [];
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        clips.forEach((clip) => {
          if (clip && clip.url) {
            try {
              URL.revokeObjectURL(clip.url);
            } catch (e) {}
          }
        });
      }
      peerAudioRecordersRef.current.forEach((session) => {
        try {
          if (session.recorder) {
            session.recorder.onstop = null;
            if (session.recorder.state !== 'inactive') {
              session.recorder.stop();
            }
          }
        } catch (e) {}
      });
      peerAudioRecordersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    iceServersRef.current = appConfig.iceServers || DEFAULT_ICE_SERVERS;
  }, [appConfig.iceServers]);

  const handleUserChange = useCallback((nextUser) => {
    setUser(nextUser);
    if (!nextUser || !nextUser.email) {
      setIsTurnstileVerified(false);
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        if (nextUser && nextUser.email) {
          const userWithTimestamp = {
            ...nextUser,
            savedAt: nextUser.savedAt || Date.now()
          };
          window.localStorage.setItem('cs_google_user', JSON.stringify(userWithTimestamp));
        } else {
          window.localStorage.removeItem('cs_google_user');
        }
      } catch (e) {}
    }
  }, []);

  // Load runtime config & handle OAuth callback credential if present
  useEffect(() => {
    let isMounted = true;
    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        if (res.ok && isMounted) {
          const data = await res.json();
          setAppConfig((prev) => ({
            ...prev,
            googleClientId: data.googleClientId || prev.googleClientId,
            turnstileSiteKey: data.turnstileSiteKey || prev.turnstileSiteKey,
            iceServers: data.iceServers || prev.iceServers
          }));
        }
      } catch (e) {}
    }
    loadConfig();

    const params = typeof window !== 'undefined' && window.location?.search ? new URLSearchParams(window.location.search) : null;
    const urlSessionId = params?.get('sessionId');
    const cred = params?.get('googleCredential');
    const effectiveSessionId = urlSessionId || user?.sessionId;

    if (urlSessionId && typeof window !== 'undefined' && window.history?.replaceState) {
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('sessionId');
        cleanUrl.searchParams.delete('googleCredential');
        window.history.replaceState({}, '', cleanUrl.toString());
      } catch (e) {}
    }

    if (effectiveSessionId) {
      fetch('/api/auth/session?sessionId=' + encodeURIComponent(effectiveSessionId), {
        headers: { 'X-Session-ID': effectiveSessionId },
        credentials: 'include'
      })
        .then((r) => {
          if (r.status === 401) {
            // Stale/expired local session on server restart -> reset ghost authenticated state
            if (isMounted) {
              handleUserChange({ name: 'You', email: '', initials: 'You' });
            }
            return null;
          }
          return r.ok ? r.json() : null;
        })
        .then((data) => {
          if (data && data.authenticated && data.user && isMounted) {
            handleUserChange({
              ...data.user,
              hasCalendarAccess: data.hasCalendarAccess
            });
          }
        })
        .catch(() => {});
    } else if (cred) {
      fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credential: cred })
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && data.user && isMounted) {
            handleUserChange(data.user);
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [handleUserChange]);

  // Camera preview hook with reliable cleanup
  useEffect(() => {
    let activeStream = null;
    let isMounted = true;

    async function initCamera() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          if (isMounted) {
            activeStream = stream;
            setLocalStream(stream);
          } else {
            stream.getTracks().forEach((track) => track.stop());
          }
        }
      } catch (err) {
        // Fallback to standby avatar gracefully
      }
    }
    initCamera();

    return () => {
      isMounted = false;
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Call timer
  useEffect(() => {
    let interval = null;
    if (isInCall) {
      interval = setInterval(() => {
        setCallSeconds((sec) => sec + 1);
      }, 1000);
    } else {
      setCallSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isInCall]);

  // WebRTC PeerConnection factory
  const getOrCreatePeerConnection = useCallback((remotePeerId, remoteUserInfo = {}) => {
    if (peerConnectionsRef.current.has(remotePeerId)) {
      return peerConnectionsRef.current.get(remotePeerId);
    }
    if (typeof RTCPeerConnection === 'undefined') return null;

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    peerConnectionsRef.current.set(remotePeerId, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
      const activeScreenTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (activeScreenTrack) {
        try {
          const senders = typeof pc.getSenders === 'function' ? pc.getSenders() : [];
          const videoSender = senders.find((s) => s.track?.kind === 'video');
          if (videoSender && typeof videoSender.replaceTrack === 'function') {
            videoSender.replaceTrack(activeScreenTrack).catch(() => {});
          }
        } catch (e) {}
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(
          JSON.stringify({
            type: 'webrtc-ice-candidate',
            targetPeerId: remotePeerId,
            candidate: event.candidate
          })
        );
      }
    };

    if (!remoteStreamsRef.current.has(remotePeerId)) {
      remoteStreamsRef.current.set(remotePeerId, new MediaStream());
    }
    const peerMediaStream = remoteStreamsRef.current.get(remotePeerId);

    pc.ontrack = (event) => {
      if (event.track) {
        if (!peerMediaStream.getTracks().some((t) => t.id === event.track.id)) {
          peerMediaStream.addTrack(event.track);
        }
      }
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          if (!peerMediaStream.getTracks().some((t) => t.id === track.id)) {
            peerMediaStream.addTrack(track);
          }
        });
      }
      setRemotePeers((prev) => {
        const exists = prev.some((p) => p.peerId === remotePeerId);
        if (exists) {
          return prev.map((p) =>
            p.peerId === remotePeerId ? { ...p, stream: peerMediaStream } : p
          );
        }
        return [
          ...prev,
          {
            peerId: remotePeerId,
            name: remoteUserInfo?.name || 'Participant',
            initials: remoteUserInfo?.initials || 'P',
            isAudioOn: remoteUserInfo?.isAudioOn !== false,
            isVideoOn: remoteUserInfo?.isVideoOn !== false,
            stream: peerMediaStream
          }
        ];
      });
    };

    return pc;
  }, []);

  // WebSocket Room & Signaling connection when in call
  useEffect(() => {
    if (!isInCall || typeof WebSocket === 'undefined') return;

    const cleanRoom = extractRoomCode(roomName) || 'strategy-sync';
    let wsUrl = 'ws://localhost:8080';
    if (typeof window !== 'undefined' && window.location?.host) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}`;
    }

    let ws;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
    } catch (e) {
      return;
    }

    ws.onopen = () => {
      try {
        ws.send(
          JSON.stringify({
            type: 'join-room',
            roomId: cleanRoom,
            user: {
              name: user?.name || 'You',
              email: user?.email || '',
              initials: user?.initials || 'YO',
              isAudioOn,
              isVideoOn
            }
          })
        );
      } catch (e) {}
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      switch (msg.type) {
        case 'room-users': {
          const others = (msg.participants || []).filter((p) => p.peerId !== msg.selfPeerId);
          setRemotePeers(others);
          if (Array.isArray(msg.transcript) && msg.transcript.length > 0) {
            setTranscript(msg.transcript);
          }
          if (Array.isArray(msg.tasks) && msg.tasks.length > 0) {
            setTasks(ensureUniqueTaskIds(msg.tasks));
          }
          break;
        }

        case 'user-joined': {
          const newPeer = msg.peer;
          if (!newPeer) break;
          setRemotePeers((prev) => {
            const exists = prev.some((p) => p.peerId === newPeer.peerId);
            return exists ? prev : [...prev, newPeer];
          });

          const pc = getOrCreatePeerConnection(newPeer.peerId, newPeer);
          if (pc) {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              ws.send(
                JSON.stringify({
                  type: 'webrtc-offer',
                  targetPeerId: newPeer.peerId,
                  sdp: pc.localDescription
                })
              );
            } catch (e) {}
          }
          break;
        }

        case 'webrtc-offer': {
          const senderId = msg.senderPeerId;
          if (!senderId || !msg.sdp) break;
          if (msg.senderUser) {
            setRemotePeers((prev) => {
              const exists = prev.some((p) => p.peerId === senderId);
              return exists ? prev : [...prev, msg.senderUser];
            });
          }
          const pc = getOrCreatePeerConnection(senderId, msg.senderUser);
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              const pending = pendingCandidatesRef.current.get(senderId) || [];
              for (const cand of pending) {
                try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (err) {}
              }
              pendingCandidatesRef.current.delete(senderId);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              ws.send(
                JSON.stringify({
                  type: 'webrtc-answer',
                  targetPeerId: senderId,
                  sdp: pc.localDescription
                })
              );
            } catch (e) {}
          }
          break;
        }

        case 'webrtc-answer': {
          const senderId = msg.senderPeerId;
          const pc = peerConnectionsRef.current.get(senderId);
          if (pc && msg.sdp) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              const pending = pendingCandidatesRef.current.get(senderId) || [];
              for (const cand of pending) {
                try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (err) {}
              }
              pendingCandidatesRef.current.delete(senderId);
            } catch (e) {}
          }
          break;
        }

        case 'webrtc-ice-candidate': {
          const senderId = msg.senderPeerId;
          const pc = peerConnectionsRef.current.get(senderId);
          if (pc && msg.candidate) {
            try {
              if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              } else {
                if (!pendingCandidatesRef.current.has(senderId)) {
                  pendingCandidatesRef.current.set(senderId, []);
                }
                pendingCandidatesRef.current.get(senderId).push(msg.candidate);
              }
            } catch (e) {}
          }
          break;
        }

        case 'participant-updated': {
          if (!msg.peerId || !msg.participant) break;
          setRemotePeers((prev) =>
            prev.map((p) => (p.peerId === msg.peerId ? { ...p, ...msg.participant } : p))
          );
          break;
        }

        case 'user-left': {
          const leftId = msg.peerId;
          pendingCandidatesRef.current.delete(leftId);
          const pc = peerConnectionsRef.current.get(leftId);
          if (pc) {
            try {
              pc.close();
            } catch (e) {}
            peerConnectionsRef.current.delete(leftId);
          }
          const session = peerAudioRecordersRef.current.get(leftId);
          if (session) {
            try {
              if (session.recorder && session.recorder.state !== 'inactive') {
                session.recorder.stop();
              }
            } catch (e) {}
            peerAudioRecordersRef.current.delete(leftId);
          }
          setCapturedPeerIds((prev) => prev.filter((id) => id !== leftId));
          remoteStreamsRef.current.delete(leftId);
          setRemotePeers((prev) => prev.filter((p) => p.peerId !== leftId));
          break;
        }

        case 'transcript-entry': {
          if (msg.entry) {
            setTranscript((prev) => {
              if (prev.some((item) => item.id === msg.entry.id)) return prev;
              return [...prev, msg.entry];
            });
          }
          break;
        }

        case 'tasks-sync': {
          if (Array.isArray(msg.tasks)) {
            setTasks(ensureUniqueTaskIds(msg.tasks));
          }
          break;
        }

        case 'remote-transcribe-toggle': {
          handleToggleCapturePeer('local');
          break;
        }

        default:
          break;
      }
    };

    return () => {
      peerConnectionsRef.current.forEach((pc) => {
        try {
          pc.close();
        } catch (e) {}
      });
      peerConnectionsRef.current.clear();
      if (ws && ws.readyState === 1) {
        try {
          ws.send(JSON.stringify({ type: 'leave-room' }));
          ws.close();
        } catch (e) {}
      }
      wsRef.current = null;
      setRemotePeers([]);
    };
  }, [isInCall, roomName, user?.name, user?.email, user?.initials, getOrCreatePeerConnection]);

  // Automatic background SpeechRecognition removed to eliminate recurring mobile/Android mic prompt toasts.
  // Speech recognition is now strictly user-activated on-demand via the "Capture" button.

  const formatTimer = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleJoinCall = () => {
    if (!user?.email || !isTurnstileVerified) {
      return;
    }
    const cleanCode = extractRoomCode(roomName) || 'strategy-sync';
    setRoomName(cleanCode);
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set('room', cleanCode);
      window.history.replaceState({}, '', url.toString());
    }
    setIsInCall(true);
  };

  const revertVideoSendersToCamera = useCallback(() => {
    const cameraTrack = localStreamRef.current ? localStreamRef.current.getVideoTracks()[0] || null : null;
    for (const pc of peerConnectionsRef.current.values()) {
      try {
        const senders = typeof pc.getSenders === 'function' ? pc.getSenders() : [];
        const videoSender = senders.find((s) => s.track?.kind === 'video');
        if (videoSender && typeof videoSender.replaceTrack === 'function') {
          videoSender.replaceTrack(cameraTrack).catch((err) => {
            console.warn('Failed to revert video sender to camera:', err);
          });
        }
      } catch (err) {
        console.warn('Error reverting video sender:', err);
      }
    }
  }, []);

  const handleLeaveCall = () => {
    if (isScreenSharing) {
      revertVideoSendersToCamera();
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
    }
    // Cleanly stop all active selective audio recordings
    peerAudioRecordersRef.current.forEach((session) => {
      try {
        if (session.recorder) {
          session.recorder.onstop = null;
          if (session.recorder.state !== 'inactive') {
            session.recorder.stop();
          }
        }
      } catch (e) {}
    });
    peerAudioRecordersRef.current.clear();
    setCapturedPeerIds([]);

    if (localRecognitionRef.current) {
      try {
        localRecognitionRef.current.stop();
      } catch (e) {}
      localRecognitionRef.current = null;
    }
    remoteStreamsRef.current.clear();

    // Revoke object URLs for captured clips
    const clips = capturedAudioClipsRef.current || [];
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      clips.forEach((clip) => {
        if (clip && clip.url) {
          try {
            URL.revokeObjectURL(clip.url);
          } catch (e) {}
        }
      });
    }
    setCapturedAudioClips([]);

    setIsInCall(false);
    setIsScreenSharing(false);
    setRemotePeers([]);
  };

  const processLiveTranscriptForActions = useCallback(async (speaker, text) => {
    if (!text || typeof text !== 'string' || text.trim().length < 5) return;
    try {
      const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || '';
      const res = await fetch(`${gatewayUrl}/api/nlp-tasks/extract-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: `${speaker}: ${text}`, roomId: roomName })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tasks) && data.tasks.length > 0) {
          setTasks((prevTasks) => {
            const updated = [...prevTasks];
            for (const t of data.tasks) {
              if (!updated.some((ex) => ex.title.toLowerCase() === String(t.title).toLowerCase())) {
                updated.push({
                  id: (t.id !== undefined && t.id !== null && String(t.id).trim() !== '') ? String(t.id) : `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  title: t.title,
                  assignee: t.assignee || speaker || user?.name || 'You',
                  due: t.due || 'Tomorrow',
                  completed: Boolean(t.completed)
                });
              }
            }
            const formatted = ensureUniqueTaskIds(updated);
            if (wsRef.current && wsRef.current.readyState === 1) {
              wsRef.current.send(JSON.stringify({ type: 'tasks-sync', tasks: formatted }));
            }
            return formatted;
          });
        }
      }
    } catch (e) {
      console.warn('Error in live action extraction:', e);
    }
  }, [roomName, user?.name]);

  const sendAudioBlobForTranscription = useCallback((blob, mime, speakerName) => {
    if (!blob || blob.size < 500 || typeof FileReader === 'undefined') return;
    try {
      const reader = new FileReader();
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      reader.onloadend = async () => {
        const rawResult = reader.result;
        if (!rawResult) return;
        const pureBase64 =
          typeof rawResult === 'string' && rawResult.includes(',')
            ? rawResult.split(',')[1]
            : String(rawResult).replace(/^data:[^,]+,/, '');
        try {
          const trRes = await fetch('/api/transcribe-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioData: pureBase64,
              mimeType: mime,
              speakerName
            })
          });
          if (trRes.ok) {
            const trData = await trRes.json();
            let cleanText = trData.transcript ? trData.transcript.trim() : '';
            cleanText = cleanText.replace(/^["'`«»“”„]+|["'`«»“”„]+$/g, '').trim();
            const cleanSpeakerAlpha = String(speakerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanTextAlpha = cleanText.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (
              cleanText &&
              !cleanText.includes('[Audio') &&
              !cleanText.includes('Private Capture') &&
              cleanText.toUpperCase() !== 'SILENCE' &&
              cleanText !== '""' &&
              cleanText.toLowerCase() !== speakerName.toLowerCase() &&
              (!cleanSpeakerAlpha || cleanTextAlpha !== cleanSpeakerAlpha)
            ) {
              const entry = {
                id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                speaker: speakerName,
                time: timeStr,
                text: cleanText
              };
              setTranscript((prevTr) => [...prevTr, entry]);
              if (wsRef.current && wsRef.current.readyState === 1) {
                wsRef.current.send(JSON.stringify({ type: 'transcript-entry', entry }));
              }
              // Immediately extract personal action items from transcribed speech
              processLiveTranscriptForActions(speakerName, cleanText);
            }
          }
        } catch (e) {}
      };
      reader.readAsDataURL(blob);
    } catch (e) {}
  }, [processLiveTranscriptForActions]);

  const handleToggleCapturePeer = useCallback((peerId) => {
    if (!peerId) return;

    const isLocal = peerId === 'local' || peerId === user?.id;
    const speakerName = isLocal ? (user?.name || 'You') : (remotePeers.find((p) => p.peerId === peerId)?.name || 'Participant');

    setCapturedPeerIds((prev) => {
      const isAlreadyCaptured = prev.includes(peerId);

      if (isAlreadyCaptured) {
        // Stop capturing for this peer
        if (isLocal && localRecognitionRef.current) {
          try {
            localRecognitionRef.current.onend = null;
            localRecognitionRef.current.stop();
          } catch (e) {}
          localRecognitionRef.current = null;
        }

        const activeSession = peerAudioRecordersRef.current.get(peerId);
        if (activeSession) {
          if (typeof activeSession.stop === 'function') {
            activeSession.stop();
          } else {
            if (activeSession.interval) {
              clearInterval(activeSession.interval);
            }
            try {
              if (activeSession.recorder && activeSession.recorder.state !== 'inactive') {
                activeSession.recorder.stop();
              }
            } catch (e) {}
          }
          peerAudioRecordersRef.current.delete(peerId);
        }
        return prev.filter((id) => id !== peerId);
      } else {
        // For local peer on desktop: start Web Speech Recognition if available
        if (isLocal && typeof window !== 'undefined') {
          const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SpeechRec) {
            try {
              const rec = new SpeechRec();
              rec.continuous = true;
              rec.interimResults = false;
              rec.lang = 'en-US';

              rec.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; i++) {
                  const text = event.results[i][0]?.transcript?.trim();
                  if (text) {
                    const entry = {
                      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      speaker: speakerName,
                      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      text
                    };
                    setTranscript((tPrev) => [...tPrev, entry]);
                    if (wsRef.current && wsRef.current.readyState === 1) {
                      wsRef.current.send(JSON.stringify({ type: 'transcript-entry', entry }));
                    }
                    // Extract action items live from speech recognition
                    processLiveTranscriptForActions(speakerName, text);
                  }
                }
              };
              rec.onerror = () => {};
              rec.start();
              localRecognitionRef.current = rec;
            } catch (e) {}
          }
        }

        // For remote peer: send signaling request
        if (!isLocal && wsRef.current && wsRef.current.readyState === 1) {
          try {
            wsRef.current.send(
              JSON.stringify({
                type: 'remote-transcribe-toggle',
                targetPeerId: peerId
              })
            );
          } catch (e) {}
        }

        // Audio track acquisition for MediaRecorder
        let audioTracks = [];
        if (isLocal) {
          audioTracks = localStreamRef.current ? localStreamRef.current.getAudioTracks() : [];
        } else {
          const streamFromRef = remoteStreamsRef.current.get(peerId);
          if (streamFromRef && streamFromRef.getAudioTracks().length > 0) {
            audioTracks = streamFromRef.getAudioTracks();
          } else {
            const targetPeer = remotePeers.find((p) => p.peerId === peerId);
            audioTracks = targetPeer?.stream?.getAudioTracks() || [];
          }
          if (audioTracks.length === 0) {
            const pc = peerConnectionsRef.current.get(peerId);
            if (pc && typeof pc.getReceivers === 'function') {
              const receiver = pc.getReceivers().find((r) => r.track && r.track.kind === 'audio');
              if (receiver && receiver.track) {
                audioTracks = [receiver.track];
              }
            }
          }
        }

        if (typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && audioTracks.length > 0) {
          try {
            let audioStream = new MediaStream(audioTracks);
            let activeAudioCtx = null;
            try {
              const AudioCtx = window.AudioContext || window.webkitAudioContext;
              if (AudioCtx) {
                activeAudioCtx = new AudioCtx();
                if (activeAudioCtx.state === 'suspended') {
                  activeAudioCtx.resume().catch(() => {});
                }
                const src = activeAudioCtx.createMediaStreamSource(new MediaStream(audioTracks));
                const dest = activeAudioCtx.createMediaStreamDestination();
                src.connect(dest);
                if (dest.stream && dest.stream.getAudioTracks().length > 0) {
                  audioStream = dest.stream;
                }
              }
            } catch (e) {}

            let mimeType = '';
            if (typeof MediaRecorder.isTypeSupported === 'function') {
              const preferredTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/aac'
              ];
              for (const pt of preferredTypes) {
                if (MediaRecorder.isTypeSupported(pt)) {
                  mimeType = pt;
                  break;
                }
              }
            }

            const options = mimeType ? { mimeType } : undefined;
            const sessionState = { active: true, currentRecorder: null, timer: null };

            const recordSegment = () => {
              if (!sessionState.active) return;
              try {
                const rec = new MediaRecorder(audioStream, options);
                const segChunks = [];
                rec.ondataavailable = (e) => {
                  if (e.data && e.data.size > 0) {
                    segChunks.push(e.data);
                  }
                };
                rec.onstop = () => {
                  const mime = rec.mimeType || mimeType || 'audio/webm';
                  if (segChunks.length > 0) {
                    const blob = new Blob(segChunks, { type: mime });
                    if (blob.size >= 500) {
                      sendAudioBlobForTranscription(blob, mime, speakerName);
                    }
                  }
                  if (sessionState.active) {
                    recordSegment();
                  }
                };
                sessionState.currentRecorder = rec;
                rec.start();
                // 3.5-second fast cyclic segment ensuring fresh container headers & live transcription
                sessionState.timer = setTimeout(() => {
                  if (rec.state === 'recording') {
                    rec.stop();
                  }
                }, 3500);
              } catch (e) {
                console.warn('Error in recordSegment:', e);
              }
            };

            recordSegment();

            peerAudioRecordersRef.current.set(peerId, {
              stop: () => {
                sessionState.active = false;
                if (sessionState.timer) clearTimeout(sessionState.timer);
                if (sessionState.currentRecorder && sessionState.currentRecorder.state !== 'inactive') {
                  sessionState.currentRecorder.stop();
                }
                if (activeAudioCtx) {
                  try { activeAudioCtx.close(); } catch (e) {}
                }
              },
              recorder: {
                state: 'recording',
                stop: () => {
                  sessionState.active = false;
                  if (sessionState.timer) clearTimeout(sessionState.timer);
                  if (sessionState.currentRecorder && sessionState.currentRecorder.state !== 'inactive') {
                    sessionState.currentRecorder.stop();
                  }
                  if (activeAudioCtx) {
                    try { activeAudioCtx.close(); } catch (e) {}
                  }
                }
              },
              stream: audioStream
            });
          } catch (err) {
            console.warn('Failed to start MediaRecorder on audio track:', err);
          }
        } else {
          // Graceful fallback for headless test runners / mock environments
          const mockSession = {
            stop: () => {},
            recorder: {
              state: 'recording',
              stop: () => {}
            },
            chunks: []
          };
          peerAudioRecordersRef.current.set(peerId, mockSession);
        }

        return [...prev, peerId];
      }
    });
  }, [remotePeers, sendAudioBlobForTranscription, user?.name, user?.id, processLiveTranscriptForActions]);

  const handleDeleteClip = (clipId) => {
    setCapturedAudioClips((prev) => {
      const clipToDelete = prev.find((c) => c.id === clipId);
      if (clipToDelete && clipToDelete.url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(clipToDelete.url);
        } catch (e) {}
      }
      return prev.filter((c) => c.id !== clipId);
    });
  };

  const toggleVideo = () => {
    const nextState = !isVideoOn;
    setIsVideoOn(nextState);
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = nextState;
      });
    }
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'media-state', isVideoOn: nextState }));
    }
  };

  const toggleAudio = () => {
    const nextState = !isAudioOn;
    setIsAudioOn(nextState);
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = nextState;
      });
    }
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'media-state', isAudioOn: nextState }));
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      revertVideoSendersToCamera();
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        setScreenStream(null);
      }
      setIsScreenSharing(false);
      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'media-state', isScreenSharing: false }));
      }
      return;
    }

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        setScreenStream(displayStream);
        setIsScreenSharing(true);
        if (wsRef.current && wsRef.current.readyState === 1) {
          wsRef.current.send(JSON.stringify({ type: 'media-state', isScreenSharing: true }));
        }

        const screenTrack = displayStream.getVideoTracks()[0];
        if (screenTrack) {
          for (const pc of peerConnectionsRef.current.values()) {
            try {
              const senders = typeof pc.getSenders === 'function' ? pc.getSenders() : [];
              const videoSender = senders.find((sender) => sender.track?.kind === 'video');
              if (videoSender && typeof videoSender.replaceTrack === 'function') {
                videoSender.replaceTrack(screenTrack).catch((err) => {
                  console.warn('Failed to replace track with screenTrack:', err);
                });
              }
            } catch (err) {
              console.warn('Error replacing video track on peer connection:', err);
            }
          }

          screenTrack.onended = () => {
            revertVideoSendersToCamera();
            setIsScreenSharing(false);
            setScreenStream(null);
            if (wsRef.current && wsRef.current.readyState === 1) {
              wsRef.current.send(JSON.stringify({ type: 'media-state', isScreenSharing: false }));
            }
          };
        }
      } else {
        setIsScreenSharing(true);
      }
    } catch (e) {
      // User cancelled screen picker
    }
  };

  const handleToggleTask = (id) => {
    setTasks((prev) => {
      const next = prev.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      );
      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'tasks-sync', tasks: next }));
      }
      return next;
    });
  };

  const handleAddTask = (title) => {
    const newTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      assignee: user?.name || 'You',
      due: 'Upcoming',
      completed: false
    };
    setTasks((prev) => {
      const next = ensureUniqueTaskIds([...prev, newTask]);
      if (wsRef.current && wsRef.current.readyState === 1) {
        wsRef.current.send(JSON.stringify({ type: 'tasks-sync', tasks: next }));
      }
      return next;
    });
  };

  const handleAddTranscript = (text) => {
    const entry = {
      id: `tr-${Date.now()}`,
      speaker: user?.name || 'You',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text
    };
    setTranscript((prev) => [...prev, entry]);
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'transcript-entry', entry }));
    }
  };

  const handleCopyRoom = () => {
    const cleanCode = extractRoomCode(roomName) || 'strategy-sync';
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://callsummarizer.onrender.com';
    const shareUrl = `${origin}/?room=${encodeURIComponent(cleanCode)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
  };

  const handleExtractTasks = async () => {
    // Only extract tasks from real spoken speech lines
    const speechLines = (transcript || [])
      .filter((item) => item?.text && !item.text.startsWith('[Private Capture') && !item.text.startsWith('[Audio') && item.text.trim())
      .map((item) => `${item.speaker}: ${item.text.trim()}`);

    if (speechLines.length === 0) {
      setIsExtracting(false);
      return;
    }

    setIsExtracting(true);
    try {
      const transcriptText = speechLines.join('\n');
      const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || '';
      const response = await fetch(`${gatewayUrl}/api/nlp-tasks/extract-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcriptText, roomId: roomName })
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.tasks) && data.tasks.length > 0) {
          const formatted = ensureUniqueTaskIds(
            data.tasks.map((t, idx) => ({
              id: t.id !== undefined && t.id !== null && t.id !== '' ? t.id : `task-${Date.now()}-${idx + 1}`,
              title: t.title,
              assignee: t.assignee || user?.name || 'You',
              due: t.due || 'Tomorrow',
              completed: Boolean(t.completed)
            }))
          );
          setTasks(formatted);
          if (wsRef.current && wsRef.current.readyState === 1) {
            wsRef.current.send(JSON.stringify({ type: 'tasks-sync', tasks: formatted }));
          }
        }
      }
    } catch (err) {
      // Gracefully maintain tasks if service is not running
    } finally {
      setIsExtracting(false);
    }
  };

  const handleAddToCalendar = async (task) => {
    try {
      const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || '';

      const headers = {
        'Content-Type': 'application/json'
      };
      if (user?.sessionId) {
        headers['X-Session-ID'] = user.sessionId;
      }

      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const res = await fetch(`${gatewayUrl}/api/calendar/events`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          title: task.title,
          description: `Action item assigned to ${task.assignee || 'You'}. Due: ${task.due || 'Upcoming'}\nRoom: ${roomName}`,
          due: task.due,
          timeZone: userTimeZone,
          sessionId: user?.sessionId
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setTasks((prev) => {
          const next = prev.map((t) => (t.id === task.id ? { ...t, calendarAdded: true } : t));
          if (wsRef.current && wsRef.current.readyState === 1) {
            wsRef.current.send(JSON.stringify({ type: 'tasks-sync', tasks: next }));
          }
          return next;
        });
        return { success: true, event: data.event };
      }
      return {
        success: false,
        error: data.error || `Calendar service error (${res.status})`
      };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Failed to connect to Google Calendar service'
      };
    }
  };

  // Real PDF Generator using jsPDF
  const handleExportPdf = () => {
    try {
      const doc = new jsPDF();
      const participantNames = [
        `${user?.name || 'You'} (Host)`,
        ...remotePeers.map((p) => p.name || 'Participant')
      ].join(', ');

      doc.setFontSize(22);
      doc.setTextColor(26, 115, 232);
      doc.text('CallSummarizer', 20, 22);

      doc.setFontSize(13);
      doc.setTextColor(80, 80, 80);
      doc.text('Meeting Summary & Action Items', 20, 30);

      doc.setDrawColor(210, 215, 225);
      doc.line(20, 34, 190, 34);

      doc.setFontSize(10);
      doc.setTextColor(90, 95, 105);
      doc.text(`Meeting Room: ${roomName || 'Session'}`, 20, 42);
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}`, 20, 48);
      doc.text(`Call Duration: ${formatTimer(callSeconds)}`, 120, 42);
      doc.text(`Participants: ${participantNames}`, 120, 48);

      let currentY = 60;
      doc.setFontSize(14);
      doc.setTextColor(26, 115, 232);
      doc.text('1. Action Items', 20, currentY);
      currentY += 8;

      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      if (tasks.length === 0) {
        doc.text('- No action items recorded during this session.', 24, currentY);
        currentY += 10;
      } else {
        tasks.forEach((task) => {
          const checkStatus = task.completed ? '[DONE]' : '[PENDING]';
          doc.text(`${checkStatus}  ${task.title}`, 24, currentY);
          doc.setFontSize(9);
          doc.setTextColor(110, 110, 110);
          doc.text(`Assignee: ${task.assignee}  |  Due: ${task.due}`, 36, currentY + 5);
          doc.setFontSize(10);
          doc.setTextColor(50, 50, 50);
          currentY += 12;
        });
      }

      currentY += 4;
      doc.setFontSize(14);
      doc.setTextColor(26, 115, 232);
      doc.text('2. Transcript Log', 20, currentY);
      currentY += 8;

      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      if (transcript.length === 0) {
        doc.text('No transcript lines recorded.', 24, currentY);
      } else {
        transcript.slice(0, 15).forEach((item) => {
          doc.text(`[${item.time}] ${item.speaker}: "${item.text}"`, 24, currentY);
          currentY += 6;
        });
      }

      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text('Generated by CallSummarizer | MERN Stack & Microservices', 20, 280);

      const cleanFileName = `meeting-summary-${(roomName || 'call')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')}.pdf`;
      doc.save(cleanFileName);
    } catch (err) {
      console.error('PDF Generation Error:', err);
    }
  };

  return (
    <div className="app-shell">
      {!isInCall ? (
        <Lobby
          roomName={roomName}
          setRoomName={setRoomName}
          onJoinCall={handleJoinCall}
          isVideoOn={isVideoOn}
          toggleVideo={toggleVideo}
          isAudioOn={isAudioOn}
          toggleAudio={toggleAudio}
          localStream={localStream}
          user={user}
          onUserChange={handleUserChange}
          googleClientId={appConfig.googleClientId}
          turnstileSiteKey={appConfig.turnstileSiteKey}
          isTurnstileVerified={isTurnstileVerified}
          onTurnstileVerified={setIsTurnstileVerified}
        />
      ) : (
        <>
          <TopBar
            roomName={roomName}
            callDuration={formatTimer(callSeconds)}
            isNotesOpen={isNotesOpen}
            setIsNotesOpen={setIsNotesOpen}
            onOpenArchModal={() => setIsArchModalOpen(true)}
            onCopyRoom={handleCopyRoom}
            participantCount={1 + remotePeers.length}
          />

          <main className="main-stage">
            {!isNotesOpen && (
              <button
                type="button"
                className="mobile-notes-fab"
                onClick={() => setIsNotesOpen(true)}
                title="Open Transcript & Action Items"
                aria-label="Open transcript and action items"
                data-testid="mobile-notes-fab"
              >
                <i className="bi bi-card-checklist me-1"></i>
                <span>Notes & Actions</span>
              </button>
            )}

            <VideoCanvas
              isVideoOn={isVideoOn}
              isAudioOn={isAudioOn}
              localStream={localStream}
              screenStream={screenStream}
              isScreenSharing={isScreenSharing}
              localUser={user}
              remotePeers={remotePeers}
              capturedPeerIds={capturedPeerIds}
              onToggleCapturePeer={handleToggleCapturePeer}
            />

            <NotesDrawer
              isOpen={isNotesOpen}
              onClose={() => setIsNotesOpen(false)}
              user={user}
              tasks={tasks}
              transcript={transcript}
              onToggleTask={handleToggleTask}
              onAddTask={handleAddTask}
              onAddTranscript={handleAddTranscript}
              onExportPdf={handleExportPdf}
              onExtractTasks={handleExtractTasks}
              isExtracting={isExtracting}
              onAddToCalendar={handleAddToCalendar}
              capturedPeerIds={capturedPeerIds}
              capturedAudioClips={capturedAudioClips}
              remotePeers={remotePeers}
              onToggleCapturePeer={handleToggleCapturePeer}
              onDeleteClip={handleDeleteClip}
            />

            <ControlDock
              isAudioOn={isAudioOn}
              toggleAudio={toggleAudio}
              isVideoOn={isVideoOn}
              toggleVideo={toggleVideo}
              isScreenSharing={isScreenSharing}
              toggleScreenShare={toggleScreenShare}
              isNotesOpen={isNotesOpen}
              setIsNotesOpen={setIsNotesOpen}
              onLeaveCall={handleLeaveCall}
            />
          </main>
        </>
      )}

      <ArchitectureModal
        isOpen={isArchModalOpen}
        onClose={() => setIsArchModalOpen(false)}
      />
    </div>
  );
}
