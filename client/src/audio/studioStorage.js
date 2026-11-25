const DB_NAME = 'SargamStudioDB';
const DB_VERSION = 2;
const STORE_NAME = 'takes';

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

export function openStudioDB() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error || new Error('IndexedDB error'));
    } catch (err) {
      resolve(null);
    }
  });
}

export async function saveStudioTake(takeData) {
  const db = await openStudioDB();
  if (!db) return takeData?.id || `take_${Date.now()}`;
  const record = {
    id: takeData.id || `take_${Date.now()}`,
    timestamp: takeData.timestamp || Date.now(),
    title: takeData.title || 'Studio Take',
    raga: takeData.raga || 'All Notes',
    tonicMidi: Number.isFinite(takeData.tonicMidi) ? takeData.tonicMidi : 60,
    bpm: takeData.bpm || 96,
    taal: takeData.taal || 'Teentaal (16)',
    durationSec: Number(takeData.durationSec) || 0,
    audioBlob: takeData.audioBlob || null,
    instUrl: takeData.instUrl || '',
    vocalUrl: takeData.vocalUrl || '',
    lyrics: Array.isArray(takeData.lyrics) ? takeData.lyrics : [],
    noteBars: Array.isArray(takeData.noteBars) ? takeData.noteBars : [],
    trimStart: Number(takeData.trimStart) || 0,
    trimEnd: Number.isFinite(takeData.trimEnd) ? takeData.trimEnd : null
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve(record.id);
    req.onerror = (e) => reject(e.target.error);
  });
}

export async function getAllStudioTakesMeta() {
  const db = await openStudioDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || [])
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .map(({ audioBlob, ...meta }) => ({ ...meta, hasAudio: Boolean(audioBlob) }));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

export async function getStudioTake(id) {
  if (!id) return null;
  const db = await openStudioDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function getLatestStudioTake() {
  const meta = await getAllStudioTakesMeta();
  if (!meta.length) return null;
  return getStudioTake(meta[0].id);
}

export async function deleteStudioTake(id) {
  if (!id) return false;
  const db = await openStudioDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

function writeWavString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function pcmFloat32ToWavBlob(floatSamples, sampleRate = 44100) {
  const numSamples = floatSamples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeWavString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeWavString(view, 8, 'WAVE');
  writeWavString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWavString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i] || 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function audioBufferToWavBlob(audioBuffer) {
  const numChannels = Math.min(2, audioBuffer.numberOfChannels || 1);
  const sampleRate = audioBuffer.sampleRate || 44100;
  const length = audioBuffer.length;
  const dataSize = length * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeWavString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeWavString(view, 8, 'WAVE');
  writeWavString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeWavString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i] || 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
