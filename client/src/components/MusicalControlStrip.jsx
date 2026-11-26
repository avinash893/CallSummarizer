import React, { useRef } from 'react';
import { TONIC_OPTIONS } from '../audio/sargamEngine';

export default function MusicalControlStrip({
  jamState,
  onUpdateJamState,
  isRawAudio = false,
  onToggleRawAudio = null,
  isRoomSynced = true,
  onToggleRoomSync = null
}) {
  const tapTimesRef = useRef([]);

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
        {/* Musical Scale / Root Key Picker */}
        <div className="mcs-group">
          <label className="mcs-label" htmlFor="select-scale-key">Scale</label>
          <select
            id="select-scale-key"
            className="mcs-select"
            value={jamState.tonicMidi}
            onChange={(e) => onUpdateJamState({ tonicMidi: Number(e.target.value) })}
          >
            {TONIC_OPTIONS.map((opt) => (
              <option key={opt.midi} value={opt.midi}>
                {opt.shortLabel} · {Math.round(opt.hz)}Hz
              </option>
            ))}
          </select>
        </div>

        {/* Acoustic Tanpura Control */}
        <div className="mcs-tanpura-box">
          <button
            type="button"
            className={`mcs-btn-tanpura ${jamState.isTanpuraOn ? 'on' : ''}`}
            aria-pressed={Boolean(jamState.isTanpuraOn)}
            onClick={() => onUpdateJamState({ isTanpuraOn: !jamState.isTanpuraOn })}
            data-testid="btn-toggle-tanpura"
            title="Toggle Acoustic Tanpura Drone"
          >
            <i className={`bi ${jamState.isTanpuraOn ? 'bi-soundwave' : 'bi-vinyl'}`}></i>
            <span>Tanpura {jamState.isTanpuraOn ? 'ON' : 'OFF'}</span>
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

        {/* BPM Tempo & Metronome */}
        <div className="mcs-taal-box">
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
            <i className="bi bi-disc"></i>
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
              title="Broadcast Scale, Tanpura, and BPM updates to everyone in the jam room"
            >
              <i className="bi bi-broadcast"></i>
              <span>{isRoomSynced ? 'Room Synced' : 'Local Only'}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
