import { describe, it, expect } from 'vitest';
import {
  getSwaraFreq,
  buildScaleNotes,
  autoCorrelate,
  createPitchSmoother,
  findNearestSwara,
  extractBarsFromCurve,
  autoDetectVocalScaleAndRange,
  getRagaSemitones
} from '../sargamEngine';
import { TAAL_PRESETS, getBeatRole } from '../taalEngine';
import { midiToTanpuraAudioKey, getTanpuraVoicingInfo } from '../tanpuraEngine';
import { pcmFloat32ToWavBlob } from '../studioStorage';

describe('Sargam Music Theory & DSP Engine', () => {
  it('computes accurate Equal Temperament and Just Intonation frequencies with 22-shruti offsets', () => {
    const a4Et = getSwaraFreq(9, 0, 60, 'et', 'Bilawal'); // A4 from C4
    expect(Math.round(a4Et)).toBe(440);

    const paJi = getSwaraFreq(7, 0, 60, 'ji', 'Bilawal'); // C4 * 3/2
    const c4 = 261.625565;
    expect(Math.abs(paJi - c4 * 1.5)).toBeLessThan(0.2);

    // Darbari Kanhra flattens Komal Ga by -22 cents compared to base JI
    const komalGaBilawal = getSwaraFreq(3, 0, 60, 'ji', 'All Notes');
    const komalGaDarbari = getSwaraFreq(3, 0, 60, 'ji', 'Darbari Kanhra');
    expect(komalGaDarbari).toBeLessThan(komalGaBilawal);
  });

  it('filters Raga semitones correctly (e.g. pentatonic Malkauns skips Re and Pa)', () => {
    const malkauns = getRagaSemitones('Malkauns');
    expect(malkauns).toEqual([0, 3, 5, 8, 10]);

    const notes = buildScaleNotes(60, 'ji', 'Malkauns');
    const octaveZero = notes.filter((n) => n.oct === 0);
    const inScaleShorts = octaveZero.filter((n) => n.inRaga).map((n) => n.short);
    expect(inScaleShorts).toEqual(['S', 'g', 'm', 'd', 'n']);
  });

  it('detects synthetic sine wave frequency via autoCorrelate and matches nearest Swara', () => {
    const sampleRate = 44100;
    const len = 2048;
    const targetHz = 440; // A4
    const buf = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      buf[i] = 0.5 * Math.sin((2 * Math.PI * targetHz * i) / sampleRate);
    }

    const detected = autoCorrelate(buf, sampleRate);
    expect(Math.abs(detected - 440)).toBeLessThan(3);

    const swara = findNearestSwara(detected, 69, 'ji', 'Bilawal'); // Tonic A4
    expect(swara.sargam).toBe('Sa');
    expect(swara.inTune).toBe(true);
    expect(Math.abs(swara.cents)).toBeLessThanOrEqual(5);

    const silence = new Float32Array(len);
    expect(autoCorrelate(silence, sampleRate)).toBe(-1);
  });

  it('rejects single-frame octave spikes and decays cleanly to silence via createPitchSmoother', () => {
    const smoother = createPitchSmoother({ windowSize: 5, alpha: 0.32, silenceHoldFrames: 4 });
    const inputs = [261.6, 262.0, 523.2, 261.8, 261.5];
    let last = -1;
    for (const hz of inputs) {
      last = smoother.push(hz);
    }
    expect(last).toBeGreaterThan(255);
    expect(last).toBeLessThan(268);

    // Silence hold for 3 frames, then clears at frame 4
    expect(smoother.push(-1)).toBeGreaterThan(255);
    expect(smoother.push(-1)).toBeGreaterThan(255);
    expect(smoother.push(-1)).toBeGreaterThan(255);
    expect(smoother.push(-1)).toBe(-1);
  });

  it('extracts melody note bars from pitch curve and auto-fits tonic/raga', () => {
    // Sequence centered around C4 Bilawal notes: C4 (60), E4 (64), G4 (67), C5 (72)
    const curve = [];
    const freqs = [261.63, 261.63, 329.63, 329.63, 392.0, 392.0, 523.25, 523.25];
    freqs.forEach((f, idx) => {
      curve.push({ time: idx * 0.2, freq: f });
      curve.push({ time: idx * 0.2 + 0.1, freq: f });
    });

    const bars = extractBarsFromCurve(curve, 1.8);
    expect(bars.length).toBeGreaterThanOrEqual(4);

    const fit = autoDetectVocalScaleAndRange(bars);
    expect(fit.confidence).toBeGreaterThan(20);
    expect(typeof fit.raga).toBe('string');
  });

  it('prioritizes true Sa over its 4th/5th on asymmetric vocal histograms (e.g. A# tonic vs D#)', () => {
    const sampleBars = [];
    let t = 0;
    const addNote = (midi, totalSec) => {
      sampleBars.push({ start: t, end: t + totalSec, midi, freq: 440 * Math.pow(2, (midi - 69) / 12) });
      t += totalSec;
    };
    addNote(58, 15.22); // A#3 (dominant Sa)
    addNote(63, 7.37);  // D#4 (Ma of A#)
    addNote(60, 4.85);  // C4 (Re of A#)
    addNote(61, 4.39);  // C#4 (Komal Ga of A#)
    addNote(56, 4.20);  // G#3 (Komal Ni of A#)
    addNote(65, 0.69);  // F4 (Pa of A#)

    const fit = autoDetectVocalScaleAndRange(sampleBars);
    expect(fit.tonicMidi % 12).toBe(10); // A#
    expect(fit.tonicMidi).toBeGreaterThanOrEqual(58 - 1);
  });

  it('maps Tanpura keys, raga voicings, Taal matra roles, and encodes PCM WAV header', () => {
    expect(midiToTanpuraAudioKey(61)).toBe('Cs');
    expect(midiToTanpuraAudioKey(69)).toBe('A');

    const malkaunsVoicing = getTanpuraVoicingInfo('Malkauns');
    expect(malkaunsVoicing.mode).toBe('maSa');

    const bhairavVoicing = getTanpuraVoicingInfo('Bhairav');
    expect(bhairavVoicing.mode).toBe('niSa');

    const bhairaviVoicing = getTanpuraVoicingInfo('Bhairavi');
    expect(bhairaviVoicing.mode).toBe('dhaSa');

    const yamanVoicing = getTanpuraVoicingInfo('Yaman');
    expect(yamanVoicing.mode).toBe('standard');

    expect(TAAL_PRESETS['Teentaal (16)'].beats).toBe(16);
    expect(getBeatRole('Teentaal (16)', 0).role).toBe('sam');
    expect(getBeatRole('Teentaal (16)', 8).role).toBe('khali');
    expect(getBeatRole('Rupak (7)', 0).role).toBe('khali');

    const wavBlob = pcmFloat32ToWavBlob(new Float32Array([0, 0.5, -0.5, 0]), 44100);
    expect(wavBlob.size).toBe(44 + 8);
    expect(wavBlob.type).toBe('audio/wav');
  });
});
