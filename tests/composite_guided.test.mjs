import assert from 'node:assert/strict';
import test from 'node:test';

import {
    analyzeGuidedComposite,
    clearGuidedRepeatGroup,
    detachGuidedRepeatOccurrence,
    GUIDED_REPEAT_MODE_EVERY,
    GUIDED_REPEAT_MODE_MATCHING,
    guidedReviewContext,
    guidedReviewGroups,
    resolveGuidedRepeatGroup,
    splitGuidedDecisionBlock,
    splitGuidedRepeatGroup,
} from '../src/composite/guided-engine.js';
import {
    clearCompositeConflictResolution,
    materializeCompositeArrangement,
    resolveCompositeConflict,
} from '../src/composite/merge-engine.js';

const beats = Array.from({ length: 41 }, (_, index) => ({
    time: index * 0.5,
    measure: index % 4 === 0 ? index / 4 + 1 : -1,
}));
const note = (beat, string, fret, sustainBeats = 0, techniques = {}) => ({
    beat,
    beatEnd: sustainBeats ? beat + sustainBeats : undefined,
    time: beat * 0.5,
    sustain: sustainBeats * 0.5,
    string,
    fret,
    techniques,
});
const arrangement = (name, notes, extra = {}) => ({
    name,
    type: 'guitar',
    tuning: [0, 0, 0, 0, 0, 0],
    capo: 0,
    notes,
    chords: [],
    chord_templates: [],
    ...extra,
});

function legacyGuidedReviewContext(plan, blockId) {
    const groups = guidedReviewGroups(plan);
    const block = plan.conflicts.find(candidate => candidate.id === blockId);
    const group = groups.find(candidate => candidate.memberIds.includes(blockId));
    if (!block || !group) return null;
    const memberIds = new Set(group.memberIds);
    const members = plan.conflicts.map((candidate, index) => ({ block: candidate, index }))
        .filter(candidate => memberIds.has(candidate.block.id));
    const groupIndex = groups.findIndex(candidate => candidate.id === group.id);
    const unresolved = candidate => candidate.memberIds.some(id => {
        const candidateBlock = plan.conflicts.find(item => item.id === id);
        return candidateBlock && !candidateBlock.resolution;
    });
    let nextIndex = -1;
    for (let offset = 1; offset < groups.length; offset++) {
        const candidateIndex = (groupIndex + offset) % groups.length;
        if (unresolved(groups[candidateIndex])) {
            nextIndex = candidateIndex;
            break;
        }
    }
    return {
        blockIndex: plan.conflicts.findIndex(candidate => candidate.id === blockId),
        groupId: group.id,
        groupIndex,
        memberIndexes: members.map(member => member.index),
        occurrenceIndex: members.findIndex(member => member.block.id === blockId),
        grouped: members.length > 1,
        allResolved: members.every(member => !!member.block.resolution),
        unresolvedDecisions: groups.filter(unresolved).length,
        unresolvedConflicts: plan.conflicts.filter(candidate => !candidate.resolution).length,
        nextIndex,
    };
}

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

test('identical Guided material is included once and never enters review', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(2, 1, 5, 1, { palm_mute: true })]),
        secondary: arrangement('Rhythm', [note(2.003, 1, 5, 1, { palm_mute: true })]),
        beats,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.conflicts.length, 0);
    assert.equal(plan.stats.duplicatesRemoved, 1);
    assert.equal(plan.fixedEntries.length, 1);
    assert.deepEqual(plan.fixedEntries[0].sources, ['primary', 'secondary']);
    assert.ok(plan.automaticRegions.some(region => region.kind === 'identical'));
});

