import assert from 'node:assert/strict';
import test from 'node:test';

import {
    analyzeCompositeMerge,
    COMPOSITE_GAP_FILL_DEFAULTS,
    compositeGapFillDefaultsForUnit,
    compositeCompatibility,
    materializeCompositeArrangement,
    normalizeCompositeGapFillOptions,
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

test('gap fill defaults are normalized and bounded', () => {
    assert.deepEqual(normalizeCompositeGapFillOptions(), COMPOSITE_GAP_FILL_DEFAULTS);
    assert.deepEqual(compositeGapFillDefaultsForUnit('seconds'), {
        unit: 'seconds', minimumGap: 0.5, transitionMargin: 0.125,
    });
    assert.deepEqual(normalizeCompositeGapFillOptions({
        minimumGapBeats: -2,
        transitionMarginBeats: 99,
    }), { unit: 'beats', minimumGap: 0, transitionMargin: 8 });
    assert.deepEqual(normalizeCompositeGapFillOptions({
        unit: 'seconds', minimumGap: 99, transitionMargin: -2,
    }), { unit: 'seconds', minimumGap: 30, transitionMargin: 0 });
});

test('gap fill blocks every technique-labelled trail and any secondary trail that reaches the next lead passage', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [
            note(0, 0, 0, 4, { tremolo: true, importer_future_trail: true }),
            note(8, 1, 5),
        ]),
        secondary: arr('Rhythm', [
            note(3, 2, 7),       // Inside the lead's open-string tremolo trail.
            note(5, 2, 8, 2),    // Complete trail fits in the protected gap.
            note(5.5, 3, 9, 2.5), // Trail reaches the next protected lead onset.
        ]),
        beats,
        strategy: 'gap-fill',
    });
    assert.equal(plan.stats.secondaryAddedCleanly, 1);
    assert.equal(plan.stats.secondarySkippedByStrategy, 2);
    assert.deepEqual(plan.fixedEntries.filter(entry => entry.source === 'secondary')
        .map(entry => entry.fret), [8]);
});

test('gap fill rejects a whole coincident chord when any child trail crosses lead activity', () => {
    const rhythm = arr('Rhythm', [], {
        chords: [{
            time: 1,
            notes: [
                { string: 1, fret: 3, sustain: 0.25 },
                { string: 2, fret: 5, sustain: 1.1 },
            ],
        }],
    });
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(4, 0, 7)]),
        secondary: rhythm,
        beats,
        strategy: 'gap-fill',
    });
    assert.equal(plan.stats.secondaryAddedCleanly, 0);
    assert.equal(plan.stats.secondarySkippedByStrategy, 2);
});

test('gap fill treats linked and connected-slide gestures as occupied until their destination', () => {
    for (const techniques of [{ link_next: true }, { slide_to: 7 }]) {
        const plan = analyzeCompositeMerge({
            primary: arr('Lead', [note(0, 0, 3, 0, techniques), note(4, 0, 7)]),
            secondary: arr('Rhythm', [note(2, 3, 9)]),
            beats,
            strategy: 'gap-fill',
            gapFill: { minimumGapBeats: 0, transitionMarginBeats: 0 },
        });
        assert.equal(plan.stats.secondaryAddedCleanly, 0);
        assert.equal(plan.stats.secondarySkippedByStrategy, 1);
    }
});

test('a cleared slide sentinel does not invent a connected trail', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(0, 0, 3, 0, { slide_to: null }), note(4, 0, 0)]),
        secondary: arr('Rhythm', [note(2, 3, 9)]),
        beats,
        strategy: 'gap-fill',
        gapFill: { minimumGapBeats: 0, transitionMarginBeats: 0 },
    });
    assert.equal(plan.stats.secondaryAddedCleanly, 1);
});

test('gap fill keeps a connected secondary gesture atomic when its destination trail crosses lead activity', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(4, 0, 9)]),
        secondary: arr('Rhythm', [
            note(2, 1, 3, 0, { link_next: true }),
            note(3, 1, 5, 2),
        ]),
        beats,
        strategy: 'gap-fill',
    });
    assert.equal(plan.stats.secondaryAddedCleanly, 0);
    assert.equal(plan.stats.secondarySkippedByStrategy, 2);
});

test('gap fill requires the configured usable window after transition margins', () => {
    const input = {
        primary: arr('Lead', [note(0, 0, 3, 1), note(2.4, 1, 5)]),
        secondary: arr('Rhythm', [note(1.5, 3, 9)]),
        beats,
        strategy: 'gap-fill',
    };
    const guarded = analyzeCompositeMerge({ ...input,
        gapFill: { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 } });
    assert.equal(guarded.stats.secondaryAddedCleanly, 0);
    const tighter = analyzeCompositeMerge({ ...input,
        gapFill: { unit: 'beats', minimumGap: 0.5, transitionMargin: 0.25 } });
    assert.equal(tighter.stats.secondaryAddedCleanly, 1);
});

test('seconds gap fill measures real time across tempo changes', () => {
    const tempoBeats = [0, 0.25, 0.5, 0.75, 1, 2, 3, 4]
        .map((time, i) => ({ time, measure: i % 4 === 0 ? i / 4 + 1 : -1 }));
    const gridNote = (beat, string, fret, sustainBeats = 0) => ({
        beat,
        beatEnd: sustainBeats ? beat + sustainBeats : undefined,
        time: tempoBeats[beat].time,
        sustain: sustainBeats
            ? tempoBeats[beat + sustainBeats].time - tempoBeats[beat].time : 0,
        string,
        fret,
        techniques: {},
    });
    const input = {
        primary: arr('Lead', [
            gridNote(0, 0, 3, 1),
            gridNote(3, 1, 5),
            gridNote(6, 0, 7),
        ]),
        secondary: arr('Rhythm', [
            gridNote(2, 3, 9),
            gridNote(5, 3, 11),
        ]),
        beats: tempoBeats,
        strategy: 'gap-fill',
    };
    const beatPlan = analyzeCompositeMerge({
        ...input,
        gapFill: { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 },
    });
    assert.deepEqual(beatPlan.fixedEntries.filter(entry => entry.source === 'secondary')
        .map(entry => entry.fret), [9, 11]);

    const secondsPlan = analyzeCompositeMerge({
        ...input,
        gapFill: { unit: 'seconds', minimumGap: 0.5, transitionMargin: 0.05 },
    });
    assert.deepEqual(secondsPlan.fixedEntries.filter(entry => entry.source === 'secondary')
        .map(entry => entry.fret), [11]);
    assert.equal(secondsPlan.gapFill.unit, 'seconds');
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
