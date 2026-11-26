import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScaleWatcherDial from '../ScaleWatcherDial';
import MusicalControlStrip from '../MusicalControlStrip';
import PitchAndLyricsView from '../PitchAndLyricsView';
import StudioDawView from '../StudioDawView';

describe('SargamJam Studio Components', () => {
  it('renders ScaleWatcherDial with IN TUNE badge and Western note when cents deviation <= 15', () => {
    render(
      <ScaleWatcherDial
        title="Your Mic Pitch"
        subtitle="Real-time F0 Pitch"
        pitchInfo={{ freq: 261.6, cents: -4, inTune: true, noteName: 'C4', targetFreq: 261.6 }}
      />
    );

    expect(screen.getByText('Your Mic Pitch')).toBeInTheDocument();
    expect(screen.getByTestId('sur-status-badge')).toHaveTextContent('IN TUNE');
    expect(screen.getByText('C4')).toBeInTheDocument();
    expect(screen.getByText('261.6 Hz')).toBeInTheDocument();
  });

  it('allows updating scale, tanpura, bpm beat, and raw audio in MusicalControlStrip', () => {
    const onUpdate = vi.fn();
    const onToggleRaw = vi.fn();

    render(
      <MusicalControlStrip
        jamState={{
          tonicMidi: 60,
          isTanpuraOn: false,
          tanpuraVol: 0.45,
          bpm: 96,
          isMetronomeOn: false
        }}
        onUpdateJamState={onUpdate}
        isRawAudio={false}
        onToggleRawAudio={onToggleRaw}
      />
    );

    fireEvent.click(screen.getByTestId('btn-toggle-tanpura'));
    expect(onUpdate).toHaveBeenCalledWith({ isTanpuraOn: true });

    fireEvent.click(screen.getByTestId('btn-toggle-metronome'));
    expect(onUpdate).toHaveBeenCalledWith({ isMetronomeOn: true });

    fireEvent.click(screen.getByTestId('btn-toggle-raw-audio'));
    expect(onToggleRaw).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Scale'), { target: { value: '62' } });
    expect(onUpdate).toHaveBeenCalledWith({ tonicMidi: 62 });

    fireEvent.click(screen.getByLabelText('Increase BPM'));
    expect(onUpdate).toHaveBeenCalledWith({ bpm: 100 });
  });

  it('renders PitchAndLyricsView with AI Stems URL splitter, Dual Watchers, and Lyrics Tray', () => {
    render(
      <PitchAndLyricsView
        jamState={{ tonicMidi: 60, raga: 'All Notes', tuningMode: 'et' }}
        onUpdateJamState={vi.fn()}
        liveMicPitch={null}
        backingState={{
          title: 'Practice Track',
          vocalUrl: '',
          instUrl: '',
          noteBars: [],
          lyrics: [{ start: 1, end: 4, text: 'Verse one cue line' }]
        }}
        onUpdateBackingState={vi.fn()}
      />
    );

    expect(screen.getByTestId('pitch-lyrics-view')).toBeInTheDocument();
    expect(screen.getByText('Your Mic Pitch')).toBeInTheDocument();
    expect(screen.getByText('Target Song Vocal')).toBeInTheDocument();
    expect(screen.getByText('Verse one cue line')).toBeInTheDocument();
  });

  it('renders StudioDawView console controls cleanly in JSDOM', () => {
    render(
      <StudioDawView
        jamState={{ tonicMidi: 60, raga: 'Bilawal', taal: 'Teentaal (16)', bpm: 96, tuningMode: 'ji' }}
        localStream={null}
        backingState={{}}
      />
    );

    expect(screen.getByTestId('studio-daw-view')).toBeInTheDocument();
    expect(screen.getByTestId('btn-daw-record')).toHaveTextContent('Record Studio Take');
    expect(screen.getByText('Console Channels & Latency Sync')).toBeInTheDocument();
    expect(screen.getByText('Vocal DSP FX & 3-Band EQ')).toBeInTheDocument();
    expect(screen.getByTestId('btn-ai-vocal-coach')).toBeDisabled();
  });
});
