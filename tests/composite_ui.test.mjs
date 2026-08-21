import assert from 'node:assert/strict';
import test from 'node:test';

import { renderHybridSetupView } from '../src/composite/setup-view.js';
import { createHybridBuilderSession, resetHybridBuilderReview } from '../src/composite/session.js';

const sources = [
    { index: 0, arrangement: { name: '<Lead>' } },
    { index: 1, arrangement: { name: 'Rhythm' } },
];

test('Hybrid setup presents the two player-facing workflows and escapes song data', () => {
    const html = renderHybridSetupView({
        sources,
        name: 'Hybrid "One"',
        gapFillUnit: 'beats',
        gapFillValues: { minimumGap: 1, transitionMargin: 0.25 },
        guidedRepeatMode: 'matching-repetitions',
    });
    assert.match(html, /Base track — always kept/);
    assert.match(html, />Automatic</);
    assert.match(html, />Review sections yourself</);
    assert.match(html, /Review matching riffs once \(recommended\)[^<]*<\/option>/);
    assert.match(html, /Advanced safety settings/);
    assert.match(html, /&lt;Lead&gt;/);
    assert.match(html, /Hybrid &quot;One&quot;/);
    assert.doesNotMatch(html, /Primary track|Secondary track|strategy skips|compatible-union/i);
});

test('Hybrid setup remembers explicit review-every-occurrence preference', () => {
    const html = renderHybridSetupView({
        sources,
        gapFillValues: { minimumGap: 1, transitionMargin: 0.25 },
        guidedRepeatMode: 'every-occurrence',
    });
    assert.match(html, /value="every-occurrence" selected/);
    assert.doesNotMatch(html, /value="matching-repetitions" selected/);
});

test('Hybrid builder session reset clears review state without losing preview restoration', () => {
    const session = createHybridBuilderSession();
    session.plan = { ok: true };
    session.conflictIndex = 4;
    session.customDrafts.set('guided:1', ['primary:1']);
    session.previewRestore = { cursorTime: 12 };
    session.previewLoading = true;
    session.previewRecordingGain = 0.25;
    const requestId = session.previewRequestId;
    resetHybridBuilderReview(session);
    assert.equal(session.plan, null);
    assert.equal(session.conflictIndex, 0);
    assert.equal(session.customDrafts.size, 0);
    assert.equal(session.previewLoading, false);
    assert.equal(session.previewRecordingGain, 1);
    assert.equal(session.previewRequestId, requestId + 1);
    assert.deepEqual(session.previewRestore, { cursorTime: 12 });
});