test('single-source cells are automatic while common-plus-extra material needs review', () => {
    const automatic = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3)]),
        secondary: arrangement('Rhythm', [note(9, 1, 5)]),
        beats,
    });
    assert.equal(automatic.conflicts.length, 0);
    assert.deepEqual(automatic.fixedEntries.map(entry => entry.fret), [3, 5]);

    const common = note(1, 2, 7);
    const different = analyzeGuidedComposite({
        primary: arrangement('Lead', [common, note(2, 3, 9)]),
        secondary: arrangement('Rhythm', [structuredClone(common)]),
        beats,
    });
    assert.equal(different.conflicts.length, 1);
    assert.equal(different.fixedEntries.length, 1, 'the duplicate is already canonical and fixed');
    assert.deepEqual(different.conflicts[0].primaryEntries.map(entry => entry.fret), [9]);
    assert.deepEqual(different.conflicts[0].secondaryEntries, []);
    assert.equal(resolveCompositeConflict(different, different.conflicts[0].id, 'secondary').ok, true);
    assert.deepEqual(materializeCompositeArrangement(different, 'Without extra').notes.map(entry => entry.fret), [7]);
});

test('decision blocks stop at section landmarks and at four bars', () => {
    const primaryNotes = [];
    const secondaryNotes = [];
    for (let bar = 0; bar < 10; bar++) {
        primaryNotes.push(note(bar * 4 + 1, 0, 3));
        secondaryNotes.push(note(bar * 4 + 1, 1, 5));
    }
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', primaryNotes),
        secondary: arrangement('Rhythm', secondaryNotes),
        beats,
        sections: [{ name: 'Verse', number: 1, start_time: 6 }], // beat 12
    });
    assert.deepEqual(plan.conflicts.map(block => [block.startBeat, block.rangeEndBeat]), [
        [0, 12], [12, 28], [28, 40],
    ]);
    assert.ok(plan.conflicts.every(block => block.cells.at(-1).measureIndex
        - block.cells[0].measureIndex < 4));
    assert.ok(plan.conflicts.every(block => !(block.startBeat < 12 && block.rangeEndBeat > 12)));
});

test('shared phrase markers are optional soft splits', () => {
    const primaryNotes = [note(1, 0, 3), note(5, 0, 3)];
    const secondaryNotes = [note(1, 1, 5), note(5, 1, 5)];
    const noPhrases = analyzeGuidedComposite({
        primary: arrangement('Lead', primaryNotes),
        secondary: arrangement('Rhythm', secondaryNotes),
        beats,
    });
    assert.equal(noPhrases.conflicts.length, 1);
    const withPhrases = analyzeGuidedComposite({
        primary: arrangement('Lead', primaryNotes, { phrases: [{ start_time: 2 }] }),
        secondary: arrangement('Rhythm', secondaryNotes, { phrases: [{ start_time: 2.002 }] }),
        beats,
    });
    assert.deepEqual(withPhrases.conflicts.map(block => block.startBeat), [0, 4]);
});

test('a Guided decision block can be split only at its real bar boundaries', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(5, 0, 3)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(5, 1, 5)]),
        beats,
    });
    const original = plan.conflicts[0];
    assert.equal(splitGuidedDecisionBlock(plan, original.id, 2).ok, false);
    const split = splitGuidedDecisionBlock(plan, original.id, 4);
    assert.equal(split.ok, true);
    assert.deepEqual(plan.conflicts.map(block => [block.startBeat, block.rangeEndBeat]), [[0, 4], [4, 8]]);
    assert.equal(plan.stats.unresolvedConflicts, 2);
});

test('an unsafe automatic source handoff is promoted to a transition decision', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(3, 0, 3, 2)]),
        secondary: arrangement('Rhythm', [note(4, 0, 5)]),
        beats,
    });
    assert.equal(plan.conflicts.length, 1);
    assert.ok(plan.conflicts[0].reasons.includes('transition'));
    assert.equal(plan.fixedEntries.length, 0);
    assert.equal(resolveCompositeConflict(plan, plan.conflicts[0].id, 'primary').ok, true);
    assert.deepEqual(materializeCompositeArrangement(plan, 'Safe handoff').notes.map(entry => entry.fret), [3]);
});

