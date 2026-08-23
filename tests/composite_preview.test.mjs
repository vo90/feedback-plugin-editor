import test from 'node:test';
import assert from 'node:assert/strict';

import {
    COMPOSITE_PREVIEW_TARGET_RMS,
    compositePreviewAudioPolicyPure,
    compositePreviewEventsPure,
    compositePreviewMixPure,
    compositePreviewModesPure,
    compositePreviewRegionPure,
    compositePreviewVolumeGainPure,
    compositeRecordingPreviewLevelPure,
} from '../src/composite/preview.js';
import {
    COMPOSITE_BEAT_EPS,
    prepareCompositeSources,
} from '../src/composite/merge-engine.js';

const beats = Array.from({ length: 12 }, (_, index) => ({ time: index * 0.5 }));

test('composite preview converts tuning, capo, and the complete effective trail', () => {
    const arrangement = { type: 'guitar', tuning: [-2, 0, 0, 0, 0, 0], capo: 2 };
    const events = compositePreviewEventsPure([{
        startBeat: 1,
        endBeat: 2,
        effectiveEndBeat: 3,
        string: 0,
        fret: 3,
    }], arrangement, beats, 6);
    assert.deepEqual(events, [{ t: 0.5, midi: 43, sus: 1 }]);
});

test('composite preview restores the MIDI fallback for merge epsilon-only notes', () => {
    const arrangement = {
        type: 'guitar', tuning: [0, 0, 0, 0, 0, 0], capo: 0,
        notes: [{ time: 1, string: 0, fret: 3, sustain: 0 }], chords: [],
    };
    const prepared = prepareCompositeSources({
        primary: arrangement,
        secondary: { ...arrangement, notes: [] },
        beats,
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.primaryEntries.length, 1);
    assert.ok(Math.abs(prepared.primaryEntries[0].effectiveEndBeat
        - prepared.primaryEntries[0].startBeat - COMPOSITE_BEAT_EPS) < 1e-12);

    const events = compositePreviewEventsPure(
        prepared.primaryEntries, arrangement, beats, 6);
    assert.deepEqual(events, [{ t: 1, midi: 43, sus: 0 }]);
});

test('composite preview preserves meaningful effective connections from zero-trail notes', () => {
    const variableBeats = [
        { time: 0 }, { time: 0.4 }, { time: 1.1 }, { time: 1.6 },
    ];
    const arrangement = {
        type: 'guitar', tuning: [0, 0, 0, 0, 0, 0], capo: 0, chords: [],
        notes: [
            { time: 0.4, string: 0, fret: 3, sustain: 0,
                techniques: { link_next: true } },
            { time: 1.1, string: 0, fret: 5, sustain: 0, techniques: {} },
        ],
    };
    const prepared = prepareCompositeSources({
        primary: arrangement,
        secondary: { ...arrangement, notes: [] },
        beats: variableBeats,
    });
    assert.equal(prepared.primaryEntries[0].connectedToId, 'primary:1');

    const events = compositePreviewEventsPure(
        prepared.primaryEntries, arrangement, variableBeats, 6);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(event => [event.t, event.midi]), [[0.4, 43], [1.1, 45]]);
    assert.ok(Math.abs(events[0].sus - 0.7) < 1e-12);
    assert.equal(events[1].sus, 0);
});

test('composite preview restores zero sustain for flattened chord entries too', () => {
    const arrangement = {
        type: 'guitar', tuning: [0, 0, 0, 0, 0, 0], capo: 0, notes: [],
        chords: [{ time: 1.5, notes: [
            { string: 0, fret: 3, sustain: 0 },
            { string: 1, fret: 2, sustain: 0.5 },
        ] }],
    };
    const prepared = prepareCompositeSources({
        primary: arrangement,
        secondary: { ...arrangement, chords: [] },
        beats,
    });
    const events = compositePreviewEventsPure(
        prepared.primaryEntries, arrangement, beats, 6);
    assert.deepEqual(events, [
        { t: 1.5, midi: 43, sus: 0 },
        { t: 1.5, midi: 47, sus: 0.5 },
    ]);
});

test('composite preview sorts chords and skips entries that cannot sound', () => {
    const arrangement = { type: 'guitar', tuning: [0, 0, 0, 0, 0, 0], capo: 0 };
    const events = compositePreviewEventsPure([
        { startBeat: 4, endBeat: 4, string: 1, fret: 2 },
        { startBeat: 2, endBeat: 2.5, string: 5, fret: 0 },
        { startBeat: 2, endBeat: 2.5, string: 9, fret: 0 },
    ], arrangement, beats, 6);
    assert.deepEqual(events, [
        { t: 1, midi: 64, sus: 0.25 },
        { t: 2, midi: 47, sus: 0 },
    ]);
});

test('composite preview region follows the visible bar context', () => {
    assert.deepEqual(compositePreviewRegionPure({ startBeat: 4, endBeat: 8 }, beats), {
        startTime: 2,
        endTime: 4,
        mode: 'bar',
    });
});

