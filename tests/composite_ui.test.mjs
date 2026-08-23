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
    const theme = fs.readFileSync(new URL('../assets/v3-theme.css', import.meta.url), 'utf8');
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
        '\n// Resolution and manual-note changes', timelineRefreshStart);
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
        /includePlayability:\s*false[\s\S]*freshnessDeadlineAt:[\s\S]*\+ 240[\s\S]*onCommitted/,
        'choice feedback skips full Experimental linting and has a bounded visible-lane commit');
    assert.doesNotMatch(refreshBody, /result\.innerHTML\s*=/,
        'same-decision input never replaces the full result DOM');
    assert.doesNotMatch(refreshBody, /renderResult\(\)/,
        'same-decision input has no full-render fallback');
    assert.doesNotMatch(refreshBody,
        /stopCompositeTimelineUi|bindCompositeTimelineEvents|bindResultEvents/,
        'retained controls keep their one existing timeline listener set');

    const toggleStart = resolver.indexOf('function toggleCompositeCustomEntry');
    const toggleEnd = resolver.indexOf('\nfunction inspectExperimentalPassage', toggleStart);
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
        /compositePreviewEventsForMode\(mode\)[\s\S]*preSanitized:\s*mode !== 'song'/,
        'the gesture path skips duplicate conversion, filtering, and sorting');
    const prewarmStart = resolver.indexOf('function scheduleCompositePreviewEventPrewarm');
    const prewarmEnd = resolver.indexOf('\nfunction setCompositeContextLoop', prewarmStart);
    assert.match(resolver.slice(prewarmStart, prewarmEnd),
        /prewarmCompositeConflictResolutionIndex\(plan\)[\s\S]*compositePreviewEventsForMode/,
        'idle time prepares both first-choice validation and all guide-event caches');
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
        /previewRequestStartedAt = hybridPerfStart\(\)[\s\S]*currentPreviewView\(\)[\s\S]*startPlayback\(\)[\s\S]*hybridPerfEnd\('ui\.preview\.requestMs'/,
        'successful Play requests include model lookup through the running transport state');
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
    assert.match(resolver,
        /interactionStartedAt: hybridPerfStart\(\)[\s\S]*finishCompositeInteraction\('zoom\.response'/,
        'coalesced zoom reports input-to-visible response rather than each raw wheel event');
    assert.match(resolver, /hybridPerformanceEnabled\(\)[\s\S]*timeline\.domNodes/,
        'expensive DOM-size gauges remain behind the explicit developer opt-in');
});

test('Original-song Hybrid playback reuses waveform levels instead of scanning PCM on Space', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const start = resolver.indexOf('function recordingPreviewGainFor');
    const end = resolver.indexOf('function updateActiveHybridPreviewMix', start);
    const body = resolver.slice(start, end);
    assert.match(body,
        /S\.waveformPeaks[\s\S]*compositeRecordingPreviewLevelFromPeaksPure/,
        'the decoded waveform summary is the normal constant-time playback path');
    assert.match(body,
        /:\s*compositeRecordingPreviewLevelPure\(S\.audioBuffer/,
        'a host without waveform data retains the exact PCM correctness fallback');
});