test('connected gestures stay in one block and custom selection expands atomically', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [
            note(3, 0, 3, 0, { link_next: true }),
            note(5, 0, 5),
        ]),
        secondary: arrangement('Rhythm', [note(3, 1, 7)]),
        beats,
    });
    const block = plan.conflicts[0];
    assert.deepEqual(block.primaryEntries.map(entry => entry.startBeat), [3, 5]);
    const resolution = resolveCompositeConflict(plan, block.id, 'custom', [block.primaryEntries[0].id]);
    assert.equal(resolution.ok, true);
    assert.deepEqual(resolution.selected.map(entry => entry.startBeat), [3, 5]);
});

test('duplicate pairing is one-to-one for repeated imported attacks', () => {
    const repeated = note(2, 1, 5);
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [repeated]),
        secondary: arrangement('Rhythm', [structuredClone(repeated), structuredClone(repeated)]),
        beats,
    });
    assert.equal(plan.stats.duplicatesRemoved, 1);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].secondaryEntries.length, 1);
});

test('connected notes deduplicate only when their complete destination gesture agrees', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [
            note(2, 0, 3, 0, { link_next: true }),
            note(3, 0, 5),
        ]),
        secondary: arrangement('Rhythm', [
            note(2, 0, 3, 0, { link_next: true }),
            note(3, 0, 7),
        ]),
        beats,
    });
    assert.equal(plan.stats.duplicatesRemoved, 0);
    assert.equal(plan.conflicts.length, 1);
    assert.equal(plan.conflicts[0].primaryEntries.length, 2);
    assert.equal(plan.conflicts[0].secondaryEntries.length, 2);
});

test('choices that collide across decision blocks become explicit transition errors', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(3, 0, 3, 2), note(6, 1, 8)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(4, 0, 7)]),
        beats,
        sections: [{ name: 'chorus1', number: 1, start_time: 2 }],
    });
    assert.equal(plan.conflicts.length, 2);
    assert.equal(resolveCompositeConflict(plan, plan.conflicts[0].id, 'primary').ok, true);
    const transition = resolveCompositeConflict(plan, plan.conflicts[1].id, 'secondary');
    assert.equal(transition.ok, false);
    assert.equal(plan.conflicts[1].validationKind, 'transition');
    assert.match(plan.conflicts[1].validationError, /^Transition conflict:/);
});

test('matching Guided repetitions become one review decision and resolve together', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(9, 0, 3)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 5)]),
        beats,
        sections: [{ name: 'Chorus', number: 2, start_time: 4 }],
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(plan.conflicts.length, 2);
    assert.equal(guidedReviewGroups(plan).length, 1);
    assert.equal(plan.stats.reviewDecisions, 1);
    assert.equal(plan.stats.repeatedOccurrences, 1);

    const result = resolveGuidedRepeatGroup(plan, plan.conflicts[0].id, 'primary');
    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 2);
    assert.ok(plan.conflicts.every(block => block.resolution === 'primary'));
    assert.deepEqual(plan.conflicts.map(block => block.selectedEntryIds.length), [1, 1]);

    const cleared = clearGuidedRepeatGroup(plan, plan.conflicts[1].id);
    assert.equal(cleared.ok, true);
    assert.ok(plan.conflicts.every(block => block.resolution === null));
});

test('Guided repetition groups are reused until their structure changes', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(9, 0, 3)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 5)]),
        beats,
        sections: [{ name: 'Chorus', number: 2, start_time: 4 }],
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    const grouped = guidedReviewGroups(plan);
    assert.strictEqual(guidedReviewGroups(plan), grouped,
        'render-time lookups reuse fingerprint and exact-match work');
    assert.equal(resolveGuidedRepeatGroup(plan, plan.conflicts[0].id, 'primary').ok, true);
    assert.strictEqual(guidedReviewGroups(plan), grouped,
        'resolution-only changes update counters without regrouping immutable blocks');
    assert.equal(plan.stats.unresolvedReviewDecisions, 0);

    plan.repeatMode = GUIDED_REPEAT_MODE_EVERY;
    const separated = guidedReviewGroups(plan);
    assert.notStrictEqual(separated, grouped);
    assert.equal(separated.length, 2);
    assert.strictEqual(guidedReviewGroups(plan), separated);
});

