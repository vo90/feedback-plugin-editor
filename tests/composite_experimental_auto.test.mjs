import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzeExperimentalAutoComposite,
    buildExperimentalGestureGraph,
    classifyExperimentalDuplicates,
    EXPERIMENTAL_REASON,
    experimentalComparisonReport,
    experimentalPassageOutcome,
    experimentalSyncPreflight,
    HYBRID_EXPERIMENTAL_ENGINE_VERSION,
    refreshExperimentalPlayability,
} from '../src/composite/experimental-auto-engine.js';
import { analyzeGapFillComposite } from '../src/composite/gap-fill-engine.js';
import {
    compositeExperimentalMetadataPreview,
    materializeCompositeArrangement,
    prepareCompositeSources,
    resolveCompositeConflict,
} from '../src/composite/merge-engine.js';

function beatGrid(length = 40, secondsPerBeat = 1) {
    return Array.from({ length }, (_, index) => ({
        time: index * secondsPerBeat,
        measure: index % 4 === 0 ? index / 4 + 1 : 0,
    }));
}

function note(time, string, fret, sustain = 0, techniques = {}) {
    return { time, string, fret, sustain, techniques };
}

function arrangement(name, notes = [], extra = {}) {
    return {
        name, type: 'guitar', tuning: [0, 0, 0, 0, 0, 0], capo: 0,
        notes, chords: [], chord_templates: [], anchors: [], anchors_user: [],
        handshapes: [], phrases: [], ...extra,
    };
}

test('experimental analysis keeps Standard Automatic as an unchanged control result', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [note(0, 0, 3, 0.5), note(5, 0, 5, 0.5)]);
    const secondary = arrangement('Rhythm', [note(2, 1, 7, 0.5)]);
    const gapFill = { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 };
    const standard = analyzeGapFillComposite({ primary, secondary, beats, gapFill });
    const experimental = analyzeExperimentalAutoComposite({
        primary, secondary, beats, gapFill,
    });
    assert.equal(experimental.ok, true);
    assert.deepEqual(experimental.standardPlan.stats, standard.stats);
    assert.deepEqual(experimental.standardPlan.fixedEntries.map(entry => entry.id),
        standard.fixedEntries.map(entry => entry.id));
    assert.equal(standard.strategy, 'gap-fill');
    assert.equal(experimental.strategy, 'experimental');
    assert.equal(experimental.profile, 'balanced');
    assert.equal(experimental.engineVersion, HYBRID_EXPERIMENTAL_ENGINE_VERSION);
    assert.match(experimentalComparisonReport(experimental), /engine: v2/i);
});

test('semantic duplicates ignore teaching annotations but preserve unknown distinctions', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [note(2, 1, 7, 0.5, { fret_finger: 1 })]);
    const secondary = arrangement('Rhythm', [note(2.002, 1, 7, 0.5, { fret_finger: 3 })]);
    const prepared = prepareCompositeSources({ primary, secondary, beats });
    assert.equal(prepared.duplicates.length, 0, 'strict matching sees the teaching difference');
    const classified = classifyExperimentalDuplicates(prepared, beats);
    assert.equal(classified.semanticCount, 1);
    assert.equal(classified.candidateEntries.length, 0);
    assert.deepEqual(classified.primaryEntries[0].sources, ['primary', 'secondary']);

    secondary.notes[0].techniques.importer_private_flag = 'different';
    const conservative = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(conservative.semanticCount, 0,
        'unknown authored data is never silently discarded');

    delete secondary.notes[0].techniques.importer_private_flag;
    secondary.notes[0].importer_private_note_data = 'different';
    const topLevelConservative = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(topLevelConservative.semanticCount, 0,
        'unknown top-level note fields are conservative too');

    delete secondary.notes[0].importer_private_note_data;
    secondary.notes[0].techniques.palm_mute = 1;
    const numericBoolean = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(numericBoolean.semanticCount, 0,
        'a truthy imported audible technique is never normalized away');

    delete secondary.notes[0].techniques.palm_mute;
    secondary.notes[0].techniques.pick_direction = 'down';
    const namedTarget = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(namedTarget.semanticCount, 0,
        'an unfamiliar authored target value remains a conservative distinction');
});

test('semantic strum topology ignores importer group ids but not missing chord members', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [
        note(2, 0, 3, 0.25, { strum_group: 10 }),
        note(2, 1, 5, 0.25, { strum_group: 10 }),
    ]);
    const secondary = arrangement('Rhythm', [
        note(2.002, 0, 3, 0.25, { strum_group: 999 }),
        note(2.002, 1, 5, 0.25, { strum_group: 999 }),
    ]);
    let classified = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(classified.semanticCount, 2);
    assert.equal(classified.candidateEntries.length, 0);

    secondary.notes.pop();
    classified = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(classified.semanticCount, 0,
        'a partial strum is not treated as the same authored gesture');
});

