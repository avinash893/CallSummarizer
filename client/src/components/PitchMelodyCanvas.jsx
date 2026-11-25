import React, { useEffect, useRef } from 'react';
import { buildScaleNotes, findNearestSwara } from '../audio/sargamEngine';

export default function PitchMelodyCanvas({
  noteBars = [],
  currentTime = 0,
  duration = 0,
  tonicMidi = 60,
  raga = 'Bilawal',
  tuningMode = 'ji',
  langMode = 'en',
  liveMicPitch = null,
  onSeek = null
}) {
  const canvasRef = useRef(null);
  const trailRef = useRef([]);

  // Append recent live mic pitch frames for fluid ribbon rendering
  useEffect(() => {
    if (liveMicPitch && liveMicPitch.freq > 0) {
      trailRef.current.push({
        t: Date.now(),
        midi: 69 + 12 * Math.log2(liveMicPitch.freq / 440),
        inTune: Boolean(liveMicPitch.inTune),
        label: langMode === 'hi' ? liveMicPitch.devanagari : liveMicPitch.shortSargam
      });
      if (trailRef.current.length > 90) {
        trailRef.current.shift();
      }
    }
  }, [liveMicPitch, langMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx = null;
    try {
      ctx = canvas.getContext('2d');
    } catch (e) {
      return;
    }
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const width = canvas.clientWidth || 720;
    const height = canvas.clientHeight || 260;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Obsidian stage background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#0d1017');
    bgGrad.addColorStop(1, '#141822');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const minMidi = tonicMidi - 8;
    const maxMidi = tonicMidi + 20;
    const midiToY = (midi) => {
      const ratio = (midi - minMidi) / Math.max(1, maxMidi - minMidi);
      return height - 18 - Math.max(0, Math.min(1, ratio)) * (height - 36);
    };

    // Draw Raga-aware horizontal pitch grid lines
    const scaleNotes = buildScaleNotes(tonicMidi, tuningMode, raga);
    ctx.font = '600 10px "JetBrains Mono", monospace';
    scaleNotes.forEach((n) => {
      if (n.midi < minMidi || n.midi > maxMidi) return;
      const y = midiToY(n.midi);
      const isSa = n.semi === 0;
      const isPa = n.semi === 7;

      ctx.beginPath();
      ctx.moveTo(46, y);
      ctx.lineTo(width, y);
      ctx.strokeStyle = isSa
        ? 'rgba(255, 111, 32, 0.42)'
        : isPa
          ? 'rgba(56, 189, 248, 0.25)'
          : n.inRaga
            ? 'rgba(255, 255, 255, 0.1)'
            : 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = isSa ? 1.5 : 1;
      ctx.stroke();

      if (n.inRaga || isSa) {
        ctx.fillStyle = isSa ? '#ff8b3d' : isPa ? '#7dd3fc' : 'rgba(220,226,240,0.68)';
        const label = langMode === 'hi' ? n.devanagari : n.short;
        ctx.fillText(label, 12, y + 3.5);
      }
    });

    // Window around current playback time (-3s left to +7s right)
    const windowSec = 10;
    const viewStart = Math.max(0, currentTime - 2.6);
    const playheadX = 46 + ((currentTime - viewStart) / windowSec) * (width - 54);
    const timeToX = (t) => 46 + ((t - viewStart) / windowSec) * (width - 54);

    // Draw reference song melody bars
    if (Array.isArray(noteBars) && noteBars.length > 0) {
      noteBars.forEach((bar) => {
        if (bar.end < viewStart || bar.start > viewStart + windowSec) return;
        const x1 = Math.max(46, timeToX(bar.start));
        const x2 = Math.min(width - 4, timeToX(bar.end));
        const bw = Math.max(6, x2 - x1);
        const y = midiToY(bar.midi);
        const isCurrent = currentTime >= bar.start && currentTime <= bar.end;
        const sw = findNearestSwara(bar.freq, tonicMidi, tuningMode, raga);

        ctx.fillStyle = isCurrent
          ? '#38bdf8'
          : sw?.inRaga
            ? 'rgba(99, 102, 241, 0.72)'
            : 'rgba(139, 92, 246, 0.42)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x1, y - 6, bw, 12, 5);
        } else {
          ctx.rect(x1, y - 6, bw, 12);
        }
        ctx.fill();

        if (isCurrent && sw) {
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (bw > 24 && sw) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 9px "Inter", sans-serif';
          ctx.fillText(langMode === 'hi' ? sw.devanagari : sw.shortSargam, x1 + 5, y + 3);
        }
      });
    }

    // Playhead laser line
    ctx.beginPath();
    ctx.moveTo(playheadX, 8);
    ctx.lineTo(playheadX, height - 8);
    ctx.strokeStyle = 'rgba(255, 111, 32, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Live user vocal/instrument trail ribbon + active Sur dot
    const now = Date.now();
    const recent = trailRef.current.filter((p) => now - p.t <= 3600);
    if (recent.length > 1) {
      ctx.beginPath();
      recent.forEach((p, idx) => {
        const ageSec = (now - p.t) / 1000;
        const px = Math.max(46, playheadX - ageSec * ((width - 54) / windowSec));
        const py = midiToY(p.midi);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (liveMicPitch && liveMicPitch.freq > 0) {
      const micMidi = 69 + 12 * Math.log2(liveMicPitch.freq / 440);
      const py = midiToY(micMidi);
      const px = playheadX;
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = liveMicPitch.inTune ? '#10b981' : '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = liveMicPitch.inTune ? '#6ee7b7' : '#fde68a';
      ctx.font = '700 10px "Inter", sans-serif';
      const tag = `${langMode === 'hi' ? liveMicPitch.devanagari : liveMicPitch.shortSargam} ${liveMicPitch.inTune ? '✓ SUR' : `${liveMicPitch.cents > 0 ? '+' : ''}${liveMicPitch.cents}c`}`;
      ctx.fillText(tag, Math.min(width - 78, px + 10), Math.max(18, py - 8));
    } else if (!noteBars || noteBars.length === 0) {
      ctx.fillStyle = 'rgba(156, 163, 175, 0.6)';
      ctx.font = '500 12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sing/play into mic OR separate/load a song to see live Swara bars scroll here', width / 2 + 16, height / 2);
    }

    ctx.restore();
  }, [noteBars, currentTime, duration, tonicMidi, raga, tuningMode, langMode, liveMicPitch]);

  const handleCanvasClick = (e) => {
    if (!onSeek || !duration || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left - 46) / Math.max(1, rect.width - 54)));
    const viewStart = Math.max(0, currentTime - 2.6);
    const targetSec = Math.max(0, Math.min(duration, viewStart + relX * 10));
    onSeek(targetSec);
  };

  return (
    <div className="pitch-canvas-shell" data-testid="pitch-melody-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="pitch-melody-canvas"
        onClick={handleCanvasClick}
        aria-label="Live Pitch and Reference Swara Piano Roll"
      />
      {duration > 0 && (
        <div
          className="pitch-minimap-bar"
          onClick={(e) => {
            if (!onSeek || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            onSeek(frac * duration);
          }}
          title="Click anywhere on timeline bar to jump"
        >
          <div
            className="pitch-minimap-progress"
            style={{ width: `${Math.min(100, (currentTime / Math.max(0.01, duration)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