test('Guided review context is clone-safe and invalidates after resolution and structure APIs', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(9, 0, 3)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 5)]),
        beats,
        sections: [{ name: 'Riff', number: 2, start_time: 4 }],
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    const blockId = plan.conflicts[0].id;
    const initial = guidedReviewContext(plan, blockId);
    assert.strictEqual(guidedReviewContext(plan, blockId), initial,
        'an unchanged render reuses its complete context');
    assert.deepEqual({
        blockIndex: initial.blockIndex,
        groupIndex: initial.groupIndex,
        groupNumber: initial.groupNumber,
        decisionCount: initial.decisionCount,
        occurrenceIndex: initial.occurrenceIndex,
        grouped: initial.grouped,
        unresolvedOccurrences: initial.unresolvedOccurrences,
        unresolvedDecisions: initial.unresolvedDecisions,
        nextUnresolvedGroup: initial.nextUnresolvedGroup,
    }, {
        blockIndex: 0,
        groupIndex: 0,
        groupNumber: 1,
        decisionCount: 1,
        occurrenceIndex: 0,
        grouped: true,
        unresolvedOccurrences: 2,
        unresolvedDecisions: 1,
        nextUnresolvedGroup: null,
    });
    assert.doesNotThrow(() => structuredClone(initial),
        'the public context contains no private Map/WeakMap state or functions');

    assert.equal(resolveGuidedRepeatGroup(plan, blockId, 'primary').ok, true);
    const resolved = guidedReviewContext(plan, blockId);
    assert.notStrictEqual(resolved, initial);
    assert.equal(resolved.allResolved, true);
    assert.equal(resolved.unresolvedOccurrences, 0);
    assert.equal(resolved.unresolvedDecisions, 0);
    assert.equal(clearGuidedRepeatGroup(plan, blockId).ok, true);
    const cleared = guidedReviewContext(plan, blockId);
    assert.notStrictEqual(cleared, resolved);
    assert.equal(cleared.allResolved, false);
    assert.equal(cleared.unresolvedDecisions, 1);

    assert.equal(detachGuidedRepeatOccurrence(plan, plan.conflicts[1].id).ok, true);
    const detached = guidedReviewContext(plan, blockId);
    assert.equal(detached.decisionCount, 2);
    assert.equal(detached.grouped, false);
    assert.equal(detached.nextUnresolvedGroupIndex, 1);

    const clonedPlan = structuredClone(plan);
    const cloned = guidedReviewContext(clonedPlan, blockId);
    assert.equal(cloned.group.id, detached.group.id);
    assert.deepEqual(cloned.members.map(member => member.index), [0]);
});

test('Guided review cache follows direct resolutions when the unresolved count is unchanged', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(9, 0, 4)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 7)]),
        beats,
        sections: [{ name: 'Second', number: 2, start_time: 4 }],
        repeatMode: GUIDED_REPEAT_MODE_EVERY,
    });
    assert.equal(guidedReviewGroups(plan).length, 2);
    const [first, second] = plan.conflicts;
    assert.equal(resolveGuidedRepeatGroup(plan, first.id, 'primary').ok, true);
    const cached = guidedReviewContext(plan, first.id);
    assert.equal(cached.allResolved, true);
    assert.equal(cached.nextUnresolvedGroup.id,
        guidedReviewContext(plan, second.id).group.id);

    assert.equal(clearCompositeConflictResolution(plan, first.id).ok, true);
    assert.equal(resolveCompositeConflict(plan, second.id, 'primary').ok, true);
    assert.equal(plan.stats.unresolvedConflicts, 1,
        'the total returns to its cached value while the unresolved group moves');

    const refreshed = guidedReviewContext(plan, first.id);
    assert.notStrictEqual(refreshed, cached);
    assert.equal(refreshed.allResolved, false);
    assert.equal(refreshed.nextUnresolvedGroup, null);
    assert.equal(guidedReviewContext(plan, second.id).allResolved, true);
});

