import React, { useEffect, useRef, useState } from 'react';
import {
  getAllStudioTakesMeta,
  getStudioTake,
  saveStudioTake,
  deleteStudioTake
} from '../audio/studioStorage';
import {
  analyzeAudioBufferPitch,
  findNearestSwara,
  midiToNoteName
} from '../audio/sargamEngine';
import {
  analyzeAndCompareVoices,
  createReverbBuffer,
  renderOfflineMasterMix
} from '../audio/voiceComparisonEngine';

const REVERB_PRESETS = {
  bypass: { label: 'Dry / Bypass', wet: 0, dur: 0.4, decay: 2.0 },
  studio: { label: 'Studio Room', wet: 0.22, dur: 1.1, decay: 2.8 },
  hall: { label: 'Concert Hall', wet: 0.38, dur: 2.1, decay: 2.2 },
  temple: { label: 'Resonant Sabha', wet: 0.52, dur: 3.1, decay: 1.8 }
};

const DELAY_PRESETS = {
  off: { label: 'Off', wet: 0, time: 0.25, feedback: 0.2 },
  slap: { label: 'Slapback 110ms', wet: 0.2, time: 0.11, feedback: 0.18 },
  eighth: { label: 'Rhythmic Echo', wet: 0.28, time: 0.31, feedback: 0.34 },
  dream: { label: 'Wide Ambient', wet: 0.4, time: 0.44, feedback: 0.45 }
};

