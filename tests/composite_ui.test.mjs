import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { renderHybridSetupView } from '../src/composite/setup-view.js';
import {
    beginHybridCreation,
    cancelHybridCreation,
    completeHybridCreation,
    createHybridBuilderSession,
    hybridCloseAction,
    hybridCloseGuardKind,
    hybridCreationIsCurrent,
    markHybridReviewWork,
    resetHybridBuilderReview,
} from '../src/composite/session.js';

const sources = [
    { index: 0, arrangement: { name: '<Lead>' } },
    { index: 1, arrangement: { name: 'Rhythm' } },
];

test('Hybrid review uses one responsive sticky toolbar instead of a side or below panel', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const theme = fs.readFileSync(new URL('../assets/v3-theme.css', import.meta.url), 'utf8');
    assert.match(resolver, /editor-composite-review-toolbar/);
    assert.match(resolver, /Decision details/);
    assert.match(resolver, /renderCompositeTimelineWorkspace\(timelineView, false, reviewToolbar\)/);
    assert.match(resolver, /editor-composite-review-details-open-up/);
    assert.match(resolver, /panel\.style\.maxHeight/);
    assert.doesNotMatch(resolver, /editor-composite-decision-panel|editor-composite-review-shell/);
    assert.match(theme, /\.editor-composite-review-toolbar/);
    assert.match(theme, /@media \(max-width: 56rem\)/);
    assert.match(theme, /@media \(max-height: 44rem\)/);
    assert.doesNotMatch(theme, /editor-composite-decision-panel|editor-composite-review-shell/);
});

