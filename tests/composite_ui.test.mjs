import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { renderHybridSetupView } from '../src/composite/setup-view.js';
import {
    beginHybridAnalysis,
    beginHybridCreation,
    cancelHybridAnalysis,
    cancelHybridCreation,
    completeHybridAnalysis,
    completeHybridCreation,
    createHybridBuilderSession,
    hybridAnalysisIsCurrent,
    hybridCloseAction,
    hybridCloseGuardKind,
    hybridCreationIsCurrent,
    markHybridReviewWork,
    installHybridPlan,
    markHybridResolutionChanged,
    markHybridViewChanged,
    resetHybridBuilderReview,
} from '../src/composite/session.js';
import { createHybridPreferenceWriter } from '../src/composite/preferences.js';

const sources = [
    { index: 0, arrangement: { name: '<Lead>' } },
    { index: 1, arrangement: { name: 'Rhythm' } },
];

test('continuous Hybrid preferences persist once with the latest live value', () => {
    const saved = [];
    const timers = new Map();
    let nextTimer = 0;
    const writer = createHybridPreferenceWriter(value => {
        saved.push(value);
        return value;
    }, {
        setTimer(callback) {
            const id = ++nextTimer;
            timers.set(id, callback);
            return id;
        },
        clearTimer(id) { timers.delete(id); },
    });
    writer.schedule({ volume: 20 });
    writer.schedule({ volume: 30 });
    writer.schedule({ volume: 40 });
    assert.equal(writer.pending(), true);
    assert.equal(timers.size, 1);
    writer.flush();
    assert.deepEqual(saved, [{ volume: 40 }]);
    assert.equal(writer.pending(), false);
    assert.equal(timers.size, 0);
});

test('Hybrid review uses one responsive sticky toolbar instead of a side or below panel', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const theme = fs.readFileSync(new URL('../assets/composite/hybrid.css', import.meta.url), 'utf8');
    assert.match(resolver, /editor-composite-review-toolbar/);
    assert.match(resolver, /Decision details/);
    assert.match(resolver,
        /renderCompositeTimelineWorkspace\(\s*presentation\.timelineView, false, presentation\.reviewToolbar\)/);
    assert.match(resolver, /editor-composite-review-details-open-up/);
    assert.match(resolver, /panel\.style\.maxHeight/);
    assert.doesNotMatch(resolver, /editor-composite-decision-panel|editor-composite-review-shell/);
    assert.match(theme, /\.editor-composite-review-toolbar/);
    assert.match(theme, /@media \(max-width: 56rem\)/);
    assert.match(theme, /@media \(max-height: 44rem\)/);
    assert.match(resolver, /id="editor-composite-edit-settings">Adjust settings<\/button>/,
        'the only secondary review action is a direct button');
    assert.doesNotMatch(resolver, /editor-composite-review-more/);
    assert.doesNotMatch(theme, /editor-composite-review-more/);
    assert.doesNotMatch(theme, /editor-composite-decision-panel|editor-composite-review-shell/);
});

test('same-decision Hybrid choices retain the workspace and update its live model', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const refreshStart = resolver.indexOf('function refreshCurrentCompositeReview');
    const refreshEnd = resolver.indexOf('\nfunction renderResult', refreshStart);
    const refreshBody = resolver.slice(refreshStart, refreshEnd);
    assert.match(refreshBody,
        /previousToolbar\.replaceWith\(nextToolbar\)[\s\S]*scheduleCompositeReviewTimelineRefresh/,
        'the same workspace receives a fresh toolbar before its live view refresh');
    const timelineRefreshStart = resolver.indexOf(
        'function scheduleCompositeReviewTimelineRefresh');
    const timelineRefreshEnd = resolver.indexOf(
        '\n// Choices, manual-note edits', timelineRefreshStart);
    const timelineRefreshBody = resolver.slice(timelineRefreshStart, timelineRefreshEnd);
    assert.match(refreshBody,
        /captureCompositeReviewUi[\s\S]*restoreCompositeReviewUi/,
        'focus, open details, and workspace scroll survive the toolbar replacement');
    assert.match(timelineRefreshBody,
        /requestAnimationFrame[\s\S]*requestAnimationFrame[\s\S]*dom\.view = presentation\.timelineView/,
        'full-song model work starts only after the compact decision state can paint');
    assert.match(timelineRefreshBody,
        /refreshCompositeTimelineStaticMap[\s\S]*scheduleCompositeTimelineStandby/,
        'the bounded map updates before dense lanes render through the hidden camera');
    assert.match(timelineRefreshBody,
        /refreshCompositePlanDerivedState\(plan\)[\s\S]*freshnessDeadlineAt:[\s\S]*\+ 240[\s\S]*onCommitted/,
        'choice feedback has a bounded visible-lane commit');
    assert.doesNotMatch(refreshBody, /result\.innerHTML\s*=/,
        'same-decision input never replaces the full result DOM');
    assert.doesNotMatch(refreshBody, /renderResult\(\)/,
        'same-decision input has no full-render fallback');
    assert.doesNotMatch(refreshBody,
        /stopCompositeTimelineUi|bindCompositeTimelineEvents|bindResultEvents/,
        'retained controls keep their one existing timeline listener set');

    const toggleStart = resolver.indexOf('function toggleCompositeCustomEntry');
    const toggleEnd = resolver.indexOf('\nfunction bindCompositeReviewDetails', toggleStart);
    const toggleBody = resolver.slice(toggleStart, toggleEnd);
    assert.match(toggleBody, /markHybridResolutionChanged[\s\S]*refreshCurrentCompositeReview/);
    assert.doesNotMatch(toggleBody, /renderResult\(\)/,
        'manual note toggles use the retained update directly');

    const bindStart = resolver.indexOf('function bindCompositeTimelineEvents');
    const bindEnd = resolver.indexOf('\nfunction renderFinalPreviewResult', bindStart);
    const boundCallbacks = resolver.slice(bindStart, bindEnd);
    assert.match(boundCallbacks, /boundDom\.view\.context/);
    assert.match(boundCallbacks, /const liveView = boundDom\.view/,
        'retained timeline handlers read the current model instead of a captured decision');
    assert.match(resolver,
        /laneId:\s*note\.closest[\s\S]*slot\.lanes\.get\(focusKey\.laneId\)/,
        'camera swaps restore a duplicate note id inside its original track');
    const toolbarStart = resolver.indexOf('function bindCompositeReviewToolbarEvents');
    const toolbarEnd = resolver.indexOf('\nfunction bindResultEvents', toolbarStart);
    const toolbarBody = resolver.slice(toolbarStart, toolbarEnd);
    assert.match(toolbarBody,
        /const moveDecision[\s\S]*refreshReviewDecision\(\)[\s\S]*review\.navigate/,
        'Previous and Next replace the toolbar immediately instead of rebuilding the workspace');
    assert.match(toolbarBody,
        /splitGuidedRepeatGroup\([\s\S]*scheduleCompositePreviewEventPrewarm\(hybridSession\.plan\)/,
        'splitting a review section rewarms the structurally replaced conflict index');
    const seekStart = resolver.indexOf('function seekCompositeTimelineAtTime');
    const seekEnd = resolver.indexOf('\nfunction commitCompositeTimelineZoom', seekStart);
    assert.match(resolver.slice(seekStart, seekEnd),
        /const view = center \? currentTimelineView\(\) : null/,
        'an ordinary navigation seek cannot synchronously rebuild the full-song model');
});

