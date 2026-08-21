import test from 'node:test';
import assert from 'node:assert/strict';

import {
    compositePreviewAudioPolicyPure,
    compositePreviewEventsPure,
    compositePreviewModesPure,
    compositePreviewRegionPure,
} from '../src/composite/preview.js';

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