test('indexed Guided review context matches the legacy scans across randomized plans', () => {
    const random = seededRandom(0x5eed1234);
    for (let trial = 0; trial < 80; trial++) {
        const occurrenceCount = 3 + Math.floor(random() * 8);
        const localBeats = Array.from({ length: occurrenceCount * 8 + 9 }, (_, index) => ({
            time: index * 0.5,
            measure: index % 4 === 0 ? index / 4 + 1 : -1,
        }));
        const primaryNotes = [];
        const secondaryNotes = [];
        const sections = [];
        for (let occurrence = 0; occurrence < occurrenceCount; occurrence++) {
            const start = occurrence * 8;
            const variant = Math.floor(random() * 3);
            primaryNotes.push(note(start + 1, 0, 3 + variant));
            secondaryNotes.push(note(start + 1, 1, 7 + variant));
            if (occurrence) sections.push({
                name: 'Part', number: occurrence + 1, start_time: start * 0.5,
            });
        }
        const plan = analyzeGuidedComposite({
            primary: arrangement('Lead', primaryNotes),
            secondary: arrangement('Rhythm', secondaryNotes),
            beats: localBeats,
            sections,
            repeatMode: random() < 0.75
                ? GUIDED_REPEAT_MODE_MATCHING : GUIDED_REPEAT_MODE_EVERY,
        });
        for (const group of [...guidedReviewGroups(plan)]) {
            if (random() < 0.45) {
                assert.equal(resolveGuidedRepeatGroup(plan, group.representativeId, 'primary').ok, true);
            }
        }
        const detachable = guidedReviewGroups(plan).filter(group => group.memberIds.length > 1);
        if (detachable.length && random() < 0.35) {
            const group = detachable[Math.floor(random() * detachable.length)];
            const memberId = group.memberIds[1 + Math.floor(random() * (group.memberIds.length - 1))];
            assert.equal(detachGuidedRepeatOccurrence(plan, memberId).ok, true);
        }
        for (const block of plan.conflicts) {
            const expected = legacyGuidedReviewContext(plan, block.id);
            const actual = guidedReviewContext(plan, block.id);
            assert.deepEqual({
                blockIndex: actual.blockIndex,
                groupId: actual.group.id,
                groupIndex: actual.groupIndex,
                memberIndexes: actual.members.map(member => member.index),
                occurrenceIndex: actual.occurrenceIndex,
                grouped: actual.grouped,
                allResolved: actual.allResolved,
                unresolvedDecisions: actual.unresolvedDecisions,
                unresolvedConflicts: actual.unresolvedConflicts,
                nextIndex: actual.nextUnresolvedGroupIndex,
            }, expected, `trial ${trial}, block ${block.id}`);
        }
    }
});

test('Guided review context remains bounded on a 20k-decision plan', () => {
    const count = 20_000;
    const conflicts = Array.from({ length: count }, (_, index) => {
        const startBeat = index * 2;
        const entry = {
            id: `primary:${index}`,
            string: 0,
            fret: index,
            techniqueSignature: `unique:${index}`,
            startBeat,
            endBeat: startBeat,
            effectiveEndBeat: startBeat,
            playableStartBeat: startBeat,
            playableEndBeat: startBeat,
        };
        return {
            id: `guided:${index + 1}`,
            startBeat,
            repeatDetached: false,
            resolution: null,
            primaryEntries: [entry],
            secondaryEntries: [],
            cells: [{ barBoundary: true, startBeat, endBeat: startBeat + 1 }],
        };
    });
    const plan = {
        strategy: 'guided',
        repeatMode: GUIDED_REPEAT_MODE_EVERY,
        conflicts,
        beats: [],
        stats: { unresolvedConflicts: count },
    };
    const coldStart = performance.now();
    const middle = guidedReviewContext(plan, 'guided:10001');
    const coldElapsed = performance.now() - coldStart;
    assert.equal(middle.blockIndex, 10_000);
    assert.equal(middle.decisionCount, count);
    assert.ok(coldElapsed < 5_000, `20k index construction took ${coldElapsed.toFixed(1)} ms`);

    const cachedStart = performance.now();
    for (let index = 0; index < count; index++) {
        const context = guidedReviewContext(plan, `guided:${index + 1}`);
        assert.equal(context.blockIndex, index);
    }
    const cachedElapsed = performance.now() - cachedStart;
    assert.ok(cachedElapsed < 2_000,
        `20k cached context reads took ${cachedElapsed.toFixed(1)} ms`);
});

