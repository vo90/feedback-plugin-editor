import test from 'node:test';
import assert from 'node:assert/strict';

import {
    compositePreviewEventsPure,
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
