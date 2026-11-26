import { audioBufferToWavBlob } from './studioStorage';

export function createReverbBuffer(audioCtx, duration = 1.6, decay = 2.6) {
  const rate = audioCtx.sampleRate || 44100;
  const length = Math.max(1, Math.floor(rate * duration));
  const impulse = audioCtx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function computePitchStats(samples, sampleRate, tonicMidi, ragaName, tuningMode, findNearestSwaraFn, analyzePitchFn) {
  if (!samples || !samples.length || !analyzePitchFn || !findNearestSwaraFn) {
    return { avgHz: 0, centsList: [], swaraSet: new Set(), voicedCount: 0, durationSec: 0 };
  }
  const curve = analyzePitchFn(samples, sampleRate);
  const centsList = [];
  const swaraSet = new Set();
  let sumHz = 0;
  let voicedCount = 0;

  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i];
    if (pt && pt.freq > 60 && pt.freq < 1200) {
      voicedCount++;
      sumHz += pt.freq;
      const info = findNearestSwaraFn(pt.freq, tonicMidi, tuningMode, ragaName);
      if (info) {
        centsList.push(info.cents);
        const noteLabel = info.noteName || info.sargam;
        if (noteLabel) swaraSet.add(noteLabel);
      }
    }
  }

  return {
    avgHz: voicedCount ? sumHz / voicedCount : 0,
    centsList,
    swaraSet,
    voicedCount,
    durationSec: samples.length / sampleRate
  };
}

export function analyzeAndCompareVoices({
  userAudioBuffer,
  refAudioBuffer = null,
  tonicMidi = 60,
  ragaName = 'Bilawal',
  tuningMode = 'ji',
  findNearestSwaraFn,
  analyzePitchFn
}) {
  if (!userAudioBuffer) return null;

  const userSamples = userAudioBuffer.getChannelData(0);
  const userStats = computePitchStats(
    userSamples,
    userAudioBuffer.sampleRate,
    tonicMidi,
    ragaName,
    tuningMode,
    findNearestSwaraFn,
    analyzePitchFn
  );

  let refAvgHz = 0;
  if (refAudioBuffer) {
    const refStats = computePitchStats(
      refAudioBuffer.getChannelData(0),
      refAudioBuffer.sampleRate,
      tonicMidi,
      ragaName,
      tuningMode,
      findNearestSwaraFn,
      analyzePitchFn
    );
    refAvgHz = refStats.avgHz;
  }

  const cents = userStats.centsList;
  const count = cents.length || 1;
  const avgCentsOffset = cents.length
    ? cents.reduce((a, b) => a + b, 0) / count
    : 0;
  const inTuneCount = cents.filter((c) => Math.abs(c) <= 15).length;
  const inTunePercent = cents.length ? (inTuneCount / count) * 100 : 0;
  const flatPercent = cents.length
    ? Math.round((cents.filter((c) => c < -15).length / count) * 100)
    : 0;
  const sharpPercent = cents.length
    ? Math.round((cents.filter((c) => c > 15).length / count) * 100)
    : 0;
  const errorPercent = Math.max(0, 100 - Math.round(inTunePercent));

  const variance = cents.length
    ? cents.reduce((acc, val) => acc + Math.pow(val - avgCentsOffset, 2), 0) / count
    : 0;
  const stabilityCents = Math.sqrt(variance);
  const stabilityScore = Math.max(0, Math.min(100, Math.round(100 - stabilityCents * 1.6)));
  const overallScore = Math.round(inTunePercent * 0.7 + stabilityScore * 0.3);
  const overallGrade =
    overallScore >= 90
      ? 'S · Pro'
      : overallScore >= 78
        ? 'A · Tight'
        : overallScore >= 65
          ? 'B · Solid'
          : overallScore >= 50
            ? 'C · Practice'
            : 'D · Warmup';

  let verdictTag = 'In Tune';
  if (avgCentsOffset > 14) verdictTag = 'Sharp Tendency (+c)';
  else if (avgCentsOffset < -14) verdictTag = 'Flat Tendency (-c)';
  else if (inTunePercent < 55) verdictTag = 'Wide Vibrato / Pitch Search';

  return {
    userAvgHz: Number(userStats.avgHz.toFixed(1)),
    refAvgHz: Number(refAvgHz.toFixed(1)),
    avgCentsOffset: Number(avgCentsOffset.toFixed(1)),
    inTunePercent: Math.round(inTunePercent),
    errorPercent,
    flatPercent,
    sharpPercent,
    stabilityCents: Number(stabilityCents.toFixed(1)),
    stabilityScore,
    overallScore,
    overallGrade,
    durationSec: Number(userStats.durationSec.toFixed(2)),
    sampleNotes: Array.from(userStats.swaraSet),
    voicedFrames: userStats.voicedCount,
    verdictTag
  };
}

