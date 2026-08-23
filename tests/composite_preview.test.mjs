import test from 'node:test';
import assert from 'node:assert/strict';

import {
    COMPOSITE_PREVIEW_TARGET_RMS,
    compositePreviewEventsPure,
    createCompositePreviewEventCache,
    compositePreviewMixPure,
    compositePreviewModesPure,
    compositePreviewRegionPure,
    compositePreviewVolumeGainPure,
    compositeRecordingPreviewLevelPure,
    compositeRecordingPreviewLevelFromPeaksPure,
    compositeRecordingSummaryPeakPure,
    prewarmCompositeRecordingSummaryPeak,
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

test('composite preview event cache reuses one immutable lane revision only', () => {
    const entries = [{ startBeat: 2, endBeat: 2.5, string: 5, fret: 0 }];
    const arrangement = { type: 'guitar', tuning: [0, 0, 0, 0, 0, 0], capo: 0 };
    const cachedEvents = createCompositePreviewEventCache();
    const first = cachedEvents(entries, arrangement, beats, 6);
    assert.strictEqual(cachedEvents(entries, arrangement, beats, 6), first,
        'replaying the same lane does no note conversion or sorting');
    assert.notStrictEqual(cachedEvents(entries.slice(), arrangement, beats, 6), first,
        'a new timeline lane revision cannot inherit stale events');
    assert.notStrictEqual(cachedEvents(entries, { ...arrangement }, beats, 6), first,
        'a changed arrangement invalidates tuning/capo-derived pitches');
    assert.notStrictEqual(cachedEvents(entries, arrangement, beats.slice(), 6), first,
        'a changed beat map invalidates event timing');
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
    }), { volume: 80, referenceGain: 0.25, guideGain: 0 });
    for (const mode of ['primary', 'secondary', 'result']) {
        assert.deepEqual(compositePreviewMixPure(mode, {
            volume: 80, recordingGain: 0.25, toneTrimGain: 0.5,
        }), { volume: 80, referenceGain: 0, guideGain: 1 });
    }
    assert.deepEqual(compositePreviewMixPure('unknown'), {
        volume: 75, referenceGain: 0, guideGain: 0,
    });
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

function waveformSummary(values, bins = 100) {
    const size = Math.max(1, Math.floor(values.length / bins));
    const minimum = new Float32Array(bins);
    const maximum = new Float32Array(bins);
    const rms = new Float32Array(bins);
    for (let bin = 0; bin < bins; bin++) {
        const from = bin * size;
        const to = bin === bins - 1 ? values.length : Math.min(values.length, from + size);
        let low = Infinity, high = -Infinity, squares = 0, count = 0;
        for (let index = from; index < to; index++) {
            const value = Number(values[index]) || 0;
            low = Math.min(low, value);
            high = Math.max(high, value);
            squares += value * value;
            count++;
        }
        minimum[bin] = count ? low : 0;
        maximum[bin] = count ? high : 0;
        rms[bin] = count ? Math.sqrt(squares / count) : 0;
    }
    return { min: minimum, max: maximum, rms, bins };
}

test('waveform summary level matching preserves the PCM gate and gain result', () => {
    const values = [
        ...Array(500).fill(0),
        ...Array(1500).fill(0.2),
    ];
    const exact = compositeRecordingPreviewLevelPure(fakeBuffer(values), 0, 2);
    const summarized = compositeRecordingPreviewLevelFromPeaksPure(
        waveformSummary(values, 200), 2, 0, 2);
    assert.equal(summarized.silent, false);
    assert.ok(Math.abs(summarized.rms - exact.rms) < 1e-6);
    assert.ok(Math.abs(summarized.peak - exact.peak) < 1e-6);
    assert.ok(Math.abs(summarized.gain - exact.gain) < 1e-6);

    const silent = compositeRecordingPreviewLevelFromPeaksPure(
        waveformSummary(Array(1000).fill(0.001), 100), 1, 0, 1);
    assert.equal(silent.silent, true);
    assert.equal(silent.gain, 1);
    assert.equal(silent.rms, 0);
    assert.ok(Math.abs(silent.peak - 0.001) < 1e-8);
});

