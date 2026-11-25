import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScaleWatcherDial from '../ScaleWatcherDial';
import MusicalControlStrip from '../MusicalControlStrip';
import PitchAndLyricsView from '../PitchAndLyricsView';
import StudioDawView from '../StudioDawView';

describe('SargamJam Studio Components', () => {
  it('renders ScaleWatcherDial with Sur Mila badge when cents deviation <= 15', () => {
    render(
      <ScaleWatcherDial
        title="Your Mic Sur"
        subtitle="Real-time F0 Pitch"
        langMode="hi"
        pitchInfo={{ freq: 261.6, cents: -4, inTune: true, noteName: 'C4', sargam: 'Sa', devanagari: 'सा' }}
      />
    );

    expect(screen.getByText('Your Mic Sur')).toBeInTheDocument();
    expect(screen.getByTestId('sur-status-badge')).toHaveTextContent('SUR MILA');
    expect(screen.getByText('सा')).toBeInTheDocument();
    expect(screen.getByText('261.6 Hz')).toBeInTheDocument();
  });

  it('allows updating tonic, raga, tanpura, beat, and raw audio in MusicalControlStrip', () => {
    const onUpdate = vi.fn();
    const onToggleRaw = vi.fn();

    render(
      <MusicalControlStrip
        jamState={{
          tonicMidi: 60,
          raga: 'Bilawal',
          tuningMode: 'ji',
          langMode: 'en',
          isTanpuraOn: false,
          tanpuraVol: 0.45,
          taal: 'Teentaal (16)',
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

    fireEvent.change(screen.getByLabelText('Raga Scale'), { target: { value: 'Yaman' } });
    expect(onUpdate).toHaveBeenCalledWith({ raga: 'Yaman' });
  });

  it('renders PitchAndLyricsView with AI Stems URL splitter, Dual Watchers, and Lyrics Tray', () => {
    render(
      <PitchAndLyricsView
        jamState={{ tonicMidi: 60, raga: 'Yaman', tuningMode: 'ji', langMode: 'en' }}
        onUpdateJamState={vi.fn()}
        liveMicPitch={null}
        backingState={{
          title: 'Yaman Bandish',
          vocalUrl: '',
          instUrl: '',
          noteBars: [],
          lyrics: [{ start: 1, end: 4, text: 'Eri aali piya bin' }]
        }}
        onUpdateBackingState={vi.fn()}
      />
    );

    expect(screen.getByTestId('pitch-lyrics-view')).toBeInTheDocument();
    expect(screen.getByText('Your Mic Sur')).toBeInTheDocument();
    expect(screen.getByText('Target Song Vocal')).toBeInTheDocument();
    expect(screen.getByText('Eri aali piya bin')).toBeInTheDocument();
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