export async function renderOfflineMasterMix({
  vocalBuffer,
  vocalTrimStart = 0,
  vocalTrimEnd = null,
  vocalVol = 1.0,
  vocalPan = 0,
  vocalMuted = false,
  eqLow = 0,
  eqMid = 0,
  eqHigh = 0,
  reverbWet = 0.25,
  reverbDur = 1.6,
  reverbDecay = 2.6,
  delayWet = 0.1,
  delayTime = 0.28,
  delayFeedback = 0.25,
  instBuffer = null,
  instVol = 0.75,
  instOffsetSec = 0,
  instMuted = false,
  vocalOnly = false
}) {
  if (!vocalBuffer) throw new Error('No vocal take buffer to render.');
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) throw new Error('OfflineAudioContext not supported in this browser.');

  const sampleRate = vocalBuffer.sampleRate || 44100;
  const start = Math.max(0, vocalTrimStart || 0);
  const end = vocalTrimEnd !== null ? Math.min(vocalBuffer.duration, vocalTrimEnd) : vocalBuffer.duration;
  const vocalDur = Math.max(0.1, end - start);
  const totalDur = Math.max(
    vocalDur,
    !vocalOnly && instBuffer ? Math.max(0.1, instBuffer.duration + Math.max(0, instOffsetSec)) : 0
  );

  const tailPad = reverbWet > 0.02 || delayWet > 0.02 ? 1.5 : 0.1;
  const totalSamples = Math.ceil((totalDur + tailPad) * sampleRate);
  const offline = new OfflineCtx(2, totalSamples, sampleRate);

  const master = offline.createGain();
  master.gain.value = 0.95;
  master.connect(offline.destination);

  if (!vocalMuted) {
    const vSource = offline.createBufferSource();
    vSource.buffer = vocalBuffer;

    const lowShelf = offline.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 240;
    lowShelf.gain.value = eqLow || 0;

    const midPeak = offline.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = 1800;
    midPeak.Q.value = 1.1;
    midPeak.gain.value = eqMid || 0;

    const highShelf = offline.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 4800;
    highShelf.gain.value = eqHigh || 0;

    const vGain = offline.createGain();
    vGain.gain.value = vocalVol;

    const panner = offline.createStereoPanner ? offline.createStereoPanner() : null;
    if (panner) panner.pan.value = vocalPan || 0;

    const dryGain = offline.createGain();
    dryGain.gain.value = 1;

    vSource.connect(lowShelf);
    lowShelf.connect(midPeak);
    midPeak.connect(highShelf);
    highShelf.connect(vGain);
    if (panner) {
      vGain.connect(panner);
      panner.connect(dryGain);
    } else {
      vGain.connect(dryGain);
    }
    dryGain.connect(master);

    if (reverbWet > 0.01) {
      const convolver = offline.createConvolver();
      convolver.buffer = createReverbBuffer(offline, reverbDur, reverbDecay);
      const rWet = offline.createGain();
      rWet.gain.value = reverbWet;
      (panner || vGain).connect(convolver);
      convolver.connect(rWet);
      rWet.connect(master);
    }

    if (delayWet > 0.01) {
      const delay = offline.createDelay(2.0);
      delay.delayTime.value = Math.max(0.05, Math.min(1.5, delayTime || 0.28));
      const fb = offline.createGain();
      fb.gain.value = Math.max(0, Math.min(0.85, delayFeedback || 0.25));
      const dWet = offline.createGain();
      dWet.gain.value = delayWet;
      (panner || vGain).connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(dWet);
      dWet.connect(master);
    }

    vSource.start(0, start, vocalDur);
  }

  if (!vocalOnly && !instMuted && instBuffer) {
    const iSource = offline.createBufferSource();
    iSource.buffer = instBuffer;
    const iGain = offline.createGain();
    iGain.gain.value = instVol;
    iSource.connect(iGain);
    iGain.connect(master);

    if (instOffsetSec >= 0) {
      iSource.start(instOffsetSec, 0);
    } else {
      iSource.start(0, Math.min(instBuffer.duration, Math.abs(instOffsetSec)));
    }
  }

  const rendered = await offline.startRendering();
  return audioBufferToWavBlob(rendered);
}
