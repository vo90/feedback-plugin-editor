import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCompositeConflictViewModel,
    buildCompositeReviewToolbarModel,
    compositeConflictContextPure,
    compositeTechniqueLabels,
    renderCompositeDifferenceTable,
} from '../src/composite/conflict-view.js';
import { resolveCompositeConflict } from '../src/composite/merge-engine.js';
import { analyzeGuidedComposite } from '../src/composite/guided-engine.js';

const beats = Array.from({ length: 25 }, (_, index) => ({
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
const arrangement = (name, notes) => ({
    name,
    type: 'guitar',
    tuning: [0, 0, 0, 0, 0, 0],
    capo: 0,
    notes,
    chords: [],
    chord_templates: [],
});
function conflictPlan(primaryNotes = [], secondaryNotes = []) {
    return analyzeGuidedComposite({
        primary: arrangement('Lead', primaryNotes),
        secondary: arrangement('Rhythm', secondaryNotes),
        beats,
    });
}

test('conflict context includes one full measure on either side', () => {
    assert.deepEqual(compositeConflictContextPure(beats, { startBeat: 8.5, endBeat: 10 }), {
        startBeat: 4,
        endBeat: 16,
        measureMarkers: [
            { beat: 4, measure: 2 },
            { beat: 8, measure: 3 },
            { beat: 12, measure: 4 },
            { beat: 16, measure: 5 },
        ],
    });
});

test('view model keeps synchronized source context and an honest unresolved result', () => {
    const plan = conflictPlan(
        [note(5, 2, 3), note(9, 0, 7, 2, { tremolo: true })],
        [note(6, 3, 5), note(10, 0, 5, 1)],
    );
    const view = buildCompositeConflictViewModel({
        plan,
        primaryName: 'Lead',
        secondaryName: 'Rhythm',
    });
    assert.equal(view.explanation,
        'Both tracks play different parts here. Choose a track, or mix the notes yourself.');
    assert.deepEqual(view.lanes[0].entries.map(entry => entry.fret), [3, 7]);
    assert.deepEqual(view.lanes[1].entries.map(entry => entry.fret), [5, 5]);
    assert.deepEqual(view.lanes[2].entries.map(entry => entry.fret), []);
    assert.equal(view.lanes[2].entries.some(entry => entry.inConflict), false);

    resolveCompositeConflict(plan, plan.conflicts[0].id, 'primary');
    const resolved = buildCompositeConflictViewModel({ plan, primaryName: 'Lead', secondaryName: 'Rhythm' });
    assert.equal(resolved.lanes[2].entries.some(entry => entry.fret === 7 && entry.inConflict), true);
});

test('custom source notes are keyboard-selectable and invalid drafts stay visible', () => {
    const plan = conflictPlan([note(8, 1, 3, 2)], [note(9, 1, 7, 1)]);
    const conflict = plan.conflicts[0];
    const bothIds = [...conflict.primaryEntries, ...conflict.secondaryEntries].map(entry => entry.id);
    assert.equal(resolveCompositeConflict(plan, conflict.id, 'custom', bothIds).ok, false);
    const view = buildCompositeConflictViewModel({
        plan,
        primaryName: 'Lead',
        secondaryName: 'Rhythm',
        customEntryIds: bothIds,
    });
    assert.equal(view.invalid, true);
    assert.equal(view.lanes[2].entries.filter(entry => entry.invalid).length, 2);
    assert.equal(view.lanes[0].entries[0].selectable, true);
    assert.equal(view.lanes[0].entries[0].selected, true);
    assert.equal(view.lanes[2].label, 'Hybrid result');
    assert.equal(view.lanes[2].subtitle, 'Your current choice');
});

test('note variants provide a compact escaped property comparison', () => {
    const plan = conflictPlan(
        [note(8, 0, 7, 1, { palm_mute: true, future_expression: '<soft>' })],
        [note(8, 0, 7, 2, { vibrato: true })],
    );
    const view = buildCompositeConflictViewModel({
        plan,
        primaryName: '<Lead>',
        secondaryName: 'Rhythm',
    });
    assert.deepEqual(compositeTechniqueLabels(plan.conflicts[0].primaryEntries[0].note),
        ['Future Expression', 'Palm mute']);
    assert.ok(view.differences.some(difference => difference.property === 'Sustain'));
    assert.ok(view.differences.some(difference => difference.property === 'Techniques'));
    assert.match(renderCompositeDifferenceTable(view), /&lt;Lead&gt;/);
    assert.doesNotMatch(renderCompositeDifferenceTable(view), /<Lead>/);
});

test('review toolbar model keeps compact Guided choice and manual-selection state together', () => {
    const plan = conflictPlan([note(8, 1, 3)], [note(9, 2, 7)]);
    const conflict = plan.conflicts[0];
    const primaryId = conflict.primaryEntries[0].id;
    const model = buildCompositeReviewToolbarModel({
        plan,
        conflict,
        primaryName: 'Lead',
        secondaryName: 'Rhythm',
        customEntryIds: [primaryId],
        decisionNumber: 2,
        decisionTotal: 6,
        unresolvedDecisions: 4,
        repeatCount: 3,
        canReset: true,
    });
    assert.deepEqual(model.choices.map(choice => choice.label),
        ['Use Lead', 'Use Rhythm', 'Mix notes']);
    assert.equal(model.resolution, 'custom');
    assert.equal(model.selectedLaneId, 'result');
    assert.equal(model.primarySelected, 1);
    assert.equal(model.secondarySelected, 0);
    assert.equal(model.repeatCount, 3);
    assert.equal(model.canReset, true);
    assert.equal(model.canContinue, false,
        'an invalid or incomplete draft cannot continue until the resolver accepts it');
});
