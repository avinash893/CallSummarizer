import { RAAG_TANPURA_MAP, RAAG_TANPURA_VOICING_LABEL, canonicalRaagName } from './raagTanpuraData';

const KEY_TO_FILENAME = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

export function midiToTanpuraAudioKey(midi = 60) {
  const idx = ((Math.round(midi) % 12) + 12) % 12;
  return KEY_TO_FILENAME[idx] || 'C';
}

export function getTanpuraVoicingInfo(ragaName = '') {
  const canon = canonicalRaagName(ragaName || '');
  const mode = (canon && RAAG_TANPURA_MAP[canon]) || 'standard';
  const label = RAAG_TANPURA_VOICING_LABEL[mode] || RAAG_TANPURA_VOICING_LABEL.standard;
  return { canon, mode, label };
}

export class TanpuraPlayer {
  constructor() {
    this.audioEl = null;
    this.synthTimer = null;
    this.audioCtx = null;
    this.synthGain = null;
    this.isPlaying = false;
    this.tonicMidi = 60;
    this.raga = 'Bilawal';
    this.volume = 0.45;
    this.stringIdx = 0;
  }

  _ensureSynthCtx() {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new Ctx();
      this.synthGain = this.audioCtx.createGain();
      this.synthGain.gain.value = this.volume * 0.35;
      this.synthGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  _pluckSynthString(freq, volScale = 0.25) {
    const ctx = this._ensureSynthCtx();
    if (!ctx || !this.synthGain) return;
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);
    osc2.frequency.setValueAtTime(freq * 1.002, now);

    // Jawari tonal filter envelope
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 3.8, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 1.6), now + 2.2);
    filter.Q.value = 1.9;

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(volScale, now + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0005, now + 3.2);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(env);
    env.connect(this.synthGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 3.3);
    osc2.stop(now + 3.3);
  }

  _startSynthLoop({ firstStringOnly = false } = {}) {
    if (this.synthTimer) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    this.stringIdx = 0;

    const triggerNext = () => {
      if (!this.isPlaying) return;
      const baseHz = 440 * Math.pow(2, (this.tonicMidi - 69) / 12);
      const { mode } = getTanpuraVoicingInfo(this.raga);
      // 1st string ratio relative to low octave Sa
      let firstRatio = 3 / 4; // Pa (low octave 5th below Sa -> 3/4 of middle Sa or 1.5/2)
      if (mode === 'maSa') firstRatio = 2 / 3; // Lower Ma (4/3 * 0.5)
      if (mode === 'niSa') firstRatio = 15 / 16; // Lower Shuddha Ni
      if (mode === 'dhaSa') firstRatio = 5 / 6; // Lower Dha

      const strings = firstStringOnly
        ? [baseHz * firstRatio]
        : [baseHz * firstRatio, baseHz * 2, baseHz * 2, baseHz];

      const idx = this.stringIdx % strings.length;
      if (firstStringOnly && idx !== 0) return;
      this._pluckSynthString(strings[idx], firstStringOnly ? 0.2 : idx === 3 ? 0.34 : 0.24);
      this.stringIdx = (this.stringIdx + 1) % 4;
    };

    triggerNext();
    this.synthTimer = setInterval(() => {
      if (!firstStringOnly || this.stringIdx % 4 === 0) {
        triggerNext();
      } else {
        this.stringIdx = (this.stringIdx + 1) % 4;
      }
    }, 900);
  }

  start(tonicMidi = 60, raga = 'Bilawal', volume = 0.45) {
    this.tonicMidi = Number.isFinite(tonicMidi) ? tonicMidi : 60;
    this.raga = raga || 'Bilawal';
    this.volume = Math.max(0, Math.min(1, Number(volume) ?? 0.45));
    this.stop();
    this.isPlaying = true;

    const key = midiToTanpuraAudioKey(this.tonicMidi);
    const { mode } = getTanpuraVoicingInfo(this.raga);

    if (typeof Audio !== 'undefined') {
      try {
        const audio = new Audio(`/audio/tanpura_${key}.mp3`);
        audio.loop = true;
        audio.volume = this.volume;
        this.audioEl = audio;
        const p = audio.play?.();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            if (this.isPlaying) {
              this._startSynthLoop({ firstStringOnly: false });
            }
          });
        }
        // Subtle 1st-string synth reinforcement if the raga prefers Ni/Ma/Dha over Pa
        if (mode !== 'standard') {
          this._startSynthLoop({ firstStringOnly: true });
        }
        return;
      } catch (e) {
        // Fallback below
      }
    }

    this._startSynthLoop({ firstStringOnly: false });
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) ?? 0.45));
    if (this.audioEl) {
      this.audioEl.volume = this.volume;
    }
    if (this.synthGain && this.audioCtx) {
      try {
        this.synthGain.gain.setTargetAtTime(this.volume * 0.35, this.audioCtx.currentTime, 0.04);
      } catch (e) {}
    }
  }

  updateConfig(tonicMidi, raga) {
    const changed = tonicMidi !== this.tonicMidi || raga !== this.raga;
    this.tonicMidi = tonicMidi;
    this.raga = raga;
    if (this.isPlaying && changed) {
      this.start(tonicMidi, raga, this.volume);
    }
  }

  stop() {
    this.isPlaying = false;
    if (this.synthTimer) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.src = '';
      } catch (e) {}
      this.audioEl = null;
    }
  }

  dispose() {
    this.stop();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch (e) {}
    }
    this.audioCtx = null;
    this.synthGain = null;
  }
}