export default function StudioDawView({
  jamState,
  localStream,
  backingState,
  onStatusBanner
}) {
  const [takesMeta, setTakesMeta] = useState([]);
  const [selectedTakeId, setSelectedTakeId] = useState('');
  const [activeTake, setActiveTake] = useState(null);
  const [vocalBuffer, setVocalBuffer] = useState(null);
  const [instBuffer, setInstBuffer] = useState(null);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isRecordingTake, setIsRecordingTake] = useState(false);
  const [isPlayingMix, setIsPlayingMix] = useState(false);

  // 3-Channel Mixer
  const [vocalVol, setVocalVol] = useState(1.0);
  const [vocalPan, setVocalPan] = useState(0);
  const [vocalMuted, setVocalMuted] = useState(false);
  const [instVol, setInstVol] = useState(0.75);
  const [instOffsetMs, setInstOffsetMs] = useState(0);
  const [instMuted, setInstMuted] = useState(false);

  // DSP Rack
  const [reverbPreset, setReverbPreset] = useState('studio');
  const [reverbWet, setReverbWet] = useState(0.22);
  const [delayPreset, setDelayPreset] = useState('off');
  const [delayWet, setDelayWet] = useState(0);
  const [eqLow, setEqLow] = useState(0);
  const [eqMid, setEqMid] = useState(1.5);
  const [eqHigh, setEqHigh] = useState(2.0);

  // Coach & Comparison
  const [comparisonStats, setComparisonStats] = useState(null);
  const [coachReport, setCoachReport] = useState(null);
  const [isCoachBusy, setIsCoachBusy] = useState(false);
  const [dawMsg, setDawMsg] = useState('');

  const waveCanvasRef = useRef(null);
  const recorderRef = useRef(null);
  const recChunksRef = useRef([]);
  const recStartRef = useRef(0);
  const playbackStopRef = useRef(null);
  const importInputRef = useRef(null);

  const refreshTakesList = async (pickId = null) => {
    const list = await getAllStudioTakesMeta();
    setTakesMeta(list);
    const targetId = pickId || (list.length > 0 ? list[0].id : '');
    if (targetId) {
      setSelectedTakeId(targetId);
      const full = await getStudioTake(targetId);
      if (full) {
        setActiveTake(full);
        await decodeTakeBlob(full);
      }
    } else {
      setActiveTake(null);
      setVocalBuffer(null);
    }
  };

  useEffect(() => {
    refreshTakesList();
    return () => {
      if (playbackStopRef.current) playbackStopRef.current();
    };
  }, []);

  // Load current room instUrl buffer when available
  useEffect(() => {
    const url = backingState?.instUrl || backingState?.vocalUrl;
    if (!url || typeof window === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(arr);
        if (!cancelled) setInstBuffer(decoded);
        try { await ctx.close(); } catch (e) {}
      } catch (e) {
        // Ignore silent fetch failures
      }
    })();
    return () => { cancelled = true; };
  }, [backingState?.instUrl, backingState?.vocalUrl]);

  const decodeTakeBlob = async (takeRecord) => {
    if (!takeRecord?.audioBlob || typeof window === 'undefined') {
      setVocalBuffer(null);
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      const ab = await takeRecord.audioBlob.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(ab);
      setVocalBuffer(audioBuf);
      setTrimStart(Math.max(0, takeRecord.trimStart || 0));
      setTrimEnd(
        takeRecord.trimEnd && takeRecord.trimEnd <= audioBuf.duration
          ? takeRecord.trimEnd
          : audioBuf.duration
      );
      try { await ctx.close(); } catch (e) {}
    } catch (err) {
      setDawMsg(`Could not decode take audio: ${err.message}`);
    }
  };

  // Draw Waveform + Trim Region
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    let ctx = null;
    try {
      ctx = canvas.getContext('2d');
    } catch (e) {
      return;
    }
    if (!ctx) return;

    const w = canvas.clientWidth || 680;
    const h = canvas.clientHeight || 130;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0c0f15';
    ctx.fillRect(0, 0, w, h);

    if (!vocalBuffer) {
      ctx.fillStyle = 'rgba(184, 192, 207, 0.72)';
      ctx.font = '500 12px Manrope, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Record a take or import vocal audio to open Waveform & Studio DSP Mixer', w / 2, h / 2 + 4);
      ctx.restore();
      return;
    }

    const data = vocalBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    const amp = h / 2 - 8;

    // Shaded active trim region
    const dur = Math.max(0.01, vocalBuffer.duration);
    const sX = (trimStart / dur) * w;
    const eX = (trimEnd / dur) * w;
    ctx.fillStyle = 'rgba(255, 111, 32, 0.1)';
    ctx.fillRect(sX, 0, Math.max(2, eX - sX), h);

    // Waveform bars
    for (let x = 0; x < w; x++) {
      let min = 1;
      let max = -1;
      for (let i = 0; i < step; i++) {
        const val = data[x * step + i] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      const inWindow = x >= sX && x <= eX;
      ctx.fillStyle = inWindow ? '#ff7b24' : 'rgba(107, 114, 128, 0.45)';
      const top = h / 2 + min * amp;
      const barH = Math.max(2, (max - min) * amp);
      ctx.fillRect(x, top, 1, barH);
    }

    // Trim handle lines
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sX, 0);
    ctx.lineTo(sX, h);
    ctx.stroke();

    ctx.strokeStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(eX, 0);
    ctx.lineTo(eX, h);
    ctx.stroke();

    ctx.restore();
  }, [vocalBuffer, trimStart, trimEnd]);

  const toggleRecordTake = async () => {
    if (isRecordingTake && recorderRef.current) {
      try {
        recorderRef.current.stop();
      } catch (e) {}
      setIsRecordingTake(false);
      return;
    }

    let stream = localStream;
    if (!stream || stream.getAudioTracks().length === 0) {
      if (navigator.mediaDevices?.getUserMedia) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    }
    if (!stream || typeof MediaRecorder === 'undefined') {
      setDawMsg('Microphone stream unavailable for direct Studio recording.');
      return;
    }

    const audioOnly = new MediaStream(stream.getAudioTracks());
    const rec = new MediaRecorder(audioOnly);
    recChunksRef.current = [];
    recStartRef.current = Date.now();

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) recChunksRef.current.push(ev.data);
    };

    rec.onstop = async () => {
      const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'audio/webm' });
      const dur = (Date.now() - recStartRef.current) / 1000;
      const takeId = `take_${Date.now()}`;
      await saveStudioTake({
        id: takeId,
        title: `Jam Take (${jamState.raga})`,
        raga: jamState.raga,
        tonicMidi: jamState.tonicMidi,
        bpm: jamState.bpm,
        taal: jamState.taal,
        durationSec: Number(dur.toFixed(1)),
        audioBlob: blob,
        instUrl: backingState?.instUrl || '',
        vocalUrl: backingState?.vocalUrl || ''
      });
      await refreshTakesList(takeId);
      setDawMsg(`Saved Studio Take (${dur.toFixed(1)}s) to local studio vault.`);
      if (onStatusBanner) onStatusBanner('New Studio Take saved!');
    };

    recorderRef.current = rec;
    rec.start(250);
    setIsRecordingTake(true);
    setDawMsg('Recording vocal/instrument take into Studio DAW...');
  };

  const handleImportTakeFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const takeId = `take_${Date.now()}`;
    await saveStudioTake({
      id: takeId,
      title: file.name.replace(/\.[^.]+$/, ''),
      raga: jamState.raga,
      tonicMidi: jamState.tonicMidi,
      bpm: jamState.bpm,
      taal: jamState.taal,
      audioBlob: file,
      instUrl: backingState?.instUrl || ''
    });
    await refreshTakesList(takeId);
    setDawMsg(`Imported "${file.name}" into Studio DAW.`);
  };

  const handleAutoCutSilence = () => {
    if (!vocalBuffer) return;
    const data = vocalBuffer.getChannelData(0);
    const threshold = 0.015;
    let firstIdx = 0;
    let lastIdx = data.length - 1;
    while (firstIdx < data.length && Math.abs(data[firstIdx]) < threshold) firstIdx++;
    while (lastIdx > firstIdx && Math.abs(data[lastIdx]) < threshold) lastIdx--;
    const s = Math.max(0, firstIdx / vocalBuffer.sampleRate - 0.05);
    const e = Math.min(vocalBuffer.duration, lastIdx / vocalBuffer.sampleRate + 0.12);
    setTrimStart(Number(s.toFixed(2)));
    setTrimEnd(Number(e.toFixed(2)));
    setDawMsg(`Auto-cut silence to ${s.toFixed(2)}s – ${e.toFixed(2)}s`);
  };

  const togglePlayStudioMix = async () => {
    if (isPlayingMix && playbackStopRef.current) {
      playbackStopRef.current();
      setIsPlayingMix(false);
      return;
    }
    if (!vocalBuffer || typeof window === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const revCfg = REVERB_PRESETS[reverbPreset] || REVERB_PRESETS.studio;
    const delCfg = DELAY_PRESETS[delayPreset] || DELAY_PRESETS.off;

    const master = ctx.createGain();
    master.gain.value = 0.92;
    master.connect(ctx.destination);

    const sources = [];
    if (!vocalMuted) {
      const vSrc = ctx.createBufferSource();
      vSrc.buffer = vocalBuffer;

      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 240;
      low.gain.value = eqLow;

      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1800;
      mid.gain.value = eqMid;

      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 4800;
      high.gain.value = eqHigh;

      const vGain = ctx.createGain();
      vGain.gain.value = vocalVol;
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) panner.pan.value = vocalPan;

      vSrc.connect(low);
      low.connect(mid);
      mid.connect(high);
      high.connect(vGain);
      const lastVocalNode = panner ? (vGain.connect(panner), panner) : vGain;
      lastVocalNode.connect(master);

      if (reverbWet > 0.01) {
        const conv = ctx.createConvolver();
        conv.buffer = createReverbBuffer(ctx, revCfg.dur, revCfg.decay);
        const rGain = ctx.createGain();
        rGain.gain.value = reverbWet;
        lastVocalNode.connect(conv);
        conv.connect(rGain);
        rGain.connect(master);
      }

      if (delayWet > 0.01) {
        const del = ctx.createDelay(2.0);
        del.delayTime.value = delCfg.time;
        const fb = ctx.createGain();
        fb.gain.value = delCfg.feedback;
        const dGain = ctx.createGain();
        dGain.gain.value = delayWet;
        lastVocalNode.connect(del);
        del.connect(fb);
        fb.connect(del);
        del.connect(dGain);
        dGain.connect(master);
      }

      const len = Math.max(0.1, (trimEnd || vocalBuffer.duration) - trimStart);
      vSrc.onended = () => {
        setIsPlayingMix(false);
        try { ctx.close(); } catch (e) {}
      };
      vSrc.start(0, trimStart, len);
      sources.push(vSrc);
    }

    if (!instMuted && instBuffer) {
      const iSrc = ctx.createBufferSource();
      iSrc.buffer = instBuffer;
      const iGain = ctx.createGain();
      iGain.gain.value = instVol;
      iSrc.connect(iGain);
      iGain.connect(master);
      const offsetSec = instOffsetMs / 1000;
      if (offsetSec >= 0) iSrc.start(ctx.currentTime + offsetSec, 0);
      else iSrc.start(0, Math.min(instBuffer.duration, Math.abs(offsetSec)));
      sources.push(iSrc);
    }

    playbackStopRef.current = () => {
      sources.forEach((s) => {
        try { s.stop(); } catch (e) {}
      });
      try { ctx.close(); } catch (e) {}
    };
    setIsPlayingMix(true);
  };

  const handleExportWav = async (vocalOnly = false) => {
    if (!vocalBuffer) return;
    setDawMsg(vocalOnly ? 'Rendering Clean Vocal WAV...' : 'Rendering Master Studio Mix WAV...');
    const revCfg = REVERB_PRESETS[reverbPreset] || REVERB_PRESETS.studio;
    const delCfg = DELAY_PRESETS[delayPreset] || DELAY_PRESETS.off;
    try {
      const wavBlob = await renderOfflineMasterMix({
        vocalBuffer,
        vocalTrimStart: trimStart,
        vocalTrimEnd: trimEnd || vocalBuffer.duration,
        vocalVol,
        vocalPan,
        vocalMuted,
        eqLow,
        eqMid,
        eqHigh,
        reverbWet,
        reverbDur: revCfg.dur,
        reverbDecay: revCfg.decay,
        delayWet,
        delayTime: delCfg.time,
        delayFeedback: delCfg.feedback,
        instBuffer,
        instVol,
        instOffsetSec: instOffsetMs / 1000,
        instMuted,
        vocalOnly
      });
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(activeTake?.title || 'sargamjam-take').replace(/\s+/g, '_')}_${vocalOnly ? 'vocal' : 'master'}.wav`;
      a.click();
      URL.revokeObjectURL(url);
      setDawMsg('Export complete!');
    } catch (err) {
      setDawMsg(`Export error: ${err.message}`);
    }
  };

  const handleCompareAndCoach = async () => {
    if (!vocalBuffer) {
      setDawMsg('Record or import a vocal take first to analyze Sur accuracy.');
      return;
    }
    setIsCoachBusy(true);
    setDawMsg('Analyzing Sur accuracy, pitch stability & consulting AI Guru...');
    try {
      const stats = analyzeAndCompareVoices({
        userAudioBuffer: vocalBuffer,
        refAudioBuffer: instBuffer,
        tonicMidi: jamState.tonicMidi,
        ragaName: jamState.raga,
        tuningMode: jamState.tuningMode,
        findNearestSwaraFn: findNearestSwara,
        analyzePitchFn: analyzeAudioBufferPitch
      });
      setComparisonStats(stats);

      const res = await fetch('/api/ai-vocal-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raga: jamState.raga,
          tonicLabel: midiToNoteName(jamState.tonicMidi),
          taal: jamState.taal,
          bpm: jamState.bpm,
          ...stats
        })
      });
      const data = await res.json();
      if (res.ok && data.analysis) {
        setCoachReport({ ...data.analysis, source: data.source });
        setDawMsg(`AI Coach Ready (${data.source})`);
      } else {
        setDawMsg(data.error || 'Coach analysis incomplete.');
      }
    } catch (err) {
      setDawMsg(`Coach error: ${err.message}`);
    } finally {
      setIsCoachBusy(false);
    }
  };

  return (
    <div className="studio-daw-view" data-testid="studio-daw-view">
      {/* Top Take Manager Toolbar */}
      <div className="daw-toolbar">
        <div className="daw-take-select-wrap">
          <label className="small text-muted fw-semibold me-2" htmlFor="select-daw-take">Take:</label>
          <select
            id="select-daw-take"
            className="mcs-select daw-select"
            value={selectedTakeId}
            onChange={async (e) => {
              const id = e.target.value;
              setSelectedTakeId(id);
              const t = await getStudioTake(id);
              setActiveTake(t);
              await decodeTakeBlob(t);
            }}
          >
            {takesMeta.length === 0 && <option value="">No recorded takes yet</option>}
            {takesMeta.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} · {t.durationSec || 0}s ({t.raga})
              </option>
            ))}
          </select>

          {selectedTakeId && (
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={async () => {
                await deleteStudioTake(selectedTakeId);
                await refreshTakesList();
              }}
              title="Delete selected take"
            >
              <i className="bi bi-trash3"></i>
            </button>
          )}
        </div>

        <div className="daw-actions-row">
          <button
            type="button"
            className={`btn btn-sm ${isRecordingTake ? 'btn-danger pulse-btn' : 'btn-primary'}`}
            onClick={toggleRecordTake}
            data-testid="btn-daw-record"
          >
            <i className={`bi ${isRecordingTake ? 'bi-stop-circle-fill' : 'bi-record-circle'} me-1`}></i>
            {isRecordingTake ? 'Stop & Save Take' : 'Record Studio Take'}
          </button>

          <input ref={importInputRef} type="file" accept="audio/*" className="d-none" onChange={handleImportTakeFile} />
          <button
            type="button"
            className="btn btn-outline-secondary btn-secondary-action btn-sm"
            onClick={() => importInputRef.current?.click()}
          >
            <i className="bi bi-folder-plus me-1"></i>
            Import Vocal
          </button>

          <button
            type="button"
            className={`btn btn-sm ${isPlayingMix ? 'btn-warning' : 'btn-success'}`}
            disabled={!vocalBuffer}
            onClick={togglePlayStudioMix}
          >
            <i className={`bi ${isPlayingMix ? 'bi-stop-fill' : 'bi-play-fill'} me-1`}></i>
            {isPlayingMix ? 'Stop Mix' : 'Audition Mix'}
          </button>
        </div>
      </div>

      {dawMsg && <div className="daw-status-pill">{dawMsg}</div>}

      {/* Waveform & Trimmer Deck */}
      <div className="daw-wave-card">
        <div className="daw-card-head">
          <span>
            <i className="bi bi-activity me-2 text-warning"></i>
            Vocal Waveform & Trim Range
            {vocalBuffer && (
              <small className="ms-2 text-muted">
                ({trimStart.toFixed(1)}s – {trimEnd.toFixed(1)}s of {vocalBuffer.duration.toFixed(1)}s)
              </small>
            )}
          </span>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={!vocalBuffer} onClick={handleAutoCutSilence}>
              Auto-Cut Silence
            </button>
            <button
              type="button"
              className="btn btn-outline-info btn-sm"
              disabled={!vocalBuffer}
              onClick={() => handleExportWav(true)}
            >
              Export Vocal WAV
            </button>
            <button
              type="button"
              className="btn btn-warning btn-sm fw-bold"
              disabled={!vocalBuffer}
              onClick={() => handleExportWav(false)}
            >
              Export Master WAV
            </button>
          </div>
        </div>

        <canvas
          ref={waveCanvasRef}
          className="daw-waveform-canvas"
          onClick={(e) => {
            if (!vocalBuffer) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            const sec = frac * vocalBuffer.duration;
            if (Math.abs(sec - trimStart) < Math.abs(sec - trimEnd)) {
              setTrimStart(Number(Math.min(sec, trimEnd - 0.2).toFixed(2)));
            } else {
              setTrimEnd(Number(Math.max(sec, trimStart + 0.2).toFixed(2)));
            }
          }}
          title="Click near start or end handle to adjust trim range"
        />
      </div>

      {/* Console Grid: 2-Channel Mixer + DSP Rack + AI Vocal Coach */}
      <div className="daw-console-grid">
        {/* Mixer Card */}
        <div className="daw-panel">
          <div className="daw-panel-title"><i className="bi bi-sliders me-2"></i>Console Channels & Latency Sync</div>
          <div className="daw-channel-row">
            <div className="daw-ch-head">
              <strong>Ch 1 · Your Vocal</strong>
              <button
                type="button"
                className={`daw-mute-btn ${vocalMuted ? 'muted' : ''}`}
                onClick={() => setVocalMuted(!vocalMuted)}
              >M</button>
            </div>
            <label className="daw-slider-row">
              <span>Gain {Math.round(vocalVol * 100)}%</span>
              <input type="range" min="0" max="1.5" step="0.02" value={vocalVol} onChange={(e) => setVocalVol(Number(e.target.value))} />
            </label>
            <label className="daw-slider-row">
              <span>Pan {vocalPan === 0 ? 'Center' : vocalPan < 0 ? `L ${Math.abs(Math.round(vocalPan * 100))}` : `R ${Math.round(vocalPan * 100)}`}</span>
              <input type="range" min="-1" max="1" step="0.05" value={vocalPan} onChange={(e) => setVocalPan(Number(e.target.value))} />
            </label>
          </div>

          <div className="daw-channel-row mt-3">
            <div className="daw-ch-head">
              <strong>Ch 2 · Backing Stem</strong>
              <button
                type="button"
                className={`daw-mute-btn ${instMuted ? 'muted' : ''}`}
                onClick={() => setInstMuted(!instMuted)}
              >M</button>
            </div>
            <label className="daw-slider-row">
              <span>Gain {Math.round(instVol * 100)}%</span>
              <input type="range" min="0" max="1.4" step="0.02" value={instVol} onChange={(e) => setInstVol(Number(e.target.value))} />
            </label>
            <label className="daw-slider-row">
              <span>Latency Align {instOffsetMs > 0 ? `+${instOffsetMs}` : instOffsetMs}ms</span>
              <input type="range" min="-500" max="500" step="5" value={instOffsetMs} onChange={(e) => setInstOffsetMs(Number(e.target.value))} />
            </label>
          </div>
        </div>

        {/* DSP FX Rack */}
        <div className="daw-panel">
          <div className="daw-panel-title"><i className="bi bi-soundwave me-2"></i>Vocal DSP FX & 3-Band EQ</div>
          <div className="daw-fx-row">
            <label>Reverb Space</label>
            <select
              className="mcs-select"
              value={reverbPreset}
              onChange={(e) => {
                const k = e.target.value;
                setReverbPreset(k);
                setReverbWet(REVERB_PRESETS[k]?.wet ?? 0.22);
              }}
            >
              {Object.entries(REVERB_PRESETS).map(([k, cfg]) => (
                <option key={k} value={k}>{cfg.label}</option>
              ))}
            </select>
            <input type="range" min="0" max="0.85" step="0.02" value={reverbWet} onChange={(e) => setReverbWet(Number(e.target.value))} aria-label="Reverb wet amount" />
          </div>

          <div className="daw-fx-row mt-2">
            <label>Echo / Delay</label>
            <select
              className="mcs-select"
              value={delayPreset}
              onChange={(e) => {
                const k = e.target.value;
                setDelayPreset(k);
                setDelayWet(DELAY_PRESETS[k]?.wet ?? 0);
              }}
            >
              {Object.entries(DELAY_PRESETS).map(([k, cfg]) => (
                <option key={k} value={k}>{cfg.label}</option>
              ))}
            </select>
            <input type="range" min="0" max="0.7" step="0.02" value={delayWet} onChange={(e) => setDelayWet(Number(e.target.value))} aria-label="Delay wet amount" />
          </div>

          <div className="daw-eq-grid mt-3">
            <label>
              <span>Low Warmth ({eqLow > 0 ? `+${eqLow}` : eqLow}dB)</span>
              <input type="range" min="-10" max="10" step="0.5" value={eqLow} onChange={(e) => setEqLow(Number(e.target.value))} />
            </label>
            <label>
              <span>Vocal Presence ({eqMid > 0 ? `+${eqMid}` : eqMid}dB)</span>
              <input type="range" min="-10" max="10" step="0.5" value={eqMid} onChange={(e) => setEqMid(Number(e.target.value))} />
            </label>
            <label>
              <span>Brilliance Air ({eqHigh > 0 ? `+${eqHigh}` : eqHigh}dB)</span>
              <input type="range" min="-10" max="10" step="0.5" value={eqHigh} onChange={(e) => setEqHigh(Number(e.target.value))} />
            </label>
          </div>
        </div>

        {/* AI Vocal Guru & Pitch Audit */}
        <div className="daw-panel daw-coach-panel">
          <div className="daw-panel-title d-flex justify-content-between align-items-center">
            <span><i className="bi bi-stars me-2 text-warning"></i>Gemini Vocal Guru</span>
            <button
              type="button"
              className="btn btn-sm btn-warning fw-semibold"
              disabled={!vocalBuffer || isCoachBusy}
              onClick={handleCompareAndCoach}
              data-testid="btn-ai-vocal-coach"
            >
              {isCoachBusy ? 'Analyzing...' : 'Analyze Sur & Coach'}
            </button>
          </div>

          {comparisonStats ? (
            <div className="daw-coach-metrics" data-testid="daw-coach-metrics">
              <div className="metric-chip">
                <small>Overall Score</small>
                <strong>{comparisonStats.overallScore}/100 ({comparisonStats.overallGrade})</strong>
              </div>
              <div className="metric-chip">
                <small>Sur Accuracy</small>
                <strong>{comparisonStats.inTunePercent}%</strong>
              </div>
              <div className="metric-chip">
                <small>Error %</small>
                <strong className={comparisonStats.errorPercent > 25 ? 'daw-err-bad' : 'daw-err-warn'}>{comparisonStats.errorPercent}%</strong>
              </div>
              <div className="metric-chip">
                <small>Flat / Sharp</small>
                <strong>{comparisonStats.flatPercent}% / {comparisonStats.sharpPercent}%</strong>
              </div>
              <div className="metric-chip">
                <small>Stability</small>
                <strong>{comparisonStats.stabilityScore}%</strong>
              </div>
              <div className="metric-chip">
                <small>Mean Offset</small>
                <strong>{comparisonStats.avgCentsOffset > 0 ? '+' : ''}{comparisonStats.avgCentsOffset}c</strong>
              </div>
            </div>
          ) : (
            <p className="text-muted small mb-2">
              Run &ldquo;Analyze Sur & Coach&rdquo; on your vocal take for intonation scoring, Raga micro-tuning feedback, and customized Riyaz exercises.
            </p>
          )}

          {coachReport && (
            <div className="daw-coach-report" data-testid="ai-coach-report">
              <div className="coach-score-row">
                <span className="coach-score-badge">Score: {coachReport.score}/100</span>
                <span className="coach-verdict">{coachReport.pitchVerdict}</span>
              </div>
              <div className="coach-list-title">Strengths</div>
              <ul className="coach-list">
                {coachReport.strengths.map((s, idx) => <li key={idx}>{s}</li>)}
              </ul>
              <div className="coach-list-title">Recommended Riyaz Drills</div>
              <ul className="coach-list">
                {coachReport.drills.map((d, idx) => <li key={idx}>{d}</li>)}
              </ul>
              {coachReport.raagTip && (
                <div className="coach-raag-tip">
                  <strong>{jamState.raga} Tip:</strong> {coachReport.raagTip}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