test('shared automatic notes may differ without creating a second review decision', () => {
    const sharedOnlyInSecondOccurrence = note(8, 0, 0, 0.5, { palm_mute: true });
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [
            note(1, 1, 3),
            sharedOnlyInSecondOccurrence,
            note(9, 1, 3),
        ]),
        secondary: arrangement('Rhythm', [
            note(1, 2, 5),
            structuredClone(sharedOnlyInSecondOccurrence),
            note(9, 2, 5),
        ]),
        beats,
        sections: [{ name: 'Verse', number: 2, start_time: 4 }],
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(plan.conflicts.length, 2);
    assert.deepEqual(plan.conflicts.map(block => block.cells
        .flatMap(cell => cell.commonEntries).length), [0, 1]);
    plan.repeatMode = GUIDED_REPEAT_MODE_EVERY;
    assert.equal(guidedReviewGroups(plan).length, 2,
        'the default occurrence-by-occurrence workflow remains available');
    plan.repeatMode = GUIDED_REPEAT_MODE_MATCHING;
    assert.equal(guidedReviewGroups(plan).length, 1,
        'fixed material cannot change the Lead-versus-Rhythm choice');

    const resolved = resolveGuidedRepeatGroup(plan, plan.conflicts[0].id, 'primary');
    assert.equal(resolved.ok, true);
    assert.equal(resolved.applied.length, 2);
    assert.deepEqual(materializeCompositeArrangement(plan, 'Shared-note repetitions')
        .notes.map(entry => entry.beat), [1, 8, 9],
    'the second occurrence keeps its own shared note without adding it to the first');
});

test('timing jitter across a bar boundary does not split a repeated review choice', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [
            note(1, 0, 3), note(4.001, 1, 7), note(6, 2, 10),
            note(9, 0, 3), note(11.999, 1, 7), note(14, 2, 10),
        ]),
        secondary: arrangement('Rhythm', [
            note(1, 3, 5), note(4.001, 4, 8), note(6, 5, 12),
            note(9, 3, 5), note(11.999, 4, 8), note(14, 5, 12),
        ]),
        beats,
        sections: [{ name: 'Riff', number: 2, start_time: 4 }],
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(plan.conflicts.length, 2);
    assert.deepEqual(plan.conflicts.map(block => block.cells
        .map(cell => cell.primaryEntries.length)), [[1, 2], [2, 1]],
    'the regression covers opposite exact cell buckets around the same boundary');
    assert.deepEqual(plan.conflicts.map(block => block.primaryEntries
        .map(entry => Number((entry.startBeat - block.startBeat).toFixed(3)))),
    [[1, 4.001, 6], [1, 3.999, 6]], 'the original attack timing remains intact');
    assert.equal(guidedReviewGroups(plan).length, 1);
    assert.equal(plan.stats.repeatedOccurrences, 1);
});

test('an extra choice-dependent note still prevents repetition grouping', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(9, 0, 3), note(10, 0, 7)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 5)]),
        beats,
        sections: [{ name: 'Riff', number: 2, start_time: 4 }],
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(plan.conflicts.length, 2);
    assert.equal(guidedReviewGroups(plan).length, 2);
    assert.equal(plan.stats.repeatedOccurrences, 0);
});

