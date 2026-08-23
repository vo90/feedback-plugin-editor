import assert from 'node:assert/strict';
import test from 'node:test';

import {
    beginHybridAnalysis,
    beginHybridCreation,
    createHybridBuilderSession,
    hybridAnalysisIsCurrent,
    hybridCreationIsCurrent,
    hybridPlanSessionIsCurrent,
    installHybridPlan,
    resetHybridBuilderReview,
} from '../src/composite/session.js';

test('Hybrid session retains a separate Notes scroll position and resets it with review state', () => {
    const session = createHybridBuilderSession();
    assert.equal(session.timelineScrollLeft, 0);
    assert.equal(session.timelineNotesScrollLeft, 0);

    session.timelineScrollLeft = 320;
    session.timelineNotesScrollLeft = 640;
    resetHybridBuilderReview(session);

    assert.equal(session.timelineScrollLeft, 0);
    assert.equal(session.timelineNotesScrollLeft, 0);
});

test('Hybrid plans retain their analysis-song ownership and reset it with review state', () => {
    const session = createHybridBuilderSession();
    const plan = { ok: true };

    const sourceGuard = { source: 'guard' };
    installHybridPlan(session, plan, 'song-a', 7, sourceGuard);
    assert.equal(session.planSessionId, 'song-a');
    assert.equal(session.planEditGeneration, 7);
    assert.equal(session.planSourceGuard, sourceGuard);
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-a', format: 'sloppak', editGeneration: 7,
    }), true);
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-b', format: 'sloppak', editGeneration: 7,
    }), false, 'the plan cannot move into another open song');
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-a', format: 'rocksmith', editGeneration: 7,
    }), false, 'the plan cannot survive an incompatible format change');
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-a', format: 'sloppak', editGeneration: 8,
    }), false, 'the plan cannot survive an in-place Editor edit');

    resetHybridBuilderReview(session);
    assert.equal(session.plan, null);
    assert.equal(session.planSessionId, null);
    assert.equal(session.planEditGeneration, null);
    assert.equal(session.planSourceGuard, null);
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-a', format: 'sloppak',
    }), false);
});

test('Hybrid background requests become stale after an in-place Editor edit', () => {
    const session = createHybridBuilderSession();
    const sourceGuard = { sources: true };
    const analysis = beginHybridAnalysis(session, {
        sessionId: 'song-a', configToken: 'guided', editGeneration: 11, sourceGuard,
    });
    assert.equal(hybridAnalysisIsCurrent(session, analysis, {
        sessionId: 'song-a', configToken: 'guided', editGeneration: 11, sourceGuard,
    }), true);
    assert.equal(hybridAnalysisIsCurrent(session, analysis, {
        sessionId: 'song-a', configToken: 'guided', editGeneration: 12, sourceGuard,
    }), false);
    assert.equal(hybridAnalysisIsCurrent(session, analysis, {
        sessionId: 'song-a', configToken: 'guided', editGeneration: 11,
        sourceGuard: { sources: true },
    }), false, 'a replaced direct-source guard invalidates the request');

    analysis.controller.abort();
    session.analyzing = false;
    const plan = { ok: true };
    const creation = beginHybridCreation(session, {
        sessionId: 'song-a', plan, editGeneration: 11,
    });
    assert.equal(hybridCreationIsCurrent(session, creation, {
        sessionId: 'song-a', plan, editGeneration: 11,
    }), true);
    assert.equal(hybridCreationIsCurrent(session, creation, {
        sessionId: 'song-a', plan, editGeneration: 12,
    }), false);
});
