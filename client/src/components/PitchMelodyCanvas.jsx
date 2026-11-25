import React, { useEffect, useRef } from 'react';
import {
  buildScaleNotes,
  findNearestSwara,
  findActiveTargetBar,
  evaluatePitchMatch,
  midiToNoteName
} from '../audio/sargamEngine';

export default function PitchMelodyCanvas({
  noteBars = [],
  currentTime = 0,
  duration = 0,
  tonicMidi = 60,
  raga = 'Bilawal',
  tuningMode = 'ji',
  langMode = 'en',
  liveMicPitch = null,
  onSeek = null,
  tolerancePct = 0.10,
  liveMatch = null
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

    let minMidi = tonicMidi - 8;
    let maxMidi = tonicMidi + 20;
    if (Array.isArray(noteBars) && noteBars.length > 0) {
      let barMin = 127;
      let barMax = 0;
      for (let i = 0; i < noteBars.length; i++) {
        const m = Number(noteBars[i]?.midi);
        if (Number.isFinite(m) && m > 24 && m < 108) {
          if (m < barMin) barMin = m;
          if (m > barMax) barMax = m;
        }
      }
      if (barMin <= barMax) {
        minMidi = Math.max(36, Math.floor(barMin) - 3);
        maxMidi = Math.min(84, Math.ceil(barMax) + 3);
        if (maxMidi - minMidi < 12) {
          minMidi = Math.max(36, minMidi - 3);
          maxMidi = Math.min(84, maxMidi + 3);
        }
      }
    }
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
    const activeTargetBar = findActiveTargetBar(noteBars, currentTime);
    const activeMatch = liveMatch || evaluatePitchMatch(liveMicPitch?.freq, activeTargetBar, tolerancePct);

    if (Array.isArray(noteBars) && noteBars.length > 0) {
      noteBars.forEach((bar) => {
        if (bar.end < viewStart || bar.start > viewStart + windowSec) return;
        const x1 = Math.max(46, timeToX(bar.start));
        const x2 = Math.min(width - 4, timeToX(bar.end));
        const bw = Math.max(10, x2 - x1);
        const y = midiToY(bar.midi);
        const isCurrent = bar === activeTargetBar || (currentTime >= bar.start && currentTime <= bar.end);
        const barMatched = isCurrent && Boolean(activeMatch?.isMatched);
        const sw = findNearestSwara(bar.freq, tonicMidi, tuningMode, raga);

        ctx.save();
        if (barMatched) {
          ctx.shadowColor = 'rgba(46, 204, 113, 0.9)';
          ctx.shadowBlur = 12;
          ctx.fillStyle = '#2ecc71';
        } else if (isCurrent) {
          ctx.shadowColor = 'rgba(56, 189, 248, 0.7)';
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#38bdf8';
        } else {
          ctx.fillStyle = sw?.inRaga ? 'rgba(99, 102, 241, 0.72)' : 'rgba(139, 92, 246, 0.42)';
        }

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(x1, y - 7, bw, 14, 5);
        } else {
          ctx.rect(x1, y - 7, bw, 14);
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isCurrent && sw) {
          ctx.strokeStyle = barMatched ? '#a8fbc4' : '#e0f2fe';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        if (bw > 22 && sw) {
          ctx.fillStyle = barMatched ? '#072310' : '#ffffff';
          ctx.font = '700 9px "Inter", sans-serif';
          ctx.fillText(langMode === 'hi' ? sw.devanagari : sw.shortSargam, x1 + 5, y + 3);
        }
        ctx.restore();
      });
    }

    // Playhead laser line
    ctx.beginPath();
    ctx.moveTo(playheadX, 8);
    ctx.lineTo(playheadX, height - 8);
    ctx.strokeStyle = 'rgba(255, 111, 32, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Instrumental Intro Countdown Banner
    if (Array.isArray(noteBars) && noteBars.length > 0 && currentTime < (Number(noteBars[0].start) || 0) - 0.2) {
      const firstBar = noteBars[0];
      const remaining = Math.max(0, firstBar.start - currentTime).toFixed(1);
      const sw = findNearestSwara(firstBar.freq, tonicMidi, tuningMode, raga);
      const swName = sw ? (langMode === 'hi' ? sw.devanagari : sw.shortSargam) : 'Sa';
      const noteName = midiToNoteName(firstBar.midi || tonicMidi);

      ctx.save();
      const boxW = Math.min(430, width - 64);
      const boxX = width / 2 - boxW / 2;
      ctx.fillStyle = 'rgba(15, 21, 32, 0.9)';
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(boxX, 10, boxW, 46, 9);
      } else {
        ctx.rect(boxX, 10, boxW, 46);
      }
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = '700 12px "Inter", sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`🎵 Instrumental Intro... Singing starts in ${remaining}s`, width / 2, 28);

      ctx.font = '500 10px "Inter", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText(`First Note: ${swName} (${noteName}) — Click canvas to jump`, width / 2, 45);
      ctx.restore();
    }

    // Live user vocal/instrument trail ribbon (gap/jump segmented + smooth quadratic Bezier)
    const now = Date.now();
    const recent = trailRef.current.filter((p) => now - p.t <= 3600);
    if (recent.length > 1) {
      const segments = [];
      let currentSeg = [recent[0]];
      for (let i = 1; i < recent.length; i++) {
        const prev = recent[i - 1];
        const curr = recent[i];
        if (curr.t - prev.t > 220 || Math.abs(curr.midi - prev.midi) > 6) {
          if (currentSeg.length > 1) segments.push(currentSeg);
          currentSeg = [curr];
        } else {
          currentSeg.push(curr);
        }
      }
      if (currentSeg.length > 1) segments.push(currentSeg);

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const pxScale = (width - 54) / windowSec;
      for (const seg of segments) {
        ctx.beginPath();
        const pts = seg.map((p) => ({
          x: Math.max(46, playheadX - ((now - p.t) / 1000) * pxScale),
          y: midiToY(p.midi)
        }));
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
    }

    if (liveMicPitch && liveMicPitch.freq > 0) {
      const micMidi = 69 + 12 * Math.log2(liveMicPitch.freq / 440);
      const py = midiToY(micMidi);
      const px = playheadX;
      const isUserMatched = Boolean(activeMatch?.isMatched ?? liveMicPitch.inTune);
      const beamW = 38;
      const beamH = 16;

      ctx.save();
      ctx.shadowColor = isUserMatched ? 'rgba(46, 204, 113, 0.95)' : 'rgba(230, 126, 34, 0.85)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = isUserMatched ? '#2ecc71' : '#e67e22';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(px - beamW / 2, py - beamH / 2, beamW, beamH, 8);
      } else {
        ctx.rect(px - beamW / 2, py - beamH / 2, beamW, beamH);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = isUserMatched ? '#072310' : '#ffffff';
      ctx.font = '700 9px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isUserMatched ? '✓ SUR' : 'YOU', px, py);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = isUserMatched ? '#6ee7b7' : '#fde68a';
      ctx.font = '700 10px "Inter", sans-serif';
      const swLabel = langMode === 'hi' ? liveMicPitch.devanagari : liveMicPitch.shortSargam;
      const errLabel = activeMatch ? `${activeMatch.errorPct}% err` : (liveMicPitch.inTune ? '✓ SUR' : `${liveMicPitch.cents > 0 ? '+' : ''}${liveMicPitch.cents}c`);
      ctx.fillText(`${swLabel} ${errLabel}`, Math.min(width - 88, px + 24), Math.max(18, py - 8));
      ctx.restore();
    } else if (!noteBars || noteBars.length === 0) {
      ctx.fillStyle = 'rgba(156, 163, 175, 0.6)';
      ctx.font = '500 12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Sing/play into mic OR separate/load a song to see live Swara bars scroll here', width / 2 + 16, height / 2);
    }

    ctx.restore();
  }, [noteBars, currentTime, duration, tonicMidi, raga, tuningMode, langMode, liveMicPitch, tolerancePct, liveMatch]);

  const handleCanvasClick = (e) => {
    if (!onSeek || !duration || duration <= 0) return;
    if (Array.isArray(noteBars) && noteBars.length > 0 && currentTime < (Number(noteBars[0].start) || 0) - 0.2) {
      onSeek(noteBars[0].start);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left - 46) / Math.max(1, rect.width - 54)));
    const viewStart = Math.max(0, currentTime - 2.6);
    const targetSec = Math.max(0, Math.min(duration, viewStart + relX * 10));
    onSeek(targetSec);
  };

  const tolLabel = Math.round(tolerancePct * 100);

  return (
    <div className="pitch-canvas-shell" data-testid="pitch-melody-canvas-wrap">
      <div className="pmc-header">
        <span className="pmc-title">Vocal Note Bars (Pre-loaded Melody vs Your Voice)</span>
        <div className="pmc-badges">
          <span
            className={`pmc-badge ${liveMatch ? (liveMatch.isMatched ? 'in-tune' : 'off-pitch') : ''}`}
            data-testid="pmc-live-diff"
          >
            {liveMatch?.isMatched
              ? `✨ SUR MILA! (${liveMatch.errorPct}% error ≤ ${tolLabel}%) ✓`
              : liveMatch
                ? `⚠️ ${Math.round(liveMatch.errorPct)}% Error (${liveMatch.direction === 'flat' ? 'Flat' : 'Sharp'})`
                : `Sing into mic to match target bars (${tolLabel}% Tolerance)`}
          </span>
          <span className="pmc-badge">{noteBars.length} Note Bars</span>
        </div>
      </div>

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

      <div className="pmc-legend">
        <div className="pmc-legend-items">
          <span className="pmc-legend-item">
            <span className="pmc-legend-dot" style={{ background: '#6366f1' }} />
            Target Vocal Bar (Pre-loaded)
          </span>
          <span className="pmc-legend-item">
            <span className="pmc-legend-dot" style={{ background: '#2ecc71', boxShadow: '0 0 6px #2ecc71' }} />
            Sur Mila (Within {tolLabel}% Match)
          </span>
          <span className="pmc-legend-item">
            <span className="pmc-legend-dot" style={{ background: '#e67e22' }} />
            Your Voice (Mic)
          </span>
        </div>
        <span className="pmc-tol-allowed">{tolLabel}% Error Allowed</span>
      </div>
    </div>
  );
}