test('Hybrid analysis and creation use cancellable background tasks with stale guards', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    assert.match(resolver, /runHybridAnalysisTask/);
    assert.match(resolver, /runHybridMaterializationTask/);
    const analyzeStart = resolver.indexOf('async function analyzeFromDialog');
    const analyzeEnd = resolver.indexOf('function clearEditorSelection', analyzeStart);
    const analyzeBody = resolver.slice(analyzeStart, analyzeEnd);
    assert.match(analyzeBody, /beginHybridAnalysis\(hybridSession, \{ sessionId, configToken \}\)/);
    assert.match(analyzeBody, /signal:\s*request\.controller\.signal/);
    assert.match(analyzeBody, /hybridAnalysisIsCurrent/);
    assert.match(analyzeBody, /completeHybridAnalysis/);
    assert.match(analyzeBody, /installHybridPlan\(hybridSession, plan\)/);
    assert.doesNotMatch(analyzeBody,
        /analyzeGapFillComposite|analyzeGuidedComposite|analyzeExperimentalAutoComposite/,
        'the modal must not run a planner directly on the renderer thread');

    const finishStart = resolver.indexOf('async function finishMerge');
    const finishEnd = resolver.indexOf('function setCompositeCreationUi', finishStart);
    const finishBody = resolver.slice(finishStart, finishEnd);
    assert.ok(finishBody.indexOf('setCompositeCreationUi(true)')
        < finishBody.indexOf('await waitForCompositeUiPaint()'),
    'Creating state is installed before yielding a paint');
    assert.ok(finishBody.indexOf('await waitForCompositeUiPaint()')
        < finishBody.indexOf('runHybridMaterializationTask'),
    'materialization starts only after the Creating state can paint');
    assert.match(finishBody, /signal:\s*request\.controller\.signal/);
    assert.doesNotMatch(finishBody, /materializeCompositeArrangement/,
        'the Create button must not materialize synchronously in the renderer');
    assert.match(resolver,
        /function closeCompositeModalImmediately[\s\S]*cancelHybridAnalysis\(hybridSession\)/,
        'closing or tearing down the modal aborts any background analysis');
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
        /const playbackSettled = hybridSession\.previewPlaying && !S\.playing;[\s\S]*timelineSeekTime = Math\.max\(0, Number\(S\.cursorTime\)\)/,
        'natural completion adopts the exact stopped transport position');
    assert.match(resolver,
        /follow:\s*\(activelyPlaying \|\| playbackSettled\)[\s\S]*hybridPreviewPreferences\.followPlayhead/,
        'natural completion also returns the followed camera and overview box to that position');
    const stopStart = resolver.indexOf('function endCompositePreviewPlayback');
    const stopEnd = resolver.indexOf('function restoreCompositePreviewSession', stopStart);
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
        /action\.kind === 'play-toggle'[\s\S]*toggleCompositePreview\(button\.dataset\.compositePreview\)/,
        'Space invokes the selected transport action directly');
    assert.match(resolver,
        /function toggleCompositePreview[\s\S]*hybridSession\.previewMode === mode[\s\S]*endCompositePreviewPlayback\(\)/,
        'Space or click on the active sound button toggles it off instead of restarting it');
    assert.match(resolver, /export function editorTeardownCompositeArrangementUi/);
    assert.match(main,
        /window\.__editorScreenTeardown = \(\) => \{[\s\S]*editorTeardownCompositeArrangementUi\(\)/,
        'Editor reinjection removes the Hybrid document listener and body-mounted modal');
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
        'idle rendering is never forced into a busy playback frame by a timeout');
    assert.match(resolver, /requestAnimationFrame\(\(\) =>\s*refreshCompositeTimelineViewport\(false\)\)/,
        'the animation timestamp can never be mistaken for a forced synchronous rebuild');
    assert.match(resolver, /setCompositeTimelineCameraSlotActive\(standby, true\)/);
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
    assert.match(resolver, /data-composite-map-viewport-window/);
    assert.match(resolver, /mapPlayhead\.style\.transform\s*=\s*`translate3d/);
    assert.match(resolver, /mapViewport\.style\.transform\s*=\s*`translate3d/);
    assert.doesNotMatch(resolver, /mapPaintAt|< 33/,
        'the overview playhead is no longer deliberately limited to 30 fps');
    assert.doesNotMatch(resolver, /mapPlayhead\.setAttribute\('transform'/,
        'the dense static overview SVG is never repainted to move its playhead');
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
    const zoomStart = resolver.indexOf('function applyCompositeTimelineZoom');
    const zoomEnd = resolver.indexOf('function updateCompositeTimelineMapFrame', zoomStart);
    assert.match(resolver.slice(zoomStart, zoomEnd),
        /setHybridPreviewPreferences\([\s\S]*deferred:\s*true[\s\S]*flushPreference[\s\S]*flushHybridPreviewPreferences\(\)/,
        'zoom changes update layout live and discrete/change events flush after the coalesced frame');
    const zoomBody = resolver.slice(zoomStart, zoomEnd);
    const applyStart = zoomBody.indexOf('function applyCompositeTimelineZoom');
    const scheduleStart = zoomBody.indexOf('function scheduleCompositeTimelineZoom');
    const applyBody = zoomBody.slice(applyStart, scheduleStart);
    const liveDomStart = applyBody.lastIndexOf('if (dom) {');
    const liveDomEnd = applyBody.indexOf('\n    else', liveDomStart);
    assert.doesNotMatch(applyBody.slice(liveDomStart, liveDomEnd),
        /refreshCompositeTimelineViewport\(true\)/,
        'continuous zoom does not synchronously rebuild ruler or lane SVG');
    assert.match(resolver, /const scaleTransform[\s\S]*scaleX\(\$\{zoomScale\}\)/,
        'visual zoom uses the existing camera instead of regenerating note markup');
    assert.match(resolver,
        /const delay = immediate \? 0 : 100[\s\S]*scheduleCompositeTimelineStandby/,
        'the existing camera previews every frame and one exact standby render follows quiet input');
    const centerStart = resolver.indexOf('function centerCurrentReviewInTimeline');
    const centerEnd = resolver.indexOf('\nfunction refreshCompositeTimelineFollowButton', centerStart);
    assert.doesNotMatch(resolver.slice(centerStart, centerEnd),
        /refreshCompositeTimelineViewport/,
        'initial review centering is camera-only; its bind frame performs the sole exact render');
    const closeStart = resolver.indexOf('function closeCompositeModalImmediately');
    const closeEnd = resolver.indexOf('export async function editorHideCompositeArrangementModal', closeStart);
    assert.match(resolver.slice(closeStart, closeEnd),
        /flushHybridPreviewPreferences\(\)[\s\S]*cancelHybridAnalysis/,
        'close and teardown persist the latest continuous value before cleanup');
});

test('Hybrid preview policy is cleared when its modal loses ownership of the Editor session', () => {
    const resolver = fs.readFileSync(new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
    const audio = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
    assert.match(resolver, /restorePreview\) \{[\s\S]*restoreCompositePreviewSession\(\)[\s\S]*\} else \{[\s\S]*editorClearGuidePreview\(\)/,
        'a song switch drops Hybrid audio policy without seeking the new session');
    const teardownStart = audio.indexOf('export function teardownAudio');
    const teardownBody = audio.slice(teardownStart, audio.indexOf('\n}', teardownStart) + 2);
    assert.match(teardownBody, /S\.playing = false;[\s\S]*editorClearGuidePreview\(\)/,
        'full Editor teardown cannot leak focused preview ownership into the next screen');
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
    const zoomStart = resolver.indexOf('function applyCompositeTimelineZoom');
    const zoomEnd = resolver.indexOf('function updateCompositeTimelineMapFrame', zoomStart);
    const zoomBody = resolver.slice(zoomStart, zoomEnd);
    assert.match(zoomBody, /followsLivePlayback/);
    assert.match(zoomBody, /editorPlaybackVisualTime\(\)/,
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
    assert.equal(installHybridPlan(session, plan), 1);
    assert.equal(session.plan, plan);
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
