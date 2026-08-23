import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
    buildCompositeConflictViewModel,
    createCompositeConflictViewIndex,
} from '../src/composite/conflict-view.js';
import {
    compositeReviewResultEntries,
    createCompositeBaseTimelineCache,
} from '../src/composite/review-model-cache.js';
import {
    buildCompositeTimelineViewModel,
    compositeTimelineOverviewIntervalIndexPure,
    renderCompositeTimelineMapSvg,
} from '../src/composite/timeline-view.js';

function noteEntry(id, startBeat, string, fret, source) {
    return {
        id,
        source,
        startBeat,
        endBeat: startBeat + 0.5,
        effectiveEndBeat: startBeat + 0.5,
        string,
        fret,
        note: { techniques: {} },
    };
}

function largeGuidedPlan(count = 20_000) {
    const beats = Array.from({ length: count + 8 }, (_, index) => ({
        time: index * 0.5,
        measure: index % 4 === 0 ? index / 4 + 1 : 0,
    }));
    const primary = [];
    const secondary = [];
    const conflicts = [];
    for (let index = 0; index < count; index++) {
        const startBeat = index + 0.125;
        const primaryEntry = noteEntry(
            `primary:${index}`, startBeat, index % 6, index % 24, 'primary');
        const secondaryEntry = noteEntry(
            `secondary:${index}`, startBeat + 0.125, index % 6,
            (index + 7) % 24, 'secondary');
        primary.push(primaryEntry);
        secondary.push(secondaryEntry);
        conflicts.push({
            id: `decision:${index}`,
            label: `Bar ${Math.floor(index / 4) + 1}`,
            startBeat,
            endBeat: startBeat + 0.75,
            reasons: ['guided-choice'],
            primaryEntries: [primaryEntry],
            secondaryEntries: [secondaryEntry],
            selectedEntryIds: [],
            resolution: null,
            validationError: '',
        });
    }
    return {
        ok: true,
        beats,
        compatibility: { stringCount: 6 },
        fixedEntries: [],
        sourceEntries: { primary, secondary },
        conflicts,
        duplicates: [],
        skippedEntries: [],
    };
}

test('base timeline cache follows immutable plan signatures and explicit invalidation', () => {
    const cache = createCompositeBaseTimelineCache();
    const plan = {};
    const beats = [];
    let builds = 0;
    const build = () => ({ build: ++builds });

    const first = cache.get(plan, [beats, 0, 'Base'], build);
    assert.strictEqual(cache.get(plan, [beats, 0, 'Base'], build), first);
    const changed = cache.get(plan, [beats, 1, 'Base'], build);
    assert.notStrictEqual(changed, first,
        'a new resolution signature replaces the immutable base model');
    assert.equal(builds, 2);

    cache.invalidate(plan);
    assert.notStrictEqual(cache.get(plan, [beats, 1, 'Base'], build), changed,
        'structural plan changes can explicitly discard the cached base model');
    assert.equal(builds, 3);
});

test('twenty-thousand-decision guided navigation reuses immutable review models', t => {
    const plan = largeGuidedPlan();
    const resolvedEntries = [];
    const baseCache = createCompositeBaseTimelineCache();
    let baseBuilds = 0;
    const signature = [
        plan.beats,
        plan.sourceEntries.primary,
        plan.sourceEntries.secondary,
        plan.conflicts,
        resolvedEntries,
    ];

    const coldStarted = performance.now();
    const modelIndex = createCompositeConflictViewIndex({ plan, resolvedEntries });
    const baseTimeline = baseCache.get(plan, signature, () => {
        baseBuilds++;
        return buildCompositeTimelineViewModel({
            plan,
            primaryName: 'Base',
            secondaryName: 'Fill',
            resultEntries: resolvedEntries,
            resultEntriesPrepared: true,
        });
    });
    const coldElapsed = performance.now() - coldStarted;

    const visits = 1_000;
    let checksum = 0;
    const navigationStarted = performance.now();
    for (let visit = 0; visit < visits; visit++) {
        // A coprime stride exercises distant Previous/Next/continue targets
        // instead of benefiting from accidental sequential locality.
        const conflictIndex = (visit * 7_919) % plan.conflicts.length;
        const conflictView = buildCompositeConflictViewModel({
            plan,
            conflictIndex,
            primaryName: 'Base',
            secondaryName: 'Fill',
            modelIndex,
            resolvedEntries,
        });
        const sharedBase = baseCache.get(plan, signature, () => {
            baseBuilds++;
            return buildCompositeTimelineViewModel({ plan, resultEntries: resolvedEntries,
                resultEntriesPrepared: true });
        });
        const localResult = conflictView.lanes.find(lane => lane.id === 'result').entries;
        const baseResult = sharedBase.lanes.find(lane => lane.id === 'result').entries;
        const resultEntries = compositeReviewResultEntries(baseResult, localResult);
        const annotations = new Map(conflictView.lanes.flatMap(lane => lane.entries
            .map(entry => [`${lane.id}:${entry.id}`, entry])));
        const reviewView = {
            ...sharedBase,
            wholeSong: false,
            review: { id: conflictView.conflict.id,
                startBeat: conflictView.conflict.startBeat,
                endBeat: conflictView.conflict.endBeat },
            entryAnnotations: annotations,
        };
        checksum += reviewView.entryAnnotations.size + resultEntries.length
            + conflictView.context.measureMarkers.length;
        assert.strictEqual(sharedBase.lanes[0].entries,
            baseTimeline.lanes[0].entries, 'source lane identity remains stable');
    }
    const navigationElapsed = performance.now() - navigationStarted;

    const overviewView = {
        ...baseTimeline,
        review: { id: plan.conflicts[0].id },
    };
    const overviewIndex = compositeTimelineOverviewIntervalIndexPure(overviewView);
    const overviewMarkup = renderCompositeTimelineMapSvg(overviewView);
    const overviewReuseStarted = performance.now();
    for (let visit = 0; visit < visits; visit++) {
        const conflictIndex = (visit * 7_919) % plan.conflicts.length;
        const focusedView = {
            ...overviewView,
            review: { id: plan.conflicts[conflictIndex].id },
        };
        assert.strictEqual(
            compositeTimelineOverviewIntervalIndexPure(focusedView), overviewIndex);
        assert.equal(renderCompositeTimelineMapSvg(focusedView), overviewMarkup);
    }
    const overviewReuseElapsed = performance.now() - overviewReuseStarted;

    assert.equal(baseBuilds, 1,
        'the 20k decision list and whole-song lane arrays are materialized once');
    assert.ok(checksum > visits, 'every distant decision produced a local review overlay');
    // Local runs are normally ~25–70 ms cold and ~35–120 ms for all 1,000
    // moves. Leave ample shared/coverage-CI headroom while still rejecting the
    // former multi-second O(song entries + all decisions) work on every move.
    assert.ok(coldElapsed < 750,
        `20k immutable review indexes should build promptly (${coldElapsed.toFixed(1)} ms)`);
    assert.ok(navigationElapsed < 750,
        `1,000 distant decision moves should stay bounded (${navigationElapsed.toFixed(1)} ms)`);
    assert.ok(overviewReuseElapsed < 250,
        `1,000 focus-only overview lookups should reuse static projections (${overviewReuseElapsed.toFixed(1)} ms)`);
    t.diagnostic(`20k cold index/base ${coldElapsed.toFixed(1)} ms; `
        + `1,000 distant moves ${navigationElapsed.toFixed(1)} ms; `
        + `1,000 overview reuses ${overviewReuseElapsed.toFixed(1)} ms; `
        + `base builds ${baseBuilds}`);
});