test('Hybrid review navigation and guide playback reuse indexed revision caches', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const guidedStart = resolver.indexOf('function guidedRepeatContext');
    const guidedEnd = resolver.indexOf('\nfunction resolveReviewChoice', guidedStart);
    assert.match(resolver.slice(guidedStart, guidedEnd),
        /return guidedReviewContext\(plan, block\)/,
        'render/navigation consumes the engine index instead of rescanning groups and members');
    const resolvedStart = resolver.indexOf('function resolvedCompositeEntriesForPlan');
    const resolvedEnd = resolver.indexOf('\nfunction entryLastBeat', resolvedStart);
    assert.match(resolver.slice(resolvedStart, resolvedEnd),
        /compositePlanResolutionRevision\(plan\)[\s\S]*cached\.conflicts === plan\.conflicts[\s\S]*cached\.fixedEntries === plan\.fixedEntries[\s\S]*compositeResolvedEntries\(plan\)/,
        'whole-song Hybrid entries are sorted once per resolution and structural revision');
    assert.equal((resolver.match(/compositeResolvedEntries\(/g) || []).length, 1,
        'all timeline and guide consumers share the resolved-entry cache');
    const wholeStart = resolver.indexOf('function wholePlanPreviewView');
    const wholeEnd = resolver.indexOf('\nfunction reviewPlanTimelineView', wholeStart);
    assert.match(resolver.slice(wholeStart, wholeEnd), /resultEntriesPrepared:\s*true/,
        'the full-song view does not sort the cached resolved revision again');
    const reviewStart = wholeEnd;
    const reviewEnd = resolver.indexOf('\nfunction currentTimelineView', reviewStart);
    assert.match(resolver.slice(reviewStart, reviewEnd),
        /resultEntriesPrepared = true[\s\S]*compositeEntriesKeepSortPosition[\s\S]*resultEntriesPrepared,/,
        'review skips sorting only while local annotations preserve the resolved order');
    const eventsStart = resolver.indexOf('function compositePreviewEventsForMode');
    const eventsEnd = resolver.indexOf('\nfunction scheduleCompositePreviewEventPrewarm', eventsStart);
    const eventsBody = resolver.slice(eventsStart, eventsEnd);
    assert.match(eventsBody,
        /compositePreviewEventPlanCache[\s\S]*resolutionRevision[\s\S]*convertCompositePreviewEvents/,
        'source events are plan-cached and Hybrid events are resolution-revision-cached');
    const previewStart = resolver.indexOf('async function startCompositePreview');
    const previewEnd = resolver.indexOf('\nfunction keepCompositeContextLoop', previewStart);
    const previewBody = resolver.slice(previewStart, previewEnd);
    assert.match(previewBody,
        /events:\s*\(\) => compositePreviewEventsForMode\(guideMode\)[\s\S]*voiceCap:\s*hybridSession\.plan\.compatibility\.stringCount/,
        'the private scheduler consumes cached, preconverted guide events directly');
    const prewarmStart = resolver.indexOf('function scheduleCompositePreviewEventPrewarm');
    const prewarmEnd = resolver.indexOf('\nfunction setCompositeContextLoop', prewarmStart);
    assert.match(resolver.slice(prewarmStart, prewarmEnd),
        /prewarmCompositeConflictResolutionIndex\(plan\)[\s\S]*compositePreviewEventsForMode/,
        'idle time prepares both first-choice validation and all guide-event caches');
    assert.match(resolver.slice(prewarmStart, prewarmEnd),
        /prewarmCompositeRecordingSummaryPeak\(peaks\)[\s\S]*recordingPreviewGainFor\(view, audio\)/,
        'idle time also prepares exact recording peak and current-region level matching');
    assert.doesNotMatch(resolver.slice(prewarmStart, prewarmEnd),
        /resolutionRevision\s*!==/,
        'an early review choice cannot permanently cancel source-event prewarming');
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
    const activePlaybackBody = playheadBody.slice(
        playheadBody.indexOf('if (activelyPlaying)'),
        playheadBody.indexOf('} else if (playbackSettled)'));
    assert.doesNotMatch(playheadBody, /innerHTML\s*=/,
        'the animation frame may move geometry but never regenerate note markup');
    assert.match(playheadBody,
        /applyCompositeTimelineCamera\(dom, visualScroll, frame\.contentX\)/,
        'the per-frame path delegates the time surfaces to the shared compositor camera');
    assert.doesNotMatch(activePlaybackBody, /syncCompositeTimelineNativeCamera/,
        'playback never forces the native scrollbar to catch up');
    assert.doesNotMatch(activePlaybackBody, /\.scrollLeft\s*=/,
        'the animation frame never writes native scroll state');
    assert.match(resolver, /data-composite-timeline-camera/);
    assert.match(resolver,
        /if \(dom\.camera\) \{[\s\S]*dom\.camera\.style\.transform = layerTransform/,
        'the ruler and all lanes share one moving compositor layer');
    assert.doesNotMatch(resolver, /rulerSvg\.style\.transform|lane\.svg\.style\.transform/,
        'large SVG surfaces are not animated independently');
    assert.match(resolver, /dom\.playhead\.style\.transform\s*=\s*`translate3d/,
        'the moving playhead stays on the compositor instead of invalidating layout');
    assert.doesNotMatch(playheadBody, /playhead\.style\.left\s*=/);
    assert.equal((resolver.match(/updateCompositeTimelinePlayhead\(\);/g) || []).length, 1,
        'only the cancel-before-refresh helper invokes the self-rescheduling callback directly');
    assert.match(resolver, /function refreshCompositeTimelinePlayheadNow\(\)[\s\S]*cancelAnimationFrame\(timelinePlayheadFrame\)[\s\S]*updateCompositeTimelinePlayhead\(\)/,
        'seek, bind, and maximize cannot multiply the playback animation loop');
});

test('Hybrid release telemetry covers transport latency, display cadence, and input work', () => {
    const resolver = fs.readFileSync(
        new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const previewStart = resolver.indexOf('async function startCompositePreview');
    const previewEnd = resolver.indexOf('\nfunction keepCompositeContextLoop', previewStart);
    assert.match(resolver.slice(previewStart, previewEnd),
        /previewRequestStartedAt = hybridPerfStart\(\)[\s\S]*currentPreviewView\(\)[\s\S]*controller\.start\(mode\)[\s\S]*hybridPerfEnd\('ui\.preview\.requestMs'/,
        'successful Play requests include model lookup through the private transport state');
    const playheadStart = resolver.indexOf('function updateCompositeTimelinePlayhead');
    const playheadEnd = resolver.indexOf('function startCompositeTimelinePlayhead', playheadStart);
    assert.match(resolver.slice(playheadStart, playheadEnd),
        /activelyPlaying[\s\S]*hybridPerfFrame\('timeline\.playhead', frameTime\)/,
        'active preview frames expose display cadence without rendering markup');
    assert.match(resolver,
        /hybridPerfResetFrame\('timeline\.playhead'\)/,
        'separate playback sessions cannot report stopped time as a dropped frame');
    const renderPlanStart = resolver.indexOf('function compositeTimelineCameraRenderPlan');
    const renderPlanEnd = resolver.indexOf(
        '\nfunction renderCompositeTimelineCameraSlot', renderPlanStart);
    const renderPlan = resolver.slice(renderPlanStart, renderPlanEnd);
    assert.match(renderPlan, /timeline\.ruler\.renderMs/);
    assert.match(renderPlan, /timeline\.lane\.renderMs/);
    assert.match(resolver,
        /finishCompositeInteraction\('review\.choice'[\s\S]*finishCompositeInteraction\('review\.reset'/,
        'review choice and reset handlers contribute to the strict interaction gate');
    assert.match(resolver, /interactionStartedAt: hybridPerfStart\(\)/);
    assert.match(resolver,
        /finishCompositeInteraction\('zoom\.response', request\.interactionStartedAt\)/,
        'coalesced zoom reports input-to-visible response at the exact camera commit');
    assert.match(resolver, /hybridPerformanceEnabled\(\)[\s\S]*timeline\.domNodes/,
        'expensive DOM-size gauges remain behind the explicit developer opt-in');
});

test('Original-song Hybrid playback reuses waveform levels instead of scanning PCM on Space', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const start = resolver.indexOf('function recordingPreviewGainFor');
    const end = resolver.indexOf('function updateActiveHybridPreviewMix', start);
    const body = resolver.slice(start, end);
    assert.match(body,
        /audio\.waveformPeaks[\s\S]*compositeRecordingPreviewLevelFromPeaksPure/,
        'the decoded waveform summary is the normal constant-time playback path');
    assert.match(body,
        /:\s*compositeRecordingPreviewLevelPure\(buffer/,
        'a host without waveform data retains the exact PCM correctness fallback');
});

test('Hybrid analysis and creation use cancellable background tasks with stale guards', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    assert.match(resolver, /runHybridAnalysisTask/);
    assert.match(resolver, /runHybridMaterializationTask/);
    const analyzeStart = resolver.indexOf('async function analyzeFromDialog');
    const analyzeEnd = resolver.indexOf('async function finishMerge', analyzeStart);
    const analyzeBody = resolver.slice(analyzeStart, analyzeEnd);
    assert.match(analyzeBody, /beginHybridAnalysis\(hybridSession, \{ sessionId, configToken \}\)/);
    assert.match(analyzeBody, /signal:\s*request\.controller\.signal/);
    assert.match(analyzeBody, /hybridAnalysisIsCurrent/);
    assert.match(analyzeBody, /completeHybridAnalysis/);
    assert.match(analyzeBody,
        /installHybridPlan\(hybridSession, plan, request\.sessionId\)/,
        'the completed plan retains the song session that produced it');
    assert.doesNotMatch(analyzeBody,
        /analyzeGapFillComposite|analyzeGuidedComposite/,
        'the modal must not run a planner directly on the renderer thread');

    const finishStart = resolver.indexOf('async function finishMerge');
    const finishEnd = resolver.indexOf('function setCompositeCreationUi', finishStart);
    const finishBody = resolver.slice(finishStart, finishEnd);
    assert.ok(finishBody.indexOf('endCompositePreviewPlayback()')
        < finishBody.indexOf('beginHybridCreation(hybridSession'),
    'creation stops private preview transport before making the workspace inert');
    assert.match(finishBody,
        /beginHybridCreation\(hybridSession, \{[\s\S]*sessionId:\s*hybridSession\.planSessionId/,
        'creation uses plan ownership, not whichever Editor session is current later');
    assert.match(finishBody,
        /creationRequestIsCurrent[\s\S]*editor\.format === 'sloppak'[\s\S]*editor\.sessionId === hybridSession\.planSessionId/,
        'every delayed creation checkpoint validates both project format and plan owner');
    assert.ok(finishBody.indexOf('setCompositeCreationUi(true)')
        < finishBody.indexOf('await waitForCompositeUiPaint()'),
    'Creating state is installed before yielding a paint');
    assert.ok(finishBody.indexOf('await waitForCompositeUiPaint()')
        < finishBody.indexOf('runHybridMaterializationTask'),
    'materialization starts only after the Creating state can paint');
    assert.match(finishBody, /signal:\s*request\.controller\.signal/);
    assert.match(finishBody,
        /if \(!creationRequestIsCurrent\(\)[\s\S]*commitCompositeArrangement\(arrangement\)/,
        'song and plan ownership are checked again immediately before commit');
    assert.doesNotMatch(finishBody, /materializeCompositeArrangement/,
        'the Create button must not materialize synchronously in the renderer');
    assert.match(resolver,
        /function closeCompositeModalImmediately[\s\S]*clearTransientState\(\)/,
        'closing or tearing down the modal enters the single transient-state cleanup path');
    assert.match(resolver,
        /function clearTransientState[\s\S]*resetHybridBuilderReview\(hybridSession\)/,
        'the shared cleanup path resets and aborts background analysis/creation');
});

test('Hybrid playhead is visible and exact before, during, and after playback', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    assert.match(resolver, /function compositeTimelineDisplayBeatAtTime/);
    assert.match(resolver,
        /initialPlayheadX\s*=\s*compositeTimelineXForBeatPure[\s\S]*renderCompositeTimelinePlayhead\(initialPlayheadX\)/,
        'the first rendered frame uses the current clamped Hybrid position');
    assert.match(resolver,
        /playheadX:\s*compositeTimelineXForBeatPure\([\s\S]*compositeTimelineDisplayBeatAtTime/,
        'the compositor cache starts with a finite visible marker instead of null/zero');
    assert.doesNotMatch(resolver, /playheadX:\s*null/);
    assert.match(resolver,
        /const playbackSettled = hybridSession\.previewPlaying && !controllerPlaying[\s\S]*controller\.presentationTime\(\)/,
        'natural completion adopts the exact private transport endpoint');
    assert.match(resolver,
        /follow:\s*\(activelyPlaying \|\| playbackSettled\)[\s\S]*hybridPreviewPreferences\.followPlayhead/,
        'natural completion also returns the followed camera and overview box to that position');
    const playheadStart = resolver.indexOf('function updateCompositeTimelinePlayhead');
    const playheadEnd = resolver.indexOf('function startCompositeTimelinePlayhead', playheadStart);
    const playheadBody = resolver.slice(playheadStart, playheadEnd);
    assert.match(playheadBody,
        /playbackSettled[\s\S]*previewPlaying = false[\s\S]*previewLoading = false[\s\S]*previewMode = ''/,
        'natural completion settles every transport flag instead of leaving a pressed mode');
    assert.match(playheadBody,
        /finished · press Space to replay[\s\S]*Hybrid preview:/,
        'natural completion replaces the stale playing help and status text');
    const stopStart = resolver.indexOf('function endCompositePreviewPlayback');
    const stopEnd = resolver.indexOf('function disposeCompositePreviewSession', stopStart);
    assert.match(resolver.slice(stopStart, stopEnd), /refreshCompositeTimelinePlayheadNow\(\)/,
        'explicit Stop leaves both timeline markers at the captured position');
});

test('Hybrid modal recovers escaped focus and owns its transport shortcuts', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    assert.match(resolver, /function recoverCompositeModalFocus/);
    assert.match(resolver,
        /bindResultEvents\(\);\s*recoverCompositeModalFocus\(\);/,
        'a hidden Setup or Review control cannot leave keyboard focus on the page body');
    assert.match(resolver, /function installCompositeModalDocumentKeyboard/);
    assert.match(resolver,
        /const nestedPrompt = byId\('editor-choice-prompt'\)[\s\S]*handleCompositeModalShortcut\(event\)[\s\S]*event\.stopImmediatePropagation\(\)/,
        'outside focus is contained without stealing keys from a nested Hybrid prompt');
    assert.match(resolver,
        /event\.key === 'Escape' && !event\.repeat && !previewActive[\s\S]*editorHideCompositeArrangementModal\(\)/,
        'escaped inactive Escape still reaches the normal guarded close path');
    assert.match(resolver,
        /closeAction === 'keep'[\s\S]*recoverCompositeModalFocus\(modal\)/,
        'keeping a guarded review restores focus immediately after its nested prompt closes');
    assert.match(resolver,
        /action\.kind === 'play-toggle'[\s\S]*event\.preventDefault\(\);\s*event\.stopImmediatePropagation\(\)/,
        'claimed Space playback cannot leak into a second transport handler');
    assert.doesNotMatch(resolver, /action\.kind === 'native-activation'/,
        'focused modal controls do not create a second Space-button activation path');
    assert.match(resolver,
        /editable:\s*compositeModalControlEditingTarget\(target\)[\s\S]*spaceEditable:\s*textEditing/,
        'range/select navigation stays native while only actual text editing suppresses Space');
    assert.match(resolver,
        /transportAvailable:\s*compositePreviewTransportAvailable\(\)/,
        'modal shortcuts are gated by the visible, non-inert review workspace');
    assert.match(resolver,
        /COMPOSITE_MODAL_NON_EDITING_INPUT_TYPES[\s\S]*'range'[\s\S]*return !COMPOSITE_MODAL_NON_EDITING_INPUT_TYPES\.has/,
        'range inputs remain transport controls while text-like inputs keep Space');
    assert.doesNotMatch(resolver, /function compositeModalNativeActivationTarget/);
    const shortcutStart = resolver.indexOf('function handleCompositeModalShortcut');
    const shortcutBody = resolver.slice(shortcutStart,
        resolver.indexOf('export async function editorShowCompositeArrangementModal', shortcutStart));
    assert.match(shortcutBody,
        /action\.kind === 'preview'[\s\S]*toggleCompositePreview\(action\.mode\)/,
        'number shortcuts invoke transport directly instead of synthesizing a click');
    assert.match(shortcutBody,
        /const result = byId\('editor-composite-result-workspace'\)[\s\S]*result\?\.querySelector/,
        'shortcuts can target only controls in the active result workspace');
    assert.match(shortcutBody,
        /action\.kind === 'play-toggle'[\s\S]*toggleCompositePreview\(button\.dataset\.compositePreview\)/,
        'Space invokes the selected transport action directly');
    assert.match(resolver,
        /function toggleCompositePreview[\s\S]*hybridSession\.previewMode === mode[\s\S]*endCompositePreviewPlayback\(\)/,
        'Space or click on the active sound button toggles it off instead of restarting it');
    assert.match(resolver, /export function editorTeardownCompositeArrangementUi/);
    assert.match(main,
        /window\.__editorScreenTeardown = \(\) => \{[\s\S]*_teardownHybridFeature\(\)/,
        'Editor reinjection removes the Hybrid document listener and body-mounted modal');
});

test('Hybrid preview lifecycle blocks loading races and stale review work', () => {
    const resolver = fs.readFileSync(
        new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    assert.match(resolver,
        /function requireCurrentCompositePlan[\s\S]*hybridPlanSessionIsCurrent[\s\S]*closeCompositeModalImmediately/,
        'review and preview fail closed when their analyzed song is no longer open');
    const buttonsStart = resolver.indexOf('function updateCompositePreviewButtons');
    const buttonsEnd = resolver.indexOf('function setCompositePreviewHelp', buttonsStart);
    const buttonsBody = resolver.slice(buttonsStart, buttonsEnd);
    assert.match(buttonsBody,
        /editor-composite-preview-tone[\s\S]*editor-composite-whole-loop[\s\S]*previewLoading/,
        'tone and whole-song loop controls stay disabled through initial loading');
    const seekStart = resolver.indexOf('function seekCompositeTimelineAtTime');
    const seekEnd = resolver.indexOf('function commitCompositeTimelineZoom', seekStart);
    const seekBody = resolver.slice(seekStart, seekEnd);
    assert.ok(seekBody.indexOf('if (hybridSession.previewLoading)')
        < seekBody.indexOf('hybridSession.previewController.seek(time)'),
    'a loading preview cannot be replaced by an unowned ruler seek');
    const previewStart = resolver.indexOf('async function startCompositePreview');
    const previewEnd = resolver.indexOf('function keepCompositeContextLoop', previewStart);
    const previewBody = resolver.slice(previewStart, previewEnd);
    assert.match(previewBody,
        /previewRequestIsCurrent[\s\S]*hybridPlanSessionIsCurrent[\s\S]*await controller\.setMode[\s\S]*previewRequestIsCurrent[\s\S]*await controller\.setTone[\s\S]*previewRequestIsCurrent/,
        'each asynchronous preview preparation step retains request and song ownership');
    const focusStart = resolver.indexOf('function prepareCurrentReviewFocus');
    const focusEnd = resolver.indexOf('function centerCurrentReviewInTimeline', focusStart);
    const focusBody = resolver.slice(focusStart, focusEnd);
    assert.ok(focusBody.indexOf('endCompositePreviewPlayback()')
        < focusBody.indexOf('seekCompositeTimelineAtTime(time)'),
    'review navigation stops the old preview before moving the cursor, avoiding a redundant restart');
});

test('Hybrid preview surfaces private transport failures and partial recording availability', () => {
    const resolver = fs.readFileSync(
        new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const controllerStart = resolver.indexOf('function ensureCompositePreviewController');
    const controllerEnd = resolver.indexOf('function updateCompositePreviewButtons', controllerStart);
    const controllerBody = resolver.slice(controllerStart, controllerEnd);
    assert.match(controllerBody,
        /state\.error[\s\S]*setCompositePreviewHelp\(message\)[\s\S]*setCompositeEditorStatus/,
        'device and decode failures replace both local help and the Editor status');
    const previewStart = resolver.indexOf('async function startCompositePreview');
    const previewEnd = resolver.indexOf('function keepCompositeContextLoop', previewStart);
    const previewBody = resolver.slice(previewStart, previewEnd);
    assert.match(previewBody,
        /controller\.state\(\)\.warnings[\s\S]*recording source[\s\S]*playing the available audio/,
        'partial stem failures remain audible but are explained to the user');
});

test('Hybrid feature teardown settles its shared choice prompt through the public key path', () => {
    const resolver = fs.readFileSync(
        new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    assert.match(resolver,
        /async function compositePromptChoice[\s\S]*compositeChoicePromptToken = token[\s\S]*await _editorPromptChoice[\s\S]*compositeChoicePromptToken === token/,
        'the feature tracks only prompts it opened itself');
    assert.match(resolver,
        /function cancelCompositeChoicePrompt[\s\S]*editor-choice-prompt[\s\S]*KeyboardEvent\('keydown'[\s\S]*key: 'Escape'/,
        'forced cleanup settles the shared prompt through its normal Escape handler');
    assert.match(resolver,
        /function clearTransientState[\s\S]*cancelCompositeChoicePrompt\(\)[\s\S]*closeDecisionResolve/,
        'reinjection cannot leave a prompt Promise or creation close-decision behind');
    assert.match(resolver,
        /function editorSuspendCompositeArrangementUi[\s\S]*cancelCompositeChoicePrompt\(\)/,
        'screen navigation cannot leave a body-mounted prompt over another screen');
});

test('Hybrid follow uses bounded double-buffered cameras and compositor-only overview movers', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    assert.match(resolver, /compositeTimelineStripGeometryPure/);
    assert.match(resolver, /cameraShell\(0\) \+ cameraShell\(1\)/,
        'two empty camera shells are emitted before the real viewport is measured');
    assert.doesNotMatch(resolver, /cloneNode\(true\)/,
        'opening the workspace never deep-clones a dense rendered timeline');
    const workspaceStart = resolver.indexOf('function renderCompositeTimelineWorkspace');
    const workspaceEnd = resolver.indexOf('function cancelCompositeTimelineStandbyWork', workspaceStart);
    assert.doesNotMatch(resolver.slice(workspaceStart, workspaceEnd),
        /renderCompositeTimeline(?:Lane|Ruler)Contents\(/,
        'opening emits lightweight shells instead of rendering at an assumed width first');
    assert.match(resolver, /scheduleCompositeTimelineStandby/);
    assert.match(resolver, /scheduleCompositeTimelineIdle/);
    assert.match(resolver, /deadline\?\.timeRemaining\?\.\(\)/,
        'standby work checks the idle time remaining before rendering a lane');
    assert.match(resolver, /compositeTimelineInputPending\(\)/,
        'pending input wins over background strip generation');
    assert.doesNotMatch(resolver, /requestIdleCallback\(callback,\s*\{\s*timeout:/,
        'ordinary soft preparation remains an untimed idle task');
    assert.match(resolver, /Boolean\(deadline\?\.didTimeout\)/,
        'urgent camera work progresses when its deadline expires');
    assert.match(resolver, /compositePreviewControllerPlaying\(\)[\s\S]*now \+ 240/,
        'playback gives finite-strip preparation a bounded deadline');
    assert.match(resolver, /requestAnimationFrame\(\(\) =>\s*refreshCompositeTimelineViewport\(false\)\)/,
        'the animation timestamp can never be mistaken for a forced synchronous rebuild');
    assert.match(resolver, /function commitCompositeTimelineCameraSlot/);
    assert.match(resolver, /setCompositeTimelineCameraSlotActive\(next, true\)/);
    assert.match(resolver, /setCompositeTimelineCameraSlotActive\(previous, false\)/,
        'the prepared strip swaps atomically instead of replacing visible lane markup');
    assert.match(resolver, /toggleAttribute\('inert', !active\)/,
        'controls in the hidden shell never enter keyboard navigation');
    assert.match(resolver, /standby\.camera\.style\.opacity = '0\.001'/,
        'the hidden strip receives one pre-paint frame before the atomic swap');
    const aheadStart = resolver.indexOf('function scheduleCompositeTimelineRenderAhead');
    const aheadEnd = resolver.indexOf('function applyCompositeTimelineCamera', aheadStart);
    const aheadBody = resolver.slice(aheadStart, aheadEnd);
    assert.doesNotMatch(aheadBody, /refreshCompositeTimelineViewport\(true\)/,
        'the display-rate camera can never force a full SVG rebuild');
    assert.match(aheadBody, /scheduleCompositeTimelineStandby\(dom, visualScroll\)/,
        'an outrun strip catches up through cancellable standby rendering');
    const cameraStart = resolver.indexOf('function applyCompositeTimelineCamera');
    const cameraEnd = resolver.indexOf('function setCompositeTimelineNativeCamera', cameraStart);
    const cameraBody = resolver.slice(cameraStart, cameraEnd);
    assert.doesNotMatch(cameraBody, /clientWidth|scrollWidth|getBoundingClientRect|innerHTML/,
        'the display-rate camera path uses cached geometry and compositor transforms only');
    assert.match(cameraBody, /dom\.nativeScrollLeft/,
        'the display-rate camera also uses cached native-scroll state');
    assert.match(cameraBody, /ensureCompositeTimelineCameraCoverage/,
        'coverage is repaired before an uncovered compositor transform is applied');
    assert.match(resolver, /timeline\.camera\.criticalFallback/,
        'the exceptional synchronous correctness fallback is telemetered');
    const coverageStart = resolver.indexOf('function ensureCompositeTimelineCameraCoverage');
    const coverageEnd = resolver.indexOf('\nfunction scheduleCompositeTimelineStandby', coverageStart);
    const coverageBody = resolver.slice(coverageStart, coverageEnd);
    assert.match(coverageBody, /scheduleCompositeTimelineCoverageRepair/,
        'an uncovered display frame queues repair outside the playhead callback');
    assert.doesNotMatch(coverageBody, /synchronouslyRepairCompositeTimelineCoverage\(/,
        'the display-rate coverage guard never rebuilds SVG synchronously');
    assert.doesNotMatch(cameraBody, /scaleX|transformOrigin/,
        'camera movement never stretches fret numbers or note heads');
    assert.match(resolver, /data-composite-map-viewport-window/);
    const bindFrameStart = resolver.indexOf(
        'timelineBindFrame = requestAnimationFrame');
    const bindFrameEnd = resolver.indexOf('\n    });\n}', bindFrameStart);
    const bindFrameBody = resolver.slice(bindFrameStart, bindFrameEnd);
    assert.doesNotMatch(bindFrameBody, /setCompositeTimelineNativeCamera/,
        'initial binding primes scroll state before the first exact render instead of rendering twice');
    assert.match(bindFrameBody,
        /boundDom\.visualScrollLeft = primedScroll[\s\S]*refreshCompositeTimelineViewport\(true\)/);
    assert.match(resolver, /mapPlayhead\.style\.transform\s*=\s*`translate3d/);
    assert.match(resolver, /mapViewport\.style\.transform\s*=\s*`translate3d/);
    assert.doesNotMatch(resolver, /mapPaintAt|< 33/,
        'the overview playhead is no longer deliberately limited to 30 fps');
    assert.doesNotMatch(resolver, /mapPlayhead\.setAttribute\('transform'/,
        'the dense static overview SVG is never repainted to move its playhead');
});

test('Hybrid Overview is an explicit shared display mode with bounded production rendering', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const planStart = resolver.indexOf('function compositeTimelineCameraRenderPlan');
    const planEnd = resolver.indexOf('\nfunction renderCompositeTimelineCameraSlot', planStart);
    assert.match(resolver.slice(planStart, planEnd),
        /overviewDensity: compositeTimelineOverviewActive\(\)/,
        'every review/final camera uses the bounded density renderer only in explicit Overview');
    const signatureStart = resolver.indexOf('function compositeTimelineRenderSignature');
    const signatureEnd = resolver.indexOf('\nfunction setCompositeTimelineCameraSlotActive', signatureStart);
    assert.match(resolver.slice(signatureStart, signatureEnd),
        /compositeTimelineDisplayMode\(\)/,
        'a Notes camera can never be reused as an Overview camera at the same numeric zoom');
    assert.match(resolver,
        /id="editor-composite-time-overview" aria-pressed=/,
        'the shared timeline exposes its display mode directly beside Zoom');
    assert.doesNotMatch(resolver, /editor-composite-time-fit/,
        'Fit is no longer disguised as an extreme numeric note zoom');
    const modeStart = resolver.indexOf('function commitCompositeTimelineDisplayMode');
    const modeEnd = resolver.indexOf('\nfunction scheduleCompositeTimelineDisplayMode', modeStart);
    const modeBody = resolver.slice(modeStart, modeEnd);
    assert.match(modeBody,
        /timelineNotesScrollLeft = currentVisual[\s\S]*timelineDisplayMode: normalizedMode/,
        'entering Overview preserves the Notes position before switching mode');
    assert.doesNotMatch(modeBody, /timelineZoom:/,
        'computed fit never replaces the remembered numeric Notes zoom');
    const bindStart = resolver.indexOf('function bindCompositeTimelineEvents');
    const bindEnd = resolver.indexOf('function renderFinalPreviewResult', bindStart);
    assert.match(resolver.slice(bindStart, bindEnd),
        /overviewButton\?\.addEventListener\('click'[\s\S]*scheduleCompositeTimelineDisplayMode/,
        'the shared Review and full-song workspace use the same mode switch');
});

test('Hybrid overview drag previews visually and commits transport once on release', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const bindStart = resolver.indexOf('function bindCompositeTimelineEvents');
    const bindEnd = resolver.indexOf('function renderFinalPreviewResult', bindStart);
    const body = resolver.slice(bindStart, bindEnd);
    const moveStart = body.indexOf("map?.addEventListener('pointermove'");
    const moveEnd = body.indexOf("map?.addEventListener('pointerup'", moveStart);
    assert.match(body.slice(moveStart, moveEnd), /queueMapPreview\(event\.clientX\)/);
    assert.doesNotMatch(body.slice(moveStart, moveEnd),
        /seekCompositeTimelineAtTime|host\.editorSeekToTime|startCompositePreview/,
        'raw pointer moves never restart or seek the audio engine');
    const upStart = moveEnd;
    const upEnd = body.indexOf('const clearMapGesture', upStart);
    assert.equal((body.slice(upStart, upEnd)
        .match(/seekCompositeTimelineAtTime\(/g) || []).length, 1,
    'pointer release performs one authoritative transport seek');
    assert.match(body, /resumePlaying[\s\S]*resumeMapPreview/,
        'playback that was active resumes once after the committed seek');
    assert.match(body,
        /closest\?\.\('\[data-composite-map-density-kind\]'\)[\s\S]*compositeTimelineOverviewIntervalAtBeatPure\([\s\S]*compositeMapDensityKind[\s\S]*compositeMapDensityState/,
        'a grouped marker resolves the exact visible kind and state before opening a section');
    assert.match(body,
        /overviewIntervalIndex:\s*compositeTimelineOverviewIntervalIndexPure\(view\)/,
        'the initial dense map retains one logarithmic hit index');
    const refreshStart = resolver.indexOf('function refreshCompositeTimelineStaticMap');
    const refreshEnd = resolver.indexOf(
        '\nfunction scheduleCompositeReviewTimelineRefresh', refreshStart);
    assert.match(resolver.slice(refreshStart, refreshEnd),
        /dom\.overviewIntervalIndex = compositeTimelineOverviewIntervalIndexPure\(view\)/,
        'retained review rebuilds the hit index whenever marker states and SVG change');
});

test('Hybrid lane resizing coalesces visual updates and rerenders only on release', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const resizeStart = resolver.indexOf('const previewCompositeLaneHeight');
    const resizeEnd = resolver.indexOf('if (typeof ResizeObserver', resizeStart);
    const resizeBody = resolver.slice(resizeStart, resizeEnd);
    const moveStart = resizeBody.indexOf('const move =');
    const moveEnd = resizeBody.indexOf('const finish =', moveStart);
    assert.match(resizeBody.slice(moveStart, moveEnd), /requestAnimationFrame/);
    assert.doesNotMatch(resizeBody.slice(moveStart, moveEnd),
        /refreshCompositeTimelineViewport|innerHTML/,
        'pointer movement only resizes existing lane surfaces');
    assert.match(resizeBody,
        /setHybridPreviewPreferences\([\s\S]*deferred:\s*true[\s\S]*flushHybridPreviewPreferences\(\)[\s\S]*refreshCompositeTimelineViewport\(true\)/,
        'exact note/string geometry is persisted and rebuilt after release');
});

test('continuous Hybrid preview preferences update live and persist off the input path', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const bindStart = resolver.indexOf('function bindResultEvents');
    const bindEnd = resolver.indexOf('function refreshCompositeTimelineZoomControls', bindStart);
    const resultBinding = resolver.slice(bindStart, bindEnd);
    assert.match(resultBinding,
        /editor-composite-preview-volume'[\s\S]*setHybridPreviewPreferences\([\s\S]*deferred:\s*true[\s\S]*updateActiveHybridPreviewMix\(\)/,
        'volume affects the active mix immediately while its storage write is deferred');
    assert.match(resultBinding,
        /editor-composite-preview-volume'[\s\S]*'change', flushHybridPreviewPreferences/,
        'releasing the volume control flushes its final value');
    const zoomStart = resolver.indexOf('function commitCompositeTimelineZoom');
    const zoomEnd = resolver.indexOf('function updateCompositeTimelineMapFrame', zoomStart);
    const zoomBody = resolver.slice(zoomStart, zoomEnd);
    assert.match(zoomBody,
        /setHybridPreviewPreferences\([\s\S]*deferred:\s*!request\.flushPreference/,
        'continuous zoom persists off the input path while discrete changes save immediately');
    const applyStart = zoomBody.indexOf('function applyCompositeTimelineZoom');
    const scheduleStart = zoomBody.indexOf('function scheduleCompositeTimelineZoom');
    const applyBody = zoomBody.slice(applyStart, scheduleStart);
    assert.doesNotMatch(applyBody,
        /content\.style\.width|refreshCompositeTimelineViewport|scaleX/,
        'continuous input only records the latest exact zoom request');
    assert.match(applyBody,
        /const delay = flushPreference \|\| !timelineLastZoomCommitAt[\s\S]*48 - \(now - timelineLastZoomCommitAt\)[\s\S]*setTimeout\([\s\S]*commitCompositeTimelineZoom/,
        'continuous input gets a leading crisp commit and bounded exact updates');
    const commitBody = zoomBody.slice(0, applyStart);
    assert.match(commitBody,
        /content\.style\.width[\s\S]*dom\.visualScrollLeft = nextScroll[\s\S]*refreshCompositeTimelineViewport\(true\)/,
        'the exact zoom updates geometry and camera atomically in one task');
    assert.doesNotMatch(resolver, /scaleX\(/,
        'no provisional zoom path can distort visible note glyphs');
    assert.match(resolver, /timelinePendingZoom = \{\s*id: \+\+timelineZoomRequestGeneration/,
        'raw zoom input claims its generation before the next display frame');
    assert.match(resolver, /timelinePendingZoom\?\.id > requestId/,
        'an older zoom timer refuses to overtake newer raw input');
    assert.match(resolver,
        /function settleCompositeTimelineZoomPreference[\s\S]*compositeTimelineZoomAtPure[\s\S]*timelineZoom: normalizedZoom[\s\S]*timelineNotesScrollLeft = settledScroll/,
        'teardown persists the newest zoom and its anchor-derived Notes position before rendering');
    const centerStart = resolver.indexOf('function centerCurrentReviewInTimeline');
    const centerEnd = resolver.indexOf('\nfunction refreshCompositeTimelineFollowButton', centerStart);
    assert.doesNotMatch(resolver.slice(centerStart, centerEnd),
        /refreshCompositeTimelineViewport/,
        'initial review centering is camera-only; its bind frame performs the sole exact render');
    const clearStart = resolver.indexOf('function clearTransientState');
    const clearEnd = resolver.indexOf('function setCompositeReviewMode', clearStart);
    assert.match(resolver.slice(clearStart, clearEnd),
        /flushHybridPreviewPreferences\(\)[\s\S]*resetHybridBuilderReview/,
        'close and teardown persist the latest continuous value before resetting state');
});

test('Hybrid preview owns and destroys its private transport at the feature boundary', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const imports = resolver.slice(0, resolver.indexOf('export const HYBRID_DIALOG_STYLE'));
    assert.match(resolver,
        /function disposeCompositePreviewSession[\s\S]*controller\.destroy\(\)/,
        'close, teardown, and song switches destroy the feature-owned controller');
    assert.match(resolver,
        /function clearTransientState[\s\S]*disposeCompositePreviewSession\(\)/,
        'modal teardown cannot leak its private AudioContext into the next Editor session');
    assert.doesNotMatch(imports,
        /from '\.\.\/audio\.js'|from '\.\.\/loop\.js'|from '\.\.\/state\.js'/,
        'ordinary Hybrid preview does not own Editor audio, loop, or state policy');
});

test('Hybrid Follow is an explicit two-state preference and zoom keeps live playback centered', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const session = fs.readFileSync(new URL('../src/composite/session.js', import.meta.url), 'utf8');
    assert.doesNotMatch(resolver, /timelineFollowSuspended|Follow paused|suspendFollow/,
        'scrolling, zooming, and stage changes cannot create a hidden third Follow state');
    assert.doesNotMatch(session, /timelineFollowSuspended/,
        'the builder session has no automatic Follow override');
    assert.match(resolver, /followPlayhead:\s*!hybridPreviewPreferences\.followPlayhead/,
        'only the Follow button toggles the remembered preference');
    const zoomStart = resolver.indexOf('function commitCompositeTimelineZoom');
    const zoomEnd = resolver.indexOf('function updateCompositeTimelineMapFrame', zoomStart);
    const zoomBody = resolver.slice(zoomStart, zoomEnd);
    assert.match(zoomBody, /followsLivePlayback/);
    assert.match(zoomBody, /compositePreviewVisualTime\(\)/,
        'live zoom anchors against the audio clock, not the previous scrollbar position');
    assert.match(zoomBody, /compositeTimelineCenteredScrollPure/);
    assert.match(zoomBody, /timelinePendingZoom/);
    assert.match(zoomBody, /requestAnimationFrame/,
        'rapid slider and wheel requests are coalesced before rebuilding tracks');
    assert.doesNotMatch(resolver, /setCompositeTimelineFollowSuspended/);
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
    assert.doesNotMatch(html, /experimental/i,
        'the MVP setup exposes only Automatic and guided manual review');
    assert.match(html, /id="editor-composite-setup" class="min-h-0 overflow-y-auto/,
        'the setup body must shrink and scroll so the fixed footer stays visible');
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

test('Hybrid builder session reset clears review and private-preview ownership', () => {
    const session = createHybridBuilderSession();
    session.plan = { ok: true };
    session.planSessionId = 'song-a';
    session.stage = 'final-preview';
    session.conflictIndex = 4;
    session.customDrafts.set('guided:1', ['primary:1']);
    session.previewController = { destroy() {} };
    session.previewControllerSessionId = 'song-a';
    session.previewLoading = true;
    session.previewRecordingGain = 0.25;
    session.wholeSongLoop = true;
    session.timelineSeekTime = 18;
    session.timelineScrollLeft = 420;
    session.timelineFocusReview = true;
    session.previewLastMode = 'secondary';
    session.analysisConfig = { strategy: 'guided' };
    session.setupDirty = true;
    session.setupDirtyMessage = 'Changed';
    session.analyzing = true;
    const requestId = session.previewRequestId;
    resetHybridBuilderReview(session);
    assert.equal(session.plan, null);
    assert.equal(session.planSessionId, null);
    assert.equal(session.stage, 'setup');
    assert.equal(session.conflictIndex, 0);
    assert.equal(session.customDrafts.size, 0);
    assert.equal(session.previewLoading, false);
    assert.equal(session.previewRecordingGain, 1);
    assert.equal(session.wholeSongLoop, false);
    assert.equal(session.timelineSeekTime, 0);
    assert.equal(session.timelineScrollLeft, 0);
    assert.equal(session.timelineFocusReview, false);
    assert.equal(session.previewLastMode, 'song');
    assert.equal(session.analysisConfig, null);
    assert.equal(session.setupDirty, false);
    assert.equal(session.setupDirtyMessage, '');
    assert.equal(session.analyzing, false);
    assert.equal(session.previewRequestId, requestId + 1);
    assert.equal(session.previewController, null);
    assert.equal(session.previewControllerSessionId, null);
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

test('Hybrid analysis requests are cancellable and stale results cannot replace newer work', () => {
    const session = createHybridBuilderSession();
    const first = beginHybridAnalysis(session, {
        sessionId: 'song-a', configToken: 'automatic:1',
    });
    assert.ok(first);
    assert.equal(beginHybridAnalysis(session, {
        sessionId: 'song-a', configToken: 'automatic:1',
    }), null, 'one analysis owns the session at a time');
    assert.equal(hybridAnalysisIsCurrent(session, first, {
        sessionId: 'song-a', configToken: 'automatic:1',
    }), true);
    assert.equal(cancelHybridAnalysis(session), true);
    assert.equal(first.controller.signal.aborted, true);
    assert.equal(hybridAnalysisIsCurrent(session, first, {
        sessionId: 'song-a', configToken: 'automatic:1',
    }), false);

    const second = beginHybridAnalysis(session, {
        sessionId: 'song-a', configToken: 'guided:2',
    });
    assert.ok(second);
    assert.equal(completeHybridAnalysis(session, first), false,
        'an old completion cannot clear a newer request');
    assert.equal(completeHybridAnalysis(session, second), true);
});

test('Hybrid revisions distinguish plan, resolution, and view-only changes', () => {
    const session = createHybridBuilderSession();
    const plan = { strategy: 'guided' };
    assert.equal(installHybridPlan(session, plan, 'song-a'), 1);
    assert.equal(session.plan, plan);
    assert.equal(session.planSessionId, 'song-a');
    assert.equal(session.resolutionRevision, 0);
    assert.equal(markHybridResolutionChanged(session), 1);
    assert.equal(markHybridViewChanged(session), 3);
    assert.equal(session.planRevision, 1);
    assert.equal(session.resolutionRevision, 1);
    assert.equal(session.viewRevision, 3);
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

test('an explicitly aborted Hybrid creation request is never current', () => {
    const session = createHybridBuilderSession();
    const plan = { strategy: 'guided' };
    session.plan = plan;
    const request = beginHybridCreation(session, { sessionId: 'song-a', plan });
    request.controller.abort();
    assert.equal(hybridCreationIsCurrent(session, request, {
        sessionId: 'song-a', plan,
    }), false);
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