test('semantic duplicate comparison covers the complete connected destination', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [
        note(2, 1, 5, 0.25, { link_next: true, fret_finger: 1 }),
        note(2.5, 1, 7, 0.25, { hammer_on: true, fret_finger: 3 }),
    ]);
    const secondary = arrangement('Rhythm', [
        note(2.002, 1, 5, 0.25, { link_next: true, fret_finger: 2 }),
        note(2.502, 1, 7, 0.25, { hammer_on: true, fret_finger: 4 }),
    ]);
    const classified = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(classified.semanticCount, 2);
    assert.equal(classified.candidateEntries.length, 0);
});

test('semantic duplicate indexing preserves one-to-one results across a long repeated part', () => {
    const count = 1200;
    const beats = beatGrid(3000, 0.01);
    const primary = arrangement('Lead', Array.from({ length: count }, (_, index) =>
        note(index * 0.02, 1, 7, 0.005, { fret_finger: 1 })));
    const secondary = arrangement('Rhythm', Array.from({ length: count }, (_, index) =>
        note(index * 0.02 + 0.001, 1, 7, 0.005, { fret_finger: 3 })));
    const classified = classifyExperimentalDuplicates(
        prepareCompositeSources({ primary, secondary, beats }), beats);
    assert.equal(classified.strictCount, 0);
    assert.equal(classified.semanticCount, count);
    assert.equal(classified.candidateEntries.length, 0);
    assert.equal(new Set(classified.duplicates.map(pair => pair.primary.id)).size, count,
        'the time index does not allow two repeated attacks to consume one base note');
});

test('complete gesture graph keeps hammer-ons and their preceding attacks atomic', () => {
    const beats = beatGrid();
    const secondary = arrangement('Rhythm', [
        note(2, 1, 5, 0.25),
        note(2.5, 1, 7, 0.25, { hammer_on: true }),
    ]);
    const prepared = prepareCompositeSources({
        primary: arrangement('Lead'), secondary, beats,
    });
    const gestures = buildExperimentalGestureGraph(
        prepared.secondaryEntries, prepared.uniqueSecondaryEntries,
    );
    assert.equal(gestures.length, 1);
    assert.deepEqual(gestures[0].entries.map(entry => entry.fret), [5, 7]);
    assert.equal(gestures[0].entries[0].playableGroupId,
        gestures[0].entries[1].playableGroupId);
});

test('gesture graph treats reused ids as local and reports malformed authored links', () => {
    const beats = beatGrid();
    const secondary = arrangement('Rhythm', [
        note(2, 1, 5, 0.25, { strum_group: 4 }),
        note(2, 2, 7, 0.25, { strum_group: 4 }),
        note(8, 1, 5, 0.25, { strum_group: 4 }),
        note(8, 2, 7, 0.25, { strum_group: 4, slide_to: 10 }),
    ]);
    const prepared = prepareCompositeSources({
        primary: arrangement('Lead'), secondary, beats,
    });
    const gestures = buildExperimentalGestureGraph(
        prepared.secondaryEntries, prepared.uniqueSecondaryEntries,
    );
    assert.equal(gestures.length, 2, 'a reused importer id does not join distant strums');
    assert.ok(gestures[1].brokenReasonCodes.includes(EXPERIMENTAL_REASON.BROKEN_CONNECTION));
});

test('profiles change only heuristic treatment while hard timing remains authoritative', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [note(0, 0, 3, 0.5), note(5, 0, 5, 0.5)]);
    const secondary = arrangement('Rhythm', [note(2, 1, 7, 0.25)]);
    const input = {
        primary, secondary, beats,
        gapFill: { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 },
    };
    const strict = analyzeExperimentalAutoComposite({ ...input, profile: 'strict' });
    const balanced = analyzeExperimentalAutoComposite({ ...input, profile: 'balanced' });
    const fill = analyzeExperimentalAutoComposite({ ...input, profile: 'fill-more' });
    assert.equal(strict.stats.leftOutPassages, 1);
    assert.equal(balanced.stats.reviewPassages, 1);
    assert.equal(fill.stats.reviewPassages, 1,
        'isolated source notes remain reviewable instead of being silently inserted');

    const blockedSecondary = arrangement('Rhythm', [note(0.25, 0, 7, 0.25)]);
    for (const profile of ['strict', 'balanced', 'fill-more']) {
        const plan = analyzeExperimentalAutoComposite({
            ...input, secondary: blockedSecondary, profile,
        });
        assert.equal(plan.stats.secondaryAddedCleanly, 0);
        assert.equal(plan.stats.secondaryReviewable, 0);
        assert.equal(plan.stats.secondarySkippedByStrategy, 1);
    }
});

