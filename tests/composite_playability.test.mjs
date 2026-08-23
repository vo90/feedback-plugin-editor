import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compositeLintOverlapPure,
    compositePlayabilityLintPure,
} from '../src/composite/playability-lint.js';
import {
    _lintOverlapPure,
    _playabilityLintPure,
} from '../src/playability-lint.js';

const note = (time, string, fret, sustain = 0, techniques = null) =>
    ({ time, string, fret, sustain, techniques });

test('Hybrid overlap sweep preserves the Editor rule and issue ordering', () => {
    let state = 0xc0111de;
    const random = () => {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        return state / 0x100000000;
    };
    for (let sample = 0; sample < 200; sample++) {
        const notes = Array.from({ length: 5 + Math.floor(random() * 45) }, () => {
            const time = Math.floor(random() * 3000) / 1000;
            const sustain = random() < 0.25 ? random() * 2 : random() * 0.02;
            return note(time, Math.floor(random() * 6), Math.floor(random() * 18), sustain);
        });
        assert.deepEqual(compositeLintOverlapPure(notes), _lintOverlapPure(notes));
    }
});

test('Hybrid full lint is behaviorally equivalent to the Editor lint', () => {
    const notes = [
        note(0, 0, 3, 2),
        note(0.5, 0, 8, 0, { hammer_on: 1 }),
        note(1, 1, 0, 0, { bend: 1 }),
        note(2, 2, 4, 0.5, { fret_finger: 1 }),
        note(2, 3, 9, 0.5, { fret_finger: 1 }),
    ];
    const anchors = [{ time: 0, fret: 3, width: 4 }];
    assert.deepEqual(
        compositePlayabilityLintPure(notes, anchors),
        _playabilityLintPure(notes, anchors),
    );
});

test('Hybrid overlap sweep handles a long non-overlapping arrangement', () => {
    const notes = Array.from({ length: 20000 }, (_, index) =>
        note(index * 0.1, 2, index % 12, 0.01));
    assert.deepEqual(compositeLintOverlapPure(notes), []);
});
