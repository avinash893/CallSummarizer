import {
  RAAG_SWARAS,
  RAAG_SHRUTIS,
  RAAG_TANPURA_MAP,
  RAAG_TANPURA_VOICING_LABEL,
  RAAG_TANPURA_LIST,
  canonicalRaagName
} from './raagTanpuraData';

export { RAAG_TANPURA_LIST, RAAG_SWARAS, RAAG_SHRUTIS, RAAG_TANPURA_MAP, canonicalRaagName };

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SWARAS_DATA = [
  { semitone: 0, short: 'S', english: 'Sa', devanagari: 'सा', jiRatio: 1 / 1, isShuddh: true },
  { semitone: 1, short: 'r', english: 'Komal Re', devanagari: 'रे॒', jiRatio: 16 / 15, isShuddh: false },
  { semitone: 2, short: 'R', english: 'Re', devanagari: 'रे', jiRatio: 9 / 8, isShuddh: true },
  { semitone: 3, short: 'g', english: 'Komal Ga', devanagari: 'ग॒', jiRatio: 6 / 5, isShuddh: false },
  { semitone: 4, short: 'G', english: 'Ga', devanagari: 'ग', jiRatio: 5 / 4, isShuddh: true },
  { semitone: 5, short: 'm', english: 'Ma', devanagari: 'म', jiRatio: 4 / 3, isShuddh: true },
  { semitone: 6, short: 'M', english: 'Tivra Ma', devanagari: 'म॑', jiRatio: 45 / 32, isShuddh: false },
  { semitone: 7, short: 'P', english: 'Pa', devanagari: 'प', jiRatio: 3 / 2, isShuddh: true },
  { semitone: 8, short: 'd', english: 'Komal Dha', devanagari: 'ध॒', jiRatio: 8 / 5, isShuddh: false },
  { semitone: 9, short: 'D', english: 'Dha', devanagari: 'ध', jiRatio: 5 / 3, isShuddh: true },
  { semitone: 10, short: 'n', english: 'Komal Ni', devanagari: 'नि॒', jiRatio: 9 / 5, isShuddh: false },
  { semitone: 11, short: 'N', english: 'Ni', devanagari: 'नि', jiRatio: 15 / 8, isShuddh: true }
];

const KALI_ALIASES = {
  'C#': 'Kali 1',
  'D#': 'Kali 2',
  'F#': 'Kali 3',
  'G#': 'Kali 4',
  'A#': 'Kali 5',
  C: 'Safed 1',
  D: 'Safed 2',
  E: 'Safed 3',
  F: 'Safed 4',
  G: 'Safed 5',
  A: 'Safed 6',
  B: 'Safed 7'
};

export const TONIC_OPTIONS = Array.from({ length: 24 }, (_, idx) => {
  const midi = 48 + idx; // C3..B4
  const noteName = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return {
    midi,
    shortLabel: `${noteName}${octave}`,
    label: `${noteName}${octave} (${KALI_ALIASES[noteName]})`,
    hz: Number((440 * Math.pow(2, (midi - 69) / 12)).toFixed(2))
  };
});

export const RAGA_OPTIONS = ['All Notes', ...RAAG_TANPURA_LIST];

