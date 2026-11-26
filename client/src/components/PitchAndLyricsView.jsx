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
  onSyncBackingToRoom
}) {
  const [songUrlInput, setSongUrlInput] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [vocalVol, setVocalVol] = useState(0.85);
  const [instVol, setInstVol] = useState(0.75);
  const [currentTime, setCurrentTime] = useState(backingState?.currentTime || 0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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
    if (vocalAudioRef.current) vocalAudioRef.current.volume = vocalVol;
  }, [vocalVol]);

  useEffect(() => {
    if (instAudioRef.current) instAudioRef.current.volume = instVol;
  }, [instVol]);

  // Synchronize remote backingState play/seek changes
  useEffect(() => {
    if (!backingState) return;
    if (vocalAudioRef.current && backingState.vocalUrl && vocalAudioRef.current.src !== backingState.vocalUrl) {
      vocalAudioRef.current.src = backingState.vocalUrl;
    }
    if (instAudioRef.current && backingState.instUrl && instAudioRef.current.src !== backingState.instUrl) {
      instAudioRef.current.src = backingState.instUrl;
    }
  }, [backingState?.vocalUrl, backingState?.instUrl]);

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
      setCurrentTime(t);
      if (d && Number.isFinite(d)) setDuration(d);

      // Keep inst synced within 60ms of vocal track
      if (vEl && iEl && backingState?.instUrl && Math.abs((vEl.currentTime || 0) - (iEl.currentTime || 0)) > 0.08) {
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
        setIsPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return stopPlaybackLoop;
  }, [isPlaying, jamState.tonicMidi, jamState.tuningMode, jamState.raga, backingState?.noteBars, backingState?.instUrl]);

  const togglePlay = async () => {
    const vEl = vocalAudioRef.current;
    const iEl = instAudioRef.current;
    if (!backingState?.vocalUrl && !backingState?.instUrl) return;

    if (isPlaying) {
      vEl?.pause();
      iEl?.pause();
      setIsPlaying(false);
      return;
    }

    ensureVocalAnalyser();
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    try {
      if (backingState?.vocalUrl && vEl) await vEl.play();
      if (backingState?.instUrl && iEl) await iEl.play();
      setIsPlaying(true);
    } catch (e) {
      setStatusMsg('Click play again after audio loads to start playback.');
    }
  };

  const handleSeek = (targetSec) => {
    const clamped = Math.max(0, Math.min(duration || 600, targetSec));
    if (vocalAudioRef.current) vocalAudioRef.current.currentTime = clamped;
    if (instAudioRef.current) instAudioRef.current.currentTime = clamped;
    setCurrentTime(clamped);
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

  const fetchPitchAndLyricsForVocal = async (vocalUrl) => {
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
        noteBars: bars,
        lyrics
      });
      const detectedScale = applyDetectedScale(bars);
      setStatusMsg(
        `Ready: ${bars.length} pitch notes & ${lyrics.length} lyric lines${detectedScale ? ` • Scale: ${detectedScale}` : '.'}`
      );
    } catch (e) {
      setStatusMsg('Stems loaded! (Cloud lyric extractor unavailable — use CPU Pitch Fit if needed.)');
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

      onUpdateBackingState({
        title: data.title || 'AI Separated Song',
        vocalUrl: data.vocalUrl || '',
        instUrl: data.instUrl || '',
        noteBars: inlineBars,
        lyrics: inlineLyrics
      });

      if (inlineBars.length > 0) {
        const detectedScale = applyDetectedScale(inlineBars);
        setStatusMsg(
          `Ready (Cloud AI): ${inlineBars.length} note bars & ${inlineLyrics.length} lyric cues${detectedScale ? ` • Key: ${detectedScale}` : '.'}`
        );
      } else {
        await fetchPitchAndLyricsForVocal(data.vocalUrl);
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
      onUpdateBackingState({
        title: file.name.replace(/\.[^.]+$/, ''),
        vocalUrl: blobUrl,
        instUrl: '',
        noteBars: [],
        lyrics: []
      });

      if (localOnly || backendStatus === 'offline') {
        setStatusMsg('Analyzing pitch contour in-browser (no cloud needed)...');
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const buf = await file.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(buf);
          setDuration(audioBuf.duration);
          const { noteBars } = await analyzeAudioBufferPitchAsync(audioBuf, (pct) => {
            setStatusMsg(`Analyzing pitch in-browser: ${pct}%`);
          });
          const fit = autoDetectVocalScaleAndRange(noteBars);
          onUpdateBackingState({
            title: file.name.replace(/\.[^.]+$/, ''),
            vocalUrl: blobUrl,
            instUrl: '',
            noteBars
          });
          if (fit && fit.confidence > 25) {
            onUpdateJamState({ tonicMidi: fit.tonicMidi });
            setStatusMsg(`Decoded ${noteBars.length} notes • Detected Key: ${midiToNoteName(fit.tonicMidi)} (${fit.confidence}% match)`);
          } else {
            setStatusMsg(`Decoded ${noteBars.length} pitch notes locally.`);
          }
          try { await ctx.close(); } catch (err) {}
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
        onUpdateBackingState({
          title: data.title || file.name,
          vocalUrl: data.vocalUrl || blobUrl,
          instUrl: data.instUrl || '',
          noteBars: Array.isArray(data.noteBars) ? data.noteBars : [],
          lyrics: Array.isArray(data.lyrics) ? data.lyrics : []
        });
        if (Array.isArray(data.noteBars) && data.noteBars.length > 0) {
          const detectedScale = applyDetectedScale(data.noteBars);
          setStatusMsg(
            `Ready (Cloud AI): ${data.noteBars.length} note bars & ${(data.lyrics || []).length} lyric cues${detectedScale ? ` • Key: ${detectedScale}` : '.'}`
          );
        } else if (data.vocalUrl) {
          await fetchPitchAndLyricsForVocal(data.vocalUrl);
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
    onUpdateBackingState({ lyrics: parsed });
    setShowLyricsEditor(false);
    setStatusMsg(`Updated ${parsed.length} cue lines for jam room.`);
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
                onClick={onSyncBackingToRoom}
                title="Share loaded song stems & lyrics with everyone in the room"
              >
                <i className="bi bi-share me-1"></i>
                Sync Track to Room
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
                  aria-label={isPlaying ? 'Pause backing stems' : 'Play backing stems'}
                >
                  <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'}`}></i>
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
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="plv-scrubber"
                  aria-label="Track seek slider"
                />
                <div className="plv-stem-faders">
                  <label>
                    <span>Vocal</span>
                    <input type="range" min="0" max="1" step="0.02" value={vocalVol} onChange={(e) => setVocalVol(Number(e.target.value))} />
                  </label>
                  {backingState.instUrl && (
                    <label>
                      <span>Beat</span>
                      <input type="range" min="0" max="1" step="0.02" value={instVol} onChange={(e) => setInstVol(Number(e.target.value))} />
                    </label>
                  )}
                </div>
              </div>
            )}
            {statusMsg && <div className="plv-status-text">{statusMsg}</div>}
          </div>
        )}
      </div>

      {/* Real-Time Pitch Tolerance Banner (fixed metrics & stable height — zero jump when sur flips) */}
      <div
        className={`plv-match-banner ${liveMatch ? (liveMatch.isMatched ? 'matched' : 'off-pitch') : ''}`}
        data-testid="pitch-match-banner"
      >
        <div className="plv-match-status">
          <span className="plv-match-indicator" />
          <span className="plv-match-text">
            {liveMatch?.isMatched
              ? `In Tune · ${liveMatch.errorPct}% error (≤ ${tolLabel}%)`
              : liveMatch
                ? `${liveMatch.direction === 'flat' ? 'Too Low (Flat)' : 'Too High (Sharp)'} · ${liveMatch.errorPct}% err (need ≤ ${tolLabel}%)`
                : liveMicPitch?.freq > 50
                  ? `Mic ${liveMicPitch.noteName || ''} · ${liveMicPitch.freq} Hz`
                  : `Sing into mic to match reference (${tolLabel}% tolerance)`}
          </span>
        </div>

        <div className="plv-match-metrics">
          <span className={`plv-metric-pill plv-metric-err ${liveMatch ? (liveMatch.isMatched ? 'ok' : 'warn') : ''}`} data-testid="pitch-diff-badge">
            {liveMatch ? `Err: ${liveMatch.errorPct}%` : 'Diff: --'}
          </span>
          <span className="plv-metric-pill plv-metric-acc" data-testid="pitch-accuracy-badge">
            {sessionAcc !== null ? `Acc: ${sessionAcc}%` : 'Acc: --'}
          </span>
          <span className="plv-metric-pill plv-metric-fs">
            F {sessionFlatPct}% · S {sessionSharpPct}%
          </span>
          <span className="plv-metric-pill plv-metric-stk">
            Streak: {sessionStats.streak}
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
