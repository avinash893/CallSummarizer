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

function getInitialUser() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem('cs_google_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name && parsed.email) return parsed;
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
  const [transcript, setTranscript] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [appConfig, setAppConfig] = useState({
    googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
    turnstileSiteKey: import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || '',
    iceServers: DEFAULT_ICE_SERVERS
  });

  const wsRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

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
          window.localStorage.setItem('cs_google_user', JSON.stringify(nextUser));
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

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        setRemotePeers((prev) => {
          const exists = prev.some((p) => p.peerId === remotePeerId);
          if (exists) {
            return prev.map((p) =>
              p.peerId === remotePeerId ? { ...p, stream: remoteStream } : p
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
              stream: remoteStream
            }
          ];
        });
      }
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
            } catch (e) {}
          }
          break;
        }

        case 'webrtc-ice-candidate': {
          const senderId = msg.senderPeerId;
          const pc = peerConnectionsRef.current.get(senderId);
          if (pc && msg.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
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
          const pc = peerConnectionsRef.current.get(leftId);
          if (pc) {
            try {
              pc.close();
            } catch (e) {}
            peerConnectionsRef.current.delete(leftId);
          }
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

  // Web Speech API live transcription while in call and audio is unmuted
  useEffect(() => {
    if (!isInCall || !isAudioOn || typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    let recognition;
    let isActive = true;
    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-IN';

      recognition.onresult = (event) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult && lastResult.isFinal) {
          const spokenText = lastResult[0]?.transcript?.trim();
          if (spokenText) {
            const entry = {
              id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              speaker: user?.name || 'You',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: spokenText
            };
            setTranscript((prev) => [...prev, entry]);
            if (wsRef.current && wsRef.current.readyState === 1) {
              wsRef.current.send(JSON.stringify({ type: 'transcript-entry', entry }));
            }
          }
        }
      };

      recognition.onerror = () => {};
      recognition.onend = () => {
        if (isActive) {
          try {
            recognition.start();
          } catch (e) {}
        }
      };

      recognition.start();
    } catch (e) {}

    return () => {
      isActive = false;
      if (recognition) {
        try {
          recognition.stop();
        } catch (e) {}
      }
    };
  }, [isInCall, isAudioOn, user?.name]);

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

  const handleLeaveCall = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
    }
    setIsInCall(false);
    setIsScreenSharing(false);
    setRemotePeers([]);
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
        const videoTrack = displayStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            setIsScreenSharing(false);
            setScreenStream(null);
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
    setIsExtracting(true);
    try {
      const transcriptText =
        transcript.length > 0
          ? transcript.map((item) => `${item.speaker}: ${item.text}`).join('\n')
          : `${user?.name || 'You'}: We will review the meeting deliverables and finalize action items by tomorrow.`;
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
            <VideoCanvas
              isVideoOn={isVideoOn}
              isAudioOn={isAudioOn}
              localStream={localStream}
              screenStream={screenStream}
              isScreenSharing={isScreenSharing}
              localUser={user}
              remotePeers={remotePeers}
            />

            <NotesDrawer
              isOpen={isNotesOpen}
              tasks={tasks}
              transcript={transcript}
              onToggleTask={handleToggleTask}
              onAddTask={handleAddTask}
              onAddTranscript={handleAddTranscript}
              onExportPdf={handleExportPdf}
              onExtractTasks={handleExtractTasks}
              isExtracting={isExtracting}
              onAddToCalendar={handleAddToCalendar}
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