export const RAGA_DESCRIPTIONS = {
  'All Notes': { thaat: 'Chromatic (12)', prahar: 'Anytime', vadi: 'Sa', samvadi: 'Pa', mood: 'Free jam & Western/Fusion harmony' },
  Bilawal: { thaat: 'Bilawal', prahar: 'Morning', vadi: 'Dha', samvadi: 'Ga', mood: 'Bright Major / Ionian equilibrium' },
  Yaman: { thaat: 'Kalyan', prahar: 'Evening (1st Prahar)', vadi: 'Ga', samvadi: 'Ni', mood: 'Devotional serene glow (Tivra Ma)' },
  Bhairav: { thaat: 'Bhairav', prahar: 'Dawn', vadi: 'Dha', samvadi: 'Re', mood: 'Majestic awe (Ati-Komal Re & Dha)' },
  Bhairavi: { thaat: 'Bhairavi', prahar: 'Morning / Finale', vadi: 'Ma', samvadi: 'Sa', mood: 'Deep pathos & sweet surrender' },
  Bhimpalasi: { thaat: 'Kafi', prahar: 'Afternoon', vadi: 'Ma', samvadi: 'Sa', mood: 'Romantic longing (g, n)' },
  'Darbari Kanhra': { thaat: 'Asavari', prahar: 'Late Night', vadi: 'Re', samvadi: 'Pa', mood: 'Royal solemnity & heavy Andolan on g, d' },
  Malkauns: { thaat: 'Bhairavi', prahar: 'Midnight', vadi: 'Ma', samvadi: 'Sa', mood: 'Hypnotic pentatonic gravity (no Re, Pa)' },
  Kafi: { thaat: 'Kafi', prahar: 'Late Evening', vadi: 'Pa', samvadi: 'Sa', mood: 'Playful Hori & Thumri (Dorian)' },
  Khamaj: { thaat: 'Khamaj', prahar: 'Night', vadi: 'Ga', samvadi: 'Ni', mood: 'Lyrical Thumri charm (Mixolydian)' },
  Des: { thaat: 'Khamaj', prahar: 'Night', vadi: 'Re', samvadi: 'Pa', mood: 'Monsoon patriotic nostalgia' },
  Todi: { thaat: 'Todi', prahar: 'Late Morning', vadi: 'Dha', samvadi: 'Ga', mood: 'Intense introspective pathos (r, g, M, d)' },
  Hansdhwani: { thaat: 'Bilawal', prahar: 'Evening', vadi: 'Sa', samvadi: 'Pa', mood: 'Joyful pentatonic briskness (S R G P N)' }
};

export function getRagaMeta(ragaName = 'Bilawal') {
  const canon = canonicalRaagName(ragaName) || ragaName || 'All Notes';
  if (RAGA_DESCRIPTIONS[canon]) return { ...RAGA_DESCRIPTIONS[canon], canon };
  const swaras = getRagaSemitones(ragaName);
  const voicing = RAAG_TANPURA_MAP[canon] || 'standard';
  return {
    thaat: 'Hindustani Classical',
    prahar: 'Traditional Concert',
    vadi: swaras.includes(4) ? 'Ga' : 'Ma',
    samvadi: swaras.includes(7) ? 'Pa' : 'Sa',
    mood: `${swaras.length}-note scale • Tanpura: ${RAAG_TANPURA_VOICING_LABEL[voicing] || 'Pa-Sa'}`,
    canon
  };
}