test('waveform summary peak limiting catches a narrow transient between sampled RMS bins', () => {
    const bins = 5000;
    const rms = new Float32Array(bins).fill(0.02);
    const minimum = new Float32Array(bins);
    const maximum = new Float32Array(bins);
    maximum[4998] = 0.9; // maximumSamples=1000 samples 0, 5, 10... and misses this bin.
    const level = compositeRecordingPreviewLevelFromPeaksPure({
        bins, rms, min: minimum, max: maximum,
    }, 5, 0, 5, {
        maximumSamples: 1000,
        targetRms: 0.5,
        peakCeiling: 0.25,
        minimumGain: 0,
        maximumGain: 10,
    });
    assert.ok(Math.abs(level.rms - 0.02) < 1e-6,
        'RMS remains the bounded-stride estimate');
    assert.ok(Math.abs(level.peak - 0.9) < 1e-6,
        'the exact min/max scan sees the unsampled transient');
    assert.ok(Math.abs(level.gain - 0.25 / 0.9) < 1e-6,
        'the missed transient still enforces the requested peak ceiling');
});

test('waveform summary exact peak prewarm caches by snapshot and invalidates replacements', () => {
    let reads = 0;
    const observed = values => new Proxy(values, {
        get(target, property) {
            if (String(Number(property)) === property) reads++;
            return target[property];
        },
    });
    const peaks = {
        bins: 4,
        min: observed({ length: 4, 0: -0.1, 1: -0.2, 2: 0, 3: -0.3 }),
        max: observed({ length: 4, 0: 0.1, 1: 0.4, 2: 0.2, 3: 0.1 }),
    };
    assert.equal(prewarmCompositeRecordingSummaryPeak(peaks), 0.4);
    const firstReads = reads;
    assert.equal(firstReads, 8, 'prewarm reads every min/max bin exactly once');
    assert.equal(compositeRecordingSummaryPeakPure(peaks), 0.4);
    assert.equal(reads, firstReads, 'the same immutable summary reuses its WeakMap entry');

    peaks.max = observed({ length: 4, 0: 0.1, 1: 0.4, 2: 0.8, 3: 0.1 });
    assert.equal(compositeRecordingSummaryPeakPure(peaks), 0.8);
    assert.equal(reads, firstReads + 8,
        'replacing either extrema array invalidates and refreshes the exact peak');
});

test('waveform summary keeps long-recording RMS work bounded and exact peak work cached', () => {
    const bins = 1_000_000;
    let rmsReads = 0;
    let extremaReads = 0;
    const observed = counter => new Proxy({ length: bins }, {
        get(target, property) {
            if (property === 'length') return target.length;
            if (String(Number(property)) === property) {
                counter();
                return 0.2;
            }
            return target[property];
        },
    });
    const peaks = {
        bins,
        rms: observed(() => rmsReads++),
        min: observed(() => extremaReads++),
        max: observed(() => extremaReads++),
    };
    const level = compositeRecordingPreviewLevelFromPeaksPure(
        peaks, 3600, 0, 3600, { maximumSamples: 1000 });
    assert.equal(level.silent, false);
    assert.ok(rmsReads <= 1100,
        `RMS should read only about one value per sampled bin, read ${rmsReads}`);
    assert.equal(extremaReads, bins * 2,
        'peak safety scans every min/max bin once');
    const extremaAfterFirstQuery = extremaReads;
    compositeRecordingPreviewLevelFromPeaksPure(
        peaks, 3600, 1200, 2400, { maximumSamples: 1000 });
    assert.equal(extremaReads, extremaAfterFirstQuery,
        'later region queries reuse the exact snapshot peak');
    assert.ok(rmsReads <= 2200,
        `two RMS queries should remain bounded, read ${rmsReads}`);
});