test('repetition matching rejects a technique or trail difference', () => {
    const techniquePlan = analyzeGuidedComposite({
        primary: arrangement('Lead', [
            note(1, 0, 3),
            note(9, 0, 3, 0, { bend: true }),
        ]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 5)]),
        beats,
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(techniquePlan.conflicts.length, 2);
    assert.equal(guidedReviewGroups(techniquePlan).length, 2);

    const trailPlan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3, 1), note(9, 0, 3, 1.1)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 5)]),
        beats,
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(trailPlan.conflicts.length, 2);
    assert.equal(guidedReviewGroups(trailPlan).length, 2);
    assert.equal(trailPlan.stats.repeatedOccurrences, 0);
});

test('custom selections map to occurrence-specific note ids', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [
            note(1, 0, 3, 0, { link_next: true }), note(2, 0, 5),
            note(9.003, 0, 3, 0, { link_next: true }), note(10.003, 0, 5),
        ]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9.003, 1, 5)]),
        beats,
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(guidedReviewGroups(plan).length, 1,
        'tiny relative timing differences stay inside the existing safety tolerance');
    const first = plan.conflicts[0];
    const result = resolveGuidedRepeatGroup(plan, first.id, 'custom', [first.primaryEntries[0].id]);
    assert.equal(result.ok, true);
    assert.equal(new Set(plan.conflicts.flatMap(block => block.selectedEntryIds)).size, 4);
    assert.deepEqual(plan.conflicts.map(block => block.selectedEntryIds), [
        ['primary:0', 'primary:1'],
        ['primary:2', 'primary:3'],
    ]);
});

test('an unsafe repeated occurrence falls back to individual transition review', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(9, 0, 3)]),
        secondary: arrangement('Rhythm', [
            note(1, 1, 5),
            note(7, 0, 7, 3),
            note(9, 1, 5),
        ]),
        beats,
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(guidedReviewGroups(plan).length, 1);
    const result = resolveGuidedRepeatGroup(plan, plan.conflicts[0].id, 'primary');
    assert.equal(result.partial, true);
    assert.equal(result.applied.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(plan.conflicts[0].resolution, 'primary');
    assert.equal(plan.conflicts[1].resolution, null);
    assert.equal(plan.conflicts[1].repeatDetached, true);
    assert.equal(plan.conflicts[1].validationKind, 'transition');
    assert.equal(guidedReviewGroups(plan).length, 2);
});

test('grouped bar splitting mirrors the relative split across repetitions', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [
            note(1, 0, 3), note(5, 0, 4),
            note(13, 0, 3), note(17, 0, 4),
        ]),
        secondary: arrangement('Rhythm', [
            note(1, 1, 5), note(5, 1, 6),
            note(13, 1, 5), note(17, 1, 6),
        ]),
        beats,
        sections: [{ name: 'Chorus', number: 2, start_time: 6 }],
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    assert.equal(plan.conflicts.length, 2);
    assert.equal(guidedReviewGroups(plan).length, 1);
    const split = splitGuidedRepeatGroup(plan, plan.conflicts[0].id, 4);
    assert.equal(split.ok, true);
    assert.equal(plan.conflicts.length, 4);
    assert.equal(guidedReviewGroups(plan).length, 2);
    assert.deepEqual(plan.conflicts.map(block => block.rangeEndBeat - block.startBeat), [4, 4, 4, 4]);
});

test('a matching occurrence can be detached for individual review', () => {
    const plan = analyzeGuidedComposite({
        primary: arrangement('Lead', [note(1, 0, 3), note(9, 0, 3)]),
        secondary: arrangement('Rhythm', [note(1, 1, 5), note(9, 1, 5)]),
        beats,
        repeatMode: GUIDED_REPEAT_MODE_MATCHING,
    });
    const detached = detachGuidedRepeatOccurrence(plan, plan.conflicts[1].id);
    assert.equal(detached.ok, true);
    assert.equal(plan.conflicts[1].repeatDetached, true);
    assert.equal(guidedReviewGroups(plan).length, 2);
});
