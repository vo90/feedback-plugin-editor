import assert from 'node:assert/strict';
import test from 'node:test';

import {
    clearCompositeConflictResolution,
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS,
    compositeCompatibility,
    compositeCollisionReason,
    compositeConflictResolutionDiagnostics,
    compositePlanResolutionRevision,
    compositeTimingToleranceSeconds,
    invalidateCompositeConflictResolutionIndex,
    materializeCompositeArrangement,
    prewarmCompositeConflictResolutionIndex,
    prepareCompositeSources,
    resolveCompositeConflict,
    validateCompositeSelection,
} from '../src/composite/merge-engine.js';
import {
    analyzeGapFillComposite,
    COMPOSITE_GAP_FILL_DEFAULTS,
    compositeGroupFitsWindowPure,
    compositeGapFillDefaultsForUnit,
    normalizeCompositeGapFillOptions,
} from '../src/composite/gap-fill-engine.js';
import { analyzeGuidedComposite } from '../src/composite/guided-engine.js';
import { flattenChords, reconstructChords } from '../src/chords.js';
import { LC } from '../src/lanes.js';
import { S } from '../src/state.js';

test('gap window lookup preserves exhaustive results without rescanning earlier gaps', () => {
    const windows = Array.from({ length: 2000 }, (_, index) => ({
        start: index * 3,
        end: index * 3 + 2,
    }));
    const exhaustive = group => windows.some(window =>
        group.startBeat >= window.start - 1e-4 && group.endBeat <= window.end + 1e-4);
    for (let index = 0; index < 4000; index++) {
        const startBeat = (index * 37) % 6000 + (index % 5) * 0.3;
        const group = { startBeat, endBeat: startBeat + (index % 7) * 0.25 };
        assert.equal(compositeGroupFitsWindowPure(group, windows), exhaustive(group));
    }
});

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

function sharedPlan(primary, secondary, timeline = beats) {
    const prepared = prepareCompositeSources({ primary, secondary, beats: timeline });
    return {
        ok: prepared.ok,
        strategy: 'test-shared-core',
        compatibility: prepared.compatibility,
        primary,
        secondary,
        beats: timeline,
        sourceEntries: { primary: prepared.primaryEntries, secondary: prepared.secondaryEntries },
        fixedEntries: [...prepared.primaryEntries, ...prepared.uniqueSecondaryEntries],
        conflicts: [],
        duplicates: prepared.duplicates,
        timingAdjustments: prepared.timingAdjustments,
        skippedEntries: [],
        stats: {
            duplicatesRemoved: prepared.duplicates.length,
            timingAdjustments: prepared.timingAdjustments.length,
            unresolvedConflicts: 0,
        },
    };
}

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
    const prepared = prepareCompositeSources({ primary, secondary, beats });
    assert.equal(prepared.duplicates.length, 1);
    assert.equal(prepared.uniqueSecondaryEntries.length, 1);
    assert.notEqual(prepared.primaryEntries[0].endBeat, prepared.uniqueSecondaryEntries[0].endBeat);
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
    const within = prepareCompositeSources({
        primary: arr('Lead', [timeNote(1, 1, 5, 0.25, { palm_mute: true })]),
        secondary: arr('Rhythm', [timeNote(1.003, 1, 5, 0.25, { palm_mute: true })]),
        beats,
    });
    assert.equal(within.duplicates.length, 1);
    assert.deepEqual(within.primaryEntries[0].sources, ['primary', 'secondary']);

    const outside = prepareCompositeSources({
        primary: arr('Lead', [timeNote(1, 1, 5, 0.25, { palm_mute: true })]),
        secondary: arr('Rhythm', [timeNote(1.006, 1, 5, 0.25, { palm_mute: true })]),
        beats,
    });
    assert.equal(outside.duplicates.length, 0);
    assert.equal(outside.uniqueSecondaryEntries.length, 1);
});

test('timing tolerance never hides semantic technique differences', () => {
    const prepared = prepareCompositeSources({
        primary: arr('Lead', [timeNote(1, 1, 5, 0.25, { palm_mute: true })]),
        secondary: arr('Rhythm', [timeNote(1.003, 1, 5, 0.25, { palm_mute: false })]),
        beats,
    });
    assert.equal(prepared.duplicates.length, 0);
    assert.equal(prepared.uniqueSecondaryEntries.length, 1);
});

