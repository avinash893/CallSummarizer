export const TAAL_PRESETS = {
  'Teentaal (16)': {
    beats: 16,
    vibhags: [4, 4, 4, 4],
    sam: [0],
    taali: [4, 12],
    khali: [8],
    bols: ['Dha', 'Dhin', 'Dhin', 'Dha', 'Dha', 'Dhin', 'Dhin', 'Dha', 'Dha', 'Tin', 'Tin', 'Ta', 'Ta', 'Dhin', 'Dhin', 'Dha'],
    mood: 'Classical 16-beat groove'
  },
  'Keherwa (8)': {
    beats: 8,
    vibhags: [4, 4],
    sam: [0],
    taali: [],
    khali: [4],
    bols: ['Dha', 'Ge', 'Na', 'Ti', 'Na', 'Ka', 'Dhi', 'Na'],
    mood: 'Folk, Bhajan & Bollywood 8-beat'
  },
  'Dadra (6)': {
    beats: 6,
    vibhags: [3, 3],
    sam: [0],
    taali: [],
    khali: [3],
    bols: ['Dha', 'Dhin', 'Na', 'Dha', 'Tin', 'Na'],
    mood: 'Waltz / Ghazals 6-beat'
  },
  'Rupak (7)': {
    beats: 7,
    vibhags: [3, 2, 2],
    sam: [0],
    taali: [3, 5],
    khali: [0],
    bols: ['Tin', 'Tin', 'Na', 'Dhi', 'Na', 'Dhi', 'Na'],
    mood: 'Asymmetric 7-beat cycle'
  },
  'Jhaptal (10)': {
    beats: 10,
    vibhags: [2, 3, 2, 3],
    sam: [0],
    taali: [2, 7],
    khali: [5],
    bols: ['Dhi', 'Na', 'Dhi', 'Dhi', 'Na', 'Ti', 'Na', 'Dhi', 'Dhi', 'Na'],
    mood: 'Madhyalaya 10-beat (2-3-2-3)'
  },
  'Ektaal (12)': {
    beats: 12,
    vibhags: [2, 2, 2, 2, 2, 2],
    sam: [0],
    taali: [4, 8, 10],
    khali: [2, 6],
    bols: ['Dhin', 'Dhin', 'DhaGe', 'TirKit', 'Tu', 'Na', 'Kat', 'Ta', 'DhaGe', 'TirKit', 'Dhi', 'Na'],
    mood: 'Vilambit / Drut Khayal 12-beat'
  },
  '4/4 Studio Click': {
    beats: 4,
    vibhags: [4],
    sam: [0],
    taali: [],
    khali: [2],
    bols: ['1', '2', '3', '4'],
    mood: 'Clean modern metronome'
  }
};

export function getBeatRole(taalName, beatIndex) {
  const preset = TAAL_PRESETS[taalName] || TAAL_PRESETS['Teentaal (16)'];
  const idx = ((beatIndex % preset.beats) + preset.beats) % preset.beats;
  const bol = preset.bols[idx] || String(idx + 1);
  // Check Khali before Sam so Rupak beat 0 (which starts on Khali) plays Dayan-only treble
  if (preset.khali.includes(idx)) return { index: idx, role: 'khali', bol };
  if (preset.sam.includes(idx)) return { index: idx, role: 'sam', bol };
  if (preset.taali.includes(idx)) return { index: idx, role: 'taali', bol };
  return { index: idx, role: 'matra', bol };
}

function triggerTablaHit(audioCtx, destGain, role, bol, volume = 0.55) {
  if (!audioCtx || !destGain) return;
  const now = audioCtx.currentTime;
  const lowerBol = String(bol || '').toLowerCase();

  // Bayan bass drum (Dha, Dhin, Dhi, Ge)
  const hasBayan = role === 'sam' || /^(dha|dhin|dhi|ge)/.test(lowerBol);
  if (hasBayan && role !== 'khali') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    const startFreq = role === 'sam' ? 148 : 132;
    const endFreq = role === 'sam' ? 68 : 76;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.16);
    gain.gain.setValueAtTime((role === 'sam' ? 0.58 : 0.36) * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(destGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  // Dayan metallic / woody membrane or woodblock click
  const clickOsc = audioCtx.createOscillator();
  const clickGain = audioCtx.createGain();
  if (role === 'sam') {
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(520, now);
    clickOsc.frequency.exponentialRampToValueAtTime(290, now + 0.09);
    clickGain.gain.setValueAtTime(0.45 * volume, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  } else if (role === 'khali') {
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(920, now);
    clickOsc.frequency.exponentialRampToValueAtTime(640, now + 0.05);
    clickGain.gain.setValueAtTime(0.28 * volume, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  } else if (role === 'taali') {
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(440, now);
    clickOsc.frequency.exponentialRampToValueAtTime(260, now + 0.07);
    clickGain.gain.setValueAtTime(0.32 * volume, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  } else {
    clickOsc.type = 'sine';
    clickOsc.frequency.setValueAtTime(/^(na|ta|tin|ti|ka|2|3|4)/.test(lowerBol) ? 620 : 380, now);
    clickGain.gain.setValueAtTime(0.18 * volume, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  }
  clickOsc.connect(clickGain);
  clickGain.connect(destGain);
  clickOsc.start(now);
  clickOsc.stop(now + 0.16);
}

export class TaalSequencer {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.timerId = null;
    this.isRunning = false;
    this.taalName = 'Teentaal (16)';
    this.bpm = 96;
    this.volume = 0.55;
    this.currentBeat = 0;
    this.onBeat = null;
  }

  _ensureAudio() {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new Ctx();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  start({ taalName, bpm, volume, onBeat } = {}) {
    if (taalName) this.taalName = taalName;
    if (bpm) this.bpm = Math.max(40, Math.min(240, Number(bpm) || 96));
    if (typeof volume === 'number') this.volume = Math.max(0, Math.min(1, volume));
    if (onBeat) this.onBeat = onBeat;

    this.stop();
    this.isRunning = true;
    this.currentBeat = 0;

    const tick = () => {
      if (!this.isRunning) return;
      const preset = TAAL_PRESETS[this.taalName] || TAAL_PRESETS['Teentaal (16)'];
      const beatInfo = getBeatRole(this.taalName, this.currentBeat);
      const ctx = this._ensureAudio();
      if (ctx) {
        triggerTablaHit(ctx, this.masterGain, beatInfo.role, beatInfo.bol, this.volume);
      }
      if (typeof this.onBeat === 'function') {
        this.onBeat({ ...beatInfo, beatsTotal: preset.beats });
      }
      this.currentBeat = (this.currentBeat + 1) % preset.beats;
    };

    tick();
    const intervalMs = Math.max(180, Math.round(60000 / this.bpm));
    this.timerId = setInterval(tick, intervalMs);
  }

  setTempo(bpm) {
    const clean = Math.max(40, Math.min(240, Number(bpm) || 96));
    if (clean === this.bpm) return;
    this.bpm = clean;
    if (this.isRunning) {
      this.start({ taalName: this.taalName, bpm: this.bpm, volume: this.volume, onBeat: this.onBeat });
    }
  }

  setTaal(taalName) {
    if (!taalName || taalName === this.taalName) return;
    this.taalName = taalName;
    if (this.isRunning) {
      this.start({ taalName: this.taalName, bpm: this.bpm, volume: this.volume, onBeat: this.onBeat });
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) || 0));
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  dispose() {
    this.stop();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch (e) {}
    }
    this.audioCtx = null;
    this.masterGain = null;
  }
}
