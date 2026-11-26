import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScaleWatcherDial from '../ScaleWatcherDial';
import MusicalControlStrip from '../MusicalControlStrip';
import PitchAndLyricsView from '../PitchAndLyricsView';
import TopBar from '../TopBar';

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

  it('omits removed Studio DAW tab in TopBar', () => {
    render(
      <TopBar
        roomName="test-jam"
        callDuration="01:00"
        isNotesOpen={true}
        setIsNotesOpen={vi.fn()}
        onOpenArchModal={vi.fn()}
        onCopyRoom={vi.fn()}
        activeTab="stage"
        onChangeTab={vi.fn()}
      />
    );

    expect(screen.getByTestId('tab-studio-stage')).toBeInTheDocument();
    expect(screen.getByTestId('tab-studio-pitch')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-studio-daw')).not.toBeInTheDocument();
  });

  it('locks follower transport controls while allowing Leader play/stop and Claim Leader takeover', () => {
    const onSendControl = vi.fn();
    const onClaimLeader = vi.fn();

    const { rerender } = render(
      <PitchAndLyricsView
        jamState={{ tonicMidi: 60, raga: 'All Notes', tuningMode: 'et' }}
        onUpdateJamState={vi.fn()}
        liveMicPitch={null}
        backingState={{
          title: 'Leader Jam',
          vocalUrl: '/api/rooms/r1/shared-audio/abc',
          instUrl: '',
          noteBars: [],
          lyrics: []
        }}
        onUpdateBackingState={vi.fn()}
        selfPeerId="peer-follower"
        leaderPeerId="peer-leader"
        leaderName="Riya"
        onSendBackingControl={onSendControl}
        onClaimLeader={onClaimLeader}
      />
    );

    expect(screen.getByTestId('backing-leader-badge')).toHaveTextContent('Leader: Riya');
    expect(screen.getByTestId('btn-backing-stop')).toBeDisabled();
    expect(screen.getByLabelText('Play backing stems')).toBeDisabled();

    fireEvent.click(screen.getByTestId('btn-claim-leader'));
    expect(onClaimLeader).toHaveBeenCalledTimes(1);

    rerender(
      <PitchAndLyricsView
        jamState={{ tonicMidi: 60, raga: 'All Notes', tuningMode: 'et' }}
        onUpdateJamState={vi.fn()}
        liveMicPitch={null}
        backingState={{
          title: 'Leader Jam',
          vocalUrl: '/api/rooms/r1/shared-audio/abc',
          instUrl: '',
          noteBars: [],
          lyrics: []
        }}
        onUpdateBackingState={vi.fn()}
        selfPeerId="peer-follower"
        leaderPeerId="peer-follower"
        leaderName="Dev"
        onSendBackingControl={onSendControl}
        onClaimLeader={onClaimLeader}
      />
    );

    expect(screen.getByTestId('backing-leader-badge')).toHaveTextContent('Leader: You');
    expect(screen.getByTestId('btn-backing-stop')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('btn-backing-stop'));
    expect(onSendControl).toHaveBeenCalledWith(expect.objectContaining({ action: 'stop', currentTime: 0 }));
  });
});