test('a timing window never silently inserts only part of a detected source passage', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [
        note(0, 0, 3, 0.25),
        note(2.5, 5, 12, 0.5),
        note(5, 0, 5, 0.25),
    ]);
    const secondary = arrangement('Rhythm', [
        note(2, 1, 7, 0.2),
        note(2.5, 2, 9, 0.2),
    ]);
    const plan = analyzeExperimentalAutoComposite({
        primary, secondary, beats, profile: 'fill-more',
        gapFill: { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 },
    });
    assert.ok(plan.passages.some(passage =>
        passage.reasonCodes.includes(EXPERIMENTAL_REASON.PARTIAL_PASSAGE)));
    assert.equal(plan.stats.addedPassages, 0,
        'a partial passage can be reviewed or omitted, but is not auto-added');
});

test('authored sections split passages without labeling earlier notes as a future section', () => {
    const beats = beatGrid();
    const plan = analyzeExperimentalAutoComposite({
        primary: arrangement('Lead', [note(0, 0, 3), note(8, 0, 5)]),
        secondary: arrangement('Rhythm', [note(3.5, 1, 7, 0.1), note(4, 1, 9, 0.1)]),
        beats,
        sections: [{ start_time: 4, name: 'Chorus' }],
        profile: 'balanced',
    });
    assert.equal(plan.passages.length, 2);
    assert.doesNotMatch(plan.passages[0].label, /Chorus/);
    assert.match(plan.passages[1].label, /Chorus/);
});

test('sync preflight blocks only strong coherent evidence of source offset', () => {
    const beats = beatGrid(80, 0.25);
    const primary = arrangement('Lead', Array.from({ length: 24 }, (_, index) =>
        note(index * 0.5, index % 3, 5 + index % 4)));
    const secondary = arrangement('Rhythm', Array.from({ length: 24 }, (_, index) =>
        note(index * 0.5 + 0.1, index % 3, 5 + index % 4)));
    const prepared = prepareCompositeSources({ primary, secondary, beats });
    const sync = experimentalSyncPreflight(prepared.primaryEntries, prepared.secondaryEntries, beats);
    assert.equal(sync.status, 'blocked');
    assert.ok(Math.abs(sync.offsetSeconds - 0.1) < 0.001);

    const sparse = experimentalSyncPreflight(prepared.primaryEntries.slice(0, 3),
        prepared.secondaryEntries.slice(0, 3), beats);
    assert.equal(sparse.status, 'inconclusive');
    assert.equal(sparse.blocked, false);

    const shortSecondary = experimentalSyncPreflight(prepared.primaryEntries,
        prepared.secondaryEntries.slice(0, 4), beats);
    assert.ok(shortSecondary.warnings.some(warning => warning.code === 'length-difference'));
});

test('experimental review uses the generic safe resolver and emits a copyable report', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [note(0, 0, 3, 0.5), note(5, 0, 5, 0.5)]);
    const secondary = arrangement('Rhythm', [note(2, 1, 7, 0.25)]);
    const plan = analyzeExperimentalAutoComposite({
        primary, secondary, beats, profile: 'balanced',
    });
    assert.equal(plan.conflicts.length, 1);
    const conflict = plan.conflicts[0];
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'secondary').ok, true);
    assert.equal(plan.stats.unresolvedConflicts, 0);
    assert.equal(experimentalPassageOutcome(plan, conflict.id).state, 'accepted');
    const hybrid = materializeCompositeArrangement(plan, 'Hybrid');
    assert.deepEqual(hybrid.notes.map(entry => entry.fret), [3, 7, 5]);
    const refreshed = refreshExperimentalPlayability(plan);
    assert.match(experimentalComparisonReport(plan), /Standard Automatic/);
    assert.match(experimentalComparisonReport(plan), /Experimental:/);
    assert.strictEqual(plan.playability, refreshed,
        'formatting the report consumes the refreshed result without replacing it');
    assert.strictEqual(refreshExperimentalPlayability(plan), refreshed,
        'an unchanged review resolution reuses the cached playability pass');
    assert.deepEqual(plan.reviewOutcome, {
        offeredNotes: 1, acceptedNotes: 1, leftOutNotes: 0,
    });
});