test('Hybrid playback keeps heavy rendering off the per-frame follow path and shares seek state', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    assert.match(resolver, /compositeTimelineRenderWindowNeedsRefreshPure/);
    assert.match(resolver, /function seekCompositeTimelineAtTime/);
    assert.match(resolver,
        /seekCompositeTimelineAtTime\(region\.startTime,\s*\{\s*center:\s*true/);
    assert.match(resolver, /voiceCap:\s*hybridSession\.plan\.compatibility\.stringCount/);
    const playheadStart = resolver.indexOf('function updateCompositeTimelinePlayhead');
    const playheadEnd = resolver.indexOf('function startCompositeTimelinePlayhead', playheadStart);
    const playheadBody = resolver.slice(playheadStart, playheadEnd);
    assert.doesNotMatch(playheadBody, /innerHTML\s*=/,
        'the animation frame may move geometry but never regenerate note markup');
    assert.match(playheadBody, /applyCompositeTimelineCamera\(dom, visualScroll, x\)/,
        'the per-frame path delegates every moving layer to the shared compositor camera');
    assert.match(resolver, /dom\.playhead\.style\.transform\s*=\s*`translate3d/,
        'the moving playhead stays on the compositor instead of invalidating layout');
    assert.doesNotMatch(playheadBody, /playhead\.style\.left\s*=/);
});

test('Hybrid setup presents the two player-facing workflows and escapes song data', () => {
    const html = renderHybridSetupView({
        sources,
        name: 'Hybrid "One"',
        gapFillUnit: 'beats',
        gapFillValues: { minimumGap: 1, transitionMargin: 0.25 },
        guidedRepeatMode: 'matching-repetitions',
    });
    assert.match(html, /Base track — starting arrangement/);
    assert.match(html, /id="editor-composite-swap-sources"/);
    assert.match(html, /Rhythm · Guitar/);
    assert.match(html, />Automatic</);
    assert.match(html, />Review sections yourself</);
    assert.match(html, /Review matching riffs once \(recommended\)[^<]*<\/option>/);
    assert.match(html, /Advanced safety settings/);
    assert.match(html, /Experimental smart fill/);
    assert.match(html, /Use experimental smart fill/);
    assert.match(html, /<details id="editor-composite-experimental-controls"/);
    assert.doesNotMatch(html, /<details id="editor-composite-experimental-controls"[^>]* open/,
        'experimental settings stay collapsed until the user opts in');
    assert.match(html, /Balanced — recommended/);
    assert.match(html, /id="editor-composite-experimental-profile-controls" hidden/,
        'experimental controls stay collapsed until the user opts in');
    assert.match(html, /id="editor-composite-setup" class="min-h-0 overflow-y-auto/,
        'the setup body must shrink and scroll so the fixed footer stays visible');
    assert.match(html, /&lt;Lead&gt;/);
    assert.match(html, /Hybrid &quot;One&quot;/);
    assert.doesNotMatch(html, /Primary track|Secondary track|strategy skips|compatible-union/i);
});

test('Hybrid setup restores an opted-in experimental profile explicitly', () => {
    const html = renderHybridSetupView({
        sources,
        gapFillValues: { minimumGap: 1, transitionMargin: 0.25 },
        experimentalEnabled: true,
        experimentalProfile: 'fill-more',
    });
    assert.match(html, /id="editor-composite-experimental" type="checkbox" checked/);
    assert.doesNotMatch(html, /id="editor-composite-experimental-profile-controls" hidden/);
    assert.match(html, /value="fill-more" selected/);
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
    session.stage = 'final-preview';
    session.conflictIndex = 4;
    session.customDrafts.set('guided:1', ['primary:1']);
    session.previewRestore = { cursorTime: 12 };
    session.previewLoading = true;
    session.previewRecordingGain = 0.25;
    session.wholeSongLoop = true;
    session.timelineSeekTime = 18;
    session.timelineScrollLeft = 420;
    session.timelineFocusReview = true;
    session.timelineFocusPassage = true;
    session.timelineFollowSuspended = true;
    session.inspectedPassageId = 'experimental:passage:2';
    session.passageFilter = 'review';
    session.previewLastMode = 'secondary';
    session.analysisConfig = { strategy: 'guided' };
    session.setupDirty = true;
    session.setupDirtyMessage = 'Changed';
    session.analyzing = true;
    const requestId = session.previewRequestId;
    resetHybridBuilderReview(session);
    assert.equal(session.plan, null);
    assert.equal(session.stage, 'setup');
    assert.equal(session.conflictIndex, 0);
    assert.equal(session.customDrafts.size, 0);
    assert.equal(session.previewLoading, false);
    assert.equal(session.previewRecordingGain, 1);
    assert.equal(session.wholeSongLoop, false);
    assert.equal(session.timelineSeekTime, 0);
    assert.equal(session.timelineScrollLeft, 0);
    assert.equal(session.timelineFocusReview, false);
    assert.equal(session.timelineFocusPassage, false);
    assert.equal(session.timelineFollowSuspended, false);
    assert.equal(session.inspectedPassageId, '');
    assert.equal(session.passageFilter, 'all');
    assert.equal(session.previewLastMode, 'song');
    assert.equal(session.analysisConfig, null);
    assert.equal(session.setupDirty, false);
    assert.equal(session.setupDirtyMessage, '');
    assert.equal(session.analyzing, false);
    assert.equal(session.previewRequestId, requestId + 1);
    assert.deepEqual(session.previewRestore, { cursorTime: 12 });
});

test('only meaningful Guided choices require a discard-review confirmation', () => {
    const session = createHybridBuilderSession();
    session.plan = { strategy: 'gap-fill' };
    assert.equal(markHybridReviewWork(session), false,
        'automatic previews do not create review work');
    assert.equal(hybridCloseGuardKind(session), 'none');

    session.plan = { strategy: 'guided' };
    assert.equal(markHybridReviewWork(session), true);
    assert.equal(hybridCloseGuardKind(session), 'review');

    resetHybridBuilderReview(session);
    assert.equal(session.hasReviewWork, false);
    assert.equal(hybridCloseGuardKind(session), 'none');
});

test('experimental review choices use the same discard guard without affecting Standard Automatic', () => {
    const session = createHybridBuilderSession();
    session.plan = { strategy: 'experimental', conflicts: [{ id: 'passage:1' }] };
    assert.equal(markHybridReviewWork(session), true);
    assert.equal(hybridCloseGuardKind(session), 'review');
    resetHybridBuilderReview(session);
    session.plan = { strategy: 'experimental', conflicts: [] };
    assert.equal(markHybridReviewWork(session), false);
    assert.equal(hybridCloseGuardKind(session), 'none');
});

test('Hybrid close choices preserve work unless discard is explicit', () => {
    assert.equal(hybridCloseAction('none', null), 'close');
    assert.equal(hybridCloseAction('review', null), 'keep');
    assert.equal(hybridCloseAction('review', 'keep'), 'keep');
    assert.equal(hybridCloseAction('review', 'discard'), 'discard-review');
    assert.equal(hybridCloseAction('creating', null), 'keep');
    assert.equal(hybridCloseAction('creating', 'discard'), 'cancel-creation');
});

test('Hybrid creation accepts one request and rejects double creation', () => {
    const session = createHybridBuilderSession();
    const plan = { strategy: 'guided' };
    session.plan = plan;
    const request = beginHybridCreation(session, { sessionId: 'song-a', plan });
    assert.ok(request);
    assert.equal(hybridCloseGuardKind(session), 'creating');
    assert.equal(beginHybridCreation(session, { sessionId: 'song-a', plan }), null);
    assert.equal(hybridCreationIsCurrent(session, request, {
        sessionId: 'song-a', plan,
    }), true);
    assert.equal(completeHybridCreation(session, request), true);
    assert.equal(hybridCreationIsCurrent(session, request, {
        sessionId: 'song-a', plan,
    }), false);
});

test('Hybrid creation becomes stale after a song switch or plan replacement', () => {
    const session = createHybridBuilderSession();
    const plan = { strategy: 'guided' };
    session.plan = plan;
    const request = beginHybridCreation(session, { sessionId: 'song-a', plan });
    assert.equal(hybridCreationIsCurrent(session, request, {
        sessionId: 'song-b', plan,
    }), false, 'a delayed response cannot enter another song');
    assert.equal(hybridCreationIsCurrent(session, request, {
        sessionId: 'song-a', plan: { strategy: 'guided' },
    }), false, 'a delayed response cannot enter a replacement plan');
});

test('cancelling Hybrid creation aborts and permanently invalidates its request', () => {
    const session = createHybridBuilderSession();
    const plan = { strategy: 'guided' };
    session.plan = plan;
    const request = beginHybridCreation(session, { sessionId: 'song-a', plan });
    assert.equal(request.controller.signal.aborted, false);
    assert.equal(cancelHybridCreation(session), true);
    assert.equal(request.controller.signal.aborted, true);
    assert.equal(hybridCreationIsCurrent(session, request, {
        sessionId: 'song-a', plan,
    }), false);
    assert.equal(cancelHybridCreation(session), false,
        'repeated close/cancel actions are harmless');
});

test('a stale Hybrid response cannot complete a newer creation request', () => {
    const session = createHybridBuilderSession();
    const firstPlan = { strategy: 'guided', version: 1 };
    const secondPlan = { strategy: 'guided', version: 2 };
    const first = beginHybridCreation(session, {
        sessionId: 'song-a', plan: firstPlan,
    });
    cancelHybridCreation(session);
    const second = beginHybridCreation(session, {
        sessionId: 'song-a', plan: secondPlan,
    });
    assert.equal(completeHybridCreation(session, first), false);
    assert.equal(hybridCreationIsCurrent(session, second, {
        sessionId: 'song-a', plan: secondPlan,
    }), true);
});
