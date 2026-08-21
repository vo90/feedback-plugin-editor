import assert from 'node:assert/strict';
import test from 'node:test';

import {
    analyzeCompositeMerge,
    compositeCompatibility,
    materializeCompositeArrangement,
    resolveCompositeConflict,
    validateCompositeSelection,
} from '../src/composite/merge-engine.js';

const beats = Array.from({ length: 17 }, (_, i) => ({ time: i * 0.5, measure: i % 4 === 0 ? i / 4 + 1 : -1 }));
const note = (beat, string, fret, sustainBeats = 0, techniques = {}) => ({
    beat,
    beatEnd: sustainBeats ? beat + sustainBeats : undefined,
    time: beat * 0.5,
    sustain: sustainBeats * 0.5,
    string,
    fret,
    techniques,
});
const arr = (name, notes, extra = {}) => ({
    name,
    type: 'guitar',
    tuning: [0, 0, 0, 0, 0, 0],
    capo: 0,
    notes,
    chords: [],
    chord_templates: [],
    ...extra,
});

test('compatibility blocks mismatched tuning, capo, kind, and string count', () => {
    assert.equal(compositeCompatibility(arr('Lead', []), arr('Rhythm', [])).ok, true);
    assert.match(compositeCompatibility(arr('Lead', []), arr('Rhythm', [], { capo: 2 })).errors[0], /Capos/);
    assert.match(compositeCompatibility(arr('Lead', []), arr('Rhythm', [], { tuning: [-2, 0, 0, 0, 0, 0] })).errors[0], /Tunings/);
    assert.match(compositeCompatibility(arr('Lead', []), arr('Bass', [], { type: 'bass', tuning: [0, 0, 0, 0] })).errors[0], /Guitar and bass/);
});

test('strict duplicates collapse only when timing, sustain, position, and techniques agree', () => {
    const primary = arr('Lead', [note(2, 1, 5, 1, { palm_mute: true })]);
    const secondary = arr('Rhythm', [
        note(2, 1, 5, 1, { palm_mute: true }),
        note(2, 1, 5, 0.5, { palm_mute: true }),
    ]);
    const plan = analyzeCompositeMerge({ primary, secondary, beats, strategy: 'full-union' });
    assert.equal(plan.stats.duplicatesRemoved, 1);
    assert.equal(plan.conflicts.length, 1);
    assert.deepEqual(plan.conflicts[0].reasons, ['note-variant']);
});

test('unknown imported technique fields prevent unsafe duplicate removal', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(2, 1, 5, 1, { importer_expression: 'soft' })]),
        secondary: arr('Rhythm', [note(2, 1, 5, 1, { importer_expression: 'hard' })]),
        beats,
        strategy: 'full-union',
    });
    assert.equal(plan.stats.duplicatesRemoved, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.deepEqual(plan.conflicts[0].reasons, ['note-variant']);
});

test('the same pitch on another string is not treated as a duplicate', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(1, 0, 5)]),
        secondary: arr('Rhythm', [note(1, 1, 0)]),
        beats,
        strategy: 'full-union',
    });
    assert.equal(plan.stats.duplicatesRemoved, 0);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.fixedEntries.length, 2);
});

test('gap fill adds secondary notes in rests and skips notes during primary activity', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(0, 0, 3, 2)]),
        secondary: arr('Rhythm', [note(1, 2, 7), note(3, 2, 8)]),
        beats,
        strategy: 'gap-fill',
    });
    assert.equal(plan.stats.secondarySkippedByStrategy, 1);
    assert.equal(plan.stats.secondaryAddedCleanly, 1);
    assert.equal(plan.conflicts.length, 0);
});

test('gap fill treats coincident zero-sustain attacks as primary activity', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(2, 0, 3)]),
        secondary: arr('Rhythm', [note(2, 2, 7)]),
        beats,
        strategy: 'gap-fill',
    });
    assert.equal(plan.stats.secondarySkippedByStrategy, 1);
    assert.equal(plan.stats.secondaryAddedCleanly, 0);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.fixedEntries.length, 1);
});

test('full union groups overlapping same-string notes into unresolved hunks', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(2, 0, 3, 2), note(6, 1, 5)]),
        secondary: arr('Rhythm', [note(3, 0, 7, 1), note(6, 1, 8)]),
        beats,
        strategy: 'full-union',
    });
    assert.equal(plan.conflicts.length, 2);
    assert.equal(plan.stats.unresolvedConflicts, 2);
    assert.throws(() => materializeCompositeArrangement(plan, 'Hybrid'), /unresolved/);
});

test('primary, secondary, and compatible conflict choices resolve deterministically', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(2, 0, 3), note(2, 2, 7)]),
        secondary: arr('Rhythm', [note(2, 0, 5), note(2, 3, 9)]),
        beats,
        strategy: 'full-union',
    });
    assert.equal(plan.conflicts.length, 1);
    assert.equal(resolveCompositeConflict(plan, plan.conflicts[0].id, 'compatible').ok, true);
    const result = materializeCompositeArrangement(plan, 'Hybrid Guitar');
    assert.equal(result.name, 'Hybrid Guitar');
    assert.equal(result.type, 'guitar');
    assert.deepEqual(result.notes.map(n => [n.string, n.fret]), [[0, 3], [2, 7], [3, 9]]);
    assert.equal(result.chords.length, 0);
});

test('custom resolution refuses cross-source same-string collisions', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(2, 0, 3, 2)]),
        secondary: arr('Rhythm', [note(3, 0, 7, 1)]),
        beats,
        strategy: 'full-union',
    });
    const conflict = plan.conflicts[0];
    const both = [...conflict.primaryEntries, ...conflict.secondaryEntries];
    assert.equal(validateCompositeSelection(both).ok, false);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'custom', both.map(e => e.id)).ok, false);
    assert.equal(conflict.resolution, null);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'secondary').ok, true);
});

test('materialization preserves beat timing and leaves both sources untouched', () => {
    const primary = arr('Lead', [note(1.5, 0, 3, 0.5, { vibrato: true })], { tones: { base: 'clean' } });
    const secondary = arr('Rhythm', [note(4, 2, 7)]);
    const before = structuredClone({ primary, secondary });
    const plan = analyzeCompositeMerge({ primary, secondary, beats, strategy: 'full-union' });
    const result = materializeCompositeArrangement(plan, 'Hybrid');
    assert.equal(result.notes.length, 2);
    assert.equal(result.notes[0].time, 0.75);
    assert.equal(result.notes[0].sustain, 0.25);
    assert.equal(result.notes[0].techniques.vibrato, true);
    assert.deepEqual({ primary, secondary }, before);
    assert.notEqual(result.tones, primary.tones);
});