test('differential playability refreshes after a reviewed passage is accepted', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [note(0, 0, 1, 0.5), note(5, 0, 1, 0.5)]);
    const secondary = arrangement('Rhythm', [
        note(2, 1, 10, 0.25), note(2, 2, 17, 0.25),
    ]);
    const plan = analyzeExperimentalAutoComposite({
        primary, secondary, beats, profile: 'balanced',
    });
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.playability.newWarnings.length, 0,
        'unresolved optional material is not blamed on the safe result');
    assert.equal(resolveCompositeConflict(plan, plan.conflicts[0].id, 'secondary').ok, true);
    refreshExperimentalPlayability(plan);
    assert.ok(plan.playability.newWarnings.some(issue => issue.rule === 'stretch'));
});

test('known chord templates, complete handshapes, phrases, and base tones survive experimental materialization', () => {
    const beats = beatGrid();
    const template = { name: 'C shape', displayName: 'C', frets: [3, 2, 0, -1, -1, -1], fingers: [3, 2, 0, -1, -1, -1] };
    const primary = arrangement('Lead', [], {
        chords: [{
            time: 0, chord_id: 0, sustain: 0.5, fn: { root: 'C', quality: 'major' },
            notes: [note(0, 0, 3), note(0, 1, 2), note(0, 2, 0)],
        }],
        chord_templates: [template],
        handshapes: [{ chord_id: 0, start_time: 0, end_time: 0.5, arp: false }],
        tones: { base: 'Lead Tone', definitions: [{ Key: 'Lead Tone' }] },
        phrases: [{ start_time: 0, difficulty: 0 }],
    });
    const secondary = arrangement('Rhythm', [note(3, 3, 5)]);
    const plan = analyzeExperimentalAutoComposite({
        primary, secondary, beats, profile: 'strict',
    });
    const hybrid = materializeCompositeArrangement(plan, 'Hybrid');
    assert.equal(hybrid.chord_templates[0].name, 'C shape');
    assert.equal(hybrid.handshapes.length, 1);
    assert.equal(hybrid.handshapes[0].chord_id, 0);
    assert.ok(hybrid.notes.slice(0, 3).every(noteEntry =>
        noteEntry._fn?.root === 'C' && noteEntry._fn?.quality === 'major'));
    assert.equal(hybrid.tones.base, primary.tones.base);
    assert.deepEqual(hybrid.tones.definitions, primary.tones.definitions);
    assert.deepEqual(hybrid.tones.changes, []);
    assert.deepEqual(hybrid.phrases, primary.phrases);
    assert.deepEqual(hybrid.anchors, [], 'anchors are deliberately recomputed by the save path');
});

test('a fully selected source passage can project compatible phrase and tone metadata', () => {
    const beats = beatGrid();
    const primary = arrangement('Lead', [note(0, 0, 3), note(6, 0, 5)], {
        tones: { base: 'Clean', definitions: [{ Key: 'Clean', Name: 'Clean' }], changes: [] },
        phrases: [{ start_time: 0, name: 'Intro' }],
    });
    const secondary = arrangement('Rhythm', [note(2, 1, 7), note(2.2, 2, 9)], {
        tones: { base: 'Drive', definitions: [{ Key: 'Drive', Name: 'Drive' }], changes: [] },
        phrases: [{ start_time: 2, name: 'Fill' }],
    });
    const plan = analyzeExperimentalAutoComposite({
        primary, secondary, beats, profile: 'balanced',
    });
    if (plan.conflicts.length) {
        assert.equal(resolveCompositeConflict(plan, plan.conflicts[0].id, 'secondary').ok, true);
    }
    const metadata = compositeExperimentalMetadataPreview(plan);
    const hybrid = materializeCompositeArrangement(plan, 'Hybrid');
    assert.equal(metadata.phrases, 2);
    assert.equal(hybrid.phrases.length, 2);
    assert.ok(hybrid.tones.definitions.some(definition => definition.Key === 'Drive'));
    assert.ok(hybrid.tones.changes.some(change => change.name === 'Drive'));
    assert.ok(hybrid.tones.changes.some(change => change.name === 'Clean'));

    secondary.tones.definitions = [];
    const missingDefinitionPlan = analyzeExperimentalAutoComposite({
        primary, secondary, beats, profile: 'balanced',
    });
    if (missingDefinitionPlan.conflicts.length) {
        assert.equal(resolveCompositeConflict(missingDefinitionPlan,
            missingDefinitionPlan.conflicts[0].id, 'secondary').ok, true);
    }
    assert.ok(compositeExperimentalMetadataPreview(missingDefinitionPlan).warnings
        .some(warning => /definition is missing/.test(warning)));
});
