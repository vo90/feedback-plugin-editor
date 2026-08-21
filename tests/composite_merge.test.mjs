import assert from 'node:assert/strict';
import test from 'node:test';

import {
    analyzeCompositeMerge,
    clearCompositeConflictResolution,
    COMPOSITE_GAP_FILL_DEFAULTS,
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS,
    compositeGapFillDefaultsForUnit,
    compositeCompatibility,
    compositeTimingToleranceSeconds,
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
const timeNote = (time, string, fret, sustain = 0, techniques = {}) => ({
    time,
    sustain,
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

test('tempo-aware timing tolerance is one percent of a local beat with one-to-five millisecond limits', () => {
    const fast = [0, 0.05, 0.1].map(time => ({ time, measure: -1 }));
    const medium = [0, 0.3, 0.6].map(time => ({ time, measure: -1 }));
    const slow = [0, 1, 2].map(time => ({ time, measure: -1 }));
    assert.equal(compositeTimingToleranceSeconds(fast, 1), COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS);
    assert.ok(Math.abs(compositeTimingToleranceSeconds(medium, 1) - 0.003) < 1e-12);
    assert.equal(compositeTimingToleranceSeconds(slow, 1), COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS);
});

test('identical notes within timing tolerance deduplicate but notes beyond it do not', () => {
    const within = analyzeCompositeMerge({
        primary: arr('Lead', [timeNote(1, 1, 5, 0.25, { palm_mute: true })]),
        secondary: arr('Rhythm', [timeNote(1.003, 1, 5, 0.25, { palm_mute: true })]),
        beats,
        strategy: 'full-union',
    });
    assert.equal(within.stats.duplicatesRemoved, 1);
    assert.equal(within.conflicts.length, 0);
    assert.deepEqual(within.fixedEntries[0].sources, ['primary', 'secondary']);

    const outside = analyzeCompositeMerge({
        primary: arr('Lead', [timeNote(1, 1, 5, 0.25, { palm_mute: true })]),
        secondary: arr('Rhythm', [timeNote(1.006, 1, 5, 0.25, { palm_mute: true })]),
        beats,
        strategy: 'full-union',
    });
    assert.equal(outside.stats.duplicatesRemoved, 0);
    assert.equal(outside.conflicts.length, 1);
});

test('timing tolerance never hides semantic technique differences', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [timeNote(1, 1, 5, 0.25, { palm_mute: true })]),
        secondary: arr('Rhythm', [timeNote(1.003, 1, 5, 0.25, { palm_mute: false })]),
        beats,
        strategy: 'full-union',
    });
    assert.equal(plan.stats.duplicatesRemoved, 0);
    assert.deepEqual(plan.conflicts[0].reasons, ['note-variant']);
});

test('a tiny cross-source boundary overlap is clamped only in the materialized composite', () => {
    const primary = arr('Lead', [timeNote(1.001, 0, 2, 0.2)]);
    const secondary = arr('Rhythm', [timeNote(0.8, 0, 0, 0.202)]);
    const before = structuredClone({ primary, secondary });
    const plan = analyzeCompositeMerge({ primary, secondary, beats, strategy: 'full-union' });
    assert.equal(plan.conflicts.length, 0);
    const result = materializeCompositeArrangement(plan, 'Hybrid');
    assert.deepEqual(result.notes.map(entry => [entry.fret, entry.time, entry.sustain]), [
        [0, 0.8, 0.201],
        [2, 1.001, 0.2],
    ]);
    assert.deepEqual({ primary, secondary }, before);
});

test('Majesty-style one millisecond source overlap normalizes before fuzzy deduplication', () => {
    const primary = arr('Lead', [timeNote(20.414, 1, 2, 0.125)]);
    const secondary = arr('Rhythm', [
        timeNote(20.099, 1, 0, 0.316),
        timeNote(20.414, 1, 2, 0.125),
    ]);
    const before = structuredClone({ primary, secondary });
    const plan = analyzeCompositeMerge({ primary, secondary, beats, strategy: 'full-union' });
    assert.equal(plan.stats.duplicatesRemoved, 1);
    assert.equal(plan.stats.timingAdjustments, 1);
    assert.equal(plan.conflicts.length, 0);
    const result = materializeCompositeArrangement(plan, 'Majesty Hybrid');
    assert.deepEqual(result.notes.map(entry => [entry.fret, entry.time, entry.sustain]), [
        [0, 20.099, 0.315],
        [2, 20.414, 0.125],
    ]);
    assert.deepEqual({ primary, secondary }, before);
});

test('deduplicated notes keep both-source provenance through conflict choices', () => {
    const primary = arr('Lead', [timeNote(20.414, 1, 2, 0.125)]);
    const secondary = arr('Rhythm', [
        timeNote(20.099, 1, 0, 0.335),
        timeNote(20.414, 1, 2, 0.125),
    ]);
    const before = structuredClone({ primary, secondary });
    const plan = analyzeCompositeMerge({ primary, secondary, beats, strategy: 'full-union' });
    const conflict = plan.conflicts[0];
    assert.equal(plan.stats.duplicatesRemoved, 1);
    assert.deepEqual(conflict.primaryEntries[0].sources, ['primary', 'secondary']);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'secondary').ok, true);
    assert.deepEqual(materializeCompositeArrangement(plan, 'Rhythm Choice').notes.map(entry => entry.fret), [0, 2]);
    assert.equal(clearCompositeConflictResolution(plan, conflict.id).ok, true);
    const bothIds = [...conflict.primaryEntries, ...conflict.secondaryEntries].map(entry => entry.id);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'custom', bothIds).ok, true);
    assert.deepEqual(materializeCompositeArrangement(plan, 'Custom Choice').notes.map(entry => entry.fret), [0, 2]);
    assert.equal(clearCompositeConflictResolution(plan, conflict.id).ok, true);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'primary').ok, true);
    assert.deepEqual(materializeCompositeArrangement(plan, 'Lead Choice').notes.map(entry => entry.fret), [2]);
    assert.deepEqual({ primary, secondary }, before);
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
    assert.equal(clearCompositeConflictResolution(plan, plan.conflicts[0].id).ok, true);
    assert.equal(plan.conflicts[0].resolution, null);
    assert.equal(plan.stats.unresolvedConflicts, 1);
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
    const validation = validateCompositeSelection(both);
    assert.equal(validation.ok, false);
    assert.match(validation.error, /String 6/);
    assert.match(validation.error, /1000 ms/);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'custom', both.map(e => e.id)).ok, false);
    assert.equal(conflict.resolution, null);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'secondary').ok, true);
});

test('materialization performs a final whole-arrangement playability check', () => {
    const plan = analyzeCompositeMerge({
        primary: arr('Lead', [note(2, 0, 3, 1)]),
        secondary: arr('Rhythm', []),
        beats,
        strategy: 'full-union',
    });
    plan.fixedEntries.push({
        ...structuredClone(plan.fixedEntries[0]),
        id: 'secondary:injected-overlap',
        source: 'secondary',
        sources: ['secondary'],
        fret: 8,
    });
    assert.throws(() => materializeCompositeArrangement(plan, 'Invalid Hybrid'),
        /not playable: String 6 has source notes overlapping by 500 ms/);
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
