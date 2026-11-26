import React, { useEffect, useRef, useState } from 'react';
import ScaleWatcherDial from './ScaleWatcherDial';
import PitchMelodyCanvas from './PitchMelodyCanvas';
import {
  analyzeAudioBufferPitchAsync,
  autoDetectVocalScaleAndRange,
  findNearestSwara,
  findActiveTargetBar,
  evaluatePitchMatch,
  autoCorrelate,
  midiToNoteName
} from '../audio/sargamEngine';

function formatClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PitchAndLyricsView({
  jamState,
  onUpdateJamState,
  liveMicPitch,
  backingState,
  onUpdateBackingState,
  onSyncBackingToRoom,
  roomName = '',
  selfPeerId = null,
  leaderPeerId = null,
  leaderName = '',
  onSendBackingControl = null,
  onClaimLeader = null,
  backingControlEvent = null,
  getServerNowMs = () => Date.now()
}) {
  const isLeader = !leaderPeerId || !selfPeerId || leaderPeerId === selfPeerId;
  const [songUrlInput, setSongUrlInput] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [vocalVol, setVocalVol] = useState(backingState?.vocalVol ?? 0.85);
  const [instVol, setInstVol] = useState(backingState?.instVol ?? 0.75);
  const [currentTime, setCurrentTime] = useState(backingState?.currentTime || 0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [refPitchInfo, setRefPitchInfo] = useState(null);
  const [showLyricsEditor, setShowLyricsEditor] = useState(false);
  const [lyricsDraft, setLyricsDraft] = useState('');
  const [needsCookieHint, setNeedsCookieHint] = useState(false);
  const [tolerancePct, setTolerancePct] = useState(0.10);
  const [sessionStats, setSessionStats] = useState({
    totalFrames: 0,
    matchedFrames: 0,
    flatFrames: 0,
    sharpFrames: 0,
    errorSum: 0,
    streak: 0,
    bestStreak: 0
  });

  const vocalAudioRef = useRef(null);
  const instAudioRef = useRef(null);
  const fileInputRef = useRef(null);
  const cookieInputRef = useRef(null);
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceConnectedRef = useRef(false);
  const lastAppliedSeqRef = useRef(0);
  const isScrubbingRef = useRef(false);
  const lastSeekSendRef = useRef(0);
  const seekTimerRef = useRef(null);
  const playAttemptRef = useRef(0);
  const followerAnchorRef = useRef(null);

  const resetPlaybackRates = () => {
    if (vocalAudioRef.current) vocalAudioRef.current.playbackRate = 1.0;
    if (instAudioRef.current) instAudioRef.current.playbackRate = 1.0;
  };

  useEffect(() => {
    return () => {
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    };
  }, []);

  // Check cloud stem separator availability
  useEffect(() => {
    let active = true;
    fetch('/api/sargam/health')
      .then((r) => r.json())
      .then((d) => {
        if (active) setBackendStatus(d.ok ? 'online' : 'offline');
      })
      .catch(() => {
        if (active) setBackendStatus('offline');
      });
    return () => { active = false; };
  }, []);

  // Keep dual stem audio element volumes updated
  useEffect(() => {
    if (typeof backingState?.vocalVol === 'number') setVocalVol(backingState.vocalVol);
    if (typeof backingState?.instVol === 'number') setInstVol(backingState.instVol);
  }, [backingState?.vocalVol, backingState?.instVol]);

  useEffect(() => {
    if (vocalAudioRef.current) vocalAudioRef.current.volume = vocalVol;
  }, [vocalVol]);

  useEffect(() => {
    if (instAudioRef.current) instAudioRef.current.volume = instVol;
  }, [instVol]);

  // Synchronize shared audio sources across participants
  useEffect(() => {
    if (!backingState) return;
    const vEl = vocalAudioRef.current;
    const iEl = instAudioRef.current;
    let changed = false;
    if (vEl && backingState.vocalUrl && vEl.getAttribute('src') !== backingState.vocalUrl) {
      vEl.src = backingState.vocalUrl;
      changed = true;
    } else if (vEl && !backingState.vocalUrl && vEl.getAttribute('src')) {
      vEl.pause();
      vEl.removeAttribute('src');
      changed = true;
    }
    if (iEl && backingState.instUrl && iEl.getAttribute('src') !== backingState.instUrl) {
      iEl.src = backingState.instUrl;
      changed = true;
    } else if (iEl && !backingState.instUrl && iEl.getAttribute('src')) {
      iEl.pause();
      iEl.removeAttribute('src');
      changed = true;
    }
    if (changed && !backingState.isPlaying) {
      vEl?.pause();
      iEl?.pause();
      setIsPlaying(false);
      setCurrentTime(backingState.currentTime || 0);
    }
  }, [backingState?.vocalUrl, backingState?.instUrl]);

  // Synchronize Leader event-driven transport commands (play, pause, stop, seek, volume)
  useEffect(() => {
    if (!backingControlEvent) return;
    if (backingControlEvent.seq && backingControlEvent.seq <= lastAppliedSeqRef.current) return;
    if (backingControlEvent.seq) lastAppliedSeqRef.current = backingControlEvent.seq;

    const vEl = vocalAudioRef.current;
    const iEl = instAudioRef.current;
    const serverNow = getServerNowMs();
    const eventServerMs = Number.isFinite(Number(backingControlEvent.sentAt))
      ? Number(backingControlEvent.sentAt)
      : serverNow;
    const baseTime = backingControlEvent.action === 'stop' ? 0 : Math.max(0, Number(backingControlEvent.currentTime || 0));
    const driftSec =
      backingControlEvent.isPlaying
        ? Math.max(0, Math.min(2.5, (serverNow - eventServerMs) / 1000))
        : 0;
    const targetSec = backingControlEvent.action === 'stop' ? 0 : Math.max(0, baseTime + driftSec);

    if (typeof backingControlEvent.vocalVol === 'number') setVocalVol(backingControlEvent.vocalVol);
    if (typeof backingControlEvent.instVol === 'number') setInstVol(backingControlEvent.instVol);

    if (backingControlEvent.action === 'stop' || backingControlEvent.action === 'pause' || backingControlEvent.isPlaying === false) {
      followerAnchorRef.current = null;
      resetPlaybackRates();
      vEl?.pause();
      iEl?.pause();
      if (vEl && Math.abs((vEl.currentTime || 0) - targetSec) > 0.08) {
        try { vEl.currentTime = targetSec; } catch (e) {}
      }
      if (iEl && backingState?.instUrl && Math.abs((iEl.currentTime || 0) - targetSec) > 0.08) {
        try { iEl.currentTime = targetSec; } catch (e) {}
      }
      setCurrentTime(targetSec);
      setIsPlaying(false);
      setNeedsAudioUnlock(false);
      return;
    }

    if (backingControlEvent.action === 'play' || backingControlEvent.action === 'seek' || backingControlEvent.isPlaying === true) {
      followerAnchorRef.current = { playing: Boolean(backingControlEvent.isPlaying), baseTime, serverAnchorMs: eventServerMs };

      if (vEl && Math.abs((vEl.currentTime || 0) - targetSec) > 0.08) {
        try { vEl.currentTime = targetSec; } catch (e) {}
      }
      if (iEl && backingState?.instUrl && Math.abs((iEl.currentTime || 0) - targetSec) > 0.08) {
        try { iEl.currentTime = targetSec; } catch (e) {}
      }
      setCurrentTime(targetSec);

      const alreadyPlaying = Boolean((vEl && !vEl.paused) || (iEl && !iEl.paused));
      if (backingControlEvent.isPlaying && (!alreadyPlaying || backingControlEvent.action === 'play')) {
        if (!backingState?.noteBars?.length) {
          ensureVocalAnalyser();
        }
        if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }
        const tasks = [];
        if (backingState?.vocalUrl && vEl) tasks.push(vEl.play());
        if (backingState?.instUrl && iEl) tasks.push(iEl.play());
        Promise.allSettled(tasks).then((results) => {
          const allFailed = tasks.length > 0 && results.every((r) => r.status === 'rejected');
          if (allFailed) {
            setIsPlaying(false);
            setNeedsAudioUnlock(true);
            setStatusMsg('Leader started playback — click Play once to unlock browser audio.');
            return;
          }
          // One-time post-buffer alignment when playback begins, then let local playback run undisturbed
          const anchor = followerAnchorRef.current;
          if (anchor?.playing) {
            const liveExpected = Math.max(0, anchor.baseTime + Math.max(0, (getServerNowMs() - anchor.serverAnchorMs) / 1000));
            if (vEl && Math.abs((vEl.currentTime || 0) - liveExpected) > 0.08) {
              try { vEl.currentTime = liveExpected; } catch (e) {}
            }
            if (iEl && backingState?.instUrl && Math.abs((iEl.currentTime || 0) - liveExpected) > 0.08) {
              try { iEl.currentTime = liveExpected; } catch (e) {}
            }
            setCurrentTime(liveExpected);
          }
          resetPlaybackRates();
          setIsPlaying(true);
          setNeedsAudioUnlock(false);
        });
      }
    }
  }, [backingControlEvent]);

  const stopPlaybackLoop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const ensureVocalAnalyser = () => {
    if (sourceConnectedRef.current || !vocalAudioRef.current || typeof window === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(vocalAudioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceConnectedRef.current = true;
    } catch (e) {
      // CrossOrigin/JSDOM fallback relies on pre-extracted noteBars for reference pitch
    }
  };

  useEffect(() => {
    if (!isPlaying) {
      stopPlaybackLoop();
      return;
    }
    const buf = analyserRef.current ? new Float32Array(analyserRef.current.fftSize) : null;

    const tick = () => {
      const vEl = vocalAudioRef.current;
      const iEl = instAudioRef.current;
      const t = vEl?.currentTime || iEl?.currentTime || 0;
      const d = vEl?.duration || iEl?.duration || duration || 0;
      if (!isScrubbingRef.current) {
        setCurrentTime(t);
      }
      if (d && Number.isFinite(d)) setDuration(d);

      // Keep inst stem aligned with vocal stem only if severely out of phase (>0.25s)
      if (vEl && iEl && backingState?.instUrl && Math.abs((vEl.currentTime || 0) - (iEl.currentTime || 0)) > 0.25) {
        try { iEl.currentTime = vEl.currentTime; } catch (e) {}
      }

      let foundRef = null;
      if (analyserRef.current && buf) {
        analyserRef.current.getFloatTimeDomainData(buf);
        const hz = autoCorrelate(buf, audioCtxRef.current?.sampleRate || 44100);
        if (hz > 0) {
          foundRef = findNearestSwara(hz, jamState.tonicMidi, jamState.tuningMode, jamState.raga);
        }
      }
      if (!foundRef && Array.isArray(backingState?.noteBars)) {
        const activeBar = backingState.noteBars.find((b) => t >= b.start && t <= b.end);
        if (activeBar) {
          foundRef = findNearestSwara(activeBar.freq, jamState.tonicMidi, jamState.tuningMode, jamState.raga);
        }
      }
      setRefPitchInfo(foundRef);

      if (vEl?.ended) {
        resetPlaybackRates();
        if (vEl) try { vEl.currentTime = 0; } catch (e) {}
        if (iEl) try { iEl.currentTime = 0; } catch (e) {}
        setCurrentTime(0);
        setIsPlaying(false);
        if (isLeader) {
          onSendBackingControl?.({ action: 'stop', currentTime: 0, vocalVol, instVol });
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stopPlaybackLoop;
  }, [isPlaying, isLeader, vocalVol, instVol, onSendBackingControl, jamState.tonicMidi, jamState.tuningMode, jamState.raga, backingState?.noteBars, backingState?.instUrl]);

  const togglePlay = async () => {
    const vEl = vocalAudioRef.current;
    const iEl = instAudioRef.current;
    if (!backingState?.vocalUrl && !backingState?.instUrl) return;

    if (!isLeader) {
      if (needsAudioUnlock || (backingState?.isPlaying && !isPlaying)) {
        if (!backingState?.noteBars?.length) {
          ensureVocalAnalyser();
        }
        if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }
        const anchor = followerAnchorRef.current;
        const offset = anchor?.playing
          ? Math.max(0, anchor.baseTime + Math.max(0, (getServerNowMs() - anchor.serverAnchorMs) / 1000))
          : Number(backingState?.currentTime || currentTime || 0);
        if (vEl && offset > 0) try { vEl.currentTime = offset; } catch (e) {}
        if (iEl && offset > 0) try { iEl.currentTime = offset; } catch (e) {}
        const tasks = [];
        if (backingState?.vocalUrl && vEl) tasks.push(vEl.play());
        if (backingState?.instUrl && iEl) tasks.push(iEl.play());
        const results = await Promise.allSettled(tasks);
        const allFailed = tasks.length > 0 && results.every((r) => r.status === 'rejected');
        if (allFailed) {
          setStatusMsg('Click play again to unlock browser audio.');
          return;
        }
        const liveExpected = anchor?.playing
          ? Math.max(0, anchor.baseTime + Math.max(0, (getServerNowMs() - anchor.serverAnchorMs) / 1000))
          : offset;
        if (vEl && Math.abs((vEl.currentTime || 0) - liveExpected) > 0.06) try { vEl.currentTime = liveExpected; } catch (e) {}
        if (iEl && backingState?.instUrl && Math.abs((iEl.currentTime || 0) - liveExpected) > 0.06) try { iEl.currentTime = liveExpected; } catch (e) {}
        setIsPlaying(true);
        setNeedsAudioUnlock(false);
        setStatusMsg(`Synced with Leader (${leaderName || 'Host'}).`);
        return;
      }
      setStatusMsg(`Only Leader (${leaderName || 'Host'}) controls playback. Click Take Leader to control.`);
      return;
    }

    const actuallyPlaying =
      isPlaying ||
      Boolean(vEl && !vEl.paused && !vEl.ended) ||
      Boolean(iEl && !iEl.paused && !iEl.ended);

    if (actuallyPlaying) {
      playAttemptRef.current += 1;
      const pausedAt = vEl?.currentTime || iEl?.currentTime || currentTime || 0;
      resetPlaybackRates();
      vEl?.pause();
      iEl?.pause();
      setIsPlaying(false);
      onSendBackingControl?.({ action: 'pause', currentTime: pausedAt, vocalVol, instVol });
      return;
    }

    if (!backingState?.noteBars?.length) {
      ensureVocalAnalyser();
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    if (vEl?.ended) try { vEl.currentTime = 0; } catch (e) {}
    if (iEl?.ended) try { iEl.currentTime = 0; } catch (e) {}

    const opId = ++playAttemptRef.current;
    const tasks = [];
    if (backingState?.vocalUrl && vEl) tasks.push(vEl.play());
    if (backingState?.instUrl && iEl) tasks.push(iEl.play());

    const results = await Promise.allSettled(tasks);
    if (opId !== playAttemptRef.current) return;

    const allFailed = tasks.length > 0 && results.every((r) => r.status === 'rejected');
    if (allFailed) {
      setIsPlaying(false);
      setStatusMsg('Audio still buffering — click Play again.');
      return;
    }

    // Align beat stem cleanly with vocal stem right as playback begins
    if (vEl && iEl && backingState?.instUrl && Math.abs((vEl.currentTime || 0) - (iEl.currentTime || 0)) > 0.05) {
      try { iEl.currentTime = vEl.currentTime; } catch (e) {}
    }
    const liveStart = vEl?.currentTime || iEl?.currentTime || currentTime || 0;
    resetPlaybackRates();
    setIsPlaying(true);
    setNeedsAudioUnlock(false);
    onSendBackingControl?.({ action: 'play', currentTime: liveStart, vocalVol, instVol });
  };

  const handleStop = () => {
    if (!isLeader) {
      setStatusMsg(`Only Leader (${leaderName || 'Host'}) can stop playback.`);
      return;
    }
    playAttemptRef.current += 1;
    const vEl = vocalAudioRef.current;
    const iEl = instAudioRef.current;
    resetPlaybackRates();
    vEl?.pause();
    iEl?.pause();
    if (vEl) try { vEl.currentTime = 0; } catch (e) {}
    if (iEl) try { iEl.currentTime = 0; } catch (e) {}
    setIsPlaying(false);
    setCurrentTime(0);
    setNeedsAudioUnlock(false);
    onSendBackingControl?.({ action: 'stop', currentTime: 0, vocalVol, instVol });
  };

  const handleSeek = (targetSec, immediate = true) => {
    if (!isLeader) return;
    const clamped = Math.max(0, Math.min(duration || 600, targetSec));
    setCurrentTime(clamped);
    if (immediate) {
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
      if (vocalAudioRef.current) try { vocalAudioRef.current.currentTime = clamped; } catch (e) {}
      if (instAudioRef.current) try { instAudioRef.current.currentTime = clamped; } catch (e) {}
      lastSeekSendRef.current = Date.now();
      onSendBackingControl?.({ action: 'seek', currentTime: clamped, vocalVol, instVol });
      return;
    }
    const elapsed = Date.now() - lastSeekSendRef.current;
    if (elapsed >= 90) {
      if (vocalAudioRef.current) try { vocalAudioRef.current.currentTime = clamped; } catch (e) {}
      if (instAudioRef.current) try { instAudioRef.current.currentTime = clamped; } catch (e) {}
      lastSeekSendRef.current = Date.now();
      onSendBackingControl?.({ action: 'seek', currentTime: clamped, vocalVol, instVol });
    } else {
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => {
        if (vocalAudioRef.current) try { vocalAudioRef.current.currentTime = clamped; } catch (e) {}
        if (instAudioRef.current) try { instAudioRef.current.currentTime = clamped; } catch (e) {}
        lastSeekSendRef.current = Date.now();
        onSendBackingControl?.({ action: 'seek', currentTime: clamped, vocalVol, instVol });
      }, 90);
    }
  };

  const applyDetectedScale = (bars) => {
    if (!Array.isArray(bars) || bars.length === 0) return null;
    const fit = autoDetectVocalScaleAndRange(bars);
    if (fit && fit.confidence > 20) {
      onUpdateJamState({ tonicMidi: fit.tonicMidi });
      return midiToNoteName(fit.tonicMidi);
    }
    return null;
  };

  const fetchPitchAndLyricsForVocal = async (vocalUrl, basePatch = {}) => {
    if (!vocalUrl) return;
    setStatusMsg('Extracting Whisper Lyrics & YIN Pitch Contour...');
    try {
      const res = await fetch(`/api/sargam/get-pitch-and-lyrics?vocal_url=${encodeURIComponent(vocalUrl)}`);
      if (!res.ok) throw new Error('Pitch extraction unavailable');
      const data = await res.json();
      const bars = Array.isArray(data.noteBars)
        ? data.noteBars
        : Array.isArray(data.pitch_curve)
          ? data.pitch_curve.map((p, idx, arr) => ({
              start: p.time,
              end: arr[idx + 1]?.time || p.time + 0.08,
              freq: p.freq,
              midi: p.freq > 0 ? 69 + 12 * Math.log2(p.freq / 440) : 60
            })).filter((b) => b.freq > 60)
          : [];

      const lyrics = Array.isArray(data.lyrics) ? data.lyrics : [];
      onUpdateBackingState({
        ...basePatch,
        noteBars: bars,
        lyrics
      }, { broadcast: true });
      const detectedScale = applyDetectedScale(bars);
      setStatusMsg(
        `Shared with room: ${bars.length} pitch notes & ${lyrics.length} lyric lines${detectedScale ? ` • Scale: ${detectedScale}` : '.'}`
      );
    } catch (e) {
      setStatusMsg('Stems loaded & shared! (Cloud lyric extractor unavailable — use CPU Pitch Fit if needed.)');
    }
  };

  const handleSeparateUrl = async () => {
    if (!songUrlInput.trim()) return;
    setIsBusy(true);
    setNeedsCookieHint(false);
    setStatusMsg('Separating vocals & backing stems via Cloud AI...');
    try {
      const res = await fetch('/api/sargam/separate-stems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: songUrlInput.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403 || /cookie|bot/i.test(data.error || '')) {
          setNeedsCookieHint(true);
        }
        throw new Error(data.error || 'Separation failed');
      }

      const inlineBars = Array.isArray(data.noteBars) ? data.noteBars : [];
      const inlineLyrics = Array.isArray(data.lyrics) ? data.lyrics : [];
      const stemPatch = {
        title: data.title || 'AI Separated Song',
        vocalUrl: data.vocalUrl || '',
        instUrl: data.instUrl || '',
        noteBars: inlineBars,
        lyrics: inlineLyrics,
        isPlaying: false,
        currentTime: 0
      };

      onUpdateBackingState(stemPatch, { broadcast: true });

      if (inlineBars.length > 0) {
        const detectedScale = applyDetectedScale(inlineBars);
        setStatusMsg(
          `Shared with room (Cloud AI): ${inlineBars.length} note bars & ${inlineLyrics.length} lyric cues${detectedScale ? ` • Key: ${detectedScale}` : '.'}`
        );
      } else {
        await fetchPitchAndLyricsForVocal(data.vocalUrl, stemPatch);
      }
    } catch (err) {
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCookieUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsBusy(true);
    setStatusMsg('Uploading YouTube cookies.txt to Modal Cloud Cache...');
    try {
      const rawBytes = await file.arrayBuffer();
      const res = await fetch('/api/sargam/upload-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: rawBytes
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cookie upload failed');
      setNeedsCookieHint(false);
      setStatusMsg('YouTube cookies synced to Cloud! Click Split Stems again.');
    } catch (err) {
      setStatusMsg(`Cookie upload error: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileUpload = async (e, localOnly = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsBusy(true);

    try {
      const blobUrl = URL.createObjectURL(file);
      const trackTitle = file.name.replace(/\.[^.]+$/, '');
      onUpdateBackingState({
        title: trackTitle,
        vocalUrl: blobUrl,
        instUrl: '',
        noteBars: [],
        lyrics: [],
        isPlaying: false,
        currentTime: 0
      });

      if (localOnly || backendStatus === 'offline') {
        setStatusMsg('Analyzing pitch contour & sharing track to room...');
        const rawBytes = await file.arrayBuffer();
        let shareableUrl = blobUrl;
        if (roomName) {
          try {
            const shareRes = await fetch(`/api/rooms/${encodeURIComponent(roomName)}/shared-audio`, {
              method: 'POST',
              headers: { 'Content-Type': file.type || 'audio/mpeg' },
              body: rawBytes
            });
            if (shareRes.ok) {
              const shareData = await shareRes.json();
              if (shareData.url) shareableUrl = shareData.url;
            }
          } catch (e) {}
        }

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const audioBuf = await ctx.decodeAudioData(rawBytes.slice(0));
          setDuration(audioBuf.duration);
          const { noteBars } = await analyzeAudioBufferPitchAsync(audioBuf, (pct) => {
            setStatusMsg(`Analyzing pitch in-browser: ${pct}%`);
          });
          const fit = autoDetectVocalScaleAndRange(noteBars);
          onUpdateBackingState({
            title: trackTitle,
            vocalUrl: shareableUrl,
            instUrl: '',
            noteBars,
            isPlaying: false,
            currentTime: 0
          }, { broadcast: true });
          if (fit && fit.confidence > 25) {
            onUpdateJamState({ tonicMidi: fit.tonicMidi });
            setStatusMsg(`Shared ${noteBars.length} notes • Key: ${midiToNoteName(fit.tonicMidi)} (${fit.confidence}% match)`);
          } else {
            setStatusMsg(`Shared ${noteBars.length} pitch notes with room.`);
          }
          try { await ctx.close(); } catch (err) {}
        } else {
          onUpdateBackingState({
            title: trackTitle,
            vocalUrl: shareableUrl,
            instUrl: '',
            isPlaying: false,
            currentTime: 0
          }, { broadcast: true });
        }
      } else {
        setStatusMsg('Uploading track to AI Demucs GPU splitter...');
        const rawBytes = await file.arrayBuffer();
        const res = await fetch('/api/sargam/separate-stems-file', {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'audio/mpeg',
            'x-filename': file.name
          },
          body: rawBytes
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload separation failed');
        const stemPatch = {
          title: data.title || trackTitle,
          vocalUrl: data.vocalUrl || blobUrl,
          instUrl: data.instUrl || '',
          noteBars: Array.isArray(data.noteBars) ? data.noteBars : [],
          lyrics: Array.isArray(data.lyrics) ? data.lyrics : [],
          isPlaying: false,
          currentTime: 0
        };
        onUpdateBackingState(stemPatch, { broadcast: true });
        if (stemPatch.noteBars.length > 0) {
          const detectedScale = applyDetectedScale(stemPatch.noteBars);
          setStatusMsg(
            `Shared with room (Cloud AI): ${stemPatch.noteBars.length} note bars & ${stemPatch.lyrics.length} lyric cues${detectedScale ? ` • Key: ${detectedScale}` : '.'}`
          );
        } else if (data.vocalUrl) {
          await fetchPitchAndLyricsForVocal(data.vocalUrl, stemPatch);
        }
      }
    } catch (err) {
      setStatusMsg(`Load failed: ${err.message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleAutoDetectKey = () => {
    if (!backingState?.noteBars?.length) return;
    const fit = autoDetectVocalScaleAndRange(backingState.noteBars);
    onUpdateJamState({ tonicMidi: fit.tonicMidi });
    setStatusMsg(`Detected Key: ${midiToNoteName(fit.tonicMidi)} (Confidence ${fit.confidence}%)`);
  };

  const saveManualLyrics = () => {
    const lines = lyricsDraft
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const total = Math.max(duration || 120, lines.length * 4);
    const step = total / Math.max(1, lines.length);
    const parsed = lines.map((text, idx) => ({
      start: Number((idx * step).toFixed(2)),
      end: Number(((idx + 1) * step).toFixed(2)),
      text
    }));
    onUpdateBackingState({ lyrics: parsed }, { broadcast: true, preserveLeader: true });
    setShowLyricsEditor(false);
    setStatusMsg(`Updated & shared ${parsed.length} cue lines for jam room.`);
  };

  const activeTargetBar = findActiveTargetBar(backingState?.noteBars, currentTime);
  const liveMatch = evaluatePitchMatch(liveMicPitch?.freq, activeTargetBar, tolerancePct);

  useEffect(() => {
    setSessionStats({
      totalFrames: 0,
      matchedFrames: 0,
      flatFrames: 0,
      sharpFrames: 0,
      errorSum: 0,
      streak: 0,
      bestStreak: 0
    });
  }, [backingState?.title, backingState?.vocalUrl]);

  useEffect(() => {
    if (!liveMicPitch || liveMicPitch.freq <= 50) return;
    const bar = findActiveTargetBar(backingState?.noteBars, currentTime);
    const m = evaluatePitchMatch(liveMicPitch.freq, bar, tolerancePct);
    if (!m) return;
    setSessionStats((prev) => {
      const nextStreak = m.isMatched ? prev.streak + 1 : 0;
      return {
        totalFrames: prev.totalFrames + 1,
        matchedFrames: prev.matchedFrames + (m.isMatched ? 1 : 0),
        flatFrames: prev.flatFrames + (!m.isMatched && m.direction === 'flat' ? 1 : 0),
        sharpFrames: prev.sharpFrames + (!m.isMatched && m.direction === 'sharp' ? 1 : 0),
        errorSum: prev.errorSum + m.errorPct,
        streak: nextStreak,
        bestStreak: Math.max(prev.bestStreak, nextStreak)
      };
    });
  }, [liveMicPitch, backingState?.noteBars, tolerancePct]);

  const tolLabel = Math.round(tolerancePct * 100);
  const sessionAcc = sessionStats.totalFrames > 0
    ? Math.round((sessionStats.matchedFrames / sessionStats.totalFrames) * 100)
    : null;
  const sessionFlatPct = sessionStats.totalFrames > 0
    ? Math.round((sessionStats.flatFrames / sessionStats.totalFrames) * 100)
    : 0;
  const sessionSharpPct = sessionStats.totalFrames > 0
    ? Math.round((sessionStats.sharpFrames / sessionStats.totalFrames) * 100)
    : 0;

  const activeLyricIndex = (backingState?.lyrics || []).findIndex(
    (l) => currentTime >= (l.start || 0) && currentTime <= (l.end ?? l.start + 6)
  );

  return (
    <div className="pitch-lyrics-view" data-testid="pitch-lyrics-view">
      {/* Top Track Loader & Stems Transport */}
      <div className="plv-top-panel">
        <div className="plv-loader-row">
          <div className="plv-url-group">
            <span className={`plv-cloud-badge ${backendStatus}`} title="Modal AI Demucs + Whisper Server Status">
              <span className="dot" />
              AI Stems: {backendStatus === 'online' ? 'GPU Ready' : backendStatus === 'checking' ? 'Checking...' : 'Local CPU Mode'}
            </span>
            <input
              type="text"
              className="form-control plv-url-input"
              placeholder="Paste YouTube or audio URL to split vocals & backing track..."
              value={songUrlInput}
              onChange={(e) => setSongUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isBusy && songUrlInput.trim()) {
                  e.preventDefault();
                  handleSeparateUrl();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm plv-split-btn"
              disabled={isBusy || !songUrlInput.trim()}
              onClick={handleSeparateUrl}
            >
              <i className="bi bi-magic"></i>
              <span>{isBusy ? 'Processing...' : 'Split Stems'}</span>
            </button>
          </div>

          <div className="plv-upload-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="d-none"
              onChange={(e) => handleFileUpload(e, backendStatus !== 'online')}
            />
            <input
              ref={cookieInputRef}
              type="file"
              accept=".txt,text/plain"
              className="d-none"
              onChange={handleCookieUpload}
            />
            <button
              type="button"
              className="btn btn-outline-secondary btn-secondary-action btn-sm"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <i className="bi bi-upload me-1"></i>
              Load Audio / Song
            </button>
            {needsCookieHint && (
              <button
                type="button"
                className="btn btn-outline-warning btn-sm"
                disabled={isBusy}
                onClick={() => cookieInputRef.current?.click()}
                title="Upload Netscape cookies.txt for cloud YouTube downloads"
              >
                <i className="bi bi-key me-1"></i>
                Upload YT Cookies
              </button>
            )}
            {backingState?.noteBars?.length > 0 && (
              <button type="button" className="btn btn-outline-warning btn-sm" onClick={handleAutoDetectKey}>
                <i className="bi bi-stars me-1"></i>
                Auto-Detect Key
              </button>
            )}
            {onSyncBackingToRoom && (backingState?.vocalUrl || backingState?.lyrics?.length > 0) && (
              <button
                type="button"
                className="btn btn-outline-info btn-sm"
                onClick={() => onSyncBackingToRoom()}
                title="Re-share loaded song stems & lyrics with everyone in the room"
              >
                <i className="bi bi-share me-1"></i>
                Share to Room
              </button>
            )}
            {leaderPeerId && (
              <span className="plv-leader-pill" data-testid="backing-leader-badge">
                <i className="bi bi-broadcast me-1"></i>
                {isLeader ? 'Leader: You' : `Leader: ${leaderName || 'Host'}`}
              </span>
            )}
            {!isLeader && onClaimLeader && (
              <button
                type="button"
                className="btn btn-outline-warning btn-sm"
                data-testid="btn-claim-leader"
                onClick={onClaimLeader}
                title="Take playback control for the whole room"
              >
                Take Leader
              </button>
            )}
          </div>
        </div>

        {/* Transport & Stem Faders */}
        {(backingState?.vocalUrl || backingState?.instUrl || statusMsg) && (
          <div className="plv-transport-bar">
            {(backingState?.vocalUrl || backingState?.instUrl) && (
              <div className="plv-player-controls">
                <button
                  type="button"
                  className={`plv-play-btn ${isPlaying ? 'playing' : ''}`}
                  onClick={togglePlay}
                  disabled={!isLeader && !needsAudioUnlock && !(backingState?.isPlaying && !isPlaying)}
                  aria-label={isPlaying ? 'Pause backing stems' : 'Play backing stems'}
                  title={isLeader ? (isPlaying ? 'Pause for room' : 'Play for room') : (needsAudioUnlock ? 'Unlock local audio sync' : `Controlled by ${leaderName || 'Leader'}`)}
                >
                  <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'}`}></i>
                </button>
                <button
                  type="button"
                  className="plv-stop-btn"
                  data-testid="btn-backing-stop"
                  onClick={handleStop}
                  disabled={!isLeader}
                  aria-label="Stop backing stems"
                  title={isLeader ? 'Stop & reset playback for room' : `Controlled by ${leaderName || 'Leader'}`}
                >
                  <i className="bi bi-stop-fill"></i>
                </button>
                <div className="plv-track-meta">
                  <strong>{backingState.title || 'Loaded Jam Track'}</strong>
                  <span>{formatClock(currentTime)} / {formatClock(duration)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  step="0.1"
                  value={currentTime}
                  disabled={!isLeader}
                  onPointerDown={() => { isScrubbingRef.current = true; }}
                  onPointerUp={(e) => {
                    isScrubbingRef.current = false;
                    handleSeek(Number(e.currentTarget.value), true);
                  }}
                  onChange={(e) => handleSeek(Number(e.target.value), false)}
                  className="plv-scrubber"
                  aria-label="Track seek slider"
                />
                <div className="plv-stem-faders">
                  <label>
                    <span>Vocal</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.02"
                      value={vocalVol}
                      onChange={(e) => {
                        const nextVal = Number(e.target.value);
                        setVocalVol(nextVal);
                        if (isLeader) {
                          onSendBackingControl?.({ action: 'volume', currentTime, vocalVol: nextVal, instVol });
                        }
                      }}
                    />
                  </label>
                  {backingState.instUrl && (
                    <label>
                      <span>Beat</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.02"
                        value={instVol}
                        onChange={(e) => {
                          const nextVal = Number(e.target.value);
                          setInstVol(nextVal);
                          if (isLeader) {
                            onSendBackingControl?.({ action: 'volume', currentTime, vocalVol, instVol: nextVal });
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
            {statusMsg && <div className="plv-status-text">{statusMsg}</div>}
          </div>
        )}
      </div>

      {/* Real-Time Pitch Tolerance Banner (fixed pixel tracks — zero jiggle on state change) */}
      <div
        className={`plv-match-banner ${liveMatch ? (liveMatch.isMatched ? 'matched' : 'off-pitch') : ''}`}
        data-testid="pitch-match-banner"
      >
        <div className="plv-match-status">
          <span className="plv-match-indicator" />
          <span className="plv-match-text">
            {liveMatch?.isMatched
              ? `In Tune · ${liveMatch.errorPct}% error`
              : liveMatch
                ? `${liveMatch.direction === 'flat' ? 'Flat (Too Low)' : 'Sharp (Too High)'} · ${liveMatch.errorPct}% err`
                : liveMicPitch?.freq > 50
                  ? `${liveMicPitch.noteName || ''} · ${liveMicPitch.freq} Hz`
                  : `Sing to match (≤ ${tolLabel}% tol)`}
          </span>
        </div>

        <div className="plv-match-metrics">
          <span className={`plv-metric-pill plv-metric-err ${liveMatch ? (liveMatch.isMatched ? 'ok' : 'warn') : ''}`} data-testid="pitch-diff-badge">
            {liveMatch ? `Err ${liveMatch.errorPct}%` : 'Diff --'}
          </span>
          <span className="plv-metric-pill plv-metric-acc" data-testid="pitch-accuracy-badge">
            {sessionAcc !== null ? `Acc ${sessionAcc}%` : 'Acc --'}
          </span>
          <span className="plv-metric-pill plv-metric-fs">
            F {sessionFlatPct}% · S {sessionSharpPct}%
          </span>
          <span className="plv-metric-pill plv-metric-stk">
            Streak {sessionStats.streak}
          </span>
          <div className="plv-tolerance-group" role="group" aria-label="Pitch error tolerance">
            {[0.05, 0.10, 0.15].map((tol) => (
              <button
                key={tol}
                type="button"
                className={`plv-tol-btn ${tolerancePct === tol ? 'active' : ''}`}
                onClick={() => setTolerancePct(tol)}
              >
                {Math.round(tol * 100)}%
              </button>
            ))}
          </div>
          <button
            type="button"
            className="plv-tol-btn plv-reset-btn"
            disabled={sessionStats.totalFrames === 0}
            onClick={() =>
              setSessionStats({
                totalFrames: 0,
                matchedFrames: 0,
                flatFrames: 0,
                sharpFrames: 0,
                errorSum: 0,
                streak: 0,
                bestStreak: 0
              })
            }
            title="Reset pitch accuracy session counters"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Main Split: Dual SVG Scale Watchers + Interactive Piano Roll */}
      <div className="plv-stage-grid">
        <div className="plv-dials-col">
          <ScaleWatcherDial
            title="Your Mic Pitch"
            subtitle="Real-time F0 Pitch"
            pitchInfo={liveMicPitch}
            accentColor="var(--accent-primary)"
            emptyLabel="Sing into mic..."
          />
          <ScaleWatcherDial
            title="Target Song Vocal"
            subtitle="Reference Melody"
            pitchInfo={refPitchInfo}
            accentColor="var(--accent-secondary)"
            emptyLabel="Play track or load stems..."
          />
        </div>

        <div className="plv-canvas-col">
          <PitchMelodyCanvas
            noteBars={backingState?.noteBars || []}
            currentTime={currentTime}
            duration={duration}
            tonicMidi={jamState.tonicMidi}
            raga={jamState.raga}
            tuningMode={jamState.tuningMode}
            liveMicPitch={liveMicPitch}
            onSeek={handleSeek}
            tolerancePct={tolerancePct}
            liveMatch={liveMatch}
          />
        </div>
      </div>

      {/* Interactive Click-to-Jump Lyrics & Cue Sheet */}
      <div className="plv-lyrics-panel">
        <div className="plv-lyrics-header">
          <div>
            <i className="bi bi-music-note-list me-2 text-warning"></i>
            <strong>Synced Lyrics & Cue Sheet</strong>
            <span className="ms-2 text-muted small">Click any line to seek playback</span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              setLyricsDraft((backingState?.lyrics || []).map((l) => l.text).join('\n'));
              setShowLyricsEditor(!showLyricsEditor);
            }}
          >
            {showLyricsEditor ? 'Cancel' : 'Edit / Paste Lyrics'}
          </button>
        </div>

        {showLyricsEditor ? (
          <div className="plv-lyrics-editor">
            <textarea
              className="form-control"
              rows={3}
              placeholder="Paste lyrics or vocal cues (one line per phrase)..."
              value={lyricsDraft}
              onChange={(e) => setLyricsDraft(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm mt-2" onClick={saveManualLyrics}>
              Apply Cue Sheet
            </button>
          </div>
        ) : (
          <div className="plv-lyrics-tray">
            {(backingState?.lyrics || []).length === 0 ? (
              <div className="plv-lyrics-empty">
                No synced lyrics loaded yet. Split a YouTube song with AI Stems or click &ldquo;Edit / Paste Lyrics&rdquo; to add lyrics or chord cues.
              </div>
            ) : (
              backingState.lyrics.map((line, idx) => (
                <button
                  key={`${line.start}-${idx}`}
                  type="button"
                  className={`plv-lyric-pill ${idx === activeLyricIndex ? 'active' : ''}`}
                  onClick={() => handleSeek(line.start || 0)}
                >
                  <span className="lyric-time">{formatClock(line.start || 0)}</span>
                  <span className="lyric-text">{line.text}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Hidden dual stems audio elements */}
      <audio
        ref={vocalAudioRef}
        crossOrigin="anonymous"
        preload="auto"
        onLoadedMetadata={(e) => {
          if (e.currentTarget.duration && Number.isFinite(e.currentTarget.duration)) {
            setDuration(e.currentTarget.duration);
          }
        }}
      />
      <audio ref={instAudioRef} crossOrigin="anonymous" preload="auto" />
    </div>
  );
}