export function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${octave}`;
}

export function getRagaSemitones(ragaName) {
  if (!ragaName || ragaName === 'All Notes') {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  }
  const canon = canonicalRaagName(ragaName);
  if (canon && Array.isArray(RAAG_SWARAS[canon])) {
    return RAAG_SWARAS[canon];
  }
  return [0, 2, 4, 5, 7, 9, 11];
}

export function getSwaraFreq(semitoneOffset, octaveOffset, tonicMidi = 60, tuningMode = 'ji', ragaName = 'All Notes') {
  const cleanSemi = ((semitoneOffset % 12) + 12) % 12;
  const tonicHz = 440 * Math.pow(2, (tonicMidi - 69) / 12);
  let baseFreq;

  if (tuningMode === 'et') {
    baseFreq = tonicHz * Math.pow(2, cleanSemi / 12 + octaveOffset);
  } else {
    const swara = SWARAS_DATA[cleanSemi] || SWARAS_DATA[0];
    baseFreq = tonicHz * swara.jiRatio * Math.pow(2, octaveOffset);
    // Apply raga-specific 22-shruti microtonal cents offset if available
    const canon = ragaName && ragaName !== 'All Notes' ? canonicalRaagName(ragaName) : null;
    const shrutiMap = canon ? RAAG_SHRUTIS[canon] : null;
    const shrutiCents = shrutiMap && shrutiMap[String(cleanSemi)];
    if (typeof shrutiCents === 'number' && shrutiCents !== 0) {
      baseFreq *= Math.pow(2, shrutiCents / 1200);
    }
  }
  return baseFreq;
}

export function buildScaleNotes(tonicMidi = 60, tuningMode = 'ji', ragaName = 'Bilawal') {
  const activeSet = new Set(getRagaSemitones(ragaName));
  const canon = ragaName && ragaName !== 'All Notes' ? canonicalRaagName(ragaName) : null;
  const shrutiMap = canon ? RAAG_SHRUTIS[canon] : null;
  const notes = [];

  for (let oct = -1; oct <= 1; oct++) {
    for (let semi = 0; semi < 12; semi++) {
      const midi = tonicMidi + oct * 12 + semi;
      const freq = getSwaraFreq(semi, oct, tonicMidi, tuningMode, ragaName);
      const sw = SWARAS_DATA[semi];
      notes.push({
        midi,
        semi,
        oct,
        freq,
        noteName: midiToNoteName(midi),
        short: sw.short,
        english: sw.english,
        devanagari: sw.devanagari,
        inRaga: activeSet.has(semi),
        shrutiCents: shrutiMap && typeof shrutiMap[String(semi)] === 'number' ? shrutiMap[String(semi)] : 0
      });
    }
  }
  return notes;
}

export function findNearestSwara(freq, tonicMidi = 60, tuningMode = 'ji', ragaName = 'Bilawal') {
  if (!freq || !Number.isFinite(freq) || freq <= 40 || freq > 2200) return null;
  const notes = buildScaleNotes(tonicMidi, tuningMode, ragaName);
  // Prefer raga notes when within tight proximity, else nearest chromatic
  const ragaOnly = notes.filter((n) => n.inRaga);
  const candidates = ragaOnly.length ? notes : notes;

  let best = notes[0];
  let bestCentsAbs = Infinity;
  let bestSignedCents = 0;

  for (let i = 0; i < candidates.length; i++) {
    const n = candidates[i];
    const cents = 1200 * Math.log2(freq / n.freq);
    const penalty = n.inRaga ? 0 : 8; // gentle nudge toward scale notes inside 8c ties
    if (Math.abs(cents) + penalty < bestCentsAbs) {
      bestCentsAbs = Math.abs(cents) + penalty;
      bestSignedCents = cents;
      best = n;
    }
  }

  const octaveMarker = best.oct < 0 ? ' · Mandra' : best.oct > 0 ? ' · Taar' : ' · Madhya';
  return {
    freq: Number(freq.toFixed(2)),
    targetFreq: Number(best.freq.toFixed(2)),
    midi: best.midi,
    semi: best.semi,
    oct: best.oct,
    noteName: best.noteName,
    sargam: best.english,
    shortSargam: best.short,
    devanagari: best.devanagari,
    octaveLabel: octaveMarker,
    inRaga: best.inRaga,
    cents: Math.round(bestSignedCents),
    inTune: Math.abs(bestSignedCents) <= 15
  };
}

/**
 * Autocorrelation + parabolic interpolation F0 detector (McLeod-style refinement)
 * Ported directly from Sargam Tuner for accurate monophonic vocal & instrument detection.
 */
export function autoCorrelate(buf, sampleRate = 44100) {
  if (!buf || !buf.length) return -1;
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    rms += buf[i] * buf[i];
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.015) return -1;

  const minPeriod = Math.max(2, Math.floor(sampleRate / 1050));
  const maxPeriod = Math.min(SIZE - 2, Math.floor(sampleRate / 65));
  if (maxPeriod <= minPeriod + 2) return -1;

  const searchLen = Math.min(SIZE - maxPeriod, 1024);
  if (searchLen < 32) return -1;

  let energy1 = 0;
  for (let i = 0; i < searchLen; i++) {
    energy1 += buf[i] * buf[i];
  }
  if (energy1 <= 0) return -1;

  const corrs = new Float32Array(maxPeriod + 2);
  let bestCorr = -1;

  for (let lag = minPeriod; lag <= maxPeriod; lag++) {
    let sum = 0;
    let energy2 = 0;
    for (let i = 0; i < searchLen; i++) {
      const a = buf[i];
      const b = buf[i + lag];
      sum += a * b;
      energy2 += b * b;
    }
    const denom = Math.sqrt(energy1 * energy2);
    const normCorr = denom > 0 ? sum / denom : 0;
    corrs[lag] = normCorr;
    if (normCorr > bestCorr) {
      bestCorr = normCorr;
    }
  }

  if (bestCorr < 0.80) return -1;

  // Pick the first strong local peak (prevents octave-down subharmonic jumps)
  const peakThreshold = Math.max(0.80, bestCorr * 0.94);
  let chosenLag = -1;
  for (let lag = minPeriod + 1; lag < maxPeriod; lag++) {
    const val = corrs[lag];
    if (val >= peakThreshold && val >= corrs[lag - 1] && val >= corrs[lag + 1]) {
      chosenLag = lag;
      break;
    }
  }

  if (chosenLag === -1) {
    let maxVal = -1;
    for (let lag = minPeriod; lag <= maxPeriod; lag++) {
      if (corrs[lag] > maxVal) {
        maxVal = corrs[lag];
        chosenLag = lag;
      }
    }
  }
  if (chosenLag <= 0) return -1;

  // Parabolic interpolation around chosenLag
  let T0 = chosenLag;
  if (chosenLag > minPeriod && chosenLag < maxPeriod) {
    const x1 = corrs[chosenLag - 1];
    const x2 = corrs[chosenLag];
    const x3 = corrs[chosenLag + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a !== 0) T0 = chosenLag - b / (2 * a);
  }

  const freq = sampleRate / T0;
  if (freq < 65 || freq > 1050 || !Number.isFinite(freq)) return -1;
  return freq;
}

export function createPitchSmoother({ windowSize = 5, alpha = 0.32, silenceHoldFrames = 6 } = {}) {
  const history = [];
  let smoothedHz = -1;
  let silentFrames = 0;

  const reset = () => {
    history.length = 0;
    smoothedHz = -1;
    silentFrames = 0;
  };

  const push = (rawHz) => {
    if (!Number.isFinite(rawHz) || rawHz <= 0) {
      silentFrames += 1;
      if (silentFrames >= silenceHoldFrames) {
        reset();
        return -1;
      }
      return smoothedHz;
    }

    silentFrames = 0;
    history.push(rawHz);
    if (history.length > windowSize) {
      history.shift();
    }

    const sorted = [...history].sort((a, b) => a - b);
    const medianHz = sorted[Math.floor(sorted.length / 2)];

    if (smoothedHz <= 0) {
      smoothedHz = medianHz;
    } else {
      const semiJump = Math.abs(12 * Math.log2(medianHz / smoothedHz));
      const effAlpha = semiJump > 1.5 ? 0.6 : alpha;
      const prevMidi = 69 + 12 * Math.log2(smoothedHz / 440);
      const medMidi = 69 + 12 * Math.log2(medianHz / 440);
      const nextMidi = prevMidi * (1 - effAlpha) + medMidi * effAlpha;
      smoothedHz = 440 * Math.pow(2, (nextMidi - 69) / 12);
    }

    return smoothedHz;
  };

  return { push, reset };
}

export function extractBarsFromCurve(pitchCurve, totalDur = 0) {
  if (!Array.isArray(pitchCurve) || pitchCurve.length === 0) return [];
  const bars = [];
  let curBar = null;

  for (let i = 0; i < pitchCurve.length; i++) {
    const pt = pitchCurve[i];
    const freq = pt.freq;
    const time = pt.time;
    const nextTime = i < pitchCurve.length - 1 ? pitchCurve[i + 1].time : Math.max(time + 0.08, totalDur || time + 0.08);

    if (!freq || freq < 65 || freq > 1150) {
      if (curBar) {
        bars.push(curBar);
        curBar = null;
      }
      continue;
    }

    const midi = 69 + 12 * Math.log2(freq / 440);
    if (curBar && Math.abs(midi - curBar.midi) <= 0.75 && time - curBar.end <= 0.16) {
      curBar.end = nextTime;
      curBar._sumMidi += midi;
      curBar._count += 1;
      curBar.midi = curBar._sumMidi / curBar._count;
      curBar.freq = 440 * Math.pow(2, (curBar.midi - 69) / 12);
    } else {
      if (curBar) bars.push(curBar);
      curBar = {
        start: time,
        end: nextTime,
        midi,
        freq,
        _sumMidi: midi,
        _count: 1
      };
    }
  }
  if (curBar) bars.push(curBar);

  return bars
    .filter((b) => b.end - b.start >= 0.06)
    .map(({ _sumMidi, _count, ...clean }) => ({
      ...clean,
      midi: Number(clean.midi.toFixed(2)),
      freq: Number(clean.freq.toFixed(2)),
      noteName: midiToNoteName(clean.midi)
    }));
}

export function analyzeAudioBufferPitch(samples, sampleRate = 44100) {
  if (!samples || !samples.length) return [];
  const hop = Math.max(512, Math.floor(sampleRate * 0.04)); // 40ms step
  const win = 2048;
  const curve = [];

  for (let pos = 0; pos + win < samples.length; pos += hop) {
    const slice = samples.subarray(pos, pos + win);
    const freq = autoCorrelate(slice, sampleRate);
    curve.push({
      time: Number((pos / sampleRate).toFixed(3)),
      freq: freq > 0 ? Number(freq.toFixed(2)) : 0
    });
  }
  return curve;
}

export async function analyzeAudioBufferPitchAsync(audioBuffer, onProgress = null) {
  if (!audioBuffer) return { pitchCurve: [], noteBars: [] };
  const samples = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate || 44100;
  const hop = Math.max(512, Math.floor(sampleRate * 0.04));
  const win = 2048;
  const totalSteps = Math.max(1, Math.floor((samples.length - win) / hop));
  const curve = [];

  for (let step = 0, pos = 0; pos + win < samples.length; step++, pos += hop) {
    const slice = samples.subarray(pos, pos + win);
    const freq = autoCorrelate(slice, sampleRate);
    curve.push({
      time: Number((pos / sampleRate).toFixed(3)),
      freq: freq > 0 ? Number(freq.toFixed(2)) : 0
    });
    if (step % 80 === 0) {
      if (onProgress) onProgress(Math.min(99, Math.round((step / totalSteps) * 100)));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (onProgress) onProgress(100);
  return {
    pitchCurve: curve,
    noteBars: extractBarsFromCurve(curve, audioBuffer.duration)
  };
}

export function autoDetectVocalScaleAndRange(bars = []) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return { tonicMidi: 60, raga: 'Bilawal', confidence: 0, minMidi: 48, maxMidi: 72 };
  }
  // Compute duration-weighted histogram of 12 pitch classes (C..B) + vocal min/max range
  const hist = new Array(12).fill(0);
  let minMidi = 127;
  let maxMidi = 0;
  let totalDur = 0;

  for (let idx = 0; idx < bars.length; idx++) {
    const b = bars[idx];
    if (!b || !Number.isFinite(Number(b.midi))) continue;
    const midi = Number(b.midi);
    const dur = Math.max(0.05, (Number(b.end) || 0) - (Number(b.start) || 0));
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    // Slight cadence bonus on ending sustained notes (melodies resolve onto Sa)
    const isCadence = idx >= Math.max(0, bars.length - 3) && dur >= 0.25;
    const weight = dur * (isCadence ? 1.25 : 1.0);
    hist[pc] += weight;
    totalDur += weight;
    if (midi < minMidi) minMidi = midi;
    if (midi > maxMidi) maxMidi = midi;
  }

  if (minMidi > maxMidi || totalDur <= 0) {
    return { tonicMidi: 60, raga: 'Bilawal', confidence: 0, minMidi: 48, maxMidi: 72 };
  }

  // Score tonic (Sa) using REAA's Sa-dominant harmonic model + raga scale fit
  const sampleRagas = ['Bilawal', 'Yaman', 'Bhairav', 'Bhairavi', 'Bhimpalasi', 'Kafi', 'Khamaj', 'Des', 'Malkauns', 'Darbari Kanhra'];
  let bestPc = 0;
  let bestRaga = 'Bilawal';
  let bestScore = -1;

  for (let pc = 0; pc < 12; pc++) {
    const sa = hist[pc];
    const pa = hist[(pc + 7) % 12];
    const ma = hist[(pc + 5) % 12];
    const ga = Math.max(hist[(pc + 4) % 12], hist[(pc + 3) % 12]);
    // Sa outweighs Pa (2.5 vs 1.5) so tonic isn't confused with its 4th/5th
    const harmonicAnchor = (sa * 2.5 + pa * 1.5 + ga * 1.1 + ma * 1.0) / totalDur;

    for (const raga of sampleRagas) {
      const semitones = new Set(getRagaSemitones(raga));
      let inScaleDur = 0;
      for (let i = 0; i < 12; i++) {
        const rel = (i - pc + 12) % 12;
        if (semitones.has(rel)) inScaleDur += hist[i];
      }
      const inScaleRatio = inScaleDur / totalDur;
      // Combine harmonic tonic strength with scale coverage (no pentatonic bias)
      const score = harmonicAnchor * 0.55 + inScaleRatio * 0.45;
      if (score > bestScore) {
        bestScore = score;
        bestPc = pc;
        bestRaga = raga;
      }
    }
  }

  // Place Sa cleanly inside the singer's lower-middle vocal octave
  let targetMidi = 48 + bestPc;
  while (targetMidi < minMidi - 1) targetMidi += 12;
  while (targetMidi > minMidi + 8 && targetMidi >= 48) targetMidi -= 12;
  targetMidi = Math.max(48, Math.min(71, targetMidi));

  return {
    tonicMidi: targetMidi,
    raga: bestRaga,
    confidence: Math.min(99, Math.max(30, Math.round((bestScore / 1.8) * 100))),
    minMidi: Math.round(minMidi),
    maxMidi: Math.round(maxMidi)
  };
}

export function getChordIntervalsForTonic(tonicMidi = 60, ragaName = 'Bilawal') {
  const semitones = new Set(getRagaSemitones(ragaName));
  const third = semitones.has(3) && !semitones.has(4) ? 3 : 4;
  const fifth = semitones.has(7) ? 7 : semitones.has(6) ? 6 : 8;
  const seventh = semitones.has(11) ? 11 : 10;
  return {
    root: midiToNoteName(tonicMidi),
    third: midiToNoteName(tonicMidi + third),
    fifth: midiToNoteName(tonicMidi + fifth),
    seventh: midiToNoteName(tonicMidi + seventh),
    quality: third === 3 ? 'Minor / Komal Ga' : 'Major / Shuddha Ga'
  };
}

let sharedRefCtx = null;

export function playReferenceSwaraTone(freq, duration = 0.85) {
  if (typeof window === 'undefined' || !freq || !Number.isFinite(freq)) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!sharedRefCtx || sharedRefCtx.state === 'closed') {
      sharedRefCtx = new Ctx();
    }
    if (sharedRefCtx.state === 'suspended') {
      sharedRefCtx.resume().catch(() => {});
    }
    const now = sharedRefCtx.currentTime;
    const osc1 = sharedRefCtx.createOscillator();
    const osc2 = sharedRefCtx.createOscillator();
    const filter = sharedRefCtx.createBiquadFilter();
    const env = sharedRefCtx.createGain();

    // Warm Harmonium / Reed tone
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, now);
    osc2.frequency.setValueAtTime(freq * 2, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(3200, freq * 5), now);

    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.18, now + 0.04);
    env.gain.setValueAtTime(0.15, now + Math.max(0.08, duration - 0.18));
    env.gain.exponentialRampToValueAtTime(0.0005, now + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(env);
    env.connect(sharedRefCtx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration + 0.02);
    osc2.stop(now + duration + 0.02);
  } catch (e) {
    // Ignore audio context errors cleanly
  }
}

export function findActiveTargetBar(noteBars, currentTime, graceSec = 0.25) {
  if (!Array.isArray(noteBars) || noteBars.length === 0) return null;
  let nearestBar = null;
  let minDist = Infinity;

  for (let i = 0; i < noteBars.length; i++) {
    const b = noteBars[i];
    if (!b) continue;
    const start = Number(b.start) || 0;
    const end = Number(b.end) || start;
    if (currentTime >= start && currentTime <= end) {
      return b;
    }
    const dist = Math.abs(currentTime - (start + end) / 2);
    if (dist < graceSec && dist < minDist) {
      minDist = dist;
      nearestBar = b;
    }
  }
  return nearestBar;
}

export function evaluatePitchMatch(userHz, targetBar, tolerancePct = 0.10) {
  const hz = Number(userHz) || 0;
  const rawTargetHz = Number(
    targetBar?.freq ||
      targetBar?.avg_hz ||
      targetBar?.hz ||
      (targetBar?.midi ? 440 * Math.pow(2, (targetBar.midi - 69) / 12) : 0)
  );
  if (hz <= 50 || rawTargetHz <= 50) return null;

  const candidates = [rawTargetHz, rawTargetHz * 0.5, rawTargetHz * 2.0];
  let minErr = Infinity;
  let bestCandidate = rawTargetHz;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const err = Math.abs(hz - c) / c;
    if (err < minErr) {
      minErr = err;
      bestCandidate = c;
    }
  }

  return {
    isMatched: minErr <= tolerancePct,
    errorPct: Number((minErr * 100).toFixed(1)),
    direction: hz < bestCandidate ? 'flat' : 'sharp',
    targetHz: Number(rawTargetHz.toFixed(1)),
    tolerancePct
  };
}