test('a tiny cross-source boundary overlap is clamped only in the materialized composite', () => {
    const primary = arr('Lead', [timeNote(1.001, 0, 2, 0.2)]);
    const secondary = arr('Rhythm', [timeNote(0.8, 0, 0, 0.202)]);
    const before = structuredClone({ primary, secondary });
    const plan = sharedPlan(primary, secondary);
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
    const plan = sharedPlan(primary, secondary);
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

test('deduplicated notes keep both-source provenance in shared material', () => {
    const primary = arr('Lead', [timeNote(20.414, 1, 2, 0.125)]);
    const secondary = arr('Rhythm', [
        timeNote(20.099, 1, 0, 0.335),
        timeNote(20.414, 1, 2, 0.125),
    ]);
    const before = structuredClone({ primary, secondary });
    const plan = sharedPlan(primary, secondary);
    assert.equal(plan.stats.duplicatesRemoved, 1);
    assert.deepEqual(plan.fixedEntries.find(entry => entry.fret === 2).sources, ['primary', 'secondary']);
    assert.deepEqual(materializeCompositeArrangement(plan, 'Hybrid').notes.map(entry => entry.fret), [0, 2]);
    assert.deepEqual({ primary, secondary }, before);
});

test('unknown imported technique fields prevent unsafe duplicate removal', () => {
    const prepared = prepareCompositeSources({
        primary: arr('Lead', [note(2, 1, 5, 1, { importer_expression: 'soft' })]),
        secondary: arr('Rhythm', [note(2, 1, 5, 1, { importer_expression: 'hard' })]),
        beats,
    });
    assert.equal(prepared.duplicates.length, 0);
    assert.equal(prepared.uniqueSecondaryEntries.length, 1);
});

test('the same pitch on another string is not treated as a duplicate', () => {
    const plan = sharedPlan(arr('Lead', [note(1, 0, 5)]), arr('Rhythm', [note(1, 1, 0)]));
    assert.equal(plan.stats.duplicatesRemoved, 0);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.fixedEntries.length, 2);
});

test('gap fill adds secondary notes in rests and skips notes during primary activity', () => {
    const plan = analyzeGapFillComposite({
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
    const plan = analyzeGapFillComposite({
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

test('zero-margin gap fill rejects coincident zero-sustain attacks on every string', () => {
    for (const [label, string] of [['same string', 0], ['different string', 2]]) {
        const plan = analyzeGapFillComposite({
            primary: arr('Lead', [note(2, 0, 3, 1)]),
            secondary: arr('Rhythm', [note(2, string, 7)]),
            beats,
            strategy: 'gap-fill',
            gapFill: { unit: 'beats', minimumGap: 0, transitionMargin: 0 },
        });
        assert.equal(plan.stats.secondaryAddedCleanly, 0, label);
        assert.equal(plan.stats.secondarySkippedByStrategy, 1, label);
    }
});

test('zero-margin gap fill allows a fill trail to end exactly when base activity starts', () => {
    const plan = analyzeGapFillComposite({
        primary: arr('Lead', [note(4, 0, 3, 1)]),
        secondary: arr('Rhythm', [note(2, 2, 7, 2)]),
        beats,
        strategy: 'gap-fill',
        gapFill: { unit: 'beats', minimumGap: 0, transitionMargin: 0 },
    });
    assert.equal(plan.stats.secondaryAddedCleanly, 1);
    assert.equal(plan.stats.secondarySkippedByStrategy, 0);
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
    const plan = analyzeGapFillComposite({
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
    const plan = analyzeGapFillComposite({
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
        const plan = analyzeGapFillComposite({
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
    const plan = analyzeGapFillComposite({
        primary: arr('Lead', [note(0, 0, 3, 0, { slide_to: null }), note(4, 0, 0)]),
        secondary: arr('Rhythm', [note(2, 3, 9)]),
        beats,
        strategy: 'gap-fill',
        gapFill: { minimumGapBeats: 0, transitionMarginBeats: 0 },
    });
    assert.equal(plan.stats.secondaryAddedCleanly, 1);
});

test('gap fill keeps a connected secondary gesture atomic when its destination trail crosses lead activity', () => {
    const plan = analyzeGapFillComposite({
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
    const guarded = analyzeGapFillComposite({ ...input,
        gapFill: { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 } });
    assert.equal(guarded.stats.secondaryAddedCleanly, 0);
    const tighter = analyzeGapFillComposite({ ...input,
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
    const beatPlan = analyzeGapFillComposite({
        ...input,
        gapFill: { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 },
    });
    assert.deepEqual(beatPlan.fixedEntries.filter(entry => entry.source === 'secondary')
        .map(entry => entry.fret), [9, 11]);

    const secondsPlan = analyzeGapFillComposite({
        ...input,
        gapFill: { unit: 'seconds', minimumGap: 0.5, transitionMargin: 0.05 },
    });
    assert.deepEqual(secondsPlan.fixedEntries.filter(entry => entry.source === 'secondary')
        .map(entry => entry.fret), [11]);
    assert.equal(secondsPlan.gapFill.unit, 'seconds');
});

test('Guided source choices resolve deterministically and removed compatible-union is rejected', () => {
    const plan = analyzeGuidedComposite({
        primary: arr('Lead', [note(2, 0, 3), note(2, 2, 7)]),
        secondary: arr('Rhythm', [note(2, 0, 5), note(2, 3, 9)]),
        beats,
    });
    assert.equal(plan.conflicts.length, 1);
    assert.equal(resolveCompositeConflict(plan, plan.conflicts[0].id, 'compatible').ok, false);
    assert.equal(resolveCompositeConflict(plan, plan.conflicts[0].id, 'primary').ok, true);
    const result = materializeCompositeArrangement(plan, 'Hybrid Guitar');
    assert.equal(result.name, 'Hybrid Guitar');
    assert.equal(result.type, 'guitar');
    assert.deepEqual(result.notes.map(n => [n.string, n.fret]), [[0, 3], [2, 7]]);
    assert.equal(result.chords.length, 0);
    assert.equal(clearCompositeConflictResolution(plan, plan.conflicts[0].id).ok, true);
    assert.equal(plan.conflicts[0].resolution, null);
    assert.equal(plan.stats.unresolvedConflicts, 1);
});

test('custom resolution refuses cross-source same-string collisions', () => {
    const plan = analyzeGuidedComposite({
        primary: arr('Lead', [note(2, 0, 3, 2)]),
        secondary: arr('Rhythm', [note(3, 0, 7, 1)]),
        beats,
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

function entrySources(entry) {
    return new Set(entry.sources?.length ? entry.sources : [entry.source].filter(Boolean));
}

function legacyFirstCollision(entries, timeline) {
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex++) {
            const left = entries[leftIndex];
            const right = entries[rightIndex];
            const leftSources = entrySources(left);
            if ([...entrySources(right)].some(source => leftSources.has(source))) continue;
            if (compositeCollisionReason(left, right, timeline)) {
                return [left.id, right.id];
            }
        }
    }
    return null;
}

function referenceConflictEntries(group) {
    const unique = new Map();
    for (const entry of [...(group.primaryEntries || []), ...(group.secondaryEntries || [])]) {
        unique.set(entry.id, entry);
    }
    return [...unique.values()];
}

function referenceConflictSelection(group, resolution, selectedEntryIds) {
    const available = referenceConflictEntries(group);
    if (resolution === 'primary' || resolution === 'secondary') {
        return available.filter(entry => entrySources(entry).has(resolution));
    }
    const requested = new Set(selectedEntryIds || []);
    const playableGroups = new Set(available.filter(entry => requested.has(entry.id))
        .map(entry => entry.playableGroupId).filter(Boolean));
    return available.filter(entry => requested.has(entry.id)
        || entry.playableGroupId && playableGroups.has(entry.playableGroupId));
}

function referenceResolveConflict(plan, conflictId, resolution, selectedEntryIds = []) {
    const group = plan.conflicts.find(candidate => candidate.id === conflictId);
    if (!group) return { ok: false, error: 'Review section not found.' };
    if (!['primary', 'secondary', 'custom'].includes(resolution)) {
        return { ok: false, error: 'Unknown review choice.' };
    }
    const selected = referenceConflictSelection(group, resolution, selectedEntryIds);
    const entries = [...plan.fixedEntries, ...selected];
    for (const other of plan.conflicts) {
        if (other === group || !other.resolution) continue;
        const ids = new Set(other.selectedEntryIds || []);
        entries.push(...referenceConflictEntries(other).filter(entry => ids.has(entry.id)));
    }
    const unique = new Map();
    for (const entry of entries) unique.set(entry.id, entry);
    const validation = validateCompositeSelection([...unique.values()], plan.beats,
        plan.compatibility.stringCount);
    const selectedIds = new Set(selected.map(entry => entry.id));
    const transition = !validation.ok && validation.entryIds
        .some(entryId => !selectedIds.has(entryId));
    group.validationKind = transition ? 'transition' : validation.ok ? '' : 'selection';
    group.validationError = transition ? `Transition conflict: ${validation.error}` : validation.error;
    if (!validation.ok) {
        group.resolution = null;
        group.selectedEntryIds = [];
        plan.stats.unresolvedConflicts = plan.conflicts.filter(candidate => !candidate.resolution).length;
        return validation;
    }
    group.resolution = resolution;
    group.selectedEntryIds = selected.map(entry => entry.id);
    plan.stats.unresolvedConflicts = plan.conflicts.filter(candidate => !candidate.resolution).length;
    return { ok: true, selected };
}

function referenceClearConflict(plan, conflictId) {
    const group = plan.conflicts.find(candidate => candidate.id === conflictId);
    if (!group) return { ok: false, error: 'Conflict not found.' };
    group.resolution = null;
    group.selectedEntryIds = [];
    group.validationError = '';
    group.validationKind = '';
    plan.stats.unresolvedConflicts = plan.conflicts.filter(candidate => !candidate.resolution).length;
    return { ok: true };
}

function resolutionResultShape(result) {
    return {
        ok: result.ok,
        error: result.error || '',
        entryIds: result.entryIds || [],
        selectedEntryIds: (result.selected || []).map(entry => entry.id),
    };
}

function resolutionStateShape(plan) {
    return {
        unresolved: plan.stats.unresolvedConflicts,
        conflicts: plan.conflicts.map(group => ({
            id: group.id,
            resolution: group.resolution,
            selectedEntryIds: group.selectedEntryIds,
            validationKind: group.validationKind,
            validationError: group.validationError,
        })),
    };
}

function resolutionFixtureEntry(id, source, startBeat, fret) {
    return {
        id,
        source,
        sources: [source],
        startBeat,
        endBeat: startBeat + 1,
        effectiveEndBeat: startBeat + 1,
        string: 0,
        fret,
    };
}

function resolutionFixtureConflict(id, { primaryEntries = [], secondaryEntries = [] } = {}) {
    return {
        id,
        primaryEntries,
        secondaryEntries,
        resolution: null,
        selectedEntryIds: [],
        validationKind: '',
        validationError: '',
    };
}

function resolutionFixturePlan(conflicts, fixedEntries = []) {
    return {
        ok: true,
        beats: [],
        compatibility: { stringCount: 6 },
        fixedEntries,
        conflicts,
        stats: { unresolvedConflicts: conflicts.filter(group => !group.resolution).length },
    };
}

test('indexed selection validation preserves exhaustive first-conflict ordering', () => {
    let state = 0x5eed1234;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    for (let sample = 0; sample < 250; sample++) {
        const entries = Array.from({ length: 8 + Math.floor(random() * 32) }, (_, index) => {
            const startBeat = Math.floor(random() * 300) / 20;
            const duration = random() < 0.2 ? 0 : Math.floor(random() * 60) / 20;
            const source = random() < 0.5 ? 'primary' : 'secondary';
            return {
                id: `random:${sample}:${index}`,
                source,
                sources: random() < 0.08 ? ['primary', 'secondary'] : [source],
                startBeat,
                endBeat: startBeat + duration,
                effectiveEndBeat: startBeat + Math.max(duration, 1e-4),
                string: Math.floor(random() * 6),
                fret: Math.floor(random() * 13),
            };
        });
        // Input order is deliberately unrelated to time. The optimized sweep
        // must still return the same lexicographically first pair as the old
        // nested resolver because that pair determines transition messaging.
        for (let index = entries.length - 1; index > 0; index--) {
            const target = Math.floor(random() * (index + 1));
            [entries[index], entries[target]] = [entries[target], entries[index]];
        }
        const expected = legacyFirstCollision(entries, beats);
        const actual = validateCompositeSelection(entries, beats);
        assert.deepEqual(actual.ok ? null : actual.entryIds, expected, `sample ${sample}`);
    }
});

test('localized conflict resolution matches whole-song validation through random out-of-order edits', () => {
    let state = 0xc0111de5;
    const observedValidationKinds = new Set();
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    const randomEntry = (id, source) => {
        const startBeat = Math.floor(random() * 160) / 8;
        const duration = random() < 0.35 ? 0 : Math.floor(random() * 24) / 8;
        return {
            id,
            source,
            sources: [source],
            startBeat,
            endBeat: startBeat + duration,
            effectiveEndBeat: startBeat + Math.max(duration, 1e-4),
            string: Math.floor(random() * 3),
            fret: Math.floor(random() * 13),
        };
    };
    for (let sample = 0; sample < 30; sample++) {
        const fixedEntries = Array.from({ length: 8 }, (_, index) =>
            randomEntry(`fixed:${sample}:${index}`, 'primary'));
        const conflicts = Array.from({ length: 18 }, (_, groupIndex) => {
            const playableGroupId = `gesture:${sample}:${groupIndex}`;
            const primaryEntries = Array.from({ length: 1 + (random() < 0.3 ? 1 : 0) },
                (_, entryIndex) => ({
                    ...randomEntry(`primary:${sample}:${groupIndex}:${entryIndex}`, 'primary'),
                    playableGroupId: entryIndex === 0 && random() < 0.25 ? playableGroupId : undefined,
                }));
            const secondaryEntries = Array.from({ length: 1 + (random() < 0.3 ? 1 : 0) },
                (_, entryIndex) => ({
                    ...randomEntry(`secondary:${sample}:${groupIndex}:${entryIndex}`, 'secondary'),
                    playableGroupId: entryIndex === 0 && random() < 0.25 ? playableGroupId : undefined,
                }));
            return {
                id: `conflict:${sample}:${groupIndex}`,
                primaryEntries,
                secondaryEntries,
                resolution: null,
                selectedEntryIds: [],
                validationKind: '',
                validationError: '',
            };
        });
        const initial = {
            ok: true,
            beats: [],
            compatibility: { stringCount: 6 },
            fixedEntries,
            conflicts,
            stats: { unresolvedConflicts: conflicts.length },
        };
        const localized = structuredClone(initial);
        const reference = structuredClone(initial);
        for (let operation = 0; operation < 90; operation++) {
            const groupIndex = Math.floor(random() * conflicts.length);
            const localizedGroup = localized.conflicts[groupIndex];
            const referenceGroup = reference.conflicts[groupIndex];
            if (random() < 0.2) {
                assert.deepEqual(clearCompositeConflictResolution(localized, localizedGroup.id),
                    referenceClearConflict(reference, referenceGroup.id),
                    `clear sample ${sample}, operation ${operation}`);
            } else {
                const resolution = ['primary', 'secondary', 'custom'][Math.floor(random() * 3)];
                const available = referenceConflictEntries(referenceGroup);
                const selectedIds = available.filter(() => random() < 0.5).map(entry => entry.id);
                const actual = resolveCompositeConflict(localized, localizedGroup.id,
                    resolution, selectedIds);
                const expected = referenceResolveConflict(reference, referenceGroup.id,
                    resolution, selectedIds);
                assert.deepEqual(resolutionResultShape(actual), resolutionResultShape(expected),
                    `resolve sample ${sample}, operation ${operation}`);
            }
            if (localizedGroup.validationKind) {
                observedValidationKinds.add(localizedGroup.validationKind);
            }
            assert.deepEqual(resolutionStateShape(localized), resolutionStateShape(reference),
                `state sample ${sample}, operation ${operation}`);
        }
    }
    assert.deepEqual([...observedValidationKinds].sort(), ['selection', 'transition']);
});

test('returned selections cannot mutate the private active-resolution index', () => {
    const first = resolutionFixtureConflict('first', {
        primaryEntries: [
            resolutionFixtureEntry('first:early', 'primary', 0, 3),
            resolutionFixtureEntry('first:late', 'primary', 10, 5),
        ],
    });
    const second = resolutionFixtureConflict('second', {
        secondaryEntries: [resolutionFixtureEntry('second:late', 'secondary', 10, 7)],
    });
    const plan = resolutionFixturePlan([first, second]);

    const resolved = resolveCompositeConflict(plan, first.id, 'primary');
    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.selected.map(entry => entry.id), ['first:early', 'first:late']);
    resolved.selected.pop();
    assert.deepEqual(first.selectedEntryIds, ['first:early', 'first:late'],
        'the public result is not the index-owned selection array');

    assert.equal(clearCompositeConflictResolution(plan, first.id).ok, true);
    assert.equal(compositeConflictResolutionDiagnostics(plan).activeEntries, 0,
        'clearing deactivates every privately stored entry despite caller mutation');
    assert.equal(resolveCompositeConflict(plan, second.id, 'secondary').ok, true,
        'no popped entry remains behind as a ghost collision');
});

test('explicit invalidation adopts deliberate in-place resolution mutations', () => {
    const first = resolutionFixtureConflict('first', {
        primaryEntries: [resolutionFixtureEntry('first:note', 'primary', 4, 3)],
    });
    const second = resolutionFixtureConflict('second', {
        secondaryEntries: [resolutionFixtureEntry('second:note', 'secondary', 4, 7)],
    });
    const plan = resolutionFixturePlan([first, second]);
    assert.equal(resolveCompositeConflict(plan, first.id, 'primary').ok, true);

    // This is deliberately outside the supported resolve/clear ownership path.
    first.resolution = null;
    first.selectedEntryIds = [];
    plan.stats.unresolvedConflicts = 2;
    const revision = compositePlanResolutionRevision(plan);
    assert.equal(invalidateCompositeConflictResolutionIndex(plan), true);
    assert.equal(compositePlanResolutionRevision(plan), revision + 1);
    assert.equal(compositeConflictResolutionDiagnostics(plan), null,
        'the stale active-entry index is discarded immediately');

    assert.equal(resolveCompositeConflict(plan, second.id, 'secondary').ok, true);
    assert.equal(first.resolution, null);
    assert.equal(second.resolution, 'secondary');
    assert.equal(plan.stats.unresolvedConflicts, 1);
    assert.equal(invalidateCompositeConflictResolutionIndex(null), false);
});

test('duplicate conflict ids retain legacy first-match resolution semantics', () => {
    const first = resolutionFixtureConflict('duplicate', {
        primaryEntries: [resolutionFixtureEntry('first:note', 'primary', 0, 3)],
    });
    const second = resolutionFixtureConflict('duplicate', {
        primaryEntries: [resolutionFixtureEntry('second:note', 'primary', 8, 5)],
    });
    const plan = resolutionFixturePlan([first, second]);
    const result = resolveCompositeConflict(plan, 'duplicate', 'primary');
    assert.equal(result.ok, true);
    assert.deepEqual(result.selected.map(entry => entry.id), ['first:note']);
    assert.equal(first.resolution, 'primary');
    assert.equal(second.resolution, null);
    assert.equal(plan.stats.unresolvedConflicts, 1);
});

test('duplicate possible-entry ids cannot create false localized spatial collisions', () => {
    for (const activeStartBeat of [0, 10]) {
        const activeEntry = resolutionFixtureEntry('shared:note', 'primary', activeStartBeat, 3);
        const shadowEntry = resolutionFixtureEntry('shared:note', 'primary',
            activeStartBeat === 0 ? 10 : 0, 3);
        const candidateEntry = resolutionFixtureEntry('candidate:note', 'secondary', 10, 7);
        const active = resolutionFixtureConflict('active', { primaryEntries: [activeEntry] });
        active.resolution = 'primary';
        active.selectedEntryIds = [activeEntry.id];
        const shadow = resolutionFixtureConflict('shadow', { primaryEntries: [shadowEntry] });
        const candidate = resolutionFixtureConflict('candidate', {
            secondaryEntries: [candidateEntry],
        });
        const initial = resolutionFixturePlan([active, shadow, candidate]);
        const localized = structuredClone(initial);
        const reference = structuredClone(initial);
        const actual = resolveCompositeConflict(localized, 'candidate', 'secondary');
        const expected = referenceResolveConflict(reference, 'candidate', 'secondary');
        assert.deepEqual(resolutionResultShape(actual), resolutionResultShape(expected),
            `active duplicate at beat ${activeStartBeat}`);
        assert.deepEqual(resolutionStateShape(localized), resolutionStateShape(reference));
    }
});

test('fixed duplicate ids use exact legacy ordering instead of localized ownership', () => {
    const fixedEarly = resolutionFixtureEntry('fixed:shared', 'primary', 0, 3);
    const fixedLate = resolutionFixtureEntry('fixed:shared', 'primary', 10, 5);
    const candidate = resolutionFixtureConflict('candidate', {
        secondaryEntries: [resolutionFixtureEntry('candidate:note', 'secondary', 10, 7)],
    });
    const initial = resolutionFixturePlan([candidate], [fixedEarly, fixedLate]);
    const localized = structuredClone(initial);
    const reference = structuredClone(initial);
    const actual = resolveCompositeConflict(localized, 'candidate', 'secondary');
    const expected = referenceResolveConflict(reference, 'candidate', 'secondary');
    assert.deepEqual(resolutionResultShape(actual), resolutionResultShape(expected));
    assert.deepEqual(resolutionStateShape(localized), resolutionStateShape(reference));
    assert.equal(actual.ok, false, 'the later fixed duplicate is the authoritative overlap');
    const diagnostics = compositeConflictResolutionDiagnostics(localized);
    assert.equal(diagnostics.duplicateEntryIds, 1);
    assert.equal(diagnostics.legacyValidationAttempts, 1);
    assert.equal(diagnostics.activeOwnershipEntriesChecked, 2);
    assert.equal(diagnostics.intervalBucketsBuilt, 0,
        'duplicate plans never consult ambiguous localized ownership');
});

test('duplicate resolved-owner fallback follows resolve, clear, and retry lifecycle exactly', () => {
    const fixed = resolutionFixtureEntry('owner:shared', 'primary', 0, 3);
    const ownerEntry = resolutionFixtureEntry('owner:shared', 'primary', 10, 5);
    const owner = resolutionFixtureConflict('owner', { primaryEntries: [ownerEntry] });
    owner.resolution = 'primary';
    owner.selectedEntryIds = [ownerEntry.id];
    const candidate = resolutionFixtureConflict('candidate', {
        secondaryEntries: [resolutionFixtureEntry('candidate:note', 'secondary', 10, 7)],
    });
    const initial = resolutionFixturePlan([owner, candidate], [fixed]);
    const localized = structuredClone(initial);
    const reference = structuredClone(initial);

    assert.deepEqual(resolutionResultShape(resolveCompositeConflict(
        localized, 'candidate', 'secondary')),
    resolutionResultShape(referenceResolveConflict(reference, 'candidate', 'secondary')));
    assert.deepEqual(clearCompositeConflictResolution(localized, 'owner'),
        referenceClearConflict(reference, 'owner'));
    const retried = resolveCompositeConflict(localized, 'candidate', 'secondary');
    const expectedRetry = referenceResolveConflict(reference, 'candidate', 'secondary');
    assert.deepEqual(resolutionResultShape(retried), resolutionResultShape(expectedRetry));
    assert.equal(retried.ok, true,
        'after the resolved duplicate owner is cleared, only the non-overlapping fixed note remains');
    assert.deepEqual(resolutionStateShape(localized), resolutionStateShape(reference));
    const diagnostics = compositeConflictResolutionDiagnostics(localized);
    assert.equal(diagnostics.duplicateEntryIds, 1);
    assert.equal(diagnostics.legacyValidationAttempts, 2);
});

test('resolution-index prewarming is repeatable and leaves the plan untouched', () => {
    const conflict = resolutionFixtureConflict('prewarm', {
        primaryEntries: [resolutionFixtureEntry('prewarm:note', 'primary', 2, 3)],
    });
    const plan = resolutionFixturePlan([conflict]);
    const before = structuredClone(plan);
    const revision = compositePlanResolutionRevision(plan);

    assert.equal(prewarmCompositeConflictResolutionIndex(plan), true);
    const diagnostics = compositeConflictResolutionDiagnostics(plan);
    assert.equal(diagnostics.indexBuilds, 1);
    assert.equal(diagnostics.resolutionAttempts, 0);
    assert.deepEqual(plan, before);
    assert.equal(compositePlanResolutionRevision(plan), revision);

    assert.equal(prewarmCompositeConflictResolutionIndex(plan), true);
    assert.deepEqual(compositeConflictResolutionDiagnostics(plan), diagnostics,
        'a second prewarm reuses the already-current private index');
    assert.deepEqual(plan, before);
    assert.equal(prewarmCompositeConflictResolutionIndex(null), false);
});

test('twenty-thousand-conflict prewarm defers interval work with deterministic bounds', () => {
    const count = 20_000;
    const conflicts = Array.from({ length: count }, (_, index) => {
        const startBeat = index * 2;
        const makeEntry = (source, fret) => ({
            id: `${source}:scale:${index}`,
            source,
            sources: [source],
            startBeat,
            endBeat: startBeat,
            effectiveEndBeat: startBeat + 1e-4,
            string: index % 6,
            fret,
        });
        return resolutionFixtureConflict(`scale:${index}`, {
            primaryEntries: [makeEntry('primary', 3)],
            secondaryEntries: [makeEntry('secondary', 7)],
        });
    });
    const plan = resolutionFixturePlan(conflicts);
    assert.equal(prewarmCompositeConflictResolutionIndex(plan), true);
    const prewarmed = compositeConflictResolutionDiagnostics(plan);
    assert.equal(prewarmed.indexBuilds, 1);
    assert.equal(prewarmed.resolutionAttempts, 0);
    assert.equal(prewarmed.indexedEntries, count * 2);
    assert.equal(prewarmed.intervalBucketsBuilt, 0,
        'prewarm indexes review ids but leaves unused string intervals lazy');
    assert.equal(prewarmed.intervalEntriesMaterialized, 0);
    assert.equal(prewarmed.intervalIndexNodesVisited, 0);
    assert.equal(prewarmed.activeOwnershipEntriesChecked, 0);

    assert.equal(resolveCompositeConflict(plan, conflicts.at(-1).id, 'secondary').ok, true);
    const queried = compositeConflictResolutionDiagnostics(plan);
    assert.equal(queried.intervalBucketsBuilt, 1,
        'the first hot query materializes only its one string bucket');
    assert.equal(queried.candidateOwnershipEntriesChecked, 1);
    assert.ok(queried.intervalEntriesMaterialized > 6_000
        && queried.intervalEntriesMaterialized < 7_000);
    assert.ok(queried.intervalIndexBinarySteps < 40);
    assert.ok(queried.intervalIndexEntriesVisited <= 4);
    assert.equal(plan.stats.unresolvedConflicts, count - 1);
});

test('late conflict choices use the local interval index instead of scanning every review block', () => {
    const count = 6000;
    const conflicts = Array.from({ length: count }, (_, index) => {
        const startBeat = index * 2;
        const makeEntry = (source, fret) => ({
            id: `${source}:${index}`,
            source,
            sources: [source],
            startBeat,
            endBeat: startBeat,
            effectiveEndBeat: startBeat + 1e-4,
            string: index % 6,
            fret,
        });
        return {
            id: `late:${index}`,
            primaryEntries: [makeEntry('primary', 3)],
            secondaryEntries: [makeEntry('secondary', 7)],
            resolution: null,
            selectedEntryIds: [],
            validationKind: '',
            validationError: '',
        };
    });
    const plan = {
        ok: true,
        beats: [],
        compatibility: { stringCount: 6 },
        fixedEntries: [],
        conflicts,
        stats: { unresolvedConflicts: conflicts.length },
    };
    assert.equal(resolveCompositeConflict(plan, conflicts[0].id, 'primary').ok, true);
    const before = compositeConflictResolutionDiagnostics(plan);
    assert.ok(before.indexedEntries >= count * 2);
    assert.equal(resolveCompositeConflict(plan, conflicts.at(-1).id, 'secondary').ok, true);
    const after = compositeConflictResolutionDiagnostics(plan);
    assert.equal(after.resolutionAttempts - before.resolutionAttempts, 1);
    assert.equal(after.candidateEntriesVisited - before.candidateEntriesVisited, 1);
    assert.ok(after.intervalTreeNodesVisited - before.intervalTreeNodesVisited < 100);
    assert.ok(after.intervalRecordsMatched - before.intervalRecordsMatched <= 4);
    assert.equal(plan.stats.unresolvedConflicts, count - 2);

    const cloned = structuredClone(plan);
    assert.equal(resolveCompositeConflict(cloned, conflicts[Math.floor(count / 2)].id, 'primary').ok, true);
    assert.equal(cloned.stats.unresolvedConflicts, count - 3);
    assert.equal(compositeConflictResolutionDiagnostics(cloned).indexBuilds, 1);
});

test('one long early trail cannot force a linear localized interval query', () => {
    const count = 10_000;
    const fixed = {
        ...resolutionFixtureEntry('fixed:long-trail', 'primary', 0, 3),
        endBeat: count * 2 + 4,
        effectiveEndBeat: count * 2 + 4,
    };
    const conflicts = Array.from({ length: count }, (_, index) => {
        const startBeat = index * 2 + 2;
        return resolutionFixtureConflict(`trail:${index}`, {
            secondaryEntries: [{
                ...resolutionFixtureEntry(`trail:note:${index}`, 'secondary', startBeat, 7),
                endBeat: startBeat + 0.25,
                effectiveEndBeat: startBeat + 0.25,
                string: 0,
            }],
        });
    });
    const initial = resolutionFixturePlan(conflicts, [fixed]);
    const localized = structuredClone(initial);
    const reference = structuredClone(initial);
    assert.equal(prewarmCompositeConflictResolutionIndex(localized), true);
    const before = compositeConflictResolutionDiagnostics(localized);
    const actual = resolveCompositeConflict(localized, conflicts.at(-1).id, 'secondary');
    const expected = referenceResolveConflict(reference, conflicts.at(-1).id, 'secondary');
    assert.deepEqual(resolutionResultShape(actual), resolutionResultShape(expected));
    const after = compositeConflictResolutionDiagnostics(localized);
    assert.equal(after.intervalBucketsBuilt - before.intervalBucketsBuilt, 1);
    assert.ok(after.intervalIndexBinarySteps - before.intervalIndexBinarySteps < 20);
    assert.ok(after.intervalIndexNodesVisited - before.intervalIndexNodesVisited < 100,
        'segment maxima prune the thousands of expired intervals behind one long trail');
    assert.ok(after.intervalIndexEntriesVisited - before.intervalIndexEntriesVisited <= 3);
    assert.equal(after.candidateEntriesVisited - before.candidateEntriesVisited, 1);
});

test('duplicate indexing remains one-to-one across a long repeated position', () => {
    const count = 2000;
    const primary = arr('Lead', Array.from({ length: count }, (_, index) =>
        timeNote(index * 0.02, 1, 7, 0.005, { palm_mute: true })));
    const secondary = arr('Rhythm', Array.from({ length: count }, (_, index) =>
        timeNote(index * 0.02 + 0.001, 1, 7, 0.005, { palm_mute: true })));
    const prepared = prepareCompositeSources({ primary, secondary, beats });
    assert.equal(prepared.duplicates.length, count);
    assert.equal(prepared.uniqueSecondaryEntries.length, 0);
    assert.equal(new Set(prepared.duplicates.map(pair => pair.primary.id)).size, count);
});

test('materialization performs a final whole-arrangement playability check', () => {
    const plan = sharedPlan(arr('Lead', [note(2, 0, 3, 1)]), arr('Rhythm', []));
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
    const plan = sharedPlan(primary, secondary);
    const result = materializeCompositeArrangement(plan, 'Hybrid');
    assert.equal(result.notes.length, 2);
    assert.equal(result.notes[0].time, 0.75);
    assert.equal(result.notes[0].sustain, 0.25);
    assert.equal(result.notes[0].techniques.vibrato, true);
    assert.deepEqual({ primary, secondary }, before);
    assert.notEqual(result.tones, primary.tones);
});

test('materialization preserves complete flattened chords through the save-shaped rebuild', t => {
    const chordNote = (time, string, fret, chordId, highDensity = false, fn = null) => ({
        time,
        sustain: 0,
        string,
        fret,
        techniques: {},
        _fromChord: true,
        _chordId: chordId,
        _highDensity: highDensity,
        _fn: fn,
    });
    const baseFn = { rn: 'I', q: 'maj', deg: 0 };
    const primary = arr('Base', [
        chordNote(1, 0, 3, 0, true, baseFn),
        chordNote(1, 1, 2, 0, true, baseFn),
    ], {
        chord_templates: [{
            name: 'Base A',
            displayName: 'A major',
            frets: [3, 2, -1, -1, -1, -1],
            fingers: [2, 1, -1, -1, -1, -1],
            arp: false,
            voicing: 'open',
            caged: 'A',
            guideTones: [0, 4, 7],
        }],
        handshapes: [{ chord_id: 0, start_time: 0.9, end_time: 1.1, arp: false }],
        anchors: [{ time: 0, fret: 1 }],
        anchors_user: [{ time: 0.5, fret: 2 }],
        phrases: [{ start_time: 0, name: 'Verse' }],
    });
    const secondary = arr('Fill', [
        // Same voicing: Base metadata wins the deterministic fret-pattern dedupe.
        chordNote(3, 0, 3, 0),
        chordNote(3, 1, 2, 0),
    ], {
        // Also cover a source still in save-shaped (non-flattened) form.
        chords: [{
            time: 5,
            chord_id: 1,
            high_density: false,
            notes: [
                { time: 5, string: 2, fret: 7, sustain: 0, techniques: {} },
                { time: 5, string: 3, fret: 9, sustain: 0, techniques: {} },
            ],
        }],
        chord_templates: [
            {
                name: 'Fill A alias',
                frets: [3, 2, -1, -1, -1, -1],
                fingers: [1, 1, -1, -1, -1, -1],
            },
            {
                name: 'Fill B',
                displayName: 'B fill',
                frets: [-1, -1, 7, 9, -1, -1],
                fingers: [-1, -1, 1, 3, -1, -1],
                arp: true,
            },
        ],
        handshapes: [
            { chord_id: 0, start_time: 2.9, end_time: 3.1, arp: false },
            { chord_id: 1, start_time: 4.9, end_time: 5.1, arp: true },
        ],
        anchors: [{ time: 4, fret: 9 }],
        phrases: [{ start_time: 4, name: 'Fill only' }],
    });
    const beforeSources = structuredClone({ primary, secondary });
    const plan = sharedPlan(primary, secondary);
    const result = materializeCompositeArrangement(plan, 'Metadata Hybrid');

    assert.deepEqual(result.chord_templates.map(template => template.name), ['Base A', 'Fill B']);
    assert.deepEqual(result.chord_templates[0], {
        name: 'Base A',
        displayName: 'A major',
        frets: [3, 2, -1, -1, -1, -1],
        fingers: [2, 1, -1, -1, -1, -1],
        arp: false,
        voicing: 'open',
        caged: 'A',
        guideTones: [0, 4, 7],
    });
    assert.deepEqual(result.notes.map(entry => entry._chordId), [0, 0, 0, 0, 1, 1]);
    assert.deepEqual(result.handshapes.map(handshape => handshape.chord_id), [0, 0, 1]);
    assert.deepEqual(result.anchors, primary.anchors);
    assert.deepEqual(result.anchors_user, primary.anchors_user);
    assert.deepEqual(result.phrases, primary.phrases);
    assert.notEqual(result.anchors, primary.anchors);
    assert.notEqual(result.phrases, primary.phrases);
    assert.deepEqual({ primary, secondary }, beforeSources,
        'analysis and materialization leave both source arrangements untouched');

    const previousState = {
        arrangements: S.arrangements,
        currentArr: S.currentArr,
        history: S.history,
        handshapeSel: S.handshapeSel,
        laneCacheActive: LC.active,
    };
    t.after(() => {
        S.arrangements = previousState.arrangements;
        S.currentArr = previousState.currentArr;
        S.history = previousState.history;
        S.handshapeSel = previousState.handshapeSel;
        LC.active = previousState.laneCacheActive;
    });
    S.arrangements = [result];
    S.currentArr = 0;
    S.history = { reset() {} };
    S.handshapeSel = null;
    LC.active = false;

    reconstructChords();
    const saveShaped = S.arrangements[0];
    assert.equal(saveShaped.notes.length, 0);
    assert.deepEqual(saveShaped.chords.map(chord => [chord.time, chord.chord_id,
        chord.high_density]), [
        [1, 0, true],
        [3, 0, false],
        [5, 1, false],
    ]);
    assert.deepEqual(saveShaped.chords[0].fn, baseFn);
    assert.deepEqual(saveShaped.chord_templates.map(template => template.name),
        ['Base A', 'Fill B']);
    assert.deepEqual(saveShaped.handshapes.map(handshape => handshape.chord_id), [0, 0, 1]);
    assert.deepEqual(saveShaped.anchors, primary.anchors);
    assert.deepEqual(saveShaped.phrases, primary.phrases);
    assert.deepEqual({ primary, secondary }, beforeSources);

    // Exercise the editor's inverse half too: reopening/editing flattens the
    // save-shaped chord instances before the following save rebuilds them.
    flattenChords();
    assert.equal(S.arrangements[0].notes.filter(note => note._highDensity).length, 2);
    reconstructChords();
    assert.deepEqual(S.arrangements[0].chords.map(chord => chord.high_density),
        [true, false, false]);
    assert.deepEqual(S.arrangements[0].chord_templates.map(template => template.name),
        ['Base A', 'Fill B']);
    assert.deepEqual(S.arrangements[0].handshapes.map(handshape => handshape.chord_id), [0, 0, 1]);
});

test('a partially selected source chord becomes a stable metadata-neutral reduced chord', t => {
    const chord = [
        { time: 1, sustain: 0, string: 0, fret: 3, techniques: {},
            _fromChord: true, _chordId: 0, _fn: { rn: 'I' } },
        { time: 1, sustain: 0, string: 1, fret: 2, techniques: {},
            _fromChord: true, _chordId: 0, _fn: { rn: 'I' } },
        { time: 1, sustain: 0, string: 2, fret: 0, techniques: {},
            _fromChord: true, _chordId: 0, _fn: { rn: 'I' } },
    ];
    const primary = arr('Base', chord, {
        chord_templates: [{
            name: 'Full triad',
            frets: [3, 2, 0, -1, -1, -1],
            fingers: [3, 2, 1, -1, -1, -1],
        }],
        handshapes: [{ chord_id: 0, start_time: 0.9, end_time: 1.1, arp: false }],
    });
    const secondary = arr('Fill', []);
    const beforeSources = structuredClone({ primary, secondary });
    const plan = sharedPlan(primary, secondary);
    plan.fixedEntries = plan.fixedEntries.slice(0, 2);
    const result = materializeCompositeArrangement(plan, 'Partial Hybrid');

    assert.equal(result.notes.length, 2);
    assert.ok(result.notes.every(entry => entry._fromChord === undefined
        && entry._chordId === undefined && entry._fn === undefined));
    assert.deepEqual(result.chord_templates, []);
    assert.deepEqual(result.handshapes, []);
    assert.deepEqual({ primary, secondary }, beforeSources);

    const previousState = {
        arrangements: S.arrangements,
        currentArr: S.currentArr,
        history: S.history,
        handshapeSel: S.handshapeSel,
        laneCacheActive: LC.active,
    };
    t.after(() => {
        S.arrangements = previousState.arrangements;
        S.currentArr = previousState.currentArr;
        S.history = previousState.history;
        S.handshapeSel = previousState.handshapeSel;
        LC.active = previousState.laneCacheActive;
    });
    S.arrangements = [result];
    S.currentArr = 0;
    S.history = { reset() {} };
    S.handshapeSel = null;
    LC.active = false;

    reconstructChords();
    assert.equal(S.arrangements[0].notes.length, 0);
    assert.equal(S.arrangements[0].chords.length, 1);
    assert.equal(S.arrangements[0].chords[0].fn, null);
    assert.deepEqual(S.arrangements[0].chords[0].notes.map(entry => [entry.string, entry.fret]), [
        [0, 3],
        [1, 2],
    ]);
    assert.equal(S.arrangements[0].chord_templates.length, 1);
    assert.deepEqual(S.arrangements[0].chord_templates[0].frets,
        [3, 2, -1, -1, -1, -1]);
    assert.equal(S.arrangements[0].chord_templates[0].name, '');
    assert.deepEqual(S.arrangements[0].handshapes, []);

    // Reopen/edit/save shape: the reduced chord remains a reduced chord and
    // cannot regain the source triad's harmony, template name, or handshape.
    flattenChords();
    reconstructChords();
    assert.equal(S.arrangements[0].notes.length, 0);
    assert.equal(S.arrangements[0].chords.length, 1);
    assert.equal(S.arrangements[0].chords[0].fn, null);
    assert.deepEqual(S.arrangements[0].chords[0].notes.map(entry => [entry.string, entry.fret]), [
        [0, 3],
        [1, 2],
    ]);
    assert.equal(S.arrangements[0].chord_templates.length, 1);
    assert.equal(S.arrangements[0].chord_templates[0].name, '');
    assert.deepEqual(S.arrangements[0].handshapes, []);
    assert.deepEqual({ primary, secondary }, beforeSources);
});

test('an authored chord plus an unrelated same-time note saves as one neutral chord', t => {
    const baseFn = { rn: 'I', q: 'maj', deg: 0 };
    const primary = arr('Base', [
        { time: 1, sustain: 0, string: 0, fret: 3, techniques: {},
            _fromChord: true, _chordId: 0, _fn: baseFn },
        { time: 1, sustain: 0, string: 1, fret: 2, techniques: {},
            _fromChord: true, _chordId: 0, _fn: baseFn },
    ], {
        chord_templates: [{
            name: 'Authored dyad',
            frets: [3, 2, -1, -1, -1, -1],
            fingers: [2, 1, -1, -1, -1, -1],
        }],
        handshapes: [{ chord_id: 0, start_time: 0.9, end_time: 1.1, arp: false }],
    });
    const secondary = arr('Fill', [
        { time: 1, sustain: 0, string: 2, fret: 7, techniques: {} },
    ]);
    const beforeSources = structuredClone({ primary, secondary });
    const result = materializeCompositeArrangement(
        sharedPlan(primary, secondary), 'Same-time Hybrid');

    assert.equal(result.notes.length, 3);
    assert.deepEqual(result.chord_templates, [],
        'source metadata is not attached to only a subset of the save-time chord');
    assert.deepEqual(result.handshapes, []);
    assert.ok(result.notes.every(entry => entry._fromChord === undefined
        && entry._chordId === undefined && entry._fn === undefined));

    const previousState = {
        arrangements: S.arrangements,
        currentArr: S.currentArr,
        history: S.history,
        handshapeSel: S.handshapeSel,
        laneCacheActive: LC.active,
    };
    t.after(() => {
        S.arrangements = previousState.arrangements;
        S.currentArr = previousState.currentArr;
        S.history = previousState.history;
        S.handshapeSel = previousState.handshapeSel;
        LC.active = previousState.laneCacheActive;
    });
    S.arrangements = [result];
    S.currentArr = 0;
    S.history = { reset() {} };
    S.handshapeSel = null;
    LC.active = false;

    reconstructChords();
    assert.equal(S.arrangements[0].chords.length, 1);
    assert.deepEqual(S.arrangements[0].chords[0].notes.map(entry => entry.string), [0, 1, 2]);
    assert.equal(S.arrangements[0].chords[0].fn, null);
    assert.equal(S.arrangements[0].chord_templates.length, 1);
    assert.equal(S.arrangements[0].chord_templates[0].name, '');
    assert.deepEqual(S.arrangements[0].handshapes, []);

    flattenChords();
    reconstructChords();
    assert.deepEqual(S.arrangements[0].chords[0].notes.map(entry => entry.string), [0, 1, 2]);
    assert.equal(S.arrangements[0].chord_templates[0].name, '');
    assert.deepEqual({ primary, secondary }, beforeSources);
});