test('composite preview exposes four clearly isolated player-facing modes', () => {
    const view = {
        names: { primary: 'Lead', secondary: 'Rhythm' },
        lanes: [
            { id: 'primary', entries: [{}] },
            { id: 'secondary', entries: [{}] },
            { id: 'result', entries: [{}] },
        ],
    };
    assert.deepEqual(compositePreviewModesPure(view, {
        audioAvailable: true,
        resultReady: true,
    }).map(({ id, label, available }) => ({ id, label, available })), [
        { id: 'song', label: 'Original song', available: true },
        { id: 'primary', label: 'Lead only', available: true },
        { id: 'secondary', label: 'Rhythm only', available: true },
        { id: 'result', label: 'Hybrid only', available: true },
    ]);
});

test('composite preview audio modes never mix the recording with a generated guide', () => {
    assert.deepEqual(compositePreviewAudioPolicyPure('song'), {
        referenceAudio: 'audible', metronome: false, allowClapFallback: false,
    });
    for (const mode of ['primary', 'secondary', 'result']) {
        assert.deepEqual(compositePreviewAudioPolicyPure(mode), {
            referenceAudio: 'muted', metronome: false, allowClapFallback: false,
        });
    }
});

test('composite preview explains unavailable recording, empty lanes, and unresolved hybrid', () => {
    const modes = compositePreviewModesPure({
        names: { primary: 'Lead', secondary: 'Rhythm' },
        lanes: [
            { id: 'primary', entries: [] },
            { id: 'secondary', entries: [{}] },
            { id: 'result', entries: [{}] },
        ],
    }, { audioAvailable: false, resultReady: false });
    assert.equal(modes.find(mode => mode.id === 'song').unavailableReason, 'No recording is loaded.');
    assert.equal(modes.find(mode => mode.id === 'primary').unavailableReason,
        'Lead has no notes in this section.');
    assert.equal(modes.find(mode => mode.id === 'result').unavailableReason,
        'Choose what to play first.');
});

test('one shared preview volume feeds exactly one of the four isolated paths', () => {
    assert.equal(compositePreviewVolumeGainPure(75), 0.75);
    assert.equal(compositePreviewVolumeGainPure(-10), 0);
    assert.equal(compositePreviewVolumeGainPure(999), 1);
    assert.deepEqual(compositePreviewMixPure('song', {
        volume: 80, recordingGain: 0.25, toneTrimGain: 0.5,
    }), { referenceGain: 0.2, guideGain: 0 });
    for (const mode of ['primary', 'secondary', 'result']) {
        assert.deepEqual(compositePreviewMixPure(mode, {
            volume: 80, recordingGain: 0.25, toneTrimGain: 0.5,
        }), { referenceGain: 0, guideGain: 0.4 });
    }
    assert.deepEqual(compositePreviewMixPure('unknown'), { referenceGain: 0, guideGain: 0 });
});

function fakeBuffer(values, sampleRate = 1000, channels = 1) {
    const data = Array.from({ length: channels }, (_, channel) => Float32Array.from(
        values.map((value, index) => channel && index % 2 ? -value : value)));
    return {
        sampleRate,
        numberOfChannels: channels,
        length: values.length,
        duration: values.length / sampleRate,
        getChannelData: channel => data[channel],
    };
}

test('recording level matching ignores silence and targets the guide loudness', () => {
    const values = [
        ...Array(500).fill(0),
        ...Array(1500).fill(0.2),
    ];
    const level = compositeRecordingPreviewLevelPure(fakeBuffer(values), 0, 2);
    assert.equal(level.silent, false);
    assert.ok(Math.abs(level.rms - 0.2) < 1e-6);
    assert.ok(Math.abs(level.gain - COMPOSITE_PREVIEW_TARGET_RMS / 0.2) < 1e-6);
});

test('recording level matching is stereo-safe, peak-safe, bounded, and silence-safe', () => {
    const stereo = compositeRecordingPreviewLevelPure(
        fakeBuffer(Array(1000).fill(0.1), 1000, 2), 0, 1,
        { targetRms: 0.5, peakCeiling: 0.25, maximumGain: 10 });
    assert.ok(Math.abs(stereo.rms - 0.1) < 1e-6, 'opposite channel signs never cancel');
    assert.ok(Math.abs(stereo.gain - 2.5) < 1e-6, 'peak ceiling wins over wanted gain');

    const belowGate = compositeRecordingPreviewLevelPure(
        fakeBuffer(Array(1000).fill(0.001)), 0, 1);
    assert.equal(belowGate.gain, 1);
    assert.equal(belowGate.rms, 0);
    assert.equal(belowGate.silent, true);
    assert.ok(Math.abs(belowGate.peak - 0.001) < 1e-8);
    assert.deepEqual(compositeRecordingPreviewLevelPure(null, 0, 1), {
        gain: 1, rms: 0, peak: 0, silent: true,
    });
});
