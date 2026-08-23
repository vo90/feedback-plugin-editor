import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHybridBuilderSession,
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

    installHybridPlan(session, plan, 'song-a');
    assert.equal(session.planSessionId, 'song-a');
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-a', format: 'sloppak',
    }), true);
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-b', format: 'sloppak',
    }), false, 'the plan cannot move into another open song');
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-a', format: 'rocksmith',
    }), false, 'the plan cannot survive an incompatible format change');

    resetHybridBuilderReview(session);
    assert.equal(session.plan, null);
    assert.equal(session.planSessionId, null);
    assert.equal(hybridPlanSessionIsCurrent(session, {
        sessionId: 'song-a', format: 'sloppak',
    }), false);
});
