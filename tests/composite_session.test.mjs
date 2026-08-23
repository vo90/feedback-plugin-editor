import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createHybridBuilderSession,
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
