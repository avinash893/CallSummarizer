import React, { useMemo, useRef } from 'react';
import {
  TONIC_OPTIONS,
  RAGA_OPTIONS,
  SWARAS_DATA,
  getRagaSemitones,
  getRagaMeta,
  getSwaraFreq,
  playReferenceSwaraTone
} from '../audio/sargamEngine';
import { TAAL_PRESETS } from '../audio/taalEngine';
import { getTanpuraVoicingInfo } from '../audio/tanpuraEngine';

export default function MusicalControlStrip({
  jamState,
  onUpdateJamState,
  isRawAudio = false,
  onToggleRawAudio = null,
  currentBeatInfo = null,
  isRoomSynced = true,
  onToggleRoomSync = null
}) {
  const tapTimesRef = useRef([]);

  const ragaSemitones = useMemo(() => new Set(getRagaSemitones(jamState.raga)), [jamState.raga]);
  const ragaMeta = useMemo(() => getRagaMeta(jamState.raga), [jamState.raga]);
  const voicingInfo = useMemo(() => getTanpuraVoicingInfo(jamState.raga), [jamState.raga]);
  const taalPreset = TAAL_PRESETS[jamState.taal] || TAAL_PRESETS['Teentaal (16)'];

  const handleTapTempo = () => {
    const now = performance.now ? performance.now() : Date.now();
    const list = tapTimesRef.current.filter((t) => now - t < 2500);
    list.push(now);
    tapTimesRef.current = list;
    if (list.length >= 2) {
      let sum = 0;
      for (let i = 1; i < list.length; i++) sum += list[i] - list[i - 1];
      const avgMs = sum / (list.length - 1);
      const bpm = Math.max(40, Math.min(240, Math.round(60000 / avgMs)));
      onUpdateJamState({ bpm });
    }
  };

  return (
    <section className="musical-control-strip" data-testid="musical-control-strip" aria-label="Music Jam Controls">
      <div className="mcs-row-main">
        {/* Sa Tonic Picker */}
        <div className="mcs-group">
          <label className="mcs-label" htmlFor="select-sa-tonic">Sa Tonic</label>
          <select
            id="select-sa-tonic"
            className="mcs-select"
            value={jamState.tonicMidi}
            onChange={(e) => onUpdateJamState({ tonicMidi: Number(e.target.value) })}
          >
            {TONIC_OPTIONS.map((opt) => (
              <option key={opt.midi} value={opt.midi}>
                {opt.label} · {Math.round(opt.hz)}Hz
              </option>
            ))}
          </select>
        </div>

        {/* Raga Selector */}
        <div className="mcs-group mcs-group-raga" title={`${ragaMeta.thaat} Thaat • ${ragaMeta.prahar} • ${ragaMeta.mood}`}>
          <label className="mcs-label" htmlFor="select-raga">Raga Scale</label>
          <select
            id="select-raga"
            className="mcs-select"
            value={jamState.raga}
            onChange={(e) => onUpdateJamState({ raga: e.target.value })}
          >
            {RAGA_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {/* JI / ET & Notation Script */}
        <div className="mcs-pill-pair">
          <button
            type="button"
            className={`mcs-toggle-chip ${jamState.tuningMode === 'ji' ? 'active' : ''}`}
            onClick={() => onUpdateJamState({ tuningMode: jamState.tuningMode === 'ji' ? 'et' : 'ji' })}
            title="Switch between Just Intonation (Shruti) and Equal Temperament"
          >
            {jamState.tuningMode === 'ji' ? 'JI Shruti' : 'ET 12-TET'}
          </button>
          <button
            type="button"
            className={`mcs-toggle-chip ${jamState.langMode === 'hi' ? 'active' : ''}`}
            onClick={() => onUpdateJamState({ langMode: jamState.langMode === 'en' ? 'hi' : 'en' })}
            title="Switch Swara script between English and Devanagari"
          >
            {jamState.langMode === 'hi' ? 'सा रे ग' : 'Sa Re Ga'}
          </button>
        </div>

        {/* Acoustic Tanpura Control */}
        <div className="mcs-tanpura-box">
          <button
            type="button"
            className={`mcs-btn-tanpura ${jamState.isTanpuraOn ? 'on' : ''}`}
            aria-pressed={Boolean(jamState.isTanpuraOn)}
            onClick={() => onUpdateJamState({ isTanpuraOn: !jamState.isTanpuraOn })}
            data-testid="btn-toggle-tanpura"
            title={`Toggle Acoustic Tanpura (${voicingInfo.label})`}
          >
            <i className={`bi ${jamState.isTanpuraOn ? 'bi-soundwave' : 'bi-vinyl'}`}></i>
            <span>Tanpura {jamState.isTanpuraOn ? 'ON' : 'OFF'}</span>
            <small className="mcs-voicing-tag">{voicingInfo.mode === 'standard' ? 'Pa-Sa' : voicingInfo.mode}</small>
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={jamState.tanpuraVol ?? 0.45}
            onChange={(e) => onUpdateJamState({ tanpuraVol: Number(e.target.value) })}
            className="mcs-mini-slider"
            aria-label="Tanpura volume"
          />
        </div>

        {/* Taal & Metronome Sequencer */}
        <div className="mcs-taal-box">
          <select
            className="mcs-select mcs-select-taal"
            value={jamState.taal}
            onChange={(e) => onUpdateJamState({ taal: e.target.value })}
            aria-label="Select Taal"
          >
            {Object.keys(TAAL_PRESETS).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <div className="mcs-bpm-stepper">
            <button
              type="button"
              className="mcs-step-btn"
              onClick={() => onUpdateJamState({ bpm: Math.max(40, (jamState.bpm || 96) - 4) })}
              aria-label="Decrease BPM"
            >−</button>
            <span className="mcs-bpm-readout">{jamState.bpm || 96} BPM</span>
            <button
              type="button"
              className="mcs-step-btn"
              onClick={() => onUpdateJamState({ bpm: Math.min(240, (jamState.bpm || 96) + 4) })}
              aria-label="Increase BPM"
            >+</button>
            <button
              type="button"
              className="mcs-tap-btn"
              onClick={handleTapTempo}
              title="Tap repeatedly to set tempo"
            >TAP</button>
          </div>

          <button
            type="button"
            className={`mcs-btn-beat ${jamState.isMetronomeOn ? 'on' : ''}`}
            aria-pressed={Boolean(jamState.isMetronomeOn)}
            onClick={() => onUpdateJamState({ isMetronomeOn: !jamState.isMetronomeOn })}
            data-testid="btn-toggle-metronome"
          >
            <i className="bi bi-metronome bi-disc"></i>
            <span>{jamState.isMetronomeOn ? 'Beat ON' : 'Beat OFF'}</span>
          </button>
        </div>

        {/* Studio Raw Audio + Room Sync */}
        <div className="mcs-right-tools">
          {onToggleRawAudio && (
            <button
              type="button"
              className={`mcs-toggle-chip raw-chip ${isRawAudio ? 'active' : ''}`}
              aria-pressed={Boolean(isRawAudio)}
              onClick={onToggleRawAudio}
              title="Disables WebRTC echo cancellation & noise suppression for instruments/vocals (use headphones!)"
              data-testid="btn-toggle-raw-audio"
            >
              <i className="bi bi-stars"></i>
              <span>{isRawAudio ? 'Hi-Fi Raw Audio' : 'Voice Filter'}</span>
            </button>
          )}

          {onToggleRoomSync && (
            <button
              type="button"
              className={`mcs-toggle-chip sync-chip ${isRoomSynced ? 'active' : ''}`}
              aria-pressed={Boolean(isRoomSynced)}
              onClick={onToggleRoomSync}
              title="Broadcast Sa, Raga, and Tempo updates to everyone in the jam room"
            >
              <i className="bi bi-broadcast"></i>
              <span>{isRoomSynced ? 'Room Synced' : 'Local Only'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Interactive Swara Palette + Taal Matra Visualizer */}
      <div className="mcs-row-sub">
        <div className="mcs-swara-strip" title="Click any Swara pill to audition its exact Raga-tuned pitch">
          <span className="mcs-raga-badge">
            <strong>{ragaMeta.canon}</strong>
            <small>{ragaMeta.thaat}</small>
          </span>
          {SWARAS_DATA.map((sw) => {
            const active = ragaSemitones.has(sw.semitone);
            const freq = getSwaraFreq(sw.semitone, 0, jamState.tonicMidi, jamState.tuningMode, jamState.raga);
            return (
              <button
                key={sw.semitone}
                type="button"
                className={`mcs-swara-pill ${active ? 'in-raga' : 'out-raga'} ${sw.semitone === 0 ? 'is-sa' : ''}`}
                onClick={() => playReferenceSwaraTone(freq, 0.9)}
                title={`${sw.english} (${Math.round(freq)} Hz) — Click to hear`}
              >
                {jamState.langMode === 'hi' ? sw.devanagari : sw.short}
              </button>
            );
          })}
        </div>

        {/* Live Taal Matra Strip */}
        <div className="mcs-beat-strip" aria-label="Taal Matra Indicator">
          {Array.from({ length: Math.min(16, taalPreset.beats) }, (_, i) => {
            const isSam = taalPreset.sam.includes(i);
            const isKhali = taalPreset.khali.includes(i);
            const isCurrent = jamState.isMetronomeOn && currentBeatInfo && currentBeatInfo.index === i;
            return (
              <span
                key={i}
                className={`mcs-beat-dot ${isSam ? 'sam' : isKhali ? 'khali' : ''} ${isCurrent ? 'pulse' : ''}`}
                title={`Beat ${i + 1}: ${taalPreset.bols[i] || i + 1}`}
              >
                {i + 1}
              </span>
            );
          })}
          {jamState.isMetronomeOn && currentBeatInfo && (
            <span className="mcs-bol-pill">{currentBeatInfo.bol}</span>
          )}
        </div>
      </div>
    </section>
  );
}
