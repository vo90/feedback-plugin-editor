/* Hybrid-track builder.
 *
 * This is the Editor integration over the DOM-free automatic and guided
 * planners: setup, musical-section review, preview, and one structural history
 * command. The merge rules remain DOM-free and testable.
 */

import {
    arrangementKind as arrKind,
    isFrettedArrangementKind as _isFrettedKind,
} from './arrangement-ports.js';
import {
    beatAtTime as beatOf,
    timeAtBeat as timeOf,
} from './timing-ports.js';
import {
    escapeEditorMarkup as _editorEscHtml,
    installEditorModalKeyboard as _installModalKeyboard,
    promptEditorChoice as _editorPromptChoice,
} from './ui-ports.js';
import {
    commitCompositeArrangement,
    compositeEditorArrangementNameTaken,
    compositeEditorContainsArrangement,
    compositeEditorSourceGuardIsCurrent,
    keepCompositeEditorLoop,
    readCompositeAnalysisSnapshot,
    readCompositeEditorSnapshot,
    readCompositePreviewAudioSnapshot,
    setCompositeEditorStatus,
    stopCompositeEditorPlayback,
} from './editor-adapter.js';
export { CreateCompositeArrangementCmd } from './editor-adapter.js';
import { createCompositePreviewController } from './preview-controller.js';
import { applyHybridThemeInheritance } from './theme-inheritance.js';
import { compositeReviewPopoverPlacementPure } from './review-popover.js';
import {
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    clearCompositeConflictResolution,
    compositeCompatibility,
    compositePlanResolutionRevision,
    compositeResolvedEntries,
    compositeSelectionUnitIds,
    prewarmCompositeConflictResolutionIndex,
    resolveCompositeConflict,
} from './merge-engine.js';
import {
    compositeGapFillDefaultsForUnit,
    normalizeCompositeGapFillOptions,
} from './gap-fill-engine.js';
import {
    clearGuidedRepeatGroup,
    detachGuidedRepeatOccurrence,
    guidedReviewContext,
    guidedReviewGroups,
    normalizeGuidedRepeatMode,
    resolveGuidedRepeatGroup,
    splitGuidedRepeatGroup,
} from './guided-engine.js';
import {
    runHybridAnalysisTask,
    runHybridMaterializationTask,
} from './analysis-runner.js';
import {
    hybridPerfCount,
    hybridPerfEnd,
    hybridPerfFrame,
    hybridPerfGauge,
    hybridPerfResetFrame,
    hybridPerfSample,
    hybridPerfStart,
    hybridPerformanceEnabled,
} from './performance.js';
import {
    compositeTimelineCameraCoveragePure,
    compositeTimelineCameraUrgencyPure,
} from './timeline-camera-policy.js';
import {
    buildCompositeConflictViewModel,
    buildCompositeReviewToolbarModel,
    compositeConflictViewIndexMatches,
    compositeTechniqueLabels,
    createCompositeConflictViewIndex,
    renderCompositeDifferenceTable,
} from './conflict-view.js';
import {
    compositeReviewResultEntries,
    createCompositeBaseTimelineCache,
} from './review-model-cache.js';
import {
    createCompositePreviewEventCache,
    compositePreviewMixPure,
    compositePreviewModesPure,
    compositePreviewRegionPure,
    compositeRecordingPreviewLevelPure,
    compositeRecordingPreviewLevelFromPeaksPure,
    prewarmCompositeRecordingSummaryPeak,
} from './preview.js';
import {
    beginHybridAnalysis,
    beginHybridCreation,
    completeHybridAnalysis,
    completeHybridCreation,
    createHybridBuilderSession,
    hybridAnalysisIsCurrent,
    hybridCloseAction,
    hybridCloseGuardKind,
    hybridCreationIsCurrent,
    hybridPlanSessionIsCurrent,
    installHybridPlan,
    markHybridResolutionChanged,
    markHybridReviewWork,
    resetHybridBuilderReview,
} from './session.js';
import {
    hybridTrackNameValidationPure,
    renderHybridSetupView,
} from './setup-view.js';
import {
    buildCompositeTimelineViewModel,
    COMPOSITE_TIMELINE_GUTTER,
    COMPOSITE_TIMELINE_RULER_HEIGHT,
    compositeTimelineBeatForXPure,
    compositeTimelineCameraFramePure,
    compositeTimelineCameraOffsetPure,
    compositeTimelineCenteredScrollPure,
    compositeTimelineContentWidthPure,
    compositeTimelineDisplayBeatPure,
    compositeTimelineFitZoomPure,
    compositeTimelineLaneHeightPure,
    compositeTimelineMapViewportPure,
    compositeTimelineMapBeatPure,
    compositeTimelineOverviewAccessibleLabelPure,
    compositeTimelineOverviewIntervalAtBeatPure,
    compositeTimelineOverviewIntervalIndexPure,
    compositeTimelinePagedCameraPure,
    compositeTimelinePageTransitionPure,
    compositeTimelineRenderGuardPure,
    compositeTimelineRenderWindowNeedsRefreshPure,
    compositeTimelineSteppedZoomPure,
    compositeTimelineStripGeometryPure,
    compositeTimelineViewportRangePure,
    compositeTimelineXForBeatPure,
    compositeTimelineZoomAtPure,
    compositeTimelineZoomPure,
    renderCompositeTimelineLaneContents,
    renderCompositeTimelineLaneHeader,
    renderCompositeTimelineMapSvg,
    renderCompositeTimelinePlayhead,
    renderCompositeTimelineRulerContents,
} from './timeline-view.js';
import {
    HYBRID_GAP_FILL_CONTROL_CONFIG,
    HYBRID_PREVIEW_TONES,
    HYBRID_PREVIEW_DEFAULTS,
    HYBRID_TIMELINE_DISPLAY_NOTES,
    HYBRID_TIMELINE_DISPLAY_OVERVIEW,
    HYBRID_TIMELINE_FOLLOW_CENTERED,
    HYBRID_TIMELINE_FOLLOW_OFF,
    HYBRID_TIMELINE_FOLLOW_PAGED,
    HYBRID_TIMELINE_LANE_MAX,
    HYBRID_TIMELINE_LANE_MIN,
    HYBRID_TIMELINE_ZOOM_CONTROL_MIN,
    HYBRID_TIMELINE_ZOOM_MAX,
    HYBRID_TIMELINE_ZOOM_STEP,
    createHybridPreferenceWriter,
    hybridGapFillPreferencesPure,
    hybridGuidedPreferencesPure,
    hybridPreviewPreferencesPure,
    loadHybridDialogSize,
    loadHybridGapFillPreferences,
    loadHybridGuidedPreferences,
    loadHybridPreviewPreferences,
    saveHybridGapFillPreferences,
    saveHybridGuidedPreferences,
    saveHybridDialogSize,
    saveHybridPreviewPreferences,
} from './preferences.js';

export {
    hybridGapFillPreferencesPure as _compositeGapFillPreferencesPure,
    hybridGuidedPreferencesPure as _compositeGuidedPreferencesPure,
    hybridPreviewPreferencesPure as _compositePreviewPreferencesPure,
};

export function _compositeModalSessionIsCurrentPure(
    modalSessionId, { sessionId, format } = {}, planSessionId = null,
) {
    return !!(modalSessionId && sessionId === modalSessionId && format === 'sloppak'
        && (!planSessionId || planSessionId === modalSessionId));
}

export const HYBRID_DIALOG_STYLE = [
    // Position against the modal itself. A percentage-height flex item is
    // treated as auto-height in Electron here, which can place the footer
    // below the Editor surface even though the accessibility tree still sees it.
    'position:absolute',
    'left:1rem',
    'top:1rem',
    'width:calc(100vw - 2rem)',
    // Electron's desktop capture includes the native title/menu chrome in vh,
    // although the renderer begins beneath it. Reserve that 3.5rem chrome plus
    // the intended 2rem workspace margin so the lower edge remains reachable.
    'height:calc(100vh - 5.5rem)',
    'min-width:min(42rem, calc(100vw - 2rem))',
    'min-height:min(32rem, calc(100vh - 5.5rem))',
    'max-width:calc(100vw - 1rem)',
    'max-height:calc(100vh - 4.5rem)',
    'display:grid',
    'grid-template-rows:auto minmax(0, 1fr) auto',
    'resize:both',
    'overflow:hidden',
].join(';');

const hybridSession = createHybridBuilderSession();
let hybridPreviewPreferences = hybridPreviewPreferencesPure(null);
const hybridPreviewPreferenceWriter = createHybridPreferenceWriter(
    preferences => saveHybridPreviewPreferences(preferences),
);
let timelineViewportFrame = 0;
let timelinePlayheadFrame = 0;
let timelineZoomFrame = 0;
let timelineZoomCommitTimer = 0;
let timelineZoomCommitRequestId = 0;
let timelineLastZoomCommitAt = 0;
let timelinePendingZoom = null;
let timelineRequestedZoom = null;
let timelineZoomRequestGeneration = 0;
let timelineStandbyCancel = null;
let timelineStandbySwapFrame = 0;
let timelineRenderGeneration = 0;
let timelineBindFrame = 0;
let timelineReviewRefreshFrame = 0;
let timelineReviewRefreshGeneration = 0;
let timelineResizeObserver = null;
let timelineOverviewResizeTimer = 0;
let timelineProgrammaticScrollTarget = null;
let dialogResizeObserver = null;
let dialogResizeSaveTimer = 0;
let reviewDetailsPlacementFrame = 0;
let reviewDetailsWindowResize = null;
let timelineViewCache = null;
let conflictViewCache = null;
let timelineViewportDom = null;
let compositeModalDocumentKeydown = null;
let compositeModalSessionId = null;
let compositeChoicePromptToken = null;
const convertCompositePreviewEvents = createCompositePreviewEventCache();
const compositePreviewEventPlanCache = new WeakMap();
const compositeResolvedEntryPlanCache = new WeakMap();
const compositeConflictViewPlanIndexes = new WeakMap();
const compositeBaseTimelineViews = createCompositeBaseTimelineCache();
const COMPOSITE_MODAL_NON_EDITING_INPUT_TYPES = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio',
    'range', 'reset', 'submit',
]);

function finishCompositeInteraction(name, startedAt) {
    const duration = hybridPerfEnd('ui.interactionMs', startedAt);
    if (!Number.isFinite(startedAt)) return duration;
    hybridPerfSample(`ui.${name}Ms`, duration);
    hybridPerfCount(`ui.${name}`);
    return duration;
}

function setHybridPreviewPreferences(preferences, { deferred = false } = {}) {
    // Normalization is intentionally separate from persistence: sliders and
    // drags must update playback/layout immediately without synchronously
    // serializing localStorage for every pointer event.
    hybridPreviewPreferences = hybridPreviewPreferencesPure(preferences);
    if (deferred) {
        hybridPreviewPreferenceWriter.schedule(hybridPreviewPreferences);
    } else {
        // A discrete save supersedes any older debounced snapshot. Cancelling
        // first prevents that stale snapshot from overwriting the newer tone,
        // Follow, or layout choice later.
        hybridPreviewPreferenceWriter.cancel();
        hybridPreviewPreferences = saveHybridPreviewPreferences(hybridPreviewPreferences);
    }
    return hybridPreviewPreferences;
}

function flushHybridPreviewPreferences() {
    const saved = hybridPreviewPreferenceWriter.flush();
    if (saved) hybridPreviewPreferences = saved;
    // flush() already clears its timer and pending value. cancel() makes the
    // lifecycle guarantee explicit if the writer implementation changes.
    hybridPreviewPreferenceWriter.cancel();
    return hybridPreviewPreferences;
}

function stopCompositeModalDocumentKeyboard() {
    if (!compositeModalDocumentKeydown || typeof document === 'undefined') return;
    document.removeEventListener('keydown', compositeModalDocumentKeydown, true);
    compositeModalDocumentKeydown = null;
}

function stopHybridDialogSizePersistence() {
    dialogResizeObserver?.disconnect();
    dialogResizeObserver = null;
    if (dialogResizeSaveTimer) clearTimeout(dialogResizeSaveTimer);
    dialogResizeSaveTimer = 0;
    if (reviewDetailsPlacementFrame) cancelAnimationFrame(reviewDetailsPlacementFrame);
    reviewDetailsPlacementFrame = 0;
    if (reviewDetailsWindowResize && typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('resize', reviewDetailsWindowResize);
    }
    reviewDetailsWindowResize = null;
}

function restoreHybridDialogSize(dialog) {
    if (!dialog) return hybridDialogSizeFallback();
    const saved = loadHybridDialogSize();
    if (saved.width && saved.height) {
        const maximumWidth = Math.max(320, window.innerWidth - 16);
        const maximumHeight = Math.max(320, window.innerHeight - 72);
        dialog.style.width = `${Math.min(maximumWidth, saved.width)}px`;
        dialog.style.height = `${Math.min(maximumHeight, saved.height)}px`;
    }
    setHybridDialogMaximized(dialog, saved.maximized, false);
    return saved;
}

function hybridDialogSizeFallback() {
    return { width: null, height: null, maximized: false };
}

function hybridDialogMaximizeIcon(maximized) {
    return maximized
        ? '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M6 3h11v11h-3V6H6V3Zm-3 3h9v11H3V6Zm2 2v7h5V8H5Z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 3h14v14H3V3Zm2 2v10h10V5H5Z" fill="currentColor"/></svg>';
}

function setHybridDialogMaximized(dialog, maximized, persist = true) {
    if (!dialog) return false;
    const next = !!maximized;
    dialog.classList.toggle('editor-composite-maximized', next);
    dialog.dataset.compositeMaximized = String(next);
    const button = byId('editor-composite-maximize');
    if (button) {
        button.setAttribute('aria-pressed', String(next));
        button.setAttribute('aria-label', next ? 'Restore Hybrid workspace size' : 'Maximize Hybrid workspace');
        button.title = next ? 'Restore workspace size' : 'Maximize workspace';
        button.innerHTML = hybridDialogMaximizeIcon(next);
    }
    const grip = byId('editor-composite-resize-grip');
    if (grip) grip.hidden = next;
    if (persist) saveHybridDialogSize({ ...loadHybridDialogSize(), maximized: next });
    requestAnimationFrame(() => {
        scheduleCompositeTimelineViewport();
        refreshCompositeTimelinePlayheadNow();
        scheduleCompositeReviewDetailsPlacement();
    });
    return next;
}

function toggleHybridDialogMaximized() {
    const dialog = byId('editor-composite-dialog');
    if (!dialog) return false;
    return setHybridDialogMaximized(dialog,
        dialog.dataset.compositeMaximized !== 'true');
}

function beginHybridDialogSizePersistence(dialog) {
    stopHybridDialogSizePersistence();
    if (!dialog) return;
    if (typeof globalThis.addEventListener === 'function') {
        reviewDetailsWindowResize = () => scheduleCompositeReviewDetailsPlacement();
        globalThis.addEventListener('resize', reviewDetailsWindowResize);
    }
    if (typeof ResizeObserver !== 'function') return;
    let initialNotification = true;
    dialogResizeObserver = new ResizeObserver(entries => {
        scheduleCompositeReviewDetailsPlacement();
        if (initialNotification) {
            initialNotification = false;
            return;
        }
        const rect = entries[0]?.contentRect;
        if (!rect || dialog.dataset.compositeMaximized === 'true') return;
        if (dialogResizeSaveTimer) clearTimeout(dialogResizeSaveTimer);
        dialogResizeSaveTimer = setTimeout(() => {
            dialogResizeSaveTimer = 0;
            saveHybridDialogSize({
                width: rect.width, height: rect.height,
                maximized: false,
            });
        }, 180);
    });
    dialogResizeObserver.observe(dialog);
}

function inputNumber(id) {
    const raw = byId(id)?.value;
    return raw === '' || raw === undefined ? Number.NaN : Number(raw);
}

function gapFillOptionsFromDialog(unit = byId('editor-composite-gap-unit')?.value) {
    return normalizeCompositeGapFillOptions({
        unit,
        minimumGap: inputNumber('editor-composite-min-gap'),
        transitionMargin: inputNumber('editor-composite-margin'),
    });
}

function compositeAnalysisConfigFromDialog() {
    const strategy = selectedCompositeStrategy();
    const base = {
        primaryIndex: Number(byId('editor-composite-primary')?.value),
        secondaryIndex: Number(byId('editor-composite-secondary')?.value),
        strategy,
    };
    if (strategy === 'guided') {
        return {
            ...base,
            repeatMode: normalizeGuidedRepeatMode(byId('editor-composite-repeat-mode')?.value),
        };
    }
    return {
        ...base,
        gapFill: gapFillOptionsFromDialog(),
    };
}

function updateCompositeStageIndicator(stage = 'setup') {
    for (const step of document.querySelectorAll('[data-composite-stage-step]')) {
        const active = step.dataset.compositeStageStep === stage;
        step.classList.toggle('editor-composite-stage-active', active);
        if (active) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
    }
}

function updateCompositeSetupDirtyState(message = '') {
    if (!hybridSession.plan || !hybridSession.analysisConfig) {
        hybridSession.setupDirty = false;
        hybridSession.setupDirtyMessage = '';
    } else {
        hybridSession.setupDirty = !_compositeAnalysisConfigEqualPure(
            compositeAnalysisConfigFromDialog(), hybridSession.analysisConfig,
        );
        hybridSession.setupDirtyMessage = hybridSession.setupDirty
            ? message || 'Settings changed. Rebuild the preview to use them.' : '';
    }
    const notice = byId('editor-composite-setup-notice');
    if (notice) {
        notice.hidden = !hybridSession.setupDirty;
        notice.textContent = hybridSession.setupDirtyMessage;
    }
    const analyze = byId('editor-composite-analyze');
    if (analyze && hybridSession.plan) {
        analyze.textContent = hybridSession.setupDirty ? 'Rebuild hybrid preview' : 'Rebuild preview';
    }
    const resume = byId('editor-composite-return-review');
    if (resume) resume.hidden = !hybridSession.plan;
    return hybridSession.setupDirty;
}

function selectedCompositeStrategy() {
    return document.querySelector('input[name="editor-composite-strategy"]:checked')?.value === 'guided'
        ? 'guided' : 'gap-fill';
}

function applyGapFillUnitToDialog(unit, values) {
    const normalized = normalizeCompositeGapFillOptions({ unit, ...(values || {}) });
    const config = HYBRID_GAP_FILL_CONTROL_CONFIG[normalized.unit];
    const minGap = byId('editor-composite-min-gap');
    const margin = byId('editor-composite-margin');
    const unitLabel = normalized.unit === 'seconds' ? 'seconds' : 'beats';
    const minLabel = byId('editor-composite-min-gap-label');
    const marginLabel = byId('editor-composite-margin-label');
    if (minLabel) minLabel.textContent = `Smallest gap to fill (${unitLabel})`;
    if (marginLabel) marginLabel.textContent = `Extra space before and after (${unitLabel})`;
    if (minGap) {
        minGap.max = String(config.minimumMax);
        minGap.step = String(config.minimumStep);
        minGap.value = String(normalized.minimumGap);
    }
    if (margin) {
        margin.max = String(config.marginMax);
        margin.step = String(config.marginStep);
        margin.value = String(normalized.transitionMargin);
    }
}

export function _compositeEligibleSourcesPure(arrangements) {
    return (arrangements || []).map((arrangement, index) => ({ arrangement, index }))
        .filter(({ arrangement }) => arrangement && _isFrettedKind(arrKind(arrangement)));
}

export function _compositeUniqueNamePure(names, base = 'Hybrid Guitar') {
    const taken = new Set((names || []).map(name => String(name || '').trim().toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i <= taken.size + 2; i++) {
        if (!taken.has(`${base.toLowerCase()} ${i}`)) return `${base} ${i}`;
    }
    return `${base} ${Date.now()}`;
}

export function _compositeDefaultNameForSourcePure(arrangement) {
    return arrKind(arrangement) === 'bass' ? 'Hybrid Bass' : 'Hybrid Guitar';
}

export function _compositeSourcePairStatePure(arrangements, primaryIndex, secondaryIndex) {
    const primary = arrangements?.[Number(primaryIndex)];
    const secondary = arrangements?.[Number(secondaryIndex)];
    if (!primary || !secondary) {
        return { ok: false, message: 'Choose a base track and a fill track.', errors: [] };
    }
    if (Number(primaryIndex) === Number(secondaryIndex)) {
        return { ok: false, message: 'Choose two different tracks.', errors: ['Choose two different source tracks.'] };
    }
    const compatibility = compositeCompatibility(primary, secondary);
    if (!compatibility.ok) {
        return {
            ok: false,
            message: compatibility.errors.join(' '),
            errors: compatibility.errors,
            compatibility,
        };
    }
    const instrument = compatibility.kind === 'bass' ? 'bass' : 'guitar';
    return {
        ok: true,
        message: `Ready: both tracks are compatible ${instrument} arrangements with ${compatibility.stringCount} strings.`,
        errors: [],
        compatibility,
    };
}

export function _compositeAnalysisConfigEqualPure(left, right) {
    if (!left || !right) return false;
    return JSON.stringify(left) === JSON.stringify(right);
}

export function _compositeReviewContinueLabelPure(unresolvedDecisions) {
    return Math.max(0, Number(unresolvedDecisions) || 0) > 0
        ? 'Next unresolved →' : 'Preview full song →';
}

export function _compositeReviewCustomSelectionPure(conflict, draft = null,
    hasDraft = Array.isArray(draft)) {
    if (hasDraft && Array.isArray(draft)) return draft;
    if (conflict?.resolution === 'custom'
            && Array.isArray(conflict.selectedEntryIds)) return conflict.selectedEntryIds;
    return null;
}

export function _compositeTimelineStageActivePure(stage) {
    return stage === 'review' || stage === 'final-preview';
}

const COMPOSITE_TIMELINE_KEYBOARD_BEAT_STEP = 1;
const COMPOSITE_TIMELINE_LANE_KEY_STEP = 8;
const COMPOSITE_TIMELINE_LANE_KEY_PAGE_STEP = 32;

export function _compositeTimelineKeyboardSeekPure({
    key = '', currentBeat = 0, context = {}, pageBeats = 4,
} = {}) {
    const start = Number.isFinite(Number(context.startBeat))
        ? Number(context.startBeat) : 0;
    const end = Math.max(start, Number.isFinite(Number(context.endBeat))
        ? Number(context.endBeat) : start);
    const current = Math.max(start, Math.min(end,
        Number.isFinite(Number(currentBeat)) ? Number(currentBeat) : start));
    const page = Math.max(COMPOSITE_TIMELINE_KEYBOARD_BEAT_STEP,
        Number.isFinite(Number(pageBeats)) ? Number(pageBeats) : 4);
    let next;
    if (key === 'ArrowLeft' || key === 'ArrowDown') {
        next = current - COMPOSITE_TIMELINE_KEYBOARD_BEAT_STEP;
    } else if (key === 'ArrowRight' || key === 'ArrowUp') {
        next = current + COMPOSITE_TIMELINE_KEYBOARD_BEAT_STEP;
    } else if (key === 'PageUp') {
        next = current - page;
    } else if (key === 'PageDown') {
        next = current + page;
    } else if (key === 'Home') {
        next = start;
    } else if (key === 'End') {
        next = end;
    } else {
        return null;
    }
    return Math.max(start, Math.min(end, next));
}

export function _compositeTimelineLaneResizeKeyPure(key, currentHeight) {
    const current = compositeTimelineLaneHeightPure(currentHeight);
    let next;
    if (key === 'ArrowUp') next = current - COMPOSITE_TIMELINE_LANE_KEY_STEP;
    else if (key === 'ArrowDown') next = current + COMPOSITE_TIMELINE_LANE_KEY_STEP;
    else if (key === 'PageUp') next = current - COMPOSITE_TIMELINE_LANE_KEY_PAGE_STEP;
    else if (key === 'PageDown') next = current + COMPOSITE_TIMELINE_LANE_KEY_PAGE_STEP;
    else if (key === 'Home') next = HYBRID_TIMELINE_LANE_MIN;
    else if (key === 'End') next = HYBRID_TIMELINE_LANE_MAX;
    else return null;
    return compositeTimelineLaneHeightPure(next);
}

export function _compositeModalShortcutPure({
    key = '', editable = false, modified = false, stage = 'review',
    previewActive = false, repeat = false, spaceEditable = editable,
    transportAvailable = true, navigationReserved = false,
} = {}) {
    // The Hybrid modal's generic keyboard trap closes on Escape. Consume the
    // first Escape here while auditioning so it behaves as Stop instead. A held
    // key produces repeat events after previewActive becomes false, so those
    // repeats must also stay consumed; a new physical press can then close.
    if (key === 'Escape' && repeat && !modified) return { kind: 'consume' };
    if (key === 'Escape' && previewActive && !modified) return { kind: 'stop-preview' };
    if (modified) return null;
    const transportEnabled = transportAvailable
        && _compositeTimelineStageActivePure(stage);
    if (key === ' ') {
        if (spaceEditable) return null;
        if (!transportEnabled) return null;
        return repeat ? { kind: 'consume' } : { kind: 'play-toggle' };
    }
    // Preserve arrows and character input for select/range/text controls.
    // Space starts transport only from the timeline/background; focused
    // interactive controls keep their native activation behavior.
    if (editable) return null;
    if (!transportEnabled) return null;
    const modes = { '1': 'song', '2': 'primary', '3': 'secondary', '4': 'result' };
    if (repeat && modes[key]) return { kind: 'consume' };
    if (modes[key]) return { kind: 'preview', mode: modes[key] };
    if (navigationReserved && [
        'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
        'PageUp', 'PageDown', 'Home', 'End',
    ].includes(key)) return null;
    if (stage === 'review' && key === 'ArrowLeft') return { kind: 'previous' };
    if (stage === 'review' && key === 'ArrowRight') return { kind: 'next' };
    if (stage === 'review' && key === 'Home') return { kind: 'focus-review' };
    return null;
}

function byId(id) {
    return document.getElementById(id);
}

async function compositePromptChoice(options) {
    const token = {};
    compositeChoicePromptToken = token;
    try {
        return await _editorPromptChoice(options);
    } finally {
        if (compositeChoicePromptToken === token) compositeChoicePromptToken = null;
    }
}

function cancelCompositeChoicePrompt() {
    if (!compositeChoicePromptToken) return false;
    const prompt = byId('editor-choice-prompt');
    if (!prompt || typeof globalThis.KeyboardEvent !== 'function') return false;
    prompt.dispatchEvent(new globalThis.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: false,
        cancelable: true,
    }));
    return true;
}

function compositePreviewTransportAvailable() {
    const modal = byId('editor-composite-modal');
    const workspace = byId('editor-composite-workspace');
    const result = byId('editor-composite-result-workspace');
    return !!(modal && !modal.hidden && result && !result.hidden
        && _compositeTimelineStageActivePure(hybridSession.stage)
        && !hybridSession.analyzing && !hybridSession.creating
        && !hybridSession.closePromptPending
        && !timelineViewportDom?.reviewRefreshPending
        && !modal.inert && !workspace?.inert && !result.inert);
}

function requireCurrentCompositePlan() {
    if (!hybridSession.plan) return false;
    const editor = readCompositeEditorSnapshot();
    if (hybridPlanEditorIsCurrent(editor)) return true;
    const modal = byId('editor-composite-modal');
    const sameSong = editor.format === 'sloppak'
        && editor.sessionId === hybridSession.planSessionId;
    const guardedSourcesCurrent = !hybridSession.planSourceGuard
        || compositeEditorSourceGuardIsCurrent(hybridSession.planSourceGuard);
    if (sameSong && (!guardedSourcesCurrent
            || hybridSession.planEditGeneration !== null
                && editor.editGeneration !== hybridSession.planEditGeneration)) {
        disposeCompositePreviewSession();
        stopCompositeTimelineUi();
        resetHybridBuilderReview(hybridSession);
        setCompositeReviewMode(false);
        updateCompositeStageIndicator('setup');
        setCompositeAnalysisUi(false);
        const message = 'The source tracks changed in the Editor. Build a new preview before continuing.';
        const notice = byId('editor-composite-setup-notice');
        if (notice) {
            notice.hidden = false;
            notice.textContent = message;
        }
        const error = byId('editor-composite-error');
        if (error) error.textContent = message;
        setCompositeEditorStatus(`Hybrid Track: ${message}`);
        byId('editor-composite-analyze')?.focus();
        return false;
    }
    closeCompositeModalImmediately(modal);
    setCompositeEditorStatus(
        'The open song changed, so Hybrid Track was closed. Open it again to build a preview for this song.');
    return false;
}

function compositeModalTextEditingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (target.matches?.('textarea')) return true;
    if (!target.matches?.('input')) return false;
    // Range, checkbox, and button-like inputs are modal controls, not text
    // editors. Their native Space behavior is reserved separately below.
    return !COMPOSITE_MODAL_NON_EDITING_INPUT_TYPES.has(
        String(target.type || 'text').toLowerCase());
}

function compositeModalControlEditingTarget(target) {
    return compositeModalTextEditingTarget(target)
        || !!target?.matches?.('input, select, textarea, [role="slider"], [role="separator"]');
}

function hybridPlanEditorIsCurrent(editor = readCompositeEditorSnapshot()) {
    return hybridPlanSessionIsCurrent(hybridSession, editor)
        && (!hybridSession.planSourceGuard
            || compositeEditorSourceGuardIsCurrent(hybridSession.planSourceGuard));
}

function compositeModalSpaceReservedTarget(target) {
    if (compositeModalControlEditingTarget(target)) return true;
    return !!target?.closest?.(
        'button, summary, a[href], [role="button"], [role="slider"], [role="separator"]');
}

function compositeModalVisibleFocusTarget(modal = byId('editor-composite-modal')) {
    if (!modal) return null;
    const resultWorkspace = byId('editor-composite-result-workspace');
    if (resultWorkspace && !resultWorkspace.hidden) {
        return byId('editor-composite-timeline-scroller')
            || resultWorkspace.querySelector('[data-composite-preview]:not([disabled])')
            || resultWorkspace;
    }
    const setup = byId('editor-composite-setup');
    if (setup && !setup.hidden) {
        return byId('editor-composite-primary')
            || setup.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    }
    return byId('editor-composite-cancel');
}

function recoverCompositeModalFocus(modal = byId('editor-composite-modal')) {
    if (!modal) return false;
    const active = document.activeElement;
    const usable = !!(active && modal.contains(active)
        && !active.closest?.('[hidden], [inert]'));
    if (usable) return false;
    const target = compositeModalVisibleFocusTarget(modal);
    if (!target?.focus) return false;
    try { target.focus({ preventScroll: true }); }
    catch (_) { target.focus(); }
    return true;
}

// A stage change can hide the focused Setup/Review control. Chromium then
// sends the next key to <body>, outside the modal's normal focus trap. Bridge
// only that escaped-focus state so an underlying Editor shortcut can never
// start transport behind a visible Hybrid workspace.
function installCompositeModalDocumentKeyboard(modal) {
    stopCompositeModalDocumentKeyboard();
    if (!modal || typeof document === 'undefined') return;
    compositeModalDocumentKeydown = event => {
        if (byId('editor-composite-modal') !== modal || modal.contains(event.target)) return;
        // Choice/text prompts deliberately sit above the Hybrid modal and own
        // their own keyboard trap. Never redirect their events underneath.
        const nestedPrompt = byId('editor-choice-prompt') || byId('editor-text-prompt');
        if (nestedPrompt) {
            if (nestedPrompt.contains(event.target)) return;
            nestedPrompt.querySelector('input, button, [tabindex]:not([tabindex="-1"])')?.focus();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const resultWorkspace = byId('editor-composite-result-workspace');
        const timelineVisible = !!(resultWorkspace && !resultWorkspace.hidden);
        recoverCompositeModalFocus(modal);
        if (timelineVisible) {
            const previewActive = hybridSession.previewPlaying || hybridSession.previewLoading;
            if (event.key === 'Escape' && !event.repeat && !previewActive) {
                event.preventDefault();
                editorHideCompositeArrangementModal();
            } else {
                handleCompositeModalShortcut(event);
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            editorHideCompositeArrangementModal();
        } else if (event.key === ' ') {
            event.preventDefault();
        }
        event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', compositeModalDocumentKeydown, true);
}

function selectedHybridPreviewTone() {
    return HYBRID_PREVIEW_TONES.find(tone => tone.id === hybridPreviewPreferences.tone)
        || HYBRID_PREVIEW_TONES[0];
}

function hybridPreviewMixFor(mode) {
    return compositePreviewMixPure(mode, {
        volume: hybridPreviewPreferences.volume,
        recordingGain: hybridSession.previewRecordingGain,
    });
}

function validateCompositeTrackName({ focus = false } = {}) {
    const input = byId('editor-composite-name');
    const names = readCompositeEditorSnapshot().arrangements
        .map(arrangement => arrangement?.name);
    const validation = hybridTrackNameValidationPure(input?.value, names);
    const message = byId('editor-composite-name-error');
    if (message) {
        message.hidden = validation.ok;
        message.textContent = validation.message;
    }
    if (input) input.setAttribute('aria-invalid', validation.ok ? 'false' : 'true');
    const footerError = byId('editor-composite-error');
    if (validation.ok && footerError?.dataset.compositeNameError === 'true') {
        footerError.textContent = '';
        delete footerError.dataset.compositeNameError;
    }
    if (!validation.ok && focus) input?.focus();
    return validation;
}

function showCompositeTrackNameError(validation) {
    const error = byId('editor-composite-error');
    if (!error || validation?.ok) return;
    error.dataset.compositeNameError = 'true';
    error.textContent = validation.message;
}

let recordingPreviewLevelCache = null;
function compositePreviewAudioAvailable() {
    return readCompositePreviewAudioSnapshot().available;
}

function compositePreviewTimelineDuration() {
    return readCompositePreviewAudioSnapshot().duration;
}

function recordingPreviewGainFor(view, audio = readCompositePreviewAudioSnapshot()) {
    const buffer = audio.activeBuffer;
    if (!buffer || !view || !hybridSession.plan) return 1;
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    const shift = (Number(audio.audioShift) || 0)
        + (Number(audio.activeSourceOffset) || 0);
    const startTime = region.startTime - shift;
    const endTime = region.endTime - shift;
    const cached = recordingPreviewLevelCache;
    if (cached && cached.buffer === buffer
            && cached.startTime === startTime && cached.endTime === endTime) return cached.gain;
    // Audio decoding already produced a compact RMS/peak waveform summary.
    // Prefer it here so the Play/Space gesture never has to scan hundreds of
    // thousands of raw samples before Original Song playback can start.
    const level = audio.waveformPeaks
        ? compositeRecordingPreviewLevelFromPeaksPure(
            audio.waveformPeaks, buffer.duration, startTime, endTime)
        : compositeRecordingPreviewLevelPure(buffer, startTime, endTime);
    const gain = level.gain;
    recordingPreviewLevelCache = { buffer, startTime, endTime, gain };
    return gain;
}

function updateActiveHybridPreviewMix() {
    const controller = hybridSession.previewController;
    if (!hybridSession.previewMode || !controller) return false;
    controller.setMix(hybridPreviewMixFor(hybridSession.previewMode));
    return true;
}

function compositePreviewControllerPlaying() {
    return !!hybridSession.previewController?.isPlaying?.();
}

function compositePreviewVisualTime() {
    const time = hybridSession.previewController?.presentationTime?.();
    return Number.isFinite(Number(time))
        ? Math.max(0, Number(time)) : hybridSession.timelineSeekTime;
}

async function ensureCompositePreviewController() {
    const { sessionId } = readCompositeEditorSnapshot();
    if (hybridSession.previewController
            && hybridSession.previewControllerSessionId === sessionId) {
        return hybridSession.previewController;
    }
    if (hybridSession.previewControllerPending?.sessionId === sessionId) {
        return hybridSession.previewControllerPending.promise;
    }
    const generation = ++hybridSession.previewControllerGeneration;
    const previous = hybridSession.previewController;
    hybridSession.previewController = null;
    hybridSession.previewControllerSessionId = null;
    if (previous) {
        hybridSession.previewControllerDestroyPromise = previous.destroy()
            .catch(() => {});
    }
    const pending = (async () => {
        await hybridSession.previewControllerDestroyPromise;
        const currentEditor = readCompositeEditorSnapshot();
        if (generation !== hybridSession.previewControllerGeneration
                || currentEditor.sessionId !== sessionId
                || currentEditor.format !== 'sloppak') return null;
        let controller = null;
        controller = createCompositePreviewController({
            tone: selectedHybridPreviewTone(),
            volume: hybridPreviewPreferences.volume,
            onStateChange: state => {
                if (hybridSession.previewController !== controller) return;
                hybridSession.previewLoading = !!state.loading;
                if (state.playing) {
                    hybridSession.previewPlaying = true;
                    // Loading a guide tone temporarily halts the private transport.
                    // The display loop sleeps while that load is in progress, so
                    // wake it when the same controller resumes.
                    wakeCompositeTimelinePlayhead();
                }
                if (state.error) {
                    hybridSession.previewPlaying = false;
                    hybridSession.previewMode = '';
                    const message = state.error.message || 'Playback could not start.';
                    setCompositePreviewHelp(message);
                    setCompositeEditorStatus(`Hybrid preview: ${message}`);
                }
                updateCompositePreviewButtons();
            },
        });
        if (generation !== hybridSession.previewControllerGeneration) {
            hybridSession.previewControllerDestroyPromise = controller.destroy()
                .catch(() => {});
            return null;
        }
        hybridSession.previewController = controller;
        hybridSession.previewControllerSessionId = sessionId;
        return controller;
    })();
    const record = { generation, sessionId, promise: pending };
    hybridSession.previewControllerPending = record;
    try {
        return await pending;
    } finally {
        if (hybridSession.previewControllerPending === record) {
            hybridSession.previewControllerPending = null;
        }
    }
}

function updateCompositePreviewButtons() {
    const reviewRefreshPending = !!timelineViewportDom?.reviewRefreshPending;
    const interactionBlocked = hybridSession.analyzing || hybridSession.creating
        || hybridSession.closePromptPending;
    for (const button of document.querySelectorAll('[data-composite-preview]')) {
        const active = button.dataset.compositePreview === hybridSession.previewMode;
        const available = button.dataset.compositePreviewAvailable === 'true';
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute('aria-busy', active && hybridSession.previewLoading
            || reviewRefreshPending ? 'true' : 'false');
        button.disabled = interactionBlocked || hybridSession.previewLoading
            || reviewRefreshPending || !available;
        button.classList.toggle('ring-2', active);
        button.classList.toggle('ring-emerald-400', active);
    }
    const stop = byId('editor-composite-preview-stop');
    if (stop) stop.disabled = interactionBlocked
        || !hybridSession.previewPlaying && !hybridSession.previewLoading;
    for (const control of [
        byId('editor-composite-preview-tone'),
        byId('editor-composite-whole-loop'),
    ]) {
        if (control) control.disabled = interactionBlocked
            || hybridSession.previewLoading || reviewRefreshPending;
    }
}

function setCompositePreviewHelp(message) {
    const help = byId('editor-composite-preview-help');
    if (help) help.textContent = message;
}

function endCompositePreviewPlayback() {
    const hadPreview = hybridSession.previewPlaying || hybridSession.previewLoading
        || !!hybridSession.previewMode;
    const controller = hybridSession.previewController;
    const previewTime = controller?.presentationTime?.();
    if ((hybridSession.stage === 'final-preview' || hybridSession.stage === 'review')
            && Number.isFinite(Number(previewTime))) {
        hybridSession.timelineSeekTime = Math.max(0, Number(previewTime));
    }
    hybridSession.previewRequestId++;
    controller?.stop?.();
    cancelCompositeTimelineCoverageRepair(timelineViewportDom);
    resetCompositeTimelinePageFollow(timelineViewportDom);
    // Settle any fractional compositor camera into the real scrollbar before
    // playback stops, so manual scrolling resumes from the exact visible view.
    syncCompositeTimelineNativeCamera(timelineViewportDom);
    hybridSession.previewPlaying = false;
    hybridSession.previewLoading = false;
    hybridSession.previewMode = '';
    hybridSession.previewRecordingGain = 1;
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelinePlayheadFrame = 0;
    hybridPerfResetFrame('timeline.playhead');
    updateCompositePreviewButtons();
    // Leave both the main line and overview marker at the exact captured
    // transport position instead of the previous animation-frame sample.
    refreshCompositeTimelinePlayheadNow();
    setCompositePreviewHelp('One source at a time · level-matched.');
    if (hadPreview) setCompositeEditorStatus('Hybrid preview stopped.');
}

function toggleCompositePreview(mode) {
    if (!requireCurrentCompositePlan() || !compositePreviewTransportAvailable()) return;
    if (hybridSession.previewMode === mode
            && (hybridSession.previewPlaying || hybridSession.previewLoading)) {
        endCompositePreviewPlayback();
        return;
    }
    startCompositePreview(mode);
}

function disposeCompositePreviewSession() {
    endCompositePreviewPlayback();
    hybridSession.previewControllerGeneration++;
    hybridSession.previewControllerPending = null;
    const controller = hybridSession.previewController;
    hybridSession.previewController = null;
    hybridSession.previewControllerSessionId = null;
    if (controller) {
        hybridSession.previewControllerDestroyPromise = controller.destroy()
            .catch(() => {});
    }
}

function clearTransientState() {
    flushHybridPreviewPreferences();
    cancelCompositeChoicePrompt();
    hybridSession.closeDecisionResolve?.('discard');
    compositeModalSessionId = null;
    stopCompositeModalDocumentKeyboard();
    stopHybridDialogSizePersistence();
    stopCompositeTimelineUi();
    invalidateCompositeTimelineView({ base: true });
    disposeCompositePreviewSession();
    resetHybridBuilderReview(hybridSession);
}

function setCompositeReviewMode(reviewing) {
    const workspace = byId('editor-composite-workspace');
    const setup = byId('editor-composite-setup');
    const result = byId('editor-composite-result-workspace');
    if (setup) setup.hidden = reviewing;
    if (result) result.hidden = !reviewing;
    if (workspace) workspace.style.gridTemplateColumns = 'minmax(0, 1fr)';
    const finish = byId('editor-composite-finish');
    if (finish && !reviewing) finish.hidden = true;
    if (!reviewing) stopCompositeTimelineUi();
    const analyze = byId('editor-composite-analyze');
    if (analyze) analyze.hidden = reviewing;
    const resume = byId('editor-composite-return-review');
    if (resume) resume.hidden = reviewing || !hybridSession.plan;
    if (!reviewing && hybridSession.plan) updateCompositeSetupDirtyState();
    updateCompositeStageIndicator(reviewing ? hybridSession.stage : 'setup');
}

function noteTechLabel(note) {
    return compositeTechniqueLabels(note).join(', ');
}

function entryMarkup(entry, checkboxName = '', stringCount = 6) {
    const length = Math.max(0, entry.endBeat - entry.startBeat);
    const tech = noteTechLabel(entry.note);
    const displayString = Math.max(1, stringCount - entry.string);
    const body = `<span class="text-gray-200">String ${displayString}, fret ${entry.fret}</span>`
        + `<span class="font-mono text-gray-500">beat ${entry.startBeat.toFixed(3)}</span>`
        + (length > 1e-4 ? `<span class="text-gray-500">holds ${length.toFixed(3)} beats</span>` : '')
        + (tech ? `<span class="text-amber-300">${_editorEscHtml(tech)}</span>` : '');
    if (!checkboxName) return `<li class="flex flex-wrap gap-x-3 gap-y-0.5 py-1">${body}</li>`;
    return `<label class="flex items-center gap-2 py-1 cursor-pointer hover:bg-dark-600/50 rounded px-1">`
        + `<input type="checkbox" data-entry-id="${entry.id}" name="${checkboxName}" class="accent-accent">`
        + `<span class="flex flex-wrap gap-x-3 gap-y-0.5">${body}</span></label>`;
}

function conflictReason(group) {
    if ((group.reasons || []).includes('guided-choice')) {
        return (group.reasons || []).includes('transition')
            ? 'a source handoff needs a playable transition'
            : 'both arrangements contain different material';
    }
    const reasons = [];
    if ((group.reasons || []).includes('same-string-overlap')) reasons.push('different notes overlap on the same string');
    if ((group.reasons || []).includes('note-variant')) reasons.push('the same position has different sustain, technique, or harmony data');
    const overlapMilliseconds = Math.round(Math.max(0, Number(group.overlapSeconds) || 0) * 1000);
    const overlap = overlapMilliseconds > 0 ? ` (${overlapMilliseconds} ms overlap)` : '';
    return `${reasons.join('; ') || 'source notes require a choice'}${overlap}`;
}

function selectedSourceNames() {
    if (hybridSession.plan) {
        return {
            primary: hybridSession.plan.primary?.name || 'Base track',
            secondary: hybridSession.plan.secondary?.name || 'Fill track',
        };
    }
    const primaryIndex = Number(byId('editor-composite-primary')?.value);
    const secondaryIndex = Number(byId('editor-composite-secondary')?.value);
    const { arrangements } = readCompositeEditorSnapshot();
    return {
        primary: arrangements[primaryIndex]?.name || 'Base track',
        secondary: arrangements[secondaryIndex]?.name || 'Fill track',
    };
}

function guidedRepeatContext(plan, block) {
    return guidedReviewContext(plan, block);
}

function resolveReviewChoice(plan, conflictId, resolution, selectedEntryIds = []) {
    return plan?.strategy === 'guided'
        ? resolveGuidedRepeatGroup(plan, conflictId, resolution, selectedEntryIds)
        : resolveCompositeConflict(plan, conflictId, resolution, selectedEntryIds);
}

function clearReviewChoice(plan, conflictId) {
    return plan?.strategy === 'guided'
        ? clearGuidedRepeatGroup(plan, conflictId)
        : clearCompositeConflictResolution(plan, conflictId);
}

function guidedOccurrenceMarkup(context, activeBlock) {
    if (!context || !context.grouped) return '';
    const chips = context.members.map(({ block, index }, occurrenceIndex) => {
        const active = block.id === activeBlock.id;
        const stateClass = block.validationError ? 'border-red-500 text-red-200'
            : block.resolution ? 'border-emerald-600 text-emerald-200'
                : 'border-amber-600 text-amber-100';
        return `<button type="button" data-conflict-index="${index}" aria-current="${active ? 'true' : 'false'}" class="px-2 py-1 rounded border ${stateClass} ${active ? 'ring-2 ring-white/70' : 'bg-dark-700'}">`
            + `${occurrenceIndex + 1}. ${_editorEscHtml(block.label)}</button>`;
    }).join('');
    return `<div class="mb-3 rounded-lg border border-sky-800/50 bg-sky-950/20 px-3 py-2">`
        + `<div><b class="text-sm text-sky-100">This riff appears ${context.members.length} times</b>`
        + `<p class="text-xs text-sky-200/80 mt-1">Your choice will be used in every section shown below. Each copy is checked separately so its surrounding notes remain playable.</p></div>`
        + `<div class="flex flex-wrap gap-1.5 mt-2">${chips}</div>`
        + `<details class="mt-2 text-xs text-gray-400"><summary class="cursor-pointer hover:text-gray-200">More options</summary>`
        + `<button type="button" id="editor-composite-detach-occurrence" class="mt-2 px-2.5 py-1.5 rounded bg-dark-700 hover:bg-dark-600 text-xs">Choose differently in this section</button></details></div>`;
}

function activateGuidedReviewGroup(plan, group, preferUnresolved = true) {
    if (!plan || !group) return false;
    let index = -1;
    for (const memberId of group.memberIds) {
        const candidate = plan.conflicts.findIndex(block => block.id === memberId
            && (!preferUnresolved || !block.resolution));
        if (candidate >= 0) { index = candidate; break; }
    }
    if (index < 0) index = plan.conflicts.findIndex(block => group.memberIds.includes(block.id));
    if (index < 0) return false;
    hybridSession.conflictIndex = index;
    return true;
}

function customDetailsMarkup(group) {
    const draft = hybridSession.customDrafts.get(group.id)
        || (group.resolution === 'custom' ? group.selectedEntryIds : null);
    if (!draft) return '';
    const checked = new Set(draft);
    const stringCount = hybridSession.plan?.compatibility?.stringCount || 6;
    const render = (entry) => entryMarkup(entry, `custom-${group.id}`, stringCount).replace(
        `data-entry-id="${entry.id}"`, `data-entry-id="${entry.id}"${checked.has(entry.id) ? ' checked' : ''}`);
    const names = selectedSourceNames();
    return `<div class="border-t border-gray-700 pt-3"><b class="text-sm text-amber-100">Manual note list</b>`
        + `<p class="mt-1 text-xs text-gray-300">You can click the outlined notes in the tracks above, or use these checkboxes. Connected notes, chords, and trails stay together.</p>`
        + `<div class="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2"><div><b class="text-sky-300">${_editorEscHtml(names.primary)}</b>${group.primaryEntries.map(render).join('')}</div>`
        + `<div><b class="text-violet-300">${_editorEscHtml(names.secondary)}</b>${group.secondaryEntries.map(render).join('')}</div></div></div>`;
}

function renderPreviewControls(view, wholeSong = false) {
    const resultReady = wholeSong || !!view.conflict.resolution;
    const buttonClass = 'px-2.5 py-1.5 rounded border border-gray-600 bg-dark-700 hover:border-gray-400 text-xs disabled:opacity-40 disabled:cursor-not-allowed';
    const colors = { song: '', primary: ' text-sky-200', secondary: ' text-violet-200', result: ' text-emerald-200' };
    const modes = compositePreviewModesPure(view, {
        audioAvailable: compositePreviewAudioAvailable(),
        resultReady,
    });
    const shortcut = { song: '1', primary: '2', secondary: '3', result: '4' };
    const buttons = modes.map(mode => `<button type="button" data-composite-preview="${mode.id}" data-composite-preview-available="${mode.available ? 'true' : 'false'}" aria-pressed="false" class="${buttonClass}${colors[mode.id]}" ${mode.available ? '' : 'disabled'} title="${_editorEscHtml(mode.unavailableReason || `${mode.label} (${shortcut[mode.id]})`)}">▶ ${_editorEscHtml(mode.label)}</button>`).join('');
    const toneOptions = HYBRID_PREVIEW_TONES.map(tone => `<option value="${tone.id}"${tone.id === hybridPreviewPreferences.tone ? ' selected' : ''}>${_editorEscHtml(tone.label)}</option>`).join('');
    return `<div class="mb-2 rounded-lg border border-gray-700 bg-dark-900/70 px-2.5 py-1.5">`
        + `<div class="flex flex-wrap items-center gap-2"><span class="text-xs text-gray-300 font-semibold mr-1">${wholeSong ? 'Preview full song' : 'Listen to this section'}</span>`
        + buttons
        + `<button type="button" id="editor-composite-preview-stop" class="${buttonClass}" disabled>■ Stop</button>`
        + `<button type="button" id="editor-composite-preview-restart" class="${buttonClass}" title="Return to the beginning of this ${wholeSong ? 'song' : 'review section'}">↤ Restart ${wholeSong ? 'song' : 'section'}</button>`
        + `<label class="flex items-center gap-1.5 text-xs text-gray-300"><span class="font-semibold">Tone</span><select id="editor-composite-preview-tone" class="rounded border border-gray-600 bg-dark-700 px-2 py-1 text-xs text-gray-100" title="Used for Base, Fill, and Hybrid previews">${toneOptions}</select></label>`
        + `<label class="flex items-center gap-1.5 text-xs text-gray-300"><span class="whitespace-nowrap font-semibold">Volume</span><input id="editor-composite-preview-volume" type="range" min="0" max="100" step="1" value="${hybridPreviewPreferences.volume}" class="w-20 flex-none accent-accent" aria-describedby="editor-composite-preview-help"><output id="editor-composite-preview-volume-value" for="editor-composite-preview-volume" class="w-9 text-right tabular-nums text-gray-200">${hybridPreviewPreferences.volume}%</output></label>`
        + (wholeSong
            ? `<button type="button" id="editor-composite-whole-loop" aria-pressed="${hybridSession.wholeSongLoop}" class="${buttonClass}${hybridSession.wholeSongLoop ? ' ring-2 ring-sky-400' : ''}" title="Repeat the whole song">↻ Loop</button>`
            : `<button type="button" id="editor-composite-keep-loop" class="${buttonClass}">Keep loop in editor</button>`)
        + `<span id="editor-composite-preview-help" class="ml-auto min-w-40 flex-1 text-right text-[11px] text-gray-400" aria-live="polite">One source at a time · level-matched.${wholeSong ? ' Loops only when Loop is on.' : ' This section repeats.'}</span></div></div>`;
}

function currentConflictView() {
    if (!hybridSession.plan || !hybridSession.plan.conflicts.length) return null;
    const plan = hybridSession.plan;
    const group = plan.conflicts[hybridSession.conflictIndex];
    const names = selectedSourceNames();
    const hasDraft = hybridSession.customDrafts.has(group.id);
    const draft = _compositeReviewCustomSelectionPure(
        group, hybridSession.customDrafts.get(group.id), hasDraft);
    const resultEntries = resolvedCompositeEntriesForPlan(plan);
    let modelIndex = compositeConflictViewPlanIndexes.get(plan);
    if (!compositeConflictViewIndexMatches(modelIndex, {
        plan, resolvedEntries: resultEntries,
    })) {
        modelIndex = createCompositeConflictViewIndex({
            plan, resolvedEntries: resultEntries,
        });
        compositeConflictViewPlanIndexes.set(plan, modelIndex);
    }
    if (conflictViewCache?.plan === plan
            && conflictViewCache.conflict === group
            && conflictViewCache.draft === draft
            && conflictViewCache.resolutionRevision === hybridSession.resolutionRevision
            && conflictViewCache.primaryName === names.primary
            && conflictViewCache.secondaryName === names.secondary
            && conflictViewCache.modelIndex === modelIndex) return conflictViewCache.view;
    const view = buildCompositeConflictViewModel({
        plan,
        conflictIndex: hybridSession.conflictIndex,
        primaryName: names.primary,
        secondaryName: names.secondary,
        customEntryIds: draft,
        modelIndex,
        resolvedEntries: resultEntries,
    });
    conflictViewCache = {
        plan,
        conflict: group,
        draft,
        resolutionRevision: hybridSession.resolutionRevision,
        primaryName: names.primary,
        secondaryName: names.secondary,
        modelIndex,
        view,
    };
    return view;
}

function resolvedCompositeEntriesForPlan(plan) {
    if (!plan) return [];
    const revision = compositePlanResolutionRevision(plan);
    const cached = compositeResolvedEntryPlanCache.get(plan);
    if (cached?.revision === revision
            && cached.conflicts === plan.conflicts
            && cached.fixedEntries === plan.fixedEntries) return cached.entries;
    const entries = compositeResolvedEntries(plan);
    compositeResolvedEntryPlanCache.set(plan, {
        revision,
        conflicts: plan.conflicts,
        fixedEntries: plan.fixedEntries,
        entries,
    });
    return entries;
}

function wholePlanPreviewView() {
    if (!hybridSession.plan) return null;
    const plan = hybridSession.plan;
    const names = selectedSourceNames();
    const result = resolvedCompositeEntriesForPlan(plan);
    const durationSeconds = compositePreviewTimelineDuration();
    const signature = [
        hybridSession.planRevision,
        hybridSession.resolutionRevision,
        plan.beats,
        plan.sourceEntries?.primary,
        plan.sourceEntries?.secondary,
        plan.conflicts,
        plan.fixedEntries,
        result,
        durationSeconds,
        names.primary,
        names.secondary,
    ];
    return compositeBaseTimelineViews.get(plan, signature,
        () => buildCompositeTimelineViewModel({
            plan,
            primaryName: names.primary,
            secondaryName: names.secondary,
            resultEntries: result,
            resultEntriesPrepared: true,
            durationSeconds,
        }));
}

function reviewPlanTimelineView(preparedConflictView = null) {
    const conflictView = preparedConflictView || currentConflictView();
    if (!conflictView || !hybridSession.plan) return null;
    const localResult = conflictView.lanes.find(lane => lane.id === 'result')?.entries || [];
    const baseView = wholePlanPreviewView();
    if (!baseView) return null;
    const baseResult = baseView.lanes.find(lane => lane.id === 'result')?.entries || [];
    const resultEntries = compositeReviewResultEntries(baseResult, localResult);
    const lanes = resultEntries === baseResult ? baseView.lanes
        : baseView.lanes.map(lane => lane.id === 'result'
            ? { ...lane, entries: resultEntries } : lane);
    const group = hybridSession.plan.conflicts[hybridSession.conflictIndex];
    const review = {
        id: group.id,
        index: hybridSession.conflictIndex,
        startBeat: group.startBeat,
        endBeat: group.endBeat,
        contextStartBeat: conflictView.context.startBeat,
        contextEndBeat: conflictView.context.endBeat,
        state: group.validationError ? 'invalid' : group.resolution ? 'resolved' : 'unresolved',
        label: group.label,
    };
    const annotations = new Map(conflictView.lanes.flatMap(lane => lane.entries
        .map(entry => [`${lane.id}:${entry.id}`, entry])));
    const manualSelectionActive = hybridSession.customDrafts.has(group.id)
        || group.resolution === 'custom';
    return {
        ...baseView,
        lanes,
        review,
        entryAnnotations: annotations,
        wholeSong: false,
        manualSelectionActive,
        selectedLaneId: manualSelectionActive ? 'result'
        : group.resolution === 'primary' || group.resolution === 'secondary'
            ? group.resolution : '',
        playbackContext: conflictView.context,
        conflict: conflictView.conflict,
        hasFillAdditions: baseView.hasFillAdditions || (resultEntries !== baseResult
            && resultEntries.some(entry => entry.source === 'secondary'
                && !(entry.sources || []).includes('primary'))),
    };
}

function currentTimelineView(preparedConflictView = null) {
    const cacheKey = `${hybridSession.stage}:${hybridSession.conflictIndex}`
        + `:${hybridSession.planRevision}:${hybridSession.resolutionRevision}`;
    if (timelineViewCache?.plan === hybridSession.plan
            && timelineViewCache.key === cacheKey) return timelineViewCache.view;
    const view = hybridSession.stage === 'final-preview'
        ? wholePlanPreviewView() : reviewPlanTimelineView(preparedConflictView);
    timelineViewCache = { plan: hybridSession.plan, key: cacheKey, view };
    return view;
}

function invalidateCompositeTimelineView({ base = false } = {}) {
    timelineViewCache = null;
    conflictViewCache = null;
    if (base) compositeBaseTimelineViews.invalidate(hybridSession.plan);
}

function currentPreviewView() {
    return currentTimelineView() || currentConflictView() || wholePlanPreviewView();
}

function compositePreviewEventsForMode(mode) {
    const plan = hybridSession.plan;
    if (!plan || !['primary', 'secondary', 'result'].includes(mode)) return [];
    let cache = compositePreviewEventPlanCache.get(plan);
    if (!cache) {
        cache = { primary: null, secondary: null, result: null, resultRevision: -1 };
        compositePreviewEventPlanCache.set(plan, cache);
    }
    const arrangement = mode === 'secondary' ? plan.secondary : plan.primary;
    const stringCount = plan.compatibility?.stringCount;
    if (mode !== 'result' && cache[mode] !== null) return cache[mode];
    if (mode === 'result' && cache.result !== null
            && cache.resultRevision === hybridSession.resolutionRevision) return cache.result;
    const entries = mode === 'result'
        ? resolvedCompositeEntriesForPlan(plan) : plan.sourceEntries?.[mode] || [];
    const events = convertCompositePreviewEvents(
        entries, arrangement, plan.beats, stringCount);
    cache[mode] = events;
    if (mode === 'result') cache.resultRevision = hybridSession.resolutionRevision;
    return events;
}

function scheduleCompositePreviewEventPrewarm(plan = hybridSession.plan) {
    if (!plan) return;
    const audio = readCompositePreviewAudioSnapshot();
    const peaks = audio.waveformPeaks;
    const tasks = [
        ...(peaks ? [() => prewarmCompositeRecordingSummaryPeak(peaks)] : []),
        ...(audio.activeBuffer ? [() => {
            const current = readCompositePreviewAudioSnapshot();
            if (current.activeBuffer !== audio.activeBuffer
                    || current.waveformPeaks !== audio.waveformPeaks) return;
            const view = currentPreviewView();
            if (view) recordingPreviewGainFor(view, audio);
        }] : []),
        ...(plan.conflicts?.length
            ? [() => prewarmCompositeConflictResolutionIndex(plan)] : []),
        ...['primary', 'secondary', 'result'].map(mode =>
            () => compositePreviewEventsForMode(mode)),
    ];
    let index = 0;
    const queue = () => scheduleCompositeTimelineIdle(deadline => {
        if (hybridSession.plan !== plan
                || !hybridPlanEditorIsCurrent()) return;
        if (compositeTimelineInputPending()
                || Math.max(0, Number(deadline?.timeRemaining?.()) || 0) < 8) {
            queue();
            return;
        }
        tasks[index++]();
        if (index < tasks.length) queue();
    });
    queue();
}

function setCompositeContextLoop(controller, view, requestedStartTime = null) {
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    const wholeSong = !!view.wholeSong;
    controller.setRange(region.startTime, region.endTime);
    controller.setLoop({
        enabled: wholeSong ? hybridSession.wholeSongLoop : true,
        startTime: region.startTime,
        endTime: region.endTime,
    });
    const requested = Number(requestedStartTime);
    const startTime = Number.isFinite(requested)
        ? Math.max(region.startTime, Math.min(region.endTime - 0.01, requested))
        : region.startTime;
    hybridSession.timelineSeekTime = startTime;
    return { region, startTime };
}

async function startCompositePreview(mode) {
    if (!requireCurrentCompositePlan() || !compositePreviewTransportAvailable()) return;
    if (timelineViewportDom?.reviewRefreshPending) {
        const message = 'Updating the tracks for your choice…';
        setCompositePreviewHelp(message);
        setCompositeEditorStatus(`Hybrid preview: ${message}`);
        return;
    }
    const previewRequestStartedAt = hybridPerfStart();
    const plan = hybridSession.plan;
    const view = currentPreviewView();
    if (!view) return;
    const audio = readCompositePreviewAudioSnapshot();
    const controller = await ensureCompositePreviewController();
    if (!controller || hybridSession.plan !== plan
            || !hybridPlanEditorIsCurrent()) return;
    let requestedStartTime = (hybridSession.previewPlaying || hybridSession.previewMode)
        ? compositePreviewVisualTime() : hybridSession.timelineSeekTime;
    const resultReady = !!view.wholeSong || !!view.conflict?.resolution
        || hybridSession.stage === 'final-preview';
    const modeModel = compositePreviewModesPure(view, {
        audioAvailable: audio.available,
        resultReady,
    }).find(candidate => candidate.id === mode);
    if (!modeModel || !modeModel.available) {
        const reason = modeModel?.unavailableReason || 'This preview is not available.';
        setCompositePreviewHelp(reason);
        setCompositeEditorStatus(`Hybrid preview: ${reason}`);
        return;
    }
    const tone = selectedHybridPreviewTone();
    // A new choice replaces the sound already playing immediately; do not let
    // the previous Original/guide mode continue underneath a loading message.
    const wasPreviewPlaying = controller.isPlaying();
    controller.stop();
    stopCompositeEditorPlayback();
    const requestId = ++hybridSession.previewRequestId;
    const previewRequestIsCurrent = () => requestId === hybridSession.previewRequestId
        && hybridSession.plan === plan
        && hybridSession.previewController === controller
        && hybridPlanEditorIsCurrent();
    const settleStalePreviewRequest = () => {
        if (hybridSession.plan === plan
                && !hybridPlanEditorIsCurrent()) {
            requireCurrentCompositePlan();
        }
    };
    hybridSession.previewMode = mode;
    hybridSession.previewLastMode = mode;
    hybridSession.previewPlaying = false;
    hybridSession.previewLoading = true;
    updateCompositePreviewButtons();
    setCompositePreviewHelp(mode === 'song'
        ? `Loading ${modeModel.label}…`
        : `Loading ${modeModel.label} · ${tone.label}…`);
    setCompositeEditorStatus(mode === 'song'
        ? `Hybrid preview: loading ${modeModel.label}.`
        : `Hybrid preview: loading the ${tone.label} tone for ${modeModel.label}.`);
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    if (!wasPreviewPlaying && Number(requestedStartTime) >= region.endTime - 0.01) {
        requestedStartTime = region.startTime;
    }
    controller.defineMode('song', {
        kind: 'reference',
        snapshot: audio.reference,
        startTime: region.startTime,
        endTime: region.endTime,
    });
    for (const guideMode of ['primary', 'secondary', 'result']) {
        controller.defineMode(guideMode, {
            kind: 'guide',
            events: () => compositePreviewEventsForMode(guideMode),
            voiceCap: hybridSession.plan.compatibility.stringCount,
            startTime: region.startTime,
            endTime: region.endTime,
        });
    }
    await controller.setMode(mode);
    if (!previewRequestIsCurrent()) {
        settleStalePreviewRequest();
        return;
    }
    await controller.setTone(tone);
    if (!previewRequestIsCurrent()) {
        settleStalePreviewRequest();
        return;
    }
    hybridSession.previewRecordingGain = mode === 'song'
        ? recordingPreviewGainFor(view, audio) : 1;
    controller.setMix(hybridPreviewMixFor(mode));
    const context = setCompositeContextLoop(controller, view, requestedStartTime);
    await controller.seek(context.startTime);
    if (!previewRequestIsCurrent()) {
        settleStalePreviewRequest();
        return;
    }
    const started = await controller.start(mode);
    if (!previewRequestIsCurrent()) {
        settleStalePreviewRequest();
        return;
    }
    hybridSession.previewLoading = false;
    hybridSession.previewPlaying = !!started && controller.isPlaying();
    updateCompositePreviewButtons();
    if (!hybridSession.previewPlaying) {
        const controllerError = controller.state().error;
        hybridSession.previewMode = '';
        const message = controllerError?.message || (mode === 'song'
            ? 'The original recording could not be loaded.'
            : `The ${tone.label} guide tone could not be loaded.`);
        setCompositePreviewHelp(message);
        setCompositeEditorStatus(`Hybrid preview: ${message}`);
        return;
    }
    hybridPerfCount('ui.preview.started');
    hybridPerfEnd('ui.preview.requestMs', previewRequestStartedAt);
    hybridPerfResetFrame('timeline.playhead');
    startCompositeTimelinePlayhead();
    const baseHelp = mode === 'song'
        ? 'Original song · level-matched.'
        : `${modeModel.label} · ${tone.label} · level-matched.`;
    const sourceWarnings = controller.state().warnings || [];
    const warning = sourceWarnings.length
        ? ` ${sourceWarnings.length === 1 ? 'One recording source was unavailable' : `${sourceWarnings.length} recording sources were unavailable`}; playing the available audio.`
        : '';
    const help = `${baseHelp}${warning}`;
    setCompositePreviewHelp(help);
    setCompositeEditorStatus(`Hybrid preview: playing ${modeModel.label}.${warning}`);
}

function keepCompositeContextLoop() {
    if (!requireCurrentCompositePlan() || !compositePreviewTransportAvailable()) return;
    const view = currentPreviewView();
    if (!view) return;
    endCompositePreviewPlayback();
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    keepCompositeEditorLoop(region);
    const button = byId('editor-composite-keep-loop');
    if (button) button.textContent = 'Editor loop set ✓';
    setCompositeEditorStatus(
        'This section will stay looped after you close the Hybrid Track builder.');
}

function restartCompositePreview() {
    if (!requireCurrentCompositePlan() || !compositePreviewTransportAvailable()) return;
    const view = currentPreviewView();
    if (!view || !hybridSession.plan) return;
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    const activeMode = hybridSession.previewMode;
    if (activeMode) endCompositePreviewPlayback();
    seekCompositeTimelineAtTime(region.startTime, {
        center: true,
    });
    if (activeMode) startCompositePreview(activeMode);
    else setCompositeEditorStatus(`Hybrid preview returned to the beginning of the ${view.review ? 'selected section' : 'song'}.`);
}

function renderCompositeReviewToolbar({
    model, group, view, names, repeatContext, rangeLabel, splitMarkup,
} = {}) {
    if (!model || !group || !view) return '';
    const stateClass = `editor-composite-review-state editor-composite-review-state-${model.state}`;
    const choiceClass = id => `editor-composite-review-choice editor-composite-review-choice-${id}`
        + (model.resolution === id ? ' editor-composite-review-choice-active' : '');
    const choices = model.choices.map(choice => `<button type="button" data-resolution="${choice.id}" aria-pressed="${choice.selected}" aria-label="${_editorEscHtml(choice.label)}" class="${choiceClass(choice.id)}" title="${_editorEscHtml(`${choice.label}: ${choice.hint}`)}"><span>${_editorEscHtml(choice.label)}</span></button>`).join('');
    const repeatBadge = model.repeatCount > 1
        ? `<span class="editor-composite-review-repeat">${model.repeatCount} matching sections</span>` : '';
    const manualStatus = model.manualActive
        ? `<div class="editor-composite-manual-status" role="status"><b>Manual mix</b><span>${model.primarySelected} ${_editorEscHtml(names.primary)} + ${model.secondarySelected} ${_editorEscHtml(names.secondary)}</span><span>Click outlined notes to include or remove them.</span>${model.validationError ? `<span id="editor-composite-custom-error" class="editor-composite-review-error" role="alert">${_editorEscHtml(model.validationError)}</span>` : ''}</div>` : '';
    const occurrenceMarkup = guidedOccurrenceMarkup(repeatContext, group);
    const details = `<details class="editor-composite-review-details"><summary>Section details</summary>`
        + `<div class="editor-composite-review-details-panel"><div class="editor-composite-review-details-heading"><b>${_editorEscHtml(group.label)}</b><span>${_editorEscHtml(conflictReason(group))}</span></div>`
        + occurrenceMarkup
        + `<div class="rounded-lg border border-gray-700 bg-dark-900/50 px-3 py-2"><b class="text-sm text-gray-100">Why does this section need review?</b><p class="mt-1 text-xs text-gray-200">${_editorEscHtml(view.explanation)}</p>${renderCompositeDifferenceTable(view)}</div>`
        + customDetailsMarkup(group)
        + (splitMarkup ? `<div class="border-t border-gray-700 pt-3 text-xs text-gray-400">${splitMarkup}</div>` : '')
        + `<details class="border-t border-gray-700 pt-3 text-xs text-gray-400"><summary class="cursor-pointer hover:text-gray-200">Technical note details</summary><div class="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">`
        + `<div><b class="text-sky-300">${_editorEscHtml(names.primary)}</b><ul>${group.primaryEntries.map(entry => entryMarkup(entry, '', view.stringCount)).join('')}</ul></div>`
        + `<div><b class="text-violet-300">${_editorEscHtml(names.secondary)}</b><ul>${group.secondaryEntries.map(entry => entryMarkup(entry, '', view.stringCount)).join('')}</ul></div></div></details></div></details>`;
    const adjustSettings = `<button type="button" id="editor-composite-edit-settings">Adjust settings</button>`;
    const continueLabel = _compositeReviewContinueLabelPure(model.unresolvedDecisions);
    const modeLabel = 'Manual review';
    return `<section class="editor-composite-review-toolbar" aria-label="Review choice ${model.decisionNumber} of ${model.decisionTotal}">`
        + `<div class="editor-composite-review-summary" role="status" aria-live="polite" aria-atomic="true"><div><b>Choice ${model.decisionNumber} of ${model.decisionTotal}</b><span class="editor-composite-review-mode">${_editorEscHtml(modeLabel)}</span><span class="editor-composite-review-location" title="${_editorEscHtml(rangeLabel)}">${_editorEscHtml(group.label)}</span></div>`
        + `<div><span class="${stateClass}">${_editorEscHtml(model.stateLabel)}</span><span class="editor-composite-review-left">${model.unresolvedDecisions} left</span>${repeatBadge}</div></div>`
        + `<div class="editor-composite-review-choices" role="group" aria-label="Choose what to play in this section">${choices}</div>`
        + manualStatus
        + `<div class="editor-composite-review-actions">`
        + `<button type="button" id="editor-composite-prev" aria-label="Previous review section" ${model.decisionNumber <= 1 ? 'disabled' : ''}>← Previous section</button>`
        + `<button type="button" id="editor-composite-next" aria-label="Next review section" ${model.decisionNumber >= model.decisionTotal ? 'disabled' : ''}>Next section →</button>`
        + `<button type="button" id="editor-composite-reset-choice" ${model.canReset ? '' : 'disabled'}>Clear choice</button>`
        + details + adjustSettings
        + `<button type="button" id="editor-composite-apply-next" class="editor-composite-review-continue" ${model.canContinue ? '' : 'disabled'}>${_editorEscHtml(continueLabel)}</button></div></section>`;
}

function compositeReviewStateClass(group) {
    return group?.validationError ? 'border-red-700/60'
        : group?.resolution ? 'border-emerald-700/60' : 'border-amber-700/60';
}

function currentCompositeReviewPresentation(plan, { includeTimeline = true } = {}) {
    if (!plan?.conflicts?.length) return null;
    hybridSession.conflictIndex = Math.max(0, Math.min(
        hybridSession.conflictIndex, plan.conflicts.length - 1));
    const group = plan.conflicts[hybridSession.conflictIndex];
    const repeatContext = guidedRepeatContext(plan, group);
    const names = selectedSourceNames();
    const hasDraft = hybridSession.customDrafts.has(group.id);
    const draft = _compositeReviewCustomSelectionPure(
        group, hybridSession.customDrafts.get(group.id), hasDraft);
    const view = currentConflictView();
    const unresolved = repeatContext
        ? repeatContext.unresolvedDecisions
        : plan.conflicts.filter(conflict => !conflict.resolution).length;
    const rangeLabel = `${group.label} · ${conflictReason(group)}`;
    const splitMarkup = group.splitPoints && group.splitPoints.length
        ? `<div><b class="text-gray-300">Divide this review section at a bar</b><p class="mt-0.5">Use this if the musical part changes inside the highlighted area.</p><div class="flex flex-wrap gap-1 mt-2">${group.splitPoints.map(point => `<button type="button" data-guided-split-beat="${point.beat}" class="px-2 py-1 rounded border border-gray-600 bg-dark-700 hover:border-gray-400">${_editorEscHtml(point.label)}</button>`).join('')}</div></div>`
        : '';
    const decisionNumber = repeatContext
        ? repeatContext.groupIndex + 1 : hybridSession.conflictIndex + 1;
    const decisionTotal = repeatContext ? repeatContext.groups.length : plan.conflicts.length;
    const model = buildCompositeReviewToolbarModel({
        plan,
        conflict: group,
        primaryName: names.primary,
        secondaryName: names.secondary,
        customEntryIds: draft,
        decisionNumber,
        decisionTotal,
        unresolvedDecisions: unresolved,
        repeatCount: repeatContext?.members.length || 1,
        canReset: repeatContext
            ? repeatContext.members.some(candidate => candidate.block.resolution
                || hybridSession.customDrafts.has(candidate.block.id))
            : group.resolution || hasDraft,
    });
    const timelineView = includeTimeline ? currentTimelineView(view) : null;
    if (includeTimeline && !timelineView) return null;
    if (timelineView) timelineView.selectedLaneId = model.selectedLaneId;
    return {
        group,
        repeatContext,
        names,
        view,
        model,
        timelineView,
        stateClass: compositeReviewStateClass(group),
        reviewToolbar: renderCompositeReviewToolbar({
            model, group, view, names, repeatContext, rangeLabel, splitMarkup,
        }),
    };
}

function renderConflict(plan) {
    if (!plan.conflicts.length) {
        return `<div class="rounded border border-emerald-700/50 bg-emerald-950/20 p-4 text-sm text-emerald-100 flex flex-wrap items-center justify-between gap-3">`
            + `<div><b class="block text-base mb-1">No choices needed</b>The tracks match here, or only one track is playing at a time. The hybrid is ready to create.</div>`
            + `<button type="button" id="editor-composite-edit-settings" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">Back and adjust</button></div>`;
    }
    const presentation = currentCompositeReviewPresentation(plan);
    return `<section data-composite-review-shell class="rounded border ${presentation.stateClass} bg-dark-800/70 p-2.5">`
        + renderCompositeTimelineWorkspace(
            presentation.timelineView, false, presentation.reviewToolbar)
        + `</section>`;
}

function enterCompositeFinalPreview() {
    if (!requireCurrentCompositePlan()) return false;
    if (hybridSession.plan.conflicts.some(block => !block.resolution)) return false;
    endCompositePreviewPlayback();
    hybridSession.stage = 'final-preview';
    hybridSession.timelineFocusReview = false;
    renderResult();
    scheduleCompositePreviewEventPrewarm(hybridSession.plan);
    const workspace = byId('editor-composite-result-workspace');
    if (workspace) workspace.scrollTop = 0;
    return true;
}

function toggleCompositeCustomEntry(entryId) {
    if (!requireCurrentCompositePlan()) return;
    const conflict = hybridSession.plan?.conflicts?.[hybridSession.conflictIndex];
    if (!conflict) return;
    const interactionStartedAt = hybridPerfStart();
    const draft = new Set(hybridSession.customDrafts.get(conflict.id)
        || (conflict.resolution === 'custom' ? conflict.selectedEntryIds : []));
    const unitIds = compositeSelectionUnitIds(conflict, entryId);
    const selected = unitIds.length && unitIds.every(unitId => draft.has(unitId));
    for (const unitId of unitIds) {
        if (selected) draft.delete(unitId);
        else draft.add(unitId);
    }
    hybridSession.customDrafts.set(conflict.id, [...draft]);
    resolveReviewChoice(hybridSession.plan, conflict.id, 'custom', [...draft]);
    markHybridResolutionChanged(hybridSession);
    markHybridReviewWork(hybridSession);
    refreshCurrentCompositeReview();
    finishCompositeInteraction('review.manual', interactionStartedAt);
}

function positionCompositeReviewDetails(details) {
    if (!details?.open || !details.isConnected) return false;
    const panel = details.querySelector('.editor-composite-review-details-panel');
    const boundary = byId('editor-composite-result-workspace')
        || byId('editor-composite-dialog');
    if (!panel || !boundary) return false;
    const summaryRect = details.querySelector('summary')?.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();
    const detailsRect = details.getBoundingClientRect();
    const documentRoot = details.ownerDocument?.documentElement;
    if (!summaryRect || !detailsRect) return false;
    const viewportWidth = Number(documentRoot?.clientWidth)
        || Number(globalThis.innerWidth) || 0;
    const viewportHeight = Number(documentRoot?.clientHeight)
        || Number(globalThis.innerHeight) || 0;
    const placement = compositeReviewPopoverPlacementPure({
        anchorRect: summaryRect,
        boundaryRect,
        viewportRect: {
            left: 0, top: 0, right: viewportWidth, bottom: viewportHeight,
        },
        contentHeight: panel.scrollHeight || 480,
    });
    details.classList.toggle(
        'editor-composite-review-details-open-up', placement.openUp);
    panel.style.left = `${placement.left - detailsRect.left}px`;
    panel.style.top = `${placement.top - detailsRect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${placement.width}px`;
    panel.style.maxHeight = `${placement.maxHeight}px`;
    return true;
}

function scheduleCompositeReviewDetailsPlacement() {
    if (reviewDetailsPlacementFrame) cancelAnimationFrame(reviewDetailsPlacementFrame);
    reviewDetailsPlacementFrame = requestAnimationFrame(() => {
        reviewDetailsPlacementFrame = 0;
        for (const details of document.querySelectorAll(
            '#editor-composite-modal .editor-composite-review-details[open]')) {
            positionCompositeReviewDetails(details);
        }
    });
}

function bindCompositeReviewDetails(details) {
    details?.addEventListener('toggle', () => {
        if (details.open) scheduleCompositeReviewDetailsPlacement();
    });
}

function bindCompositeReviewToolbarEvents(toolbar) {
    if (!toolbar) return;
    const reviewActionAvailable = () => hybridSession.stage === 'review'
        && requireCurrentCompositePlan() && compositePreviewTransportAvailable();
    const refreshReviewDecision = () => {
        if (!refreshCurrentCompositeReview()) renderResult();
    };
    for (const details of toolbar.querySelectorAll('.editor-composite-review-details')) {
        bindCompositeReviewDetails(details);
    }
    for (const marker of toolbar.querySelectorAll('[data-conflict-index]')) {
        marker.addEventListener('click', () => {
            if (!reviewActionAvailable()) return;
            hybridSession.conflictIndex = Number(marker.dataset.conflictIndex) || 0;
            prepareCurrentReviewFocus(true);
            refreshReviewDecision();
        });
    }
    for (const button of toolbar.querySelectorAll('[data-guided-split-beat]')) {
        button.addEventListener('click', () => {
            if (!reviewActionAvailable()) return;
            const block = hybridSession.plan.conflicts[hybridSession.conflictIndex];
            const split = splitGuidedRepeatGroup(hybridSession.plan, block.id,
                Number(button.dataset.guidedSplitBeat));
            if (!split.ok) {
                block.validationError = split.error;
                renderResult();
                return;
            }
            markHybridResolutionChanged(hybridSession);
            markHybridReviewWork(hybridSession);
            for (const replacedId of split.replacedBlockIds || [block.id]) {
                hybridSession.customDrafts.delete(replacedId);
            }
            hybridSession.conflictIndex = split.index;
            prepareCurrentReviewFocus(true);
            scheduleCompositePreviewEventPrewarm(hybridSession.plan);
            renderResult();
        });
    }
    toolbar.querySelector('#editor-composite-edit-settings')?.addEventListener('click', () => {
        if (!reviewActionAvailable()) return;
        endCompositePreviewPlayback();
        setCompositeReviewMode(false);
        byId('editor-composite-primary')?.focus();
    });
    const moveDecision = offset => {
        if (!reviewActionAvailable()) return;
        const interactionStartedAt = hybridPerfStart();
        const block = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        const context = guidedRepeatContext(hybridSession.plan, block);
        const target = context?.groups[context.groupIndex + offset];
        if (target) {
            activateGuidedReviewGroup(hybridSession.plan, target, false);
            prepareCurrentReviewFocus(true);
        } else if (!context) {
            hybridSession.conflictIndex = Math.max(0, Math.min(
                hybridSession.plan.conflicts.length - 1,
                hybridSession.conflictIndex + offset,
            ));
            prepareCurrentReviewFocus(true);
        }
        refreshReviewDecision();
        finishCompositeInteraction('review.navigate', interactionStartedAt);
    };
    toolbar.querySelector('#editor-composite-prev')?.addEventListener(
        'click', () => moveDecision(-1));
    toolbar.querySelector('#editor-composite-next')?.addEventListener(
        'click', () => moveDecision(1));
    for (const button of toolbar.querySelectorAll('[data-resolution]')) {
        button.addEventListener('click', () => {
            if (!reviewActionAvailable()) return;
            const interactionStartedAt = hybridPerfStart();
            const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
            const resolution = button.dataset.resolution;
            if (resolution === 'custom') {
                if (!hybridSession.customDrafts.has(conflict.id)) {
                    hybridSession.customDrafts.set(conflict.id,
                        conflict.resolution === 'custom'
                            ? [...conflict.selectedEntryIds]
                            : conflict.primaryEntries.map(entry => entry.id));
                }
                const draft = hybridSession.customDrafts.get(conflict.id);
                resolveReviewChoice(hybridSession.plan, conflict.id, 'custom', draft);
            } else {
                const repeatContext = guidedRepeatContext(hybridSession.plan, conflict);
                for (const member of repeatContext?.members || [{ block: conflict }]) {
                    hybridSession.customDrafts.delete(member.block.id);
                }
                resolveReviewChoice(hybridSession.plan, conflict.id, resolution);
            }
            markHybridResolutionChanged(hybridSession);
            markHybridReviewWork(hybridSession);
            refreshCurrentCompositeReview();
            finishCompositeInteraction('review.choice', interactionStartedAt);
        });
    }
    for (const checkbox of toolbar.querySelectorAll('[data-entry-id]')) {
        checkbox.addEventListener('change', () => {
            toggleCompositeCustomEntry(checkbox.dataset.entryId);
        });
    }
    toolbar.querySelector('#editor-composite-reset-choice')?.addEventListener('click', () => {
        if (!reviewActionAvailable()) return;
        const interactionStartedAt = hybridPerfStart();
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        const context = guidedRepeatContext(hybridSession.plan, conflict);
        for (const member of context?.members || [{ block: conflict }]) {
            hybridSession.customDrafts.delete(member.block.id);
        }
        clearReviewChoice(hybridSession.plan, conflict.id);
        markHybridResolutionChanged(hybridSession);
        markHybridReviewWork(hybridSession);
        refreshCurrentCompositeReview();
        finishCompositeInteraction('review.reset', interactionStartedAt);
    });
    toolbar.querySelector('#editor-composite-detach-occurrence')?.addEventListener('click', () => {
        if (!reviewActionAvailable()) return;
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        hybridSession.customDrafts.delete(conflict.id);
        const detached = detachGuidedRepeatOccurrence(hybridSession.plan, conflict.id);
        if (!detached.ok) conflict.validationError = detached.error;
        else {
            markHybridResolutionChanged(hybridSession);
            markHybridReviewWork(hybridSession);
        }
        renderResult();
    });
    toolbar.querySelector('#editor-composite-apply-next')?.addEventListener('click', () => {
        if (!reviewActionAvailable()) return;
        const interactionStartedAt = hybridPerfStart();
        const context = guidedRepeatContext(hybridSession.plan,
            hybridSession.plan.conflicts[hybridSession.conflictIndex]);
        const target = context?.nextUnresolvedGroup || null;
        if (target) {
            activateGuidedReviewGroup(hybridSession.plan, target);
            prepareCurrentReviewFocus(true);
            refreshReviewDecision();
        } else if (!context) {
            const next = hybridSession.plan.conflicts.findIndex((block, index) =>
                index > hybridSession.conflictIndex && !block.resolution);
            const wrapped = next >= 0 ? next
                : hybridSession.plan.conflicts.findIndex(block => !block.resolution);
            if (wrapped >= 0) {
                hybridSession.conflictIndex = wrapped;
                prepareCurrentReviewFocus(true);
                refreshReviewDecision();
            } else {
                enterCompositeFinalPreview();
            }
        } else {
            enterCompositeFinalPreview();
        }
        finishCompositeInteraction('review.continue', interactionStartedAt);
    });
}

function bindResultEvents() {
    const result = byId('editor-composite-result');
    if (!result || !hybridSession.plan) return;
    const transportActionAvailable = () => requireCurrentCompositePlan()
        && compositePreviewTransportAvailable();
    const guardResultInteraction = event => {
        if (transportActionAvailable()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    for (const type of [
        'click', 'dblclick', 'change', 'input', 'pointerdown', 'keydown', 'wheel',
    ]) {
        result.addEventListener(type, guardResultInteraction, true);
    }
    const reviewToolbar = result.querySelector('.editor-composite-review-toolbar');
    bindCompositeReviewToolbarEvents(reviewToolbar);
    if (!reviewToolbar) {
        byId('editor-composite-edit-settings')?.addEventListener('click', () => {
            if (!transportActionAvailable()) return;
            endCompositePreviewPlayback();
            setCompositeReviewMode(false);
            byId('editor-composite-primary')?.focus();
        });
    }
    byId('editor-composite-back-review')?.addEventListener('click', () => {
        if (!transportActionAvailable()) return;
        endCompositePreviewPlayback();
        hybridSession.stage = 'review';
        prepareCurrentReviewFocus(true);
        renderResult();
    });
    for (const button of result.querySelectorAll('[data-composite-preview]')) {
        button.addEventListener('click', () => toggleCompositePreview(
            button.dataset.compositePreview));
    }
    byId('editor-composite-preview-stop')?.addEventListener('click', () => {
        if (transportActionAvailable()) endCompositePreviewPlayback();
    });
    byId('editor-composite-preview-restart')?.addEventListener('click', restartCompositePreview);
    byId('editor-composite-keep-loop')?.addEventListener('click', keepCompositeContextLoop);
    byId('editor-composite-whole-loop')?.addEventListener('click', () => {
        if (!transportActionAvailable() || hybridSession.previewLoading) return;
        hybridSession.wholeSongLoop = !hybridSession.wholeSongLoop;
        const button = byId('editor-composite-whole-loop');
        if (button) {
            button.setAttribute('aria-pressed', String(hybridSession.wholeSongLoop));
            button.classList.toggle('ring-2', hybridSession.wholeSongLoop);
            button.classList.toggle('ring-sky-400', hybridSession.wholeSongLoop);
        }
        if (hybridSession.stage === 'final-preview' && hybridSession.previewMode) {
            const controller = hybridSession.previewController;
            const view = currentPreviewView();
            if (controller && view) {
                const region = compositePreviewRegionPure(
                    view.playbackContext || view.context, hybridSession.plan.beats);
                controller.setLoop({
                    enabled: hybridSession.wholeSongLoop,
                    startTime: region.startTime,
                    endTime: region.endTime,
                });
            }
        }
        setCompositePreviewHelp(hybridSession.wholeSongLoop
            ? 'Whole-song loop is on. Playback repeats until you press Stop.'
            : 'Whole-song loop is off. Playback stops at the end of the song.');
    });
    byId('editor-composite-preview-tone')?.addEventListener('change', event => {
        if (!transportActionAvailable() || hybridSession.previewLoading) {
            event.target.value = hybridPreviewPreferences.tone;
            return;
        }
        setHybridPreviewPreferences({
            ...hybridPreviewPreferences,
            tone: event.target.value,
        });
        const activeMode = hybridSession.previewMode;
        if (activeMode && activeMode !== 'song') {
            void hybridSession.previewController?.setTone?.(selectedHybridPreviewTone());
            updateActiveHybridPreviewMix();
        } else {
            const tone = selectedHybridPreviewTone();
            setCompositePreviewHelp(`Guide tone set to ${tone.label}. It is used for Base, Fill, and Hybrid previews.`);
        }
    });
    byId('editor-composite-preview-volume')?.addEventListener('input', event => {
        if (!transportActionAvailable()) return;
        setHybridPreviewPreferences({
            ...hybridPreviewPreferences,
            volume: event.target.value,
        }, { deferred: true });
        const value = byId('editor-composite-preview-volume-value');
        if (value) value.textContent = `${hybridPreviewPreferences.volume}%`;
        updateActiveHybridPreviewMix();
    });
    byId('editor-composite-preview-volume')?.addEventListener(
        'change', flushHybridPreviewPreferences);
    if (_compositeTimelineStageActivePure(hybridSession.stage)) {
        bindCompositeTimelineEvents();
    }
}

export function _compositeAutomaticSummaryPure(stats = {}, names = {}) {
    const base = String(names.primary || 'Base track');
    const fill = String(names.secondary || 'Fill track');
    const added = Math.max(0, Number(stats.secondaryAddedCleanly) || 0);
    const skipped = Math.max(0, Number(stats.secondarySkippedByStrategy) || 0);
    return {
        title: 'Ready to create',
        description: `${base} unchanged · ${added} ${fill} ${added === 1 ? 'note' : 'notes'} added · ${skipped} skipped (too close)`,
        added,
        skipped,
    };
}

const COMPOSITE_TIMELINE_ZOOM_PRESETS = Object.freeze([
    Object.freeze([60, 'Compact']),
    Object.freeze([120, 'Normal']),
    Object.freeze([240, 'Detailed']),
    Object.freeze([480, 'Maximum']),
]);

export function _compositeTimelineEffectiveZoomPure(context, viewportWidth, preferences) {
    const normalized = hybridPreviewPreferencesPure(preferences);
    return normalized.timelineDisplayMode === HYBRID_TIMELINE_DISPLAY_OVERVIEW
        ? compositeTimelineFitZoomPure(context, viewportWidth)
        : normalized.timelineZoom;
}

function compositeTimelineDisplayMode() {
    return hybridPreviewPreferences.timelineDisplayMode === HYBRID_TIMELINE_DISPLAY_OVERVIEW
        ? HYBRID_TIMELINE_DISPLAY_OVERVIEW : HYBRID_TIMELINE_DISPLAY_NOTES;
}

export function _compositeGuidedSummaryPure(stats = {}, conflictCount = 0) {
    const count = Math.max(0, Math.trunc(Number(stats.reviewDecisions) || 0));
    if (Math.max(0, Math.trunc(Number(conflictCount) || 0)) === 0) {
        return {
            title: 'No review needed ✓',
            description: 'The tracks match, or only one track plays at a time · inspect or listen before creating',
        };
    }
    return {
        title: 'Review complete ✓',
        description: `${count} ${count === 1 ? 'choice' : 'choices'} complete · inspect or listen before creating`,
    };
}

function compositeTimelineFollowMode() {
    const mode = hybridPreviewPreferences.timelineFollowMode;
    return [
        HYBRID_TIMELINE_FOLLOW_CENTERED,
        HYBRID_TIMELINE_FOLLOW_PAGED,
        HYBRID_TIMELINE_FOLLOW_OFF,
    ].includes(mode) ? mode : HYBRID_TIMELINE_FOLLOW_CENTERED;
}

function compositeTimelineOverviewActive() {
    return compositeTimelineDisplayMode() === HYBRID_TIMELINE_DISPLAY_OVERVIEW;
}

function compositeTimelineEffectiveZoom(view, viewportWidth = 1400) {
    return _compositeTimelineEffectiveZoomPure(
        view?.context, viewportWidth, hybridPreviewPreferences);
}

export function _compositeTimelineZoomControlsPure(zoom,
    displayMode = HYBRID_TIMELINE_DISPLAY_NOTES) {
    const rounded = Math.round(Number(zoom) || HYBRID_PREVIEW_DEFAULTS.timelineZoom);
    const overview = displayMode === HYBRID_TIMELINE_DISPLAY_OVERVIEW;
    const disabled = overview ? ' disabled' : '';
    const presetOptions = COMPOSITE_TIMELINE_ZOOM_PRESETS
        .map(([value, label]) => `<option value="${value}"${rounded === value ? ' selected' : ''}>${label} — ${value} px/beat</option>`)
        .join('');
    const customPreset = COMPOSITE_TIMELINE_ZOOM_PRESETS.some(([value]) => rounded === value)
        ? '' : `<option value="${rounded}" selected>Custom — ${rounded} px/beat</option>`;
    const sliderValue = compositeTimelineSteppedZoomPure(rounded);
    return `<span data-composite-note-zoom-controls${overview ? ' hidden' : ''} style="display:${overview ? 'none' : 'contents'}">`
        + `<label class="text-xs font-semibold text-gray-300">Zoom <select id="editor-composite-time-preset" class="ml-1 rounded border border-gray-600 bg-dark-700 px-2 py-1.5 text-xs text-gray-100"${disabled}>${presetOptions}${customPreset}</select></label>`
        + `<button type="button" data-composite-time-zoom="out" class="rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom out by ${HYBRID_TIMELINE_ZOOM_STEP} pixels per beat"${disabled}>−</button>`
        + `<input id="editor-composite-time-zoom" type="range" min="${HYBRID_TIMELINE_ZOOM_CONTROL_MIN}" max="${HYBRID_TIMELINE_ZOOM_MAX}" step="${HYBRID_TIMELINE_ZOOM_STEP}" value="${sliderValue}" class="w-32 flex-none accent-accent" aria-label="Timeline zoom in pixels per beat" aria-valuetext="${rounded} pixels per beat" title="Fine zoom in ${HYBRID_TIMELINE_ZOOM_STEP} px/beat steps"${disabled}>`
        + `<button type="button" data-composite-time-zoom="in" class="rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom in by ${HYBRID_TIMELINE_ZOOM_STEP} pixels per beat"${disabled}>+</button></span>`
        + `<output id="editor-composite-time-zoom-value" for="editor-composite-time-zoom" class="whitespace-nowrap text-xs tabular-nums text-gray-100" title="${overview ? 'Overview intentionally hides fret numbers and techniques. Turn it off or zoom in to restore note details.' : 'Horizontal spacing in pixels per beat'}">${overview ? 'Whole song · details hidden' : `${rounded} px/beat`}</output>`
        + `<button type="button" id="editor-composite-time-overview" aria-pressed="${overview}" class="rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs disabled:cursor-wait disabled:opacity-60${overview ? ' ring-2 ring-sky-400' : ''}" title="${overview ? 'Turn off Overview to restore your saved note zoom, position, fret numbers, and techniques' : 'Fit the whole song using a lightweight overview'}">Whole-song overview</button>`;
}

function compositeTimelineDisplayBeatAtTime(view, time = hybridSession.timelineSeekTime) {
    const seconds = Number(time);
    const rawBeat = beatOf(view?.beats || hybridSession.plan?.beats || [],
        Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
    return compositeTimelineDisplayBeatPure(rawBeat, view?.context);
}

function compositeTimelineAriaNumber(value) {
    return String(Number(Number(value || 0).toFixed(3)));
}

export function _compositeTimelineSeekAriaPure(view, beat) {
    const start = Number(view?.context?.startBeat) || 0;
    const end = Math.max(start, Number(view?.context?.endBeat) || start);
    const current = compositeTimelineDisplayBeatPure(beat, { startBeat: start, endBeat: end });
    const now = compositeTimelineAriaNumber(current);
    return {
        min: compositeTimelineAriaNumber(start),
        max: compositeTimelineAriaNumber(end),
        now,
        text: `Beat ${now} of ${compositeTimelineAriaNumber(end)}`,
    };
}

function compositeTimelineSeekAriaAttributes(view, beat) {
    const value = _compositeTimelineSeekAriaPure(view, beat);
    return `aria-valuemin="${value.min}" aria-valuemax="${value.max}" `
        + `aria-valuenow="${value.now}" aria-valuetext="${value.text}" aria-live="off"`;
}

function compositeTimelineLaneResizeAriaAttributes(height) {
    const value = compositeTimelineLaneHeightPure(height);
    return `aria-valuemin="${HYBRID_TIMELINE_LANE_MIN}" `
        + `aria-valuemax="${HYBRID_TIMELINE_LANE_MAX}" aria-valuenow="${value}" `
        + `aria-valuetext="${value} pixels high"`;
}

function renderCompositeTimelineMapOverlays(view, viewportRange) {
    const viewport = compositeTimelineMapViewportPure(view, viewportRange);
    const initialBeat = compositeTimelineDisplayBeatAtTime(
        view, hybridSession.timelineSeekTime);
    const span = Math.max(1, view.context.endBeat - view.context.startBeat);
    const playheadX = Math.max(0, Math.min(1000,
        ((initialBeat - view.context.startBeat) / span) * 1000));
    const moverStyle = 'position:absolute;inset:0;width:100%;height:42px;pointer-events:none;will-change:transform;transform-origin:0 0';
    return renderCompositeTimelineActiveDecisionOverlay(view)
        + `<span id="editor-composite-map-viewport" aria-hidden="true" style="${moverStyle};z-index:2;transform:translate3d(${(viewport.x / 10).toFixed(3)}%,0,0)">`
        + `<span data-composite-map-viewport-window style="position:absolute;left:0;top:3px;width:${(viewport.width / 10).toFixed(3)}%;height:36px;box-sizing:border-box;border:2px solid #7dd3fc;border-radius:5px;background:rgba(56,189,248,.08)"></span></span>`
        + `<span id="editor-composite-map-playhead" aria-hidden="true" style="${moverStyle};z-index:3;transform:translate3d(${(playheadX / 10).toFixed(3)}%,0,0)">`
        + `<span style="position:absolute;left:-1px;top:2px;width:2px;height:38px;background:#fb7185"></span></span>`;
}

function renderCompositeTimelineActiveDecisionOverlay(view) {
    const active = view?.review && (view.decisions || [])
        .find(decision => decision.id === view.review.id);
    if (!active) return '';
    const start = Number(view.context?.startBeat) || 0;
    const end = Math.max(start + 1e-9, Number(view.context?.endBeat) || start + 1);
    const span = end - start;
    const left = Math.max(0, Math.min(100,
        ((Number(active.startBeat) - start) / span) * 100));
    const right = Math.max(left, Math.min(100,
        ((Number(active.endBeat) - start) / span) * 100));
    const color = active.state === 'invalid' ? '#f87171'
        : active.state === 'resolved' ? '#34d399' : '#fbbf24';
    return `<span data-composite-map-active-decision data-composite-map-decision="${active.index}" aria-hidden="true" style="position:absolute;z-index:1;left:${left.toFixed(4)}%;top:5px;width:max(2px, ${(right - left).toFixed(4)}%);height:8px;border-radius:2px;background:${color};cursor:pointer"></span>`;
}

function refreshCompositeTimelineActiveDecisionOverlay(map, view) {
    if (!map) return;
    const previous = map.querySelector('[data-composite-map-active-decision]');
    const replacement = elementFromCompositeMarkup(
        renderCompositeTimelineActiveDecisionOverlay(view));
    if (previous && replacement) previous.replaceWith(replacement);
    else if (previous) previous.remove();
    else if (replacement) map.querySelector('svg')?.after(replacement);
}

function compositeTimelineStaticMapInputs(view) {
    return {
        decisions: view?.decisions,
        resultEntries: view?.lanes?.find(lane => lane.id === 'result')?.entries,
        startBeat: Number(view?.context?.startBeat) || 0,
        endBeat: Number(view?.context?.endBeat) || 0,
    };
}

function compositeTimelineStaticMapInputsMatch(left, right) {
    return !!(left && right
        && left.decisions === right.decisions
        && left.resultEntries === right.resultEntries
        && left.startBeat === right.startBeat
        && left.endBeat === right.endBeat);
}

function compositeTimelineMapKeyMarkup(view) {
    const decisionKey = view.decisions.length
        ? (view.decisions.some(decision => decision.state === 'unresolved')
            ? '<span><i class="editor-composite-map-review" aria-hidden="true"></i>Needs review</span>' : '')
            + (view.decisions.some(decision => decision.state === 'resolved')
                ? '<span><i class="editor-composite-map-resolved" aria-hidden="true"></i>Reviewed sections</span>' : '')
            + (view.decisions.some(decision => decision.state === 'invalid')
                ? '<span><i class="editor-composite-map-invalid" aria-hidden="true"></i>Needs attention</span>' : '')
        : '';
    return `<span><i class="editor-composite-map-base" aria-hidden="true"></i>Hybrid notes</span>`
        + (view.hasFillAdditions
            ? `<span><i class="editor-composite-map-fill" aria-hidden="true"></i>Added from ${_editorEscHtml(view.names.secondary)}</span>` : '')
        + decisionKey;
}

function renderCompositeTimelineWorkspace(view, wholeSong = false, reviewToolbar = '') {
    const displayMode = compositeTimelineDisplayMode();
    const zoom = compositeTimelineEffectiveZoom(view, 1400);
    const width = compositeTimelineContentWidthPure(view.context, zoom);
    const initialPlayheadBeat = compositeTimelineDisplayBeatAtTime(
        view, hybridSession.timelineSeekTime);
    const initialPlayheadX = compositeTimelineXForBeatPure(
        initialPlayheadBeat, view.context, zoom);
    const viewport = compositeTimelineViewportRangePure({
        context: view.context, zoom,
        scrollLeft: hybridSession.timelineScrollLeft,
        viewportWidth: 1400,
    });
    const laneHeights = new Map(view.lanes.map(lane => [lane.id,
        compositeTimelineLaneHeightPure(hybridPreviewPreferences.laneHeights[lane.id])]));
    const cameraShell = slotIndex => {
        const rows = view.lanes.map(lane => {
            const height = laneHeights.get(lane.id);
            return `<div class="relative border-t border-slate-700/80" data-composite-timeline-row="${lane.id}" style="height:${height}px;width:1px;min-width:100%">`
                + `<svg data-composite-timeline-lane-svg="${lane.id}" width="1" height="${height}" role="group" aria-label="${_editorEscHtml(lane.label)} full-song tablature" style="position:absolute;inset:0;display:block;width:1px;height:${height}px;max-width:none;contain:paint"></svg>`
                + `<span data-composite-lane-resize="${lane.id}" role="separator" tabindex="0" aria-orientation="horizontal" ${compositeTimelineLaneResizeAriaAttributes(height)} aria-label="Resize ${_editorEscHtml(lane.label)} track" title="Drag to resize this track; double-click to reset" class="absolute bottom-0 left-0 z-30 h-2 w-full select-none border-0 bg-transparent" style="cursor:row-resize;touch-action:none;user-select:none"></span></div>`;
        }).join('');
        return `<div data-composite-timeline-camera data-composite-timeline-camera-slot="${slotIndex}" class="absolute top-0" style="left:0;width:1px;will-change:transform,opacity;contain:layout paint style;opacity:${slotIndex ? 0 : 1};pointer-events:${slotIndex ? 'none' : 'auto'}">`
            + `<div class="relative border-b border-slate-600" data-composite-timeline-ruler style="height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px;width:1px;min-width:100%">`
            + `<svg data-composite-timeline-ruler-svg width="1" height="${COMPOSITE_TIMELINE_RULER_HEIGHT}" role="slider" tabindex="0" focusable="true" aria-orientation="horizontal" ${compositeTimelineSeekAriaAttributes(view, initialPlayheadBeat)} aria-label="Seek on the bar and beat ruler" style="position:absolute;inset:0;display:block;width:1px;height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px;max-width:none;cursor:pointer;contain:paint"></svg>`
            + `</div>${rows}</div>`;
    };
    const fixedHeaders = `<div data-composite-timeline-fixed-headers class="sticky left-0 top-0 z-50" style="width:${COMPOSITE_TIMELINE_GUTTER}px">`
        + `<div class="relative flex items-center border-b border-r border-slate-600 bg-gray-900 px-3 text-xs font-semibold text-gray-300 shadow-lg" style="width:${COMPOSITE_TIMELINE_GUTTER}px;height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px">Bars and beats</div>`
        + view.lanes.map(lane => renderCompositeTimelineLaneHeader(
            view, lane.id, laneHeights.get(lane.id), { fixed: true })).join('')
        + '</div>';
    const timelineHeight = COMPOSITE_TIMELINE_RULER_HEIGHT
        + [...laneHeights.values()].reduce((sum, height) => sum + height, 0);
    const followMode = hybridPreviewPreferences.timelineFollowMode;
    const followOptions = [
        [HYBRID_TIMELINE_FOLLOW_CENTERED, 'Centered'],
        [HYBRID_TIMELINE_FOLLOW_PAGED, 'Page by page'],
        [HYBRID_TIMELINE_FOLLOW_OFF, 'Off'],
    ].map(([value, label]) => `<option value="${value}"${followMode === value ? ' selected' : ''}>${label}</option>`).join('');
    const title = view.review ? 'Review tracks' : 'Full-song tablature';
    const description = view.review
        ? 'The full song remains available while the highlighted review section stays in focus.'
        : 'All three tracks stay aligned while you scroll, zoom, and resize them.';
    const manualChip = view.manualSelectionActive && !reviewToolbar
        ? `<span class="rounded-full border border-amber-600/60 bg-amber-950/50 px-2 py-1 text-[11px] text-amber-100" role="status" title="Select notes in the aligned tracks; white outlines show notes included in the hybrid">Manual mix · outlined notes are included</span>` : '';
    return `<div class="sticky top-0 z-50 -mx-1 mb-2 rounded-lg border border-slate-700 bg-slate-950/95 p-1.5 shadow-xl backdrop-blur-sm">`
        + renderPreviewControls(view, wholeSong)
        + reviewToolbar
        + `<div class="flex flex-wrap items-center gap-2" title="${_editorEscHtml(description)}"><b class="mr-auto text-sm text-gray-100">${_editorEscHtml(title)}</b>${manualChip}`
        + _compositeTimelineZoomControlsPure(
            hybridPreviewPreferences.timelineZoom, displayMode)
        + `<label class="flex items-center gap-1 text-xs text-gray-300" title="Centered keeps the marker in the middle. Page by page keeps the tracks still until the marker reaches the right edge. Off leaves the view where you put it."><span>Follow</span><select id="editor-composite-time-follow" aria-label="Timeline follow mode" class="rounded border border-gray-600 bg-dark-700 px-2 py-1.5 text-xs text-gray-100">${followOptions}</select></label>`
        + (view.review ? `<button type="button" id="editor-composite-focus-review" class="rounded border border-amber-600/70 bg-amber-950/50 px-2.5 py-1.5 text-xs text-amber-100">Focus section</button>` : '')
        + `<details class="relative"><summary class="cursor-pointer rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs">More</summary><div class="absolute right-0 z-50 mt-1 flex min-w-44 flex-col gap-1 rounded border border-gray-600 bg-dark-800 p-2 shadow-xl">`
        + `<button type="button" id="editor-composite-lanes-equal" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Make tracks equal</button>`
        + `<button type="button" id="editor-composite-lanes-reset" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Reset track sizes</button>`
        + `<p class="mt-1 border-t border-gray-700 pt-1 text-[11px] text-gray-500">Map/ruler: click, drag, or use arrow keys to seek · Ctrl+wheel: zoom · Track edge: drag or use Up/Down to resize · Space: play/stop · 1–4: sound</p></div></details></div></div>`
        + `<section class="rounded-xl border border-slate-700 bg-slate-950/60 p-2">`
        + `<div data-composite-map-key class="editor-composite-map-key">${compositeTimelineMapKeyMarkup(view)}</div>`
        + `<div id="editor-composite-timeline-map" role="slider" tabindex="0" aria-orientation="horizontal" ${compositeTimelineSeekAriaAttributes(view, initialPlayheadBeat)} class="relative mb-1.5 block w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950 p-0 text-left" style="touch-action:none" title="Click or drag to move through the song" aria-label="${_editorEscHtml(compositeTimelineOverviewAccessibleLabelPure(view))}">${renderCompositeTimelineMapSvg(view, viewport)}${renderCompositeTimelineMapOverlays(view, viewport)}</div>`
        + `<div id="editor-composite-timeline-scroller" class="relative overflow-x-auto overflow-y-hidden rounded-lg border border-slate-700 bg-slate-950" style="contain:layout paint style" tabindex="0" aria-label="Scrollable full-song Hybrid timeline; Control plus mouse wheel changes time zoom">`
        + `<div id="editor-composite-timeline-content" class="relative" style="width:${width}px;min-width:100%;height:${timelineHeight}px">`
        + cameraShell(0) + cameraShell(1)
        + fixedHeaders
        + renderCompositeTimelinePlayhead(initialPlayheadX)
        + `</div></div></section>`;
}

function cancelCompositeTimelineStandbyWork(dom = timelineViewportDom) {
    const pendingSlotIndex = dom?.standbyPending ? dom.standbySlotIndex : null;
    timelineRenderGeneration += 1;
    if (timelineStandbyCancel) timelineStandbyCancel();
    timelineStandbyCancel = null;
    if (timelineStandbySwapFrame) cancelAnimationFrame(timelineStandbySwapFrame);
    timelineStandbySwapFrame = 0;
    if (dom) {
        const pendingSlot = dom.cameraSlots?.[pendingSlotIndex];
        if (pendingSlot && pendingSlotIndex !== dom.activeCameraIndex) {
            pendingSlot.ready = false;
            pendingSlot.pendingSignature = '';
            pendingSlot.pendingRange = null;
            setCompositeTimelineCameraSlotActive(pendingSlot, false);
        }
        dom.standbyPending = false;
        dom.standbyPurpose = '';
        dom.standbySlotIndex = null;
        dom.standbyTargetVisualScroll = Number.NaN;
    }
}

function clearCompositeTimelinePagePrefetch(dom = timelineViewportDom) {
    if (!dom) return;
    if (dom.standbyPending && dom.standbyPurpose === 'page-prefetch') {
        cancelCompositeTimelineStandbyWork(dom);
    }
    const slotIndex = dom.pagePreparedSlotIndex;
    const slot = dom.cameraSlots?.[slotIndex];
    if (slot && slotIndex !== dom.activeCameraIndex) {
        slot.ready = false;
        slot.pendingSignature = '';
        slot.pendingRange = null;
        setCompositeTimelineCameraSlotActive(slot, false);
    }
    dom.pagePreparedSlotIndex = null;
    dom.pagePreparedScrollLeft = Number.NaN;
}

function resetCompositeTimelinePageFollow(dom = timelineViewportDom, {
    clearPrefetch = true,
    immediateCatchup = false,
    cancelCoverageRepair = true,
} = {}) {
    if (!dom) return;
    // A queued repair owns an older camera target. Once page intent is reset
    // (mode change, manual scroll, resize, zoom, or model rebuild), allowing
    // that task to settle would jump the camera and blue overview box back to
    // stale geometry. New seeks/camera work can queue a fresh repair normally.
    if (cancelCoverageRepair) cancelCompositeTimelineCoverageRepair(dom);
    dom.pageTransition = null;
    dom.pageTargetWaiting = false;
    dom.pageTargetImmediate = false;
    dom.pageLastTime = Number.NaN;
    dom.pageLastContentX = Number.NaN;
    dom.pageImmediateCatchup = Boolean(immediateCatchup);
    if (clearPrefetch) clearCompositeTimelinePagePrefetch(dom);
}

function scheduleCompositeTimelineIdle(callback, timeoutMs = 0) {
    if (typeof globalThis.requestIdleCallback === 'function') {
        // Soft preparation has no timeout. Urgent coverage and exact-zoom work
        // supply one explicitly so Chromium cannot starve the finite strip
        // throughout uninterrupted playback.
        const timeout = Math.max(0, Number(timeoutMs) || 0);
        const id = globalThis.requestIdleCallback(
            callback, timeout ? { timeout } : undefined);
        return () => globalThis.cancelIdleCallback?.(id);
    }
    const id = setTimeout(() => {
        const started = globalThis.performance?.now?.() || Date.now();
        callback({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 12
                - ((globalThis.performance?.now?.() || Date.now()) - started)),
        });
    }, 0);
    return () => clearTimeout(id);
}

function compositeTimelineInputPending() {
    try {
        return !!globalThis.navigator?.scheduling?.isInputPending?.({
            includeContinuous: true,
        });
    } catch (_) {
        return false;
    }
}

function compositeTimelineCameraSlot(camera, view) {
    if (!camera) return null;
    return {
        camera,
        ruler: camera.querySelector('[data-composite-timeline-ruler]'),
        rulerSvg: camera.querySelector('[data-composite-timeline-ruler-svg]'),
        lanes: new Map(view.lanes.map(lane => [lane.id, {
            row: camera.querySelector(`[data-composite-timeline-row="${lane.id}"]`),
            svg: camera.querySelector(`[data-composite-timeline-lane-svg="${lane.id}"]`),
        }])),
        renderedRange: null,
        renderedZoom: null,
        renderedViewportWidth: 0,
        renderOriginX: 0,
        surfaceWidth: 0,
        timelineHeight: 0,
        renderSignature: '',
        pendingSignature: '',
        pendingRange: null,
        ready: false,
    };
}

function compositeTimelineRenderSignature(dom,
    zoom = compositeTimelineEffectiveZoom(dom?.view, dom?.viewportWidth || 1400)) {
    const laneHeights = (dom?.view?.lanes || []).map(lane =>
        compositeTimelineLaneHeightPure(hybridPreviewPreferences.laneHeights[lane.id]));
    return [compositeTimelineDisplayMode(), Number(zoom).toFixed(4),
        Math.round(Number(dom?.viewportWidth) || 0),
        ...laneHeights].join('|');
}

function setCompositeTimelineCameraSlotActive(slot, active) {
    const camera = slot?.camera;
    if (!camera) return;
    camera.style.opacity = active ? '1' : '0';
    camera.style.pointerEvents = active ? 'auto' : 'none';
    camera.style.zIndex = active ? '10' : '0';
    camera.setAttribute('aria-hidden', String(!active));
    camera.toggleAttribute('inert', !active);
    if ('inert' in camera) camera.inert = !active;
}

function activateCompositeTimelineCameraSlot(dom, slotIndex) {
    const slot = dom?.cameraSlots?.[slotIndex];
    if (!slot) return null;
    dom.activeCameraIndex = slotIndex;
    dom.camera = slot.camera;
    dom.ruler = slot.ruler;
    dom.rulerSvg = slot.rulerSvg;
    dom.lanes = slot.lanes;
    dom.renderedRange = slot.renderedRange;
    dom.renderedZoom = slot.renderedZoom;
    dom.renderedViewportWidth = slot.renderedViewportWidth;
    dom.renderOriginX = slot.renderOriginX;
    dom.surfaceWidth = slot.surfaceWidth;
    return slot;
}

function recordCompositeTimelineGauges(dom) {
    if (!hybridPerformanceEnabled() || !dom?.view) return;
    const nodeCount = dom.content?.querySelectorAll?.('*')?.length || 0;
    const entryCount = dom.view.lanes.reduce(
        (total, lane) => total + (lane.entries?.length || 0), 0);
    hybridPerfGauge('timeline.domNodes', nodeCount);
    hybridPerfGauge('timeline.entries', entryCount);
    hybridPerfGauge('timeline.cameraSlots', dom.cameraSlots?.length || 0);
    hybridPerfSample('timeline.domNodes.sample', nodeCount);
}

function compositeTimelineCameraRenderPlan(dom, slot, geometry, zoom) {
    const view = dom.view;
    const visible = geometry.renderRange;
    const renderOptions = {
        renderOriginX: geometry.renderOriginX,
        surfaceWidth: geometry.surfaceWidth,
        overviewDensity: compositeTimelineOverviewActive(),
    };
    let timelineHeight = COMPOSITE_TIMELINE_RULER_HEIGHT;
    const steps = [() => {
        slot.camera.style.left = `${geometry.renderOriginX}px`;
        slot.camera.style.width = `${geometry.surfaceWidth}px`;
        slot.camera.dataset.compositeRenderOriginX = String(geometry.renderOriginX);
        if (slot.ruler) slot.ruler.style.width = `${geometry.surfaceWidth}px`;
        if (slot.rulerSvg) {
            const renderStartedAt = hybridPerfStart();
            slot.rulerSvg.setAttribute('width', String(geometry.surfaceWidth));
            slot.rulerSvg.style.width = `${geometry.surfaceWidth}px`;
            slot.rulerSvg.innerHTML = renderCompositeTimelineRulerContents(
                view, visible, zoom, renderOptions);
            hybridPerfEnd('timeline.ruler.renderMs', renderStartedAt);
        }
    }];
    for (const lane of view.lanes) {
        const laneDom = slot.lanes.get(lane.id);
        const height = compositeTimelineLaneHeightPure(
            hybridPreviewPreferences.laneHeights[lane.id]);
        timelineHeight += height;
        steps.push(() => {
            if (laneDom?.row) {
                laneDom.row.style.width = `${geometry.surfaceWidth}px`;
                laneDom.row.style.height = `${height}px`;
            }
            if (laneDom?.svg) {
                const renderStartedAt = hybridPerfStart();
                laneDom.svg.setAttribute('width', String(geometry.surfaceWidth));
                laneDom.svg.setAttribute('height', String(height));
                laneDom.svg.style.width = `${geometry.surfaceWidth}px`;
                laneDom.svg.style.height = `${height}px`;
                laneDom.svg.innerHTML = renderCompositeTimelineLaneContents(
                    view, lane.id, height, visible, zoom, renderOptions);
                hybridPerfEnd('timeline.lane.renderMs', renderStartedAt);
            }
        });
    }
    steps.push(() => {
        slot.renderOriginX = geometry.renderOriginX;
        slot.surfaceWidth = geometry.surfaceWidth;
        slot.renderedRange = visible;
        slot.renderedZoom = zoom;
        slot.renderedViewportWidth = dom.viewportWidth;
        slot.timelineHeight = timelineHeight;
        slot.renderSignature = compositeTimelineRenderSignature(dom, zoom);
        slot.ready = true;
        recordCompositeTimelineGauges(dom);
    });
    return { steps, timelineHeight };
}

function renderCompositeTimelineCameraSlot(dom, slot, geometry, zoom) {
    const plan = compositeTimelineCameraRenderPlan(dom, slot, geometry, zoom);
    for (const step of plan.steps) step();
    return plan.timelineHeight;
}

function updateCompositeTimelineFixedLaneHeights(dom) {
    if (!dom?.view || !dom.content) return;
    let timelineHeight = COMPOSITE_TIMELINE_RULER_HEIGHT;
    for (const lane of dom.view.lanes) {
        const height = compositeTimelineLaneHeightPure(
            hybridPreviewPreferences.laneHeights[lane.id]);
        timelineHeight += height;
        const header = dom.headers?.get(lane.id);
        if (header) header.style.height = `${height}px`;
    }
    dom.content.style.height = `${timelineHeight}px`;
}

function compositeTimelineFocusedControl(camera) {
    const active = document.activeElement;
    if (!camera?.contains(active)) return null;
    const note = active.closest?.('[data-composite-entry-id]');
    if (note) {
        return {
            kind: 'note',
            value: note.dataset.compositeEntryId,
            laneId: note.closest?.('[data-composite-timeline-row]')
                ?.dataset.compositeTimelineRow || '',
        };
    }
    const grip = active.closest?.('[data-composite-lane-resize]');
    if (grip) return { kind: 'grip', value: grip.dataset.compositeLaneResize };
    if (active.closest?.('[data-composite-timeline-ruler-svg]')) {
        return { kind: 'ruler', value: '' };
    }
    return { kind: 'timeline', value: '' };
}

function restoreCompositeTimelineFocus(dom, slot, focusKey) {
    if (!focusKey) return;
    let target = null;
    if (focusKey.kind === 'note') {
        const lane = focusKey.laneId ? slot.lanes.get(focusKey.laneId)?.row : slot.camera;
        if (lane) {
            target = [...lane.querySelectorAll('[data-composite-entry-id]')]
                .find(entry => entry.dataset.compositeEntryId === focusKey.value);
        }
    } else if (focusKey.kind === 'grip') {
        target = [...slot.camera.querySelectorAll('[data-composite-lane-resize]')]
            .find(grip => grip.dataset.compositeLaneResize === focusKey.value);
    } else if (focusKey.kind === 'ruler') {
        target = slot.rulerSvg;
    }
    (target || dom.scroller)?.focus?.({ preventScroll: true });
}

function refreshCompositeTimelineZoomControls(dom, requestedZoom = undefined) {
    const zoom = Number.isFinite(Number(requestedZoom)) ? Number(requestedZoom)
        : timelinePendingZoom?.zoom ?? timelineRequestedZoom?.zoom
            ?? hybridPreviewPreferences.timelineZoom;
    const overview = compositeTimelineOverviewActive();
    if (dom?.zoomOutput) {
        dom.zoomOutput.textContent = overview
            ? 'Whole song · details hidden' : `${Math.round(zoom)} px/beat`;
        dom.zoomOutput.title = overview
            ? 'Overview intentionally hides fret numbers and techniques. Turn it off or zoom in to restore note details.'
            : 'Horizontal spacing in pixels per beat';
    }
    if (dom?.zoomControls) {
        dom.zoomControls.hidden = overview;
        dom.zoomControls.style.display = overview ? 'none' : 'contents';
    }
    if (dom?.zoomSlider) {
        dom.zoomSlider.value = String(compositeTimelineSteppedZoomPure(zoom));
        dom.zoomSlider.setAttribute('aria-valuetext', `${Math.round(zoom)} pixels per beat`);
        dom.zoomSlider.disabled = overview;
    }
    const preset = dom?.zoomPreset;
    if (preset) {
        preset.disabled = overview;
        preset.querySelector('[data-composite-custom-zoom]')?.remove();
        const value = String(Math.round(zoom));
        if (![...preset.options].some(option => option.value === value)) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = `Custom — ${value} px/beat`;
            option.dataset.compositeCustomZoom = 'true';
            preset.appendChild(option);
        }
        preset.value = value;
    }
    for (const button of dom?.zoomButtons || []) button.disabled = overview;
    if (dom?.overviewButton) {
        dom.overviewButton.disabled = false;
        dom.overviewButton.setAttribute('aria-pressed', String(overview));
        dom.overviewButton.classList.toggle('ring-2', overview);
        dom.overviewButton.classList.toggle('ring-sky-400', overview);
        dom.overviewButton.textContent = 'Whole-song overview';
        dom.overviewButton.title = overview
            ? 'Turn off Overview to restore your saved note zoom, position, fret numbers, and techniques'
            : 'Fit the whole song using a lightweight overview';
    }
}

function settleCompositeTimelineZoomPreference({ switchToNotes = true } = {}) {
    const unsettledZoom = timelinePendingZoom || timelineRequestedZoom;
    if (!unsettledZoom) return false;
    const dom = timelineViewportDom;
    const view = dom?.view;
    const scroller = dom?.scroller;
    const normalizedZoom = hybridPreviewPreferencesPure({
        ...hybridPreviewPreferences,
        timelineZoom: unsettledZoom.zoom,
    }).timelineZoom;
    let settledScroll = hybridSession.timelineNotesScrollLeft;
    if (view && scroller) {
        const currentZoom = Number(dom.renderedZoom) > 0
            ? Number(dom.renderedZoom)
            : compositeTimelineEffectiveZoom(view, dom.viewportWidth);
        const currentScroll = compositeTimelineVisualScrollLeft(dom);
        const anchor = Number.isFinite(Number(unsettledZoom.anchorX))
            ? Number(unsettledZoom.anchorX) : scroller.clientWidth / 2;
        const livePlayback = hybridSession.previewPlaying
            && compositePreviewControllerPlaying() && hybridSession.plan;
        const followMode = compositeTimelineFollowMode();
        const liveBeat = livePlayback
            ? beatOf(hybridSession.plan.beats, compositePreviewVisualTime()) : null;
        const pageAnchor = livePlayback
            ? compositeTimelineXForBeatPure(liveBeat, view.context, currentZoom)
                - currentScroll
            : anchor;
        const next = unsettledZoom.forceStart
            ? { scrollLeft: 0 }
            : livePlayback && followMode === HYBRID_TIMELINE_FOLLOW_CENTERED
                ? {
                    scrollLeft: compositeTimelineCenteredScrollPure({
                        beat: liveBeat,
                        context: view.context,
                        zoom: normalizedZoom,
                        viewportWidth: scroller.clientWidth,
                    }),
                }
                : compositeTimelineZoomAtPure({
                    context: view.context,
                    oldZoom: currentZoom,
                    newZoom: normalizedZoom,
                    scrollLeft: currentScroll,
                    anchorX: livePlayback && followMode === HYBRID_TIMELINE_FOLLOW_PAGED
                        ? pageAnchor : anchor,
                    viewportWidth: scroller.clientWidth,
                });
        const maximum = Math.max(0,
            compositeTimelineContentWidthPure(view.context, normalizedZoom)
                - scroller.clientWidth);
        settledScroll = Math.max(0, Math.min(maximum, Number(next.scrollLeft) || 0));
    }
    setHybridPreviewPreferences({
        ...hybridPreviewPreferences,
        timelineZoom: normalizedZoom,
        timelineDisplayMode: switchToNotes
            ? HYBRID_TIMELINE_DISPLAY_NOTES : compositeTimelineDisplayMode(),
    });
    hybridSession.timelineNotesScrollLeft = settledScroll;
    if (switchToNotes) hybridSession.timelineScrollLeft = settledScroll;
    return true;
}

function stopCompositeTimelineUi() {
    settleCompositeTimelineZoomPreference();
    timelineReviewRefreshGeneration += 1;
    timelineZoomRequestGeneration += 1;
    cancelCompositeTimelineCoverageRepair(timelineViewportDom);
    resetCompositeTimelinePageFollow(timelineViewportDom);
    cancelCompositeTimelineStandbyWork();
    if (timelineViewportFrame) cancelAnimationFrame(timelineViewportFrame);
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    if (timelineZoomFrame) cancelAnimationFrame(timelineZoomFrame);
    if (timelineZoomCommitTimer) clearTimeout(timelineZoomCommitTimer);
    if (timelineBindFrame) cancelAnimationFrame(timelineBindFrame);
    if (timelineReviewRefreshFrame) cancelAnimationFrame(timelineReviewRefreshFrame);
    if (timelineOverviewResizeTimer) clearTimeout(timelineOverviewResizeTimer);
    for (const cleanup of timelineViewportDom?.cleanup || []) cleanup();
    timelineViewportFrame = 0;
    timelinePlayheadFrame = 0;
    timelineZoomFrame = 0;
    timelineZoomCommitTimer = 0;
    timelineZoomCommitRequestId = 0;
    timelineLastZoomCommitAt = 0;
    timelineBindFrame = 0;
    timelineReviewRefreshFrame = 0;
    timelineOverviewResizeTimer = 0;
    hybridPerfResetFrame('timeline.playhead');
    timelinePendingZoom = null;
    timelineRequestedZoom = null;
    timelineProgrammaticScrollTarget = null;
    timelineResizeObserver?.disconnect();
    timelineResizeObserver = null;
    timelineViewportDom = null;
}

function timelineActualViewportRange(view, scroller, scrollLeft = undefined,
    viewportWidth = scroller?.clientWidth || 1200) {
    return compositeTimelineViewportRangePure({
        context: view.context,
        zoom: compositeTimelineEffectiveZoom(view, viewportWidth),
        scrollLeft: Number.isFinite(Number(scrollLeft))
            ? Number(scrollLeft) : scroller?.scrollLeft || 0,
        viewportWidth,
    });
}

function updateCompositeTimelineMapViewport(dom, view, scroller, scrollLeft = undefined,
    viewportWidth = dom?.viewportWidth || scroller?.clientWidth || 1200) {
    if (!dom || !view || !scroller) return;
    const exact = timelineActualViewportRange(view, scroller, scrollLeft, viewportWidth);
    const mapViewport = compositeTimelineMapViewportPure(view, exact);
    if (dom.mapViewport) {
        const width = (mapViewport.width / 10).toFixed(3);
        if (dom.mapViewportWidth !== width) {
            if (dom.mapViewportWindow) dom.mapViewportWindow.style.width = `${width}%`;
            dom.mapViewportWidth = width;
        }
        dom.mapViewport.style.transform = `translate3d(${(mapViewport.x / 10).toFixed(3)}%,0,0)`;
    }
    dom.mapViewportVisualScroll = Number.isFinite(Number(scrollLeft))
        ? Number(scrollLeft) : scroller.scrollLeft || 0;
    return exact;
}

function refreshCompositeTimelineViewport(force = false) {
    force = force === true;
    if (timelineViewportFrame) cancelAnimationFrame(timelineViewportFrame);
    timelineViewportFrame = 0;
    if (!_compositeTimelineStageActivePure(hybridSession.stage)) return;
    const dom = timelineViewportDom;
    const view = dom?.view;
    const scroller = dom?.scroller;
    const content = dom?.content;
    if (!view || !scroller || !content) return;
    const viewportWidth = Math.max(1, scroller.clientWidth || 1);
    const zoom = compositeTimelineEffectiveZoom(view, viewportWidth);
    const width = compositeTimelineContentWidthPure(view.context, zoom);
    dom.viewportWidth = viewportWidth;
    dom.contentWidth = width;
    dom.maxScroll = Math.max(0, width - viewportWidth);
    const playheadTime = hybridSession.previewPlaying && compositePreviewControllerPlaying()
        ? compositePreviewVisualTime() : hybridSession.timelineSeekTime;
    dom.playheadX = compositeTimelineXForBeatPure(
        compositeTimelineDisplayBeatAtTime(view, playheadTime), view.context, zoom);
    const visualScroll = compositeTimelineVisualScrollLeft(dom);
    const exact = updateCompositeTimelineMapViewport(
        dom, view, scroller, visualScroll, viewportWidth);
    const guardPx = compositeTimelineRenderGuardPure(viewportWidth);
    const rebuildMarkup = Math.abs((dom.renderedViewportWidth || 0) - viewportWidth) >= 0.5
        || compositeTimelineRenderWindowNeedsRefreshPure({
        context: view.context,
        zoom,
        renderedZoom: dom.renderedZoom,
        renderedRange: dom.renderedRange,
        viewportRange: exact,
        guardPx,
        force,
    });
    if (!rebuildMarkup) return;
    content.style.width = `${width}px`;
    if (!force && dom.cameraSlots?.length > 1) {
        // Scroll, seek, and ResizeObserver callbacks are input-adjacent. Keep
        // the current bounded strip visible and prepare the replacement in
        // idle slices whether or not a large jump temporarily outran it.
        scheduleCompositeTimelineStandby(dom, visualScroll);
        return;
    }
    resetCompositeTimelinePageFollow(dom, { immediateCatchup: true });
    cancelCompositeTimelineStandbyWork(dom);
    const geometry = compositeTimelineStripGeometryPure({
        context: view.context,
        zoom,
        visualScrollLeft: visualScroll,
        viewportWidth,
    });
    const activeSlot = dom.cameraSlots?.[dom.activeCameraIndex]
        || compositeTimelineCameraSlot(dom.camera, view);
    if (!activeSlot) return;
    const focusKey = compositeTimelineFocusedControl(activeSlot.camera);
    renderCompositeTimelineCameraSlot(dom, activeSlot, geometry, zoom);
    for (const slot of dom.cameraSlots || []) {
        if (slot === activeSlot) continue;
        slot.ready = false;
        setCompositeTimelineCameraSlotActive(slot, false);
    }
    setCompositeTimelineCameraSlotActive(activeSlot, true);
    if (dom.cameraSlots?.length) {
        activateCompositeTimelineCameraSlot(dom, dom.cameraSlots.indexOf(activeSlot));
    } else {
        dom.renderOriginX = activeSlot.renderOriginX;
        dom.surfaceWidth = activeSlot.surfaceWidth;
        dom.renderedRange = activeSlot.renderedRange;
        dom.renderedZoom = activeSlot.renderedZoom;
        dom.renderedViewportWidth = activeSlot.renderedViewportWidth;
    }
    restoreCompositeTimelineFocus(dom, activeSlot, focusKey);
    updateCompositeTimelineFixedLaneHeights(dom);
    refreshCompositeTimelineZoomControls(dom);
    applyCompositeTimelineCamera(dom, visualScroll);
}

function scheduleCompositeTimelineViewport() {
    if (!timelineViewportFrame) {
        timelineViewportFrame = requestAnimationFrame(() =>
            refreshCompositeTimelineViewport(false));
    }
}

function clampTimelineScroll(scroller, value) {
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    return Math.max(0, Math.min(max, Number(value) || 0));
}

function clampCompositeTimelineScroll(dom, value) {
    const max = Math.max(0, Number(dom?.maxScroll) || 0);
    return Math.max(0, Math.min(max, Number(value) || 0));
}

function compositeTimelineVisualScrollLeft(dom = timelineViewportDom) {
    const scroller = dom?.scroller;
    if (!scroller) return 0;
    return clampCompositeTimelineScroll(dom, Number.isFinite(Number(dom.visualScrollLeft))
        ? Number(dom.visualScrollLeft) : scroller.scrollLeft);
}

function rememberCompositeTimelineScroll(value) {
    const scrollLeft = Math.max(0, Number(value) || 0);
    hybridSession.timelineScrollLeft = scrollLeft;
    if (!compositeTimelineOverviewActive()) {
        hybridSession.timelineNotesScrollLeft = scrollLeft;
    }
    return scrollLeft;
}

function compositeTimelineCameraCoverage(dom, slot, visualScroll, direction = 1) {
    if (!dom?.view || !dom.scroller || !slot) {
        return compositeTimelineCameraCoveragePure();
    }
    return compositeTimelineCameraCoveragePure({
        context: dom.view.context,
        zoom: compositeTimelineEffectiveZoom(dom.view, dom.viewportWidth),
        renderedRange: slot.renderedRange,
        viewportRange: timelineActualViewportRange(
            dom.view, dom.scroller, visualScroll, dom.viewportWidth),
        direction,
    });
}

function compositeTimelineCurrentDirection(dom, visualScroll) {
    const previous = Number(dom?.lastCoverageVisualScroll);
    let direction = Number(dom?.travelDirection) || 1;
    if (Number.isFinite(previous)) {
        if (visualScroll > previous + 0.25) direction = 1;
        else if (visualScroll < previous - 0.25) direction = -1;
    }
    if (dom) {
        dom.lastCoverageVisualScroll = visualScroll;
        dom.travelDirection = direction;
    }
    return direction;
}

function compositeTimelineSlotReadyForViewport(dom, slot, visualScroll, direction = 1) {
    return Boolean(slot?.ready
        && slot.renderSignature === compositeTimelineRenderSignature(dom)
        && compositeTimelineCameraCoverage(
            dom, slot, visualScroll, direction).coversViewport);
}

function commitCompositeTimelineCameraSlot(dom, slotIndex, visualScroll) {
    const next = dom?.cameraSlots?.[slotIndex];
    if (!next) return false;
    const previous = dom.cameraSlots?.[dom.activeCameraIndex];
    const focusKey = compositeTimelineFocusedControl(previous?.camera);
    next.camera.style.transform = `translate3d(${compositeTimelineCameraOffsetPure(
        dom.nativeScrollLeft, visualScroll)}px,0,0)`;
    setCompositeTimelineCameraSlotActive(next, true);
    activateCompositeTimelineCameraSlot(dom, slotIndex);
    restoreCompositeTimelineFocus(dom, next, focusKey);
    if (previous && previous !== next) {
        // Move focus before making the old subtree inert; Chromium otherwise
        // rejects aria-hidden on its active node.
        setCompositeTimelineCameraSlotActive(previous, false);
        previous.ready = false;
    }
    dom.standbyPending = false;
    dom.standbyPurpose = '';
    dom.standbySlotIndex = null;
    dom.standbyTargetVisualScroll = Number.NaN;
    if (dom.pagePreparedSlotIndex === slotIndex) {
        dom.pagePreparedSlotIndex = null;
        dom.pagePreparedScrollLeft = Number.NaN;
    }
    next.pendingSignature = '';
    next.pendingRange = null;
    updateCompositeTimelineFixedLaneHeights(dom);
    return true;
}

function synchronouslyRepairCompositeTimelineCoverage(dom, visualScroll) {
    if (!dom?.view || !dom.scroller) return false;
    const startedAt = hybridPerfStart();
    hybridPerfCount('timeline.camera.criticalFallback');
    cancelCompositeTimelineStandbyWork(dom);
    const slotIndex = dom.activeCameraIndex === 0 ? 1 : 0;
    const slot = dom.cameraSlots?.[slotIndex];
    if (!slot) {
        hybridPerfCount('timeline.camera.coverageRepairFailure');
        hybridPerfEnd('timeline.camera.criticalFallbackMs', startedAt);
        return false;
    }
    slot.ready = false;
    slot.pendingSignature = '';
    slot.pendingRange = null;
    try {
        const zoom = compositeTimelineEffectiveZoom(dom.view, dom.viewportWidth);
        const geometry = compositeTimelineStripGeometryPure({
            context: dom.view.context,
            zoom,
            visualScrollLeft: visualScroll,
            viewportWidth: dom.viewportWidth,
        });
        renderCompositeTimelineCameraSlot(dom, slot, geometry, zoom);
        const repaired = compositeTimelineSlotReadyForViewport(
            dom, slot, visualScroll, dom.travelDirection || 1);
        if (!repaired) {
            slot.ready = false;
            hybridPerfCount('timeline.camera.coverageRepairFailure');
            hybridPerfEnd('timeline.camera.criticalFallbackMs', startedAt);
            return false;
        }
        commitCompositeTimelineCameraSlot(dom, slotIndex, visualScroll);
        hybridPerfEnd('timeline.camera.criticalFallbackMs', startedAt);
        return true;
    } catch (_) {
        slot.ready = false;
        hybridPerfCount('timeline.camera.coverageRepairFailure');
        hybridPerfEnd('timeline.camera.criticalFallbackMs', startedAt);
        return false;
    }
}

function cancelCompositeTimelineCoverageRepair(dom = timelineViewportDom) {
    if (!dom?.coverageRepairTimer) return;
    clearTimeout(dom.coverageRepairTimer);
    dom.coverageRepairTimer = 0;
    dom.coverageRepairTarget = null;
}

function settleCompositeTimelineCoverageRepair(dom, target) {
    // A repair can finish after the frame that requested it. Reconcile every
    // camera-dependent value from what the coverage guard actually applied,
    // not from the older requested target. This moves only the blue overview
    // overlay and never regenerates the static map SVG.
    const appliedVisualScroll = applyCompositeTimelineCamera(dom, target);
    rememberCompositeTimelineScroll(appliedVisualScroll);
    updateCompositeTimelineMapViewport(
        dom, dom.view, dom.scroller, appliedVisualScroll, dom.viewportWidth);
    return appliedVisualScroll;
}

// Critical coverage repair is deliberately queued outside the display-rate
// playhead callback. Until this task runs, the compositor stays at the last
// painted position instead of exposing an empty strip.
function scheduleCompositeTimelineCoverageRepair(dom, visualScroll) {
    if (!dom) return;
    dom.coverageRepairTarget = visualScroll;
    if (dom.coverageRepairTimer) return;
    hybridPerfCount('timeline.camera.criticalRepairQueued');
    dom.coverageRepairTimer = setTimeout(() => {
        dom.coverageRepairTimer = 0;
        if (timelineViewportDom !== dom || !dom.view || !dom.scroller) return;
        const target = clampCompositeTimelineScroll(dom, dom.coverageRepairTarget);
        dom.coverageRepairTarget = null;
        const direction = dom.travelDirection || 1;
        const active = dom.cameraSlots?.[dom.activeCameraIndex];
        let repaired = compositeTimelineCameraCoverage(
            dom, active, target, direction).coversViewport;
        if (!repaired) {
            const readyIndex = (dom.cameraSlots || []).findIndex((slot, index) =>
                index !== dom.activeCameraIndex
                && compositeTimelineSlotReadyForViewport(dom, slot, target, direction));
            if (readyIndex >= 0) {
                cancelCompositeTimelineStandbyWork(dom);
                repaired = commitCompositeTimelineCameraSlot(dom, readyIndex, target);
            } else {
                repaired = synchronouslyRepairCompositeTimelineCoverage(dom, target);
            }
        }
        if (repaired) {
            settleCompositeTimelineCoverageRepair(dom, target);
        } else {
            hybridPerfCount('timeline.camera.coverageMiss');
        }
    }, 0);
}

// A compositor transform must never move the finite active SVG strip away
// from the visible viewport. Ordinarily the idle/urgent standby is ready first;
// this check is the bounded correctness fallback for a starved browser.
function ensureCompositeTimelineCameraCoverage(dom, requestedVisualScroll) {
    const previousVisual = compositeTimelineVisualScrollLeft(dom);
    const direction = compositeTimelineCurrentDirection(dom, requestedVisualScroll);
    const active = dom?.cameraSlots?.[dom.activeCameraIndex];
    const coverage = compositeTimelineCameraCoverage(
        dom, active, requestedVisualScroll, direction);
    hybridPerfGauge('timeline.camera.travelHeadroomPx', coverage.travelHeadroomPx);
    if (coverage.coversViewport) return requestedVisualScroll;

    const readyIndex = (dom.cameraSlots || []).findIndex((slot, index) =>
        index !== dom.activeCameraIndex
        && compositeTimelineSlotReadyForViewport(
            dom, slot, requestedVisualScroll, direction));
    if (readyIndex >= 0) {
        cancelCompositeTimelineStandbyWork(dom);
        commitCompositeTimelineCameraSlot(dom, readyIndex, requestedVisualScroll);
        hybridPerfCount('timeline.camera.readyCoverageSwap');
        return requestedVisualScroll;
    }
    // Keep the display-rate path compositor-only. A queued user-visible task
    // repairs the hidden slot while this frame retains the last covered camera.
    scheduleCompositeTimelineCoverageRepair(dom, requestedVisualScroll);
    hybridPerfCount('timeline.camera.coverageClamp');
    return previousVisual;
}

function scheduleCompositeTimelineStandby(dom, rawVisualScroll, options = {}) {
    if (!dom?.view || !dom.scroller || (dom.cameraSlots?.length || 0) < 2) return;
    const retainedOptions = dom.reviewRefreshOptions || {};
    const holdReady = options.holdReady === true;
    const purpose = options.purpose || (holdReady ? 'page-prefetch' : 'camera');
    const now = globalThis.performance?.now?.() ?? Date.now();
    const activeCoverage = compositeTimelineCameraCoverage(
        dom, dom.cameraSlots[dom.activeCameraIndex],
        clampCompositeTimelineScroll(dom, rawVisualScroll), dom.travelDirection || 1);
    const urgency = compositeTimelineCameraUrgencyPure({
        coverage: activeCoverage,
        viewportWidth: dom.viewportWidth,
    });
    const requestedDeadline = Math.max(0, Number(
        options.freshnessDeadlineAt ?? retainedOptions.freshnessDeadlineAt) || 0);
    // An active transport and exact zoom both need bounded progress. The
    // ordinary soft path remains idle-only while ample painted runway exists.
    const freshnessDeadlineAt = requestedDeadline || (compositePreviewControllerPlaying()
        || urgency === 'urgent' || urgency === 'critical' ? now + 240 : 0);
    if (freshnessDeadlineAt) hybridPerfCount('timeline.camera.urgentPreparation');
    const onCommitted = options.onCommitted || retainedOptions.onCommitted || null;
    const beforeCommit = options.beforeCommit || retainedOptions.beforeCommit || null;
    const onPrepared = options.onPrepared || null;
    const zoom = compositeTimelineEffectiveZoom(dom.view, dom.viewportWidth);
    const visualScroll = clampCompositeTimelineScroll(dom, rawVisualScroll);
    const standbyIndex = dom.activeCameraIndex === 0 ? 1 : 0;
    const standby = dom.cameraSlots[standbyIndex];
    if (!standby) return;
    if (dom.standbyPending) {
        const currentViewport = timelineActualViewportRange(
            dom.view, dom.scroller, visualScroll, dom.viewportWidth);
        const pendingStillUseful = dom.standbyPurpose === purpose
            && standby.pendingSignature
                === compositeTimelineRenderSignature(dom, zoom)
            && standby.pendingRange
            && !compositeTimelineRenderWindowNeedsRefreshPure({
                context: dom.view.context,
                zoom,
                renderedZoom: zoom,
                renderedRange: standby.pendingRange,
                viewportRange: currentViewport,
                guardPx: 0,
            });
        if (pendingStillUseful) return;
        cancelCompositeTimelineStandbyWork(dom);
    }
    const geometry = compositeTimelineStripGeometryPure({
        context: dom.view.context,
        zoom,
        visualScrollLeft: visualScroll,
        viewportWidth: dom.viewportWidth,
    });
    const generation = ++timelineRenderGeneration;
    const plan = compositeTimelineCameraRenderPlan(dom, standby, geometry, zoom);
    if (beforeCommit) plan.steps.push(beforeCommit);
    let stepIndex = 0;
    let cancelled = false;
    let cancelPendingIdle = null;
    dom.standbyPending = true;
    dom.standbyPurpose = purpose;
    dom.standbySlotIndex = standbyIndex;
    dom.standbyTargetVisualScroll = visualScroll;
    standby.ready = false;
    standby.pendingSignature = compositeTimelineRenderSignature(dom, zoom);
    standby.pendingRange = geometry.renderRange;
    setCompositeTimelineCameraSlotActive(standby, false);
    const cancel = () => {
        cancelled = true;
        cancelPendingIdle?.();
        cancelPendingIdle = null;
    };
    timelineStandbyCancel = cancel;
    const abandon = () => {
        if (timelineStandbyCancel === cancel) timelineStandbyCancel = null;
        if (dom === timelineViewportDom) {
            dom.standbyPending = false;
            dom.standbyPurpose = '';
            dom.standbySlotIndex = null;
            dom.standbyTargetVisualScroll = Number.NaN;
        }
        standby.ready = false;
        standby.pendingSignature = '';
        standby.pendingRange = null;
        setCompositeTimelineCameraSlotActive(standby, false);
    };
    const currentStandbyState = () => {
        if (cancelled || generation !== timelineRenderGeneration
            || dom !== timelineViewportDom || !standby.ready
            || !_compositeTimelineStageActivePure(hybridSession.stage)) return null;
        const currentVisual = compositeTimelineVisualScrollLeft(dom);
        const validationVisual = holdReady ? visualScroll : currentVisual;
        const viewportRange = timelineActualViewportRange(
            dom.view, dom.scroller, validationVisual, dom.viewportWidth);
        const stale = standby.renderSignature !== compositeTimelineRenderSignature(dom)
            || compositeTimelineRenderWindowNeedsRefreshPure({
                context: dom.view.context,
                zoom: compositeTimelineEffectiveZoom(dom.view, dom.viewportWidth),
                renderedZoom: standby.renderedZoom,
                renderedRange: standby.renderedRange,
                viewportRange,
                guardPx: 0,
            });
        return stale ? null : { currentVisual, validationVisual };
    };
    const rescheduleLatest = () => {
        const currentVisual = holdReady
            ? visualScroll : compositeTimelineVisualScrollLeft(dom);
        abandon();
        if (dom === timelineViewportDom) {
            scheduleCompositeTimelineStandby(dom, currentVisual, {
                freshnessDeadlineAt,
                onCommitted,
                beforeCommit,
                holdReady,
                purpose,
                onPrepared,
            });
        }
    };
    const queueStep = () => {
        const now = globalThis.performance?.now?.() || Date.now();
        const timeout = freshnessDeadlineAt
            ? Math.max(16, freshnessDeadlineAt - now) : 0;
        cancelPendingIdle = scheduleCompositeTimelineIdle(deadline => {
            cancelPendingIdle = null;
            if (cancelled || generation !== timelineRenderGeneration
                || dom !== timelineViewportDom
                || !_compositeTimelineStageActivePure(hybridSession.stage)) {
                abandon();
                return;
            }
            const currentTime = globalThis.performance?.now?.() || Date.now();
            // Soft preparation remains purely idle while enough painted runway
            // exists. Coverage, zoom, and review deadlines advance one bounded
            // ruler/lane step even during playback so the finite strip cannot
            // be starved until it leaves the viewport.
            const freshnessDue = Boolean(deadline?.didTimeout)
                || freshnessDeadlineAt && currentTime >= freshnessDeadlineAt;
            if (!freshnessDue && (compositeTimelineInputPending()
                    || Math.max(0, Number(deadline?.timeRemaining?.()) || 0) < 8)) {
                queueStep();
                return;
            }
            // A ruler or one dense lane is the largest unit we allow in one
            // idle slice. Yield between them so audio and display frames win.
            plan.steps[stepIndex++]();
            if (stepIndex < plan.steps.length) {
                queueStep();
                return;
            }
            if (timelineStandbyCancel === cancel) timelineStandbyCancel = null;
            timelineStandbySwapFrame = requestAnimationFrame(() => {
                timelineStandbySwapFrame = 0;
                const warmState = currentStandbyState();
                if (!warmState) {
                    rescheduleLatest();
                    return;
                }
                const cameraOffset = compositeTimelineCameraOffsetPure(
                    dom.nativeScrollLeft, warmState.validationVisual);
                standby.camera.style.transform = `translate3d(${cameraOffset}px,0,0)`;
                // Give Chromium one paint with the new bounded strip underneath
                // the opaque active one so raster work cannot land on the swap.
                standby.camera.style.opacity = '0.001';
                timelineStandbySwapFrame = requestAnimationFrame(() => {
                    timelineStandbySwapFrame = 0;
                    const swapState = currentStandbyState();
                    if (!swapState) {
                        rescheduleLatest();
                        return;
                    }
                    if (holdReady) {
                        setCompositeTimelineCameraSlotActive(standby, false);
                        dom.standbyPending = false;
                        dom.standbyPurpose = '';
                        dom.standbySlotIndex = null;
                        dom.standbyTargetVisualScroll = Number.NaN;
                        standby.pendingSignature = '';
                        standby.pendingRange = null;
                        dom.pagePreparedSlotIndex = standbyIndex;
                        dom.pagePreparedScrollLeft = visualScroll;
                        onPrepared?.(standbyIndex, visualScroll);
                        return;
                    }
                    commitCompositeTimelineCameraSlot(
                        dom, standbyIndex, swapState.currentVisual);
                    applyCompositeTimelineCamera(dom, swapState.currentVisual);
                    onCommitted?.();
                });
            });
        }, timeout);
    };
    queueStep();
}

function scheduleCompositeTimelinePageTarget(dom, rawTargetScroll) {
    if (!dom?.view || !dom.scroller || compositeTimelineOverviewActive()) {
        return {
            ready: false,
            pending: false,
            targetScrollLeft: 0,
            source: 'unavailable',
        };
    }
    const targetScroll = clampCompositeTimelineScroll(dom, rawTargetScroll);
    const currentScroll = compositeTimelineVisualScrollLeft(dom);
    if (Math.abs(targetScroll - currentScroll) < 0.5) {
        return {
            ready: true,
            pending: false,
            targetScrollLeft: targetScroll,
            source: 'current',
        };
    }
    const direction = Math.sign(targetScroll - currentScroll) || dom.travelDirection || 1;
    const preparedIndex = dom.pagePreparedSlotIndex;
    const prepared = dom.cameraSlots?.[preparedIndex];
    if (prepared && preparedIndex !== dom.activeCameraIndex
            && compositeTimelineSlotReadyForViewport(
                dom, prepared, targetScroll, direction)) {
        dom.pagePreparedScrollLeft = targetScroll;
        return {
            ready: true,
            pending: false,
            targetScrollLeft: targetScroll,
            source: 'prepared',
        };
    }
    const active = dom.cameraSlots?.[dom.activeCameraIndex];
    if (compositeTimelineCameraCoverage(
        dom, active, targetScroll, direction).coversViewport) {
        return {
            ready: true,
            pending: false,
            targetScrollLeft: targetScroll,
            source: 'active',
        };
    }
    if (preparedIndex != null) clearCompositeTimelinePagePrefetch(dom);
    scheduleCompositeTimelineStandby(dom, targetScroll, {
        holdReady: true,
        purpose: 'page-prefetch',
        freshnessDeadlineAt: (globalThis.performance?.now?.() || Date.now()) + 240,
    });
    return {
        ready: false,
        pending: dom.standbyPending && dom.standbyPurpose === 'page-prefetch',
        targetScrollLeft: targetScroll,
        source: 'pending',
    };
}

function scheduleCompositeTimelinePagePrefetch(dom, visualScroll, pageFrame) {
    if (!dom || dom.pageTransition || dom.pageTargetWaiting || compositeTimelineFollowMode()
            !== HYBRID_TIMELINE_FOLLOW_PAGED || !hybridSession.previewPlaying
            || !compositePreviewControllerPlaying()) return null;
    const pageTravel = Math.max(0, Number(pageFrame?.pageTravelPx) || 0);
    if (pageTravel < 0.5) return null;
    const target = clampCompositeTimelineScroll(dom, visualScroll + pageTravel);
    return scheduleCompositeTimelinePageTarget(dom, target);
}

function scheduleCompositeTimelineRenderAhead(dom, visualScroll) {
    const scroller = dom?.scroller;
    if (!dom?.view || !scroller) return;
    const viewportRange = timelineActualViewportRange(
        dom.view, scroller, visualScroll, dom.viewportWidth);
    const activeStillCoversViewport = !compositeTimelineRenderWindowNeedsRefreshPure({
        context: dom.view.context,
        zoom: compositeTimelineEffectiveZoom(dom.view, dom.viewportWidth),
        renderedZoom: dom.renderedZoom,
        renderedRange: dom.renderedRange,
        viewportRange,
        guardPx: 0,
    });
    if (!activeStillCoversViewport) {
        // Never regenerate SVG from the display-rate camera path. If playback
        // outruns a prepared strip, keep the current camera moving and let the
        // cancellable standby renderer catch up when the main thread is idle.
        scheduleCompositeTimelineStandby(dom, visualScroll);
        return;
    }
    if (dom.standbyPending) return;
    if (compositeTimelineRenderWindowNeedsRefreshPure({
        context: dom.view.context,
        zoom: compositeTimelineEffectiveZoom(dom.view, dom.viewportWidth),
        renderedZoom: dom.renderedZoom,
        renderedRange: dom.renderedRange,
        viewportRange,
        guardPx: compositeTimelineRenderGuardPure(dom.viewportWidth),
    })) scheduleCompositeTimelineStandby(dom, visualScroll);
}

// Labels remain fixed while one shared time-bearing layer moves on the
// compositor. Native scroll is deliberately left untouched during Follow;
// settling it is reserved for stop/seek/zoom or an explicit user scroll.
function applyCompositeTimelineCamera(dom = timelineViewportDom, rawVisualScroll,
    rawPlayheadX = dom?.playheadX) {
    const scroller = dom?.scroller;
    if (!dom || !scroller) return 0;
    const requestedVisualScroll = clampCompositeTimelineScroll(dom, rawVisualScroll);
    // Correctness boundary: repair or atomically swap the bounded strip before
    // its compositor transform can expose an unpainted viewport.
    const visualScroll = ensureCompositeTimelineCameraCoverage(
        dom, requestedVisualScroll);
    const cameraOffset = compositeTimelineCameraOffsetPure(
        dom.nativeScrollLeft, visualScroll);
    const layerTransform = `translate3d(${cameraOffset}px,0,0)`;
    if (dom.camera) {
        dom.camera.style.transform = layerTransform;
    }
    const playheadX = rawPlayheadX == null ? Number.NaN : Number(rawPlayheadX);
    if (Number.isFinite(playheadX)) dom.playheadX = playheadX;
    if (dom.playhead && dom.playheadX != null && Number.isFinite(Number(dom.playheadX))) {
        dom.playhead.style.transform = `translate3d(${Number(dom.playheadX) + cameraOffset}px,0,0)`;
    }
    dom.visualScrollLeft = visualScroll;
    if (dom.cameraSlots?.[dom.activeCameraIndex]?.ready
            && !(compositeTimelineFollowMode() === HYBRID_TIMELINE_FOLLOW_PAGED
                && hybridSession.previewPlaying && compositePreviewControllerPlaying())) {
        scheduleCompositeTimelineRenderAhead(dom, visualScroll);
    }
    return visualScroll;
}

function setCompositeTimelineNativeCamera(dom = timelineViewportDom,
    rawVisualScroll = compositeTimelineVisualScrollLeft(dom), refresh = true) {
    const scroller = dom?.scroller;
    if (!dom || !scroller) return 0;
    const visualScroll = clampCompositeTimelineScroll(dom, rawVisualScroll);
    if (Math.abs(scroller.scrollLeft - visualScroll) >= 0.5) {
        timelineProgrammaticScrollTarget = visualScroll;
        scroller.scrollLeft = visualScroll;
    }
    dom.nativeScrollLeft = scroller.scrollLeft;
    applyCompositeTimelineCamera(dom, visualScroll);
    rememberCompositeTimelineScroll(visualScroll);
    if (refresh) scheduleCompositeTimelineViewport();
    return visualScroll;
}

function syncCompositeTimelineNativeCamera(dom = timelineViewportDom) {
    const scroller = dom?.scroller;
    if (!dom || !scroller) return false;
    const visualScroll = compositeTimelineVisualScrollLeft(dom);
    setCompositeTimelineNativeCamera(dom, visualScroll);
    return true;
}

function seekCompositeTimelineAtTime(rawTime, {
    center = false,
} = {}) {
    if (hybridSession.plan && !requireCurrentCompositePlan()) return 0;
    if (hybridSession.previewLoading) {
        setCompositePreviewHelp('Wait for the current preview to finish loading before seeking.');
        return hybridSession.timelineSeekTime;
    }
    const time = Math.max(0, Number(rawTime) || 0);
    // Ordinary seeks only move the retained camera/playhead. Building a fresh
    // full-song model is necessary solely when the caller asks us to derive a
    // new centered scroll position from that model.
    const view = center ? currentTimelineView() : null;
    const dom = timelineViewportDom;
    const scroller = dom?.scroller
        || byId('editor-composite-timeline-scroller');
    cancelCompositeTimelineCoverageRepair(dom);
    resetCompositeTimelinePageFollow(dom, { immediateCatchup: true });
    hybridSession.timelineSeekTime = time;
    if (hybridSession.previewController) {
        void hybridSession.previewController.seek(time);
    }
    if (center && view && scroller && hybridSession.plan) {
        const beat = beatOf(hybridSession.plan.beats, time);
        const nextScroll = clampTimelineScroll(scroller,
            compositeTimelineCenteredScrollPure({
                beat,
                context: view.context,
                zoom: compositeTimelineEffectiveZoom(view, scroller.clientWidth),
                viewportWidth: scroller.clientWidth,
            }));
        if (dom) setCompositeTimelineNativeCamera(dom, nextScroll, false);
        else rememberCompositeTimelineScroll(nextScroll);
    } else if (dom) {
        applyCompositeTimelineCamera(dom, compositeTimelineVisualScrollLeft(dom));
    }
    if (dom?.view) {
        updateCompositeTimelineSeekAria(
            dom, compositeTimelineDisplayBeatAtTime(dom.view, time), { force: true });
    }
    scheduleCompositeTimelineViewport();
    refreshCompositeTimelinePlayheadNow();
    return time;
}

function commitCompositeTimelineZoom(dom, requestId) {
    if (timelineZoomCommitRequestId === requestId) {
        timelineZoomCommitTimer = 0;
        timelineZoomCommitRequestId = 0;
    }
    const request = timelineRequestedZoom;
    if (timelinePendingZoom?.id > requestId) return;
    if (!request || request.id !== requestId || timelineViewportDom !== dom
            || !dom?.view || !dom.scroller || !dom.content) return;
    const view = dom.view;
    const scroller = dom.scroller;
    const normalizedZoom = hybridPreviewPreferencesPure({
        ...hybridPreviewPreferences,
        timelineZoom: request.zoom,
    }).timelineZoom;
    const currentZoom = Number(dom.renderedZoom) > 0
        ? Number(dom.renderedZoom)
        : compositeTimelineEffectiveZoom(
            view, dom.viewportWidth || scroller.clientWidth);
    const currentScroll = compositeTimelineVisualScrollLeft(dom);
    const anchor = Number.isFinite(Number(request.anchorX))
        ? Number(request.anchorX) : scroller.clientWidth / 2;
    const livePlayback = hybridSession.previewPlaying
        && compositePreviewControllerPlaying() && hybridSession.plan;
    const followMode = compositeTimelineFollowMode();
    const liveBeat = livePlayback
        ? beatOf(hybridSession.plan.beats, compositePreviewVisualTime()) : null;
    const pageAnchor = livePlayback
        ? compositeTimelineXForBeatPure(liveBeat, view.context, currentZoom)
            - currentScroll
        : anchor;
    const next = request.forceStart
        ? { zoom: normalizedZoom, scrollLeft: 0 }
        : livePlayback && followMode === HYBRID_TIMELINE_FOLLOW_CENTERED
            ? {
                zoom: normalizedZoom,
                scrollLeft: compositeTimelineCenteredScrollPure({
                    beat: liveBeat,
                    context: view.context,
                    zoom: normalizedZoom,
                    viewportWidth: scroller.clientWidth,
                }),
            }
            : compositeTimelineZoomAtPure({
                context: view.context,
                oldZoom: currentZoom,
                newZoom: normalizedZoom,
                scrollLeft: currentScroll,
                anchorX: livePlayback && followMode === HYBRID_TIMELINE_FOLLOW_PAGED
                    ? pageAnchor : anchor,
                viewportWidth: scroller.clientWidth,
            });

    setHybridPreviewPreferences({
        ...hybridPreviewPreferences,
        timelineZoom: next.zoom,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
    }, { deferred: !request.flushPreference });
    const nextContentWidth = compositeTimelineContentWidthPure(view.context, next.zoom);
    dom.content.style.width = `${nextContentWidth}px`;
    dom.contentWidth = nextContentWidth;
    dom.maxScroll = Math.max(0, nextContentWidth - dom.viewportWidth);
    const nextScroll = clampCompositeTimelineScroll(dom, next.scrollLeft);
    const previewBeat = livePlayback
        ? liveBeat
        : compositeTimelineDisplayBeatAtTime(view, hybridSession.timelineSeekTime);
    dom.playheadX = compositeTimelineXForBeatPure(previewBeat, view.context, next.zoom);

    cancelCompositeTimelineCoverageRepair(dom);
    resetCompositeTimelinePageFollow(dom, { immediateCatchup: true });
    cancelCompositeTimelineStandbyWork(dom);
    const retainedReview = dom.reviewRefreshOptions;
    retainedReview?.beforeCommit?.();
    timelineProgrammaticScrollTarget = nextScroll;
    scroller.scrollLeft = nextScroll;
    dom.nativeScrollLeft = scroller.scrollLeft;
    dom.visualScrollLeft = nextScroll;
    dom.lastCoverageVisualScroll = nextScroll;
    rememberCompositeTimelineScroll(nextScroll);
    timelineRequestedZoom = null;
    refreshCompositeTimelineViewport(true);
    refreshCompositeTimelineZoomControls(dom, next.zoom);
    updateCompositeTimelineMapViewport(
        dom, view, scroller, nextScroll, dom.viewportWidth);
    retainedReview?.onCommitted?.();
    timelineLastZoomCommitAt = globalThis.performance?.now?.() || Date.now();
    finishCompositeInteraction('zoom.response', request.interactionStartedAt);
}

function commitCompositeTimelineDisplayMode(dom, nextMode, {
    preserveNotesScroll = false,
} = {}) {
    if (timelineViewportDom !== dom || !dom?.view || !dom.scroller || !dom.content) return;
    const normalizedMode = nextMode === HYBRID_TIMELINE_DISPLAY_OVERVIEW
        ? HYBRID_TIMELINE_DISPLAY_OVERVIEW : HYBRID_TIMELINE_DISPLAY_NOTES;
    const previousMode = compositeTimelineDisplayMode();
    if (normalizedMode === previousMode) return;
    const currentVisual = compositeTimelineVisualScrollLeft(dom);
    if (previousMode === HYBRID_TIMELINE_DISPLAY_NOTES && !preserveNotesScroll) {
        hybridSession.timelineNotesScrollLeft = currentVisual;
    }
    setHybridPreviewPreferences({
        ...hybridPreviewPreferences,
        timelineDisplayMode: normalizedMode,
    });
    const zoom = compositeTimelineEffectiveZoom(dom.view, dom.viewportWidth);
    const width = compositeTimelineContentWidthPure(dom.view.context, zoom);
    dom.content.style.width = `${width}px`;
    dom.contentWidth = width;
    dom.maxScroll = Math.max(0, width - dom.viewportWidth);
    const livePlayback = hybridSession.previewPlaying && compositePreviewControllerPlaying()
        && hybridSession.plan;
    const followMode = compositeTimelineFollowMode();
    const beat = compositeTimelineDisplayBeatAtTime(dom.view, livePlayback
        ? compositePreviewVisualTime() : hybridSession.timelineSeekTime);
    let wantedScroll = normalizedMode === HYBRID_TIMELINE_DISPLAY_OVERVIEW
        ? 0 : hybridSession.timelineNotesScrollLeft;
    if (normalizedMode === HYBRID_TIMELINE_DISPLAY_NOTES && livePlayback
            && followMode === HYBRID_TIMELINE_FOLLOW_CENTERED) {
        wantedScroll = compositeTimelineCenteredScrollPure({
                beat,
                context: dom.view.context,
                zoom,
                viewportWidth: dom.viewportWidth,
            });
    } else if (normalizedMode === HYBRID_TIMELINE_DISPLAY_NOTES && livePlayback
            && followMode === HYBRID_TIMELINE_FOLLOW_PAGED) {
        const page = compositeTimelinePagedCameraPure({
            beat,
            context: dom.view.context,
            zoom,
            viewportWidth: dom.viewportWidth,
            visualScrollLeft: wantedScroll,
        });
        if (page.shouldAdvance) wantedScroll = page.targetScrollLeft;
    }
    const nextScroll = clampCompositeTimelineScroll(dom, wantedScroll);
    dom.playheadX = compositeTimelineXForBeatPure(beat, dom.view.context, zoom);
    cancelCompositeTimelineCoverageRepair(dom);
    resetCompositeTimelinePageFollow(dom, { immediateCatchup: true });
    cancelCompositeTimelineStandbyWork(dom);
    const retainedReview = dom.reviewRefreshOptions;
    retainedReview?.beforeCommit?.();
    timelineProgrammaticScrollTarget = nextScroll;
    dom.scroller.scrollLeft = nextScroll;
    dom.nativeScrollLeft = dom.scroller.scrollLeft;
    dom.visualScrollLeft = nextScroll;
    dom.lastCoverageVisualScroll = nextScroll;
    rememberCompositeTimelineScroll(nextScroll);
    refreshCompositeTimelineViewport(true);
    refreshCompositeTimelineZoomControls(dom);
    updateCompositeTimelineMapViewport(
        dom, dom.view, dom.scroller, nextScroll, dom.viewportWidth);
    retainedReview?.onCommitted?.();
    refreshCompositeTimelinePlayheadNow();
}

function scheduleCompositeTimelineDisplayMode(dom, nextMode) {
    if (timelineViewportDom !== dom) return;
    if (dom.overviewButton) dom.overviewButton.disabled = true;
    const startedAt = hybridPerfStart();
    const requestId = ++timelineZoomRequestGeneration;
    const preserveNotesScroll = settleCompositeTimelineZoomPreference({ switchToNotes: false });
    if (timelineZoomFrame) cancelAnimationFrame(timelineZoomFrame);
    if (timelineZoomCommitTimer) clearTimeout(timelineZoomCommitTimer);
    if (timelineOverviewResizeTimer) clearTimeout(timelineOverviewResizeTimer);
    timelineZoomFrame = 0;
    timelineOverviewResizeTimer = 0;
    timelinePendingZoom = null;
    timelineRequestedZoom = null;
    timelineZoomCommitRequestId = requestId;
    timelineZoomCommitTimer = setTimeout(() => {
        if (timelineZoomCommitRequestId !== requestId) return;
        timelineZoomCommitTimer = 0;
        timelineZoomCommitRequestId = 0;
        if (timelineViewportDom !== dom) return;
        commitCompositeTimelineDisplayMode(dom, nextMode, { preserveNotesScroll });
        finishCompositeInteraction('overview.response', startedAt);
    }, 0);
}

function applyCompositeTimelineZoom(nextZoom, anchorX = null, forceStart = false,
    flushPreference = false, interactionStartedAt = hybridPerfStart(), requestId = 0) {
    const dom = timelineViewportDom;
    if (!dom?.view || !dom.scroller || !dom.content) return;
    const request = {
        id: requestId || ++timelineZoomRequestGeneration,
        zoom: compositeTimelineZoomPure(nextZoom),
        anchorX,
        forceStart,
        flushPreference,
        interactionStartedAt,
    };
    timelineRequestedZoom = request;
    refreshCompositeTimelineZoomControls(dom, request.zoom);
    if (timelineZoomCommitTimer) clearTimeout(timelineZoomCommitTimer);
    // Discrete presets commit in the next task. Continuous input gets a leading
    // exact response and is then throttled: the camera always stays crisp, a
    // sustained gesture remains visible, and rendering cannot run per event.
    const now = globalThis.performance?.now?.() || Date.now();
    const delay = flushPreference || !timelineLastZoomCommitAt
        ? 0 : Math.max(0, 48 - (now - timelineLastZoomCommitAt));
    timelineZoomCommitRequestId = request.id;
    timelineZoomCommitTimer = setTimeout(
        () => commitCompositeTimelineZoom(dom, request.id), delay);
}

function pendingCompositeTimelineZoom() {
    return timelinePendingZoom?.zoom ?? timelineRequestedZoom?.zoom
        ?? hybridPreviewPreferences.timelineZoom;
}

// Slider and wheel input can fire much faster than the display. Keep the most
// recent request and leave the last exact camera crisp while the gesture is in
// motion; render requested note/ruler geometry at bounded intervals.
function scheduleCompositeTimelineZoom(zoom, anchorX = null, forceStart = false,
    flushPreference = false) {
    timelinePendingZoom = {
        id: ++timelineZoomRequestGeneration,
        zoom,
        anchorX,
        forceStart,
        flushPreference,
        interactionStartedAt: hybridPerfStart(),
    };
    if (timelineZoomFrame) return;
    timelineZoomFrame = requestAnimationFrame(() => {
        timelineZoomFrame = 0;
        const pending = timelinePendingZoom;
        timelinePendingZoom = null;
        if (pending) {
            applyCompositeTimelineZoom(
                pending.zoom, pending.anchorX, pending.forceStart,
                pending.flushPreference, pending.interactionStartedAt, pending.id);
        }
    });
}

const COMPOSITE_TIMELINE_ARIA_UPDATE_INTERVAL_MS = 1000;

function updateCompositeTimelineSeekAria(dom, beat, { force = false } = {}) {
    if (!dom?.view) return false;
    const now = globalThis.performance?.now?.() || Date.now();
    if (!force && Number.isFinite(Number(dom.seekAriaUpdatedAt))
            && now - Number(dom.seekAriaUpdatedAt)
                < COMPOSITE_TIMELINE_ARIA_UPDATE_INTERVAL_MS) return false;
    const value = _compositeTimelineSeekAriaPure(dom.view, beat);
    const signature = `${value.min}|${value.max}|${value.now}|${value.text}`;
    dom.seekAriaUpdatedAt = now;
    if (dom.seekAriaSignature === signature) return false;
    dom.seekAriaSignature = signature;
    const controls = [dom.map, ...(dom.cameraSlots || []).map(slot => slot.rulerSvg)]
        .filter(Boolean);
    for (const control of controls) {
        control.setAttribute('aria-valuemin', value.min);
        control.setAttribute('aria-valuemax', value.max);
        control.setAttribute('aria-valuenow', value.now);
        control.setAttribute('aria-valuetext', value.text);
    }
    return true;
}

function updateCompositeTimelineMapFrame(dom, beat, visualScroll, _frameTime = 0, force = false) {
    if (!dom?.view || !dom.scroller) return;
    const span = Math.max(1, dom.view.context.endBeat - dom.view.context.startBeat);
    const mapX = Math.max(0, Math.min(1000,
        ((beat - dom.view.context.startBeat) / span) * 1000));
    if (dom.mapPlayhead) {
        dom.mapPlayhead.style.transform = `translate3d(${(mapX / 10).toFixed(3)}%,0,0)`;
    }
    // The visual marker follows every animation frame. Slider semantics need
    // only human-scale updates; throttling prevents a focused map or ruler
    // from generating a stream of screen-reader value changes during playback.
    updateCompositeTimelineSeekAria(dom, beat);
    // The red marker is a single compositor transform and follows every
    // display frame. Recalculate the blue viewport only when its camera moved.
    if (force || !Number.isFinite(Number(dom.mapViewportVisualScroll))
            || Math.abs(Number(dom.mapViewportVisualScroll) - visualScroll) >= 0.25) {
        updateCompositeTimelineMapViewport(
            dom, dom.view, dom.scroller, visualScroll, dom.viewportWidth);
    }
}

function compositeTimelinePageFollowFrame(dom, view, beat, time, {
    frameTime = 0,
    playbackSettled = false,
} = {}) {
    const zoom = compositeTimelineEffectiveZoom(view, dom.viewportWidth);
    const now = Number(frameTime) > 0
        ? Number(frameTime) : (globalThis.performance?.now?.() || Date.now());
    let visualScroll = compositeTimelineVisualScrollLeft(dom);
    let page = compositeTimelinePagedCameraPure({
        beat,
        context: view.context,
        zoom,
        viewportWidth: dom.viewportWidth,
        visualScrollLeft: visualScroll,
    });
    const backwardJump = Number.isFinite(Number(dom.pageLastTime))
        && Number(time) < Number(dom.pageLastTime) - 0.05;
    const largeJump = Number.isFinite(Number(dom.pageLastContentX))
        && Math.abs(page.contentX - Number(dom.pageLastContentX)) > dom.viewportWidth;
    const playheadOutsideViewport = page.screenX < page.visibleStartScreenX
        || page.screenX > page.visibleEndScreenX;
    const firstPageSample = !Number.isFinite(Number(dom.pageLastTime))
        || !Number.isFinite(Number(dom.pageLastContentX));
    // A cold first frame can begin with a saved camera many pages away. Treat
    // that as recovery, not as a normal edge crossing: animating the entire
    // distance would expose unpainted space and make Follow appear sluggish.
    const immediateCatchup = Boolean(backwardJump || largeJump || playbackSettled
        || playheadOutsideViewport && (firstPageSample || dom.pageImmediateCatchup));
    if ((dom.pageTransition || dom.pageTargetWaiting)
            && (backwardJump || largeJump)) {
        dom.pageTransition = null;
        dom.pageTargetWaiting = false;
        dom.pageTargetImmediate = false;
        page = compositeTimelinePagedCameraPure({
            beat,
            context: view.context,
            zoom,
            viewportWidth: dom.viewportWidth,
            visualScrollLeft: visualScroll,
        });
    }
    if (!dom.pageTransition && page.shouldAdvance) {
        const target = scheduleCompositeTimelinePageTarget(dom, page.targetScrollLeft);
        const targetImmediate = dom.pageTargetWaiting
            ? dom.pageTargetImmediate
            : immediateCatchup || page.reason !== 'right-trigger';
        if (target.ready) {
            // Do not start the 120 ms clock until one bounded camera already
            // covers the destination. This keeps a starved 4K prefetch from
            // turning a nominally smooth page into a clamp + synchronous SVG
            // repair on the display-rate path.
            dom.pageTransition = {
                fromScrollLeft: visualScroll,
                targetScrollLeft: target.targetScrollLeft,
                startedAt: now,
                immediate: targetImmediate,
            };
            dom.pageTargetWaiting = false;
            dom.pageTargetImmediate = false;
        } else {
            dom.pageTargetWaiting = target.pending;
            dom.pageTargetImmediate = targetImmediate;
        }
    } else if (!dom.pageTransition) {
        dom.pageTargetWaiting = false;
        dom.pageTargetImmediate = false;
    }
    if (dom.pageTransition) {
        const transition = compositeTimelinePageTransitionPure({
            ...dom.pageTransition,
            elapsedMs: now - dom.pageTransition.startedAt,
            reducedMotion: dom.reducedMotion,
            immediate: immediateCatchup || dom.pageTransition.immediate,
        });
        visualScroll = clampCompositeTimelineScroll(dom, transition.visualScrollLeft);
        if (transition.done) dom.pageTransition = null;
    }
    dom.pageImmediateCatchup = false;
    dom.pageLastTime = Number(time);
    dom.pageLastContentX = page.contentX;
    return {
        ...page,
        visualScrollLeft: visualScroll,
        waitingForPageTarget: dom.pageTargetWaiting,
    };
}

function updateCompositeTimelinePlayhead(frameTime = 0) {
    timelinePlayheadFrame = 0;
    if (!_compositeTimelineStageActivePure(hybridSession.stage)) return;
    const dom = timelineViewportDom;
    const view = dom?.view;
    const scroller = dom?.scroller;
    const playhead = dom?.playhead;
    if (!view || !scroller || !playhead) return;
    const controller = hybridSession.previewController;
    const controllerPlaying = !!controller?.isPlaying?.();
    const activelyPlaying = hybridSession.previewPlaying && controllerPlaying;
    const playbackSettled = hybridSession.previewPlaying && !controllerPlaying
        && !hybridSession.previewLoading;
    if (activelyPlaying && Number(frameTime) > 0) {
        hybridPerfFrame('timeline.playhead', frameTime);
    }
    if (playbackSettled && Number.isFinite(Number(controller?.presentationTime?.()))) {
        // The private transport holds its exact range endpoint at natural
        // completion, so the marker and overview stay on the last heard spot.
        hybridSession.timelineSeekTime = Math.max(
            0, Number(controller.presentationTime()));
    }
    const time = activelyPlaying
        ? compositePreviewVisualTime() : hybridSession.timelineSeekTime;
    const beat = compositeTimelineDisplayBeatAtTime(view, time);
    const followMode = compositeTimelineFollowMode();
    const followsTransport = activelyPlaying || playbackSettled;
    if (followMode !== HYBRID_TIMELINE_FOLLOW_PAGED
            && (dom.pageTransition || dom.pagePreparedSlotIndex != null
                || dom.standbyPurpose === 'page-prefetch')) {
        resetCompositeTimelinePageFollow(dom);
    }
    const frame = followsTransport && followMode === HYBRID_TIMELINE_FOLLOW_PAGED
        ? compositeTimelinePageFollowFrame(dom, view, beat, time, {
            frameTime,
            playbackSettled,
        })
        : compositeTimelineCameraFramePure({
            beat,
            context: view.context,
            zoom: compositeTimelineEffectiveZoom(view, dom.viewportWidth),
            viewportWidth: dom.viewportWidth,
            visualScrollLeft: compositeTimelineVisualScrollLeft(dom),
            // Give natural completion one settling Centered frame so the
            // overview and long-song camera land on the transport endpoint.
            follow: followsTransport
                && followMode === HYBRID_TIMELINE_FOLLOW_CENTERED,
        });
    if (activelyPlaying) {
        hybridSession.timelineSeekTime = Math.max(0, time);
        const visualScroll = applyCompositeTimelineCamera(
            dom, frame.visualScrollLeft, frame.contentX);
        rememberCompositeTimelineScroll(visualScroll);
        updateCompositeTimelineMapFrame(dom, beat, visualScroll, frameTime);
        if (followMode === HYBRID_TIMELINE_FOLLOW_PAGED) {
            scheduleCompositeTimelinePagePrefetch(dom, visualScroll, frame);
        }
        timelinePlayheadFrame = requestAnimationFrame(updateCompositeTimelinePlayhead);
    } else if (playbackSettled) {
        if (followMode === HYBRID_TIMELINE_FOLLOW_PAGED
                && frame.waitingForPageTarget) {
            // Audio has reached its exact endpoint, but a cold bounded strip
            // may still be finishing. Keep the lightweight display loop alive
            // until that destination is ready instead of finalizing against a
            // stale camera or forcing a synchronous render hitch.
            const visualScroll = applyCompositeTimelineCamera(
                dom, frame.visualScrollLeft, frame.contentX);
            rememberCompositeTimelineScroll(visualScroll);
            updateCompositeTimelineMapFrame(dom, beat, visualScroll, frameTime, true);
            timelinePlayheadFrame = requestAnimationFrame(updateCompositeTimelinePlayhead);
            return;
        }
        const finishedMode = hybridSession.previewMode;
        const finishedLabel = {
            song: 'Original song',
            primary: 'Base preview',
            secondary: 'Fill preview',
            result: 'Hybrid preview',
        }[finishedMode] || 'Preview';
        const visualScroll = applyCompositeTimelineCamera(
            dom, frame.visualScrollLeft, frame.contentX);
        rememberCompositeTimelineScroll(visualScroll);
        updateCompositeTimelineMapFrame(dom, beat, visualScroll, frameTime, true);
        updateCompositeTimelineSeekAria(dom, beat, { force: true });
        // The endpoint apply above may have queued a legitimate final camera
        // repair (notably for Centered mode after a long display stall). Keep
        // that new target; this reset only retires page-transition state.
        resetCompositeTimelinePageFollow(dom, { cancelCoverageRepair: false });
        syncCompositeTimelineNativeCamera(dom);
        hybridSession.previewPlaying = false;
        hybridSession.previewLoading = false;
        hybridSession.previewMode = '';
        hybridSession.previewRecordingGain = 1;
        hybridPerfResetFrame('timeline.playhead');
        updateCompositePreviewButtons();
        setCompositePreviewHelp(`${finishedLabel} finished · press Space to replay.`);
        setCompositeEditorStatus(`Hybrid preview: ${finishedLabel.toLowerCase()} finished.`);
    } else {
        const visualScroll = applyCompositeTimelineCamera(
            dom, frame.visualScrollLeft, frame.contentX);
        updateCompositeTimelineMapFrame(dom, beat, visualScroll, frameTime, true);
    }
}

function startCompositeTimelinePlayhead() {
    wakeCompositeTimelinePlayhead();
}

function wakeCompositeTimelinePlayhead() {
    if (timelinePlayheadFrame || !_compositeTimelineStageActivePure(hybridSession.stage)
            || !hybridSession.previewMode || !hybridSession.previewPlaying
            || !compositePreviewControllerPlaying()) return false;
    timelinePlayheadFrame = requestAnimationFrame(updateCompositeTimelinePlayhead);
    return true;
}

function refreshCompositeTimelinePlayheadNow() {
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelinePlayheadFrame = 0;
    updateCompositeTimelinePlayhead();
}

function prepareCurrentReviewFocus(seek = false) {
    if (!requireCurrentCompositePlan()) return;
    if (hybridSession.stage !== 'review') return;
    const view = currentConflictView();
    if (!view) return;
    hybridSession.timelineFocusReview = true;
    if (seek) {
        if (hybridSession.previewMode || hybridSession.previewLoading
                || hybridSession.previewPlaying) endCompositePreviewPlayback();
        const time = Math.max(0, timeOf(hybridSession.plan.beats, view.context.startBeat));
        seekCompositeTimelineAtTime(time);
    }
}

function currentReviewCenteredScroll(view, scroller) {
    if (!view?.review || !scroller) return null;
    const beat = (view.review.startBeat + view.review.endBeat) / 2;
    return clampTimelineScroll(scroller,
        compositeTimelineCenteredScrollPure({
            beat, context: view.context,
            zoom: compositeTimelineEffectiveZoom(view, scroller.clientWidth),
            viewportWidth: scroller.clientWidth,
        }));
}

function centerCurrentReviewInTimeline(view, scroller) {
    const nextScroll = currentReviewCenteredScroll(view, scroller);
    if (nextScroll === null) return;
    if (timelineViewportDom) setCompositeTimelineNativeCamera(
        timelineViewportDom, nextScroll, false);
    else rememberCompositeTimelineScroll(nextScroll);
    hybridSession.timelineFocusReview = false;
    return nextScroll;
}

function refreshCompositeTimelineFollowControl() {
    const follow = byId('editor-composite-time-follow');
    if (!follow) return;
    follow.value = compositeTimelineFollowMode();
}

function bindCompositeTimelineEvents() {
    const view = currentTimelineView();
    const scroller = byId('editor-composite-timeline-scroller');
    if (!view || !scroller) return;
    const content = byId('editor-composite-timeline-content');
    const map = byId('editor-composite-timeline-map');
    const viewportWidth = Math.max(1, scroller.clientWidth || 1);
    const effectiveZoom = compositeTimelineEffectiveZoom(view, viewportWidth);
    const contentWidth = compositeTimelineContentWidthPure(view.context, effectiveZoom);
    const reducedMotionQuery = typeof globalThis.matchMedia === 'function'
        ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const cameraSlots = [...(content?.querySelectorAll(
        '[data-composite-timeline-camera]') || [])]
        .sort((left, right) => Number(left.dataset.compositeTimelineCameraSlot)
            - Number(right.dataset.compositeTimelineCameraSlot))
        .map(camera => compositeTimelineCameraSlot(camera, view))
        .filter(Boolean);
    const primarySlot = cameraSlots[0];
    const headers = new Map(view.lanes.map(lane => [lane.id,
        content?.querySelector(`[data-composite-timeline-header="${lane.id}"]`)]));
    timelineViewportDom = {
        view,
        scroller,
        content,
        camera: primarySlot?.camera,
        cameraSlots,
        activeCameraIndex: 0,
        fixedHeaders: content?.querySelector('[data-composite-timeline-fixed-headers]'),
        ruler: primarySlot?.ruler,
        rulerSvg: primarySlot?.rulerSvg,
        lanes: primarySlot?.lanes || new Map(),
        headers,
        map,
        mapStaticInputs: compositeTimelineStaticMapInputs(view),
        mapViewport: map?.querySelector('#editor-composite-map-viewport'),
        mapViewportWindow: map?.querySelector('[data-composite-map-viewport-window]'),
        mapPlayhead: map?.querySelector('#editor-composite-map-playhead'),
        overviewIntervalIndex: compositeTimelineOverviewIntervalIndexPure(view),
        playhead: content?.querySelector('#editor-composite-timeline-playhead'),
        zoomOutput: byId('editor-composite-time-zoom-value'),
        zoomControls: document.querySelector('[data-composite-note-zoom-controls]'),
        zoomSlider: byId('editor-composite-time-zoom'),
        zoomPreset: byId('editor-composite-time-preset'),
        zoomButtons: [...document.querySelectorAll('[data-composite-time-zoom]')],
        overviewButton: byId('editor-composite-time-overview'),
        renderedRange: null,
        renderedZoom: null,
        renderedViewportWidth: 0,
        viewportWidth,
        contentWidth,
        maxScroll: Math.max(0, contentWidth - viewportWidth),
        renderOriginX: 0,
        surfaceWidth: 0,
        visualScrollLeft: scroller.scrollLeft,
        nativeScrollLeft: scroller.scrollLeft,
        lastCoverageVisualScroll: scroller.scrollLeft,
        travelDirection: 1,
        playheadX: compositeTimelineXForBeatPure(
            compositeTimelineDisplayBeatAtTime(view, hybridSession.timelineSeekTime),
            view.context, effectiveZoom),
        seekAriaUpdatedAt: Number.NaN,
        seekAriaSignature: '',
        mapViewportWidth: '',
        mapViewportVisualScroll: Number.NaN,
        standbyPending: false,
        standbyPurpose: '',
        standbySlotIndex: null,
        standbyTargetVisualScroll: Number.NaN,
        pageTransition: null,
        pageTargetWaiting: false,
        pageTargetImmediate: false,
        pageLastTime: Number.NaN,
        pageLastContentX: Number.NaN,
        pageImmediateCatchup: false,
        pagePreparedSlotIndex: null,
        pagePreparedScrollLeft: Number.NaN,
        reducedMotion: !!reducedMotionQuery?.matches,
        cleanup: new Set(),
    };
    for (const [index, slot] of cameraSlots.entries()) {
        setCompositeTimelineCameraSlotActive(slot, index === 0);
    }
    if (primarySlot) {
        primarySlot.renderSignature = compositeTimelineRenderSignature(
            timelineViewportDom, effectiveZoom);
    }
    activateCompositeTimelineCameraSlot(timelineViewportDom, 0);
    const boundDom = timelineViewportDom;
    if (reducedMotionQuery) {
        const updateReducedMotion = event => {
            if (timelineViewportDom === boundDom) {
                boundDom.reducedMotion = !!event.matches;
            }
        };
        reducedMotionQuery.addEventListener?.('change', updateReducedMotion);
        boundDom.cleanup.add(() => reducedMotionQuery.removeEventListener?.(
            'change', updateReducedMotion));
    }
    scroller.addEventListener('scroll', () => {
        const dom = boundDom;
        if (timelineViewportDom !== dom) return;
        const programmaticTarget = timelineProgrammaticScrollTarget;
        timelineProgrammaticScrollTarget = null;
        const internalCameraCommit = Number.isFinite(Number(programmaticTarget))
            && Math.abs(scroller.scrollLeft - Number(programmaticTarget)) < 0.5;
        if (internalCameraCommit) {
            dom.nativeScrollLeft = scroller.scrollLeft;
            applyCompositeTimelineCamera(dom, compositeTimelineVisualScrollLeft(dom));
        } else {
            resetCompositeTimelinePageFollow(dom, { immediateCatchup: true });
            const previousNative = Number.isFinite(Number(dom.nativeScrollLeft))
                ? Number(dom.nativeScrollLeft) : scroller.scrollLeft;
            const visualScroll = clampTimelineScroll(scroller,
                compositeTimelineVisualScrollLeft(dom) + scroller.scrollLeft - previousNative);
            dom.nativeScrollLeft = scroller.scrollLeft;
            rememberCompositeTimelineScroll(visualScroll);
            applyCompositeTimelineCamera(dom, visualScroll);
        }
        updateCompositeTimelineMapViewport(dom, dom.view, scroller,
            compositeTimelineVisualScrollLeft(dom));
        scheduleCompositeTimelineViewport();
    }, { passive: true });
    const prepareManualScroll = () => {
        const dom = boundDom;
        if (timelineViewportDom !== dom) return;
        if (Math.abs(scroller.scrollLeft - compositeTimelineVisualScrollLeft(dom)) >= 0.5) {
            syncCompositeTimelineNativeCamera(dom);
        }
    };
    scroller.addEventListener('wheel', event => {
        if (!event.ctrlKey) {
            if (event.deltaX || event.deltaY) prepareManualScroll();
            return;
        }
        if (!event.deltaY) return;
        event.preventDefault();
        if (compositeTimelineOverviewActive() && event.deltaY > 0) return;
        const rect = scroller.getBoundingClientRect();
        const anchor = event.clientX - rect.left;
        scheduleCompositeTimelineZoom(compositeTimelineSteppedZoomPure(
            pendingCompositeTimelineZoom(), event.deltaY < 0 ? 1 : -1), anchor);
    }, { passive: false });
    scroller.addEventListener('pointerdown', event => {
        if (event.target === scroller) prepareManualScroll();
    }, { passive: true });
    scroller.addEventListener('touchstart', prepareManualScroll, { passive: true });
    const seekFromRuler = (event, slot) => {
        if (timelineViewportDom !== boundDom) return;
        const liveView = boundDom.view;
        const ruler = slot.rulerSvg;
        const rect = ruler.getBoundingClientRect();
        const contentX = event.clientX - rect.left
            + (slot.renderOriginX || timelineViewportDom?.renderOriginX || 0);
        if (contentX < COMPOSITE_TIMELINE_GUTTER) return;
        const beat = Math.max(liveView.context.startBeat, Math.min(liveView.context.endBeat,
            compositeTimelineBeatForXPure(contentX, liveView.context,
                compositeTimelineEffectiveZoom(liveView, boundDom.viewportWidth))));
        const time = Math.max(0, timeOf(hybridSession.plan.beats, beat));
        seekCompositeTimelineAtTime(time);
    };
    const seekFromTimelineKeyboard = event => {
        if (timelineViewportDom !== boundDom
                || event.altKey || event.ctrlKey || event.metaKey) return;
        const liveView = boundDom.view;
        const currentBeat = compositeTimelineDisplayBeatAtTime(
            liveView, hybridSession.timelineSeekTime);
        const visible = compositeTimelineViewportRangePure({
            context: liveView.context,
            zoom: compositeTimelineEffectiveZoom(liveView, boundDom.viewportWidth),
            scrollLeft: compositeTimelineVisualScrollLeft(boundDom),
            viewportWidth: boundDom.viewportWidth,
        });
        const beat = _compositeTimelineKeyboardSeekPure({
            key: event.key,
            currentBeat,
            context: liveView.context,
            pageBeats: Math.max(1, visible.endBeat - visible.startBeat),
        });
        if (beat === null) return;
        event.preventDefault();
        event.stopPropagation();
        seekCompositeTimelineAtTime(
            Math.max(0, timeOf(hybridSession.plan.beats, beat)), { center: true });
    };
    for (const slot of cameraSlots) {
        slot.rulerSvg?.addEventListener('click', event => seekFromRuler(event, slot));
        slot.rulerSvg?.addEventListener('keydown', seekFromTimelineKeyboard);
    }
    map?.addEventListener('keydown', seekFromTimelineKeyboard);
    for (const button of boundDom.zoomButtons) {
        button.addEventListener('click', () => scheduleCompositeTimelineZoom(
            compositeTimelineSteppedZoomPure(pendingCompositeTimelineZoom(),
                button.dataset.compositeTimeZoom === 'in' ? 1 : -1), null, false, true));
    }
    byId('editor-composite-time-zoom')?.addEventListener('input', event => {
        scheduleCompositeTimelineZoom(Number(event.target.value));
    });
    byId('editor-composite-time-zoom')?.addEventListener('change', event => {
        scheduleCompositeTimelineZoom(Number(event.target.value), null, false, true);
    });
    byId('editor-composite-time-preset')?.addEventListener('change', event => {
        scheduleCompositeTimelineZoom(Number(event.target.value), null, false, true);
    });
    boundDom.overviewButton?.addEventListener('click', () => {
        scheduleCompositeTimelineDisplayMode(boundDom,
            compositeTimelineOverviewActive()
                ? HYBRID_TIMELINE_DISPLAY_NOTES
                : HYBRID_TIMELINE_DISPLAY_OVERVIEW);
    });
    byId('editor-composite-time-follow')?.addEventListener('change', event => {
        setHybridPreviewPreferences({
            ...hybridPreviewPreferences,
            timelineFollowMode: event.target.value,
        });
        resetCompositeTimelinePageFollow(boundDom, { immediateCatchup: true });
        refreshCompositeTimelineFollowControl();
        refreshCompositeTimelinePlayheadNow();
    });
    const mapLocationAt = (clientX, rect) => {
        const beat = compositeTimelineMapBeatPure({
            clientX,
            mapLeft: rect.left,
            mapWidth: rect.width,
            context: boundDom.view.context,
        });
        const time = Math.max(0, timeOf(hybridSession.plan.beats, beat));
        const scrollLeft = clampTimelineScroll(scroller,
            compositeTimelineCenteredScrollPure({
                beat,
                context: boundDom.view.context,
                zoom: compositeTimelineEffectiveZoom(
                    boundDom.view, boundDom.viewportWidth),
                viewportWidth: scroller.clientWidth,
            }));
        return { beat, time, scrollLeft };
    };
    const previewMapLocation = location => {
        hybridSession.timelineSeekTime = location.time;
        rememberCompositeTimelineScroll(location.scrollLeft);
        const contentX = compositeTimelineXForBeatPure(
            location.beat, boundDom.view.context,
            compositeTimelineEffectiveZoom(boundDom.view, boundDom.viewportWidth));
        applyCompositeTimelineCamera(boundDom, location.scrollLeft, contentX);
        updateCompositeTimelineMapFrame(
            boundDom, location.beat, location.scrollLeft, 0, true);
        return location;
    };
    const settleMapCamera = location => {
        setCompositeTimelineNativeCamera(boundDom, location.scrollLeft, false);
        scheduleCompositeTimelineViewport();
        refreshCompositeTimelinePlayheadNow();
    };
    let mapPointerGesture = null;
    const discardMapGesture = pointerId => {
        const gesture = mapPointerGesture;
        if (!gesture) return;
        if (gesture.frame) cancelAnimationFrame(gesture.frame);
        mapPointerGesture = null;
        if (pointerId != null) map?.releasePointerCapture?.(pointerId);
    };
    const flushMapPreview = (clientX = mapPointerGesture?.latestClientX) => {
        const gesture = mapPointerGesture;
        if (!gesture) return null;
        if (gesture.frame) cancelAnimationFrame(gesture.frame);
        gesture.frame = 0;
        gesture.latestClientX = clientX;
        gesture.location = previewMapLocation(mapLocationAt(clientX, gesture.rect));
        return gesture.location;
    };
    const queueMapPreview = clientX => {
        const gesture = mapPointerGesture;
        if (!gesture) return;
        gesture.latestClientX = clientX;
        if (gesture.frame) return;
        gesture.frame = requestAnimationFrame(() => {
            if (mapPointerGesture !== gesture) return;
            if (boundDom.reviewRefreshPending) {
                discardMapGesture(gesture.pointerId);
                return;
            }
            gesture.frame = 0;
            gesture.location = previewMapLocation(
                mapLocationAt(gesture.latestClientX, gesture.rect));
        });
    };
    const resumeMapPreview = gesture => {
        if (gesture?.resumePlaying && gesture.resumeMode
                && timelineViewportDom === boundDom) {
            startCompositePreview(gesture.resumeMode);
        }
    };
    map?.addEventListener('pointerdown', event => {
        if (timelineViewportDom !== boundDom) return;
        if (event.button !== 0) return;
        event.preventDefault();
        const decision = event.target.closest?.('[data-composite-map-decision]');
        const density = event.target.closest?.('[data-composite-map-density-kind]');
        const surface = map.querySelector('svg') || map;
        const rect = surface.getBoundingClientRect();
        const densityLocation = density ? mapLocationAt(event.clientX, rect) : null;
        const densityItem = density ? compositeTimelineOverviewIntervalAtBeatPure(
            boundDom.overviewIntervalIndex,
            densityLocation.beat,
            {
                kind: density.dataset.compositeMapDensityKind,
                state: density.dataset.compositeMapDensityState,
            },
        ) : null;
        const densityKind = density?.dataset.compositeMapDensityKind;
        const resumeMode = hybridSession.previewMode;
        const resumePlaying = hybridSession.previewPlaying
            && compositePreviewControllerPlaying();
        const gestureStartTime = hybridSession.timelineSeekTime;
        // Pause at most once for the whole gesture. Pointer moves below only
        // update compositor transforms; one authoritative Editor seek happens
        // when the pointer is released.
        if (hybridSession.previewMode || hybridSession.previewLoading
                || hybridSession.previewPlaying) endCompositePreviewPlayback();
        mapPointerGesture = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            latestClientX: event.clientX,
            moved: false,
            decisionIndex: decision ? Number(decision.dataset.compositeMapDecision)
                : densityKind === 'decision' && Number.isInteger(densityItem?.index)
                    ? densityItem.index : -1,
            rect,
            frame: 0,
            location: null,
            resumeMode,
            resumePlaying,
            startTime: gestureStartTime,
        };
        map.setPointerCapture?.(event.pointerId);
        queueMapPreview(event.clientX);
    });
    map?.addEventListener('pointermove', event => {
        if (timelineViewportDom !== boundDom) return;
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId
            || !(event.buttons & 1)) return;
        if (boundDom.reviewRefreshPending) {
            discardMapGesture(event.pointerId);
            return;
        }
        if (Math.hypot(event.clientX - mapPointerGesture.startX,
            event.clientY - mapPointerGesture.startY) > 4) mapPointerGesture.moved = true;
        queueMapPreview(event.clientX);
    });
    map?.addEventListener('pointerup', event => {
        if (timelineViewportDom !== boundDom) return;
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId) return;
        if (boundDom.reviewRefreshPending) {
            discardMapGesture(event.pointerId);
            return;
        }
        const gesture = mapPointerGesture;
        const location = flushMapPreview(event.clientX);
        mapPointerGesture = null;
        map.releasePointerCapture?.(event.pointerId);
        const opensDecision = !gesture.moved
            && Number.isInteger(gesture.decisionIndex) && gesture.decisionIndex >= 0
            && hybridSession.stage === 'review'
            && hybridSession.plan.conflicts[gesture.decisionIndex];
        if (gesture.resumePlaying && gesture.resumeMode
                && !opensDecision) {
            // startCompositePreview owns the single transport seek when it
            // resumes. Settle only visual/native camera state here so the same
            // cursor is not redundantly committed twice.
            settleMapCamera(location);
        } else {
            seekCompositeTimelineAtTime(location.time, { center: true });
        }
        if (gesture.moved) {
            resumeMapPreview(gesture);
            return;
        }
        if (opensDecision) {
            hybridSession.conflictIndex = gesture.decisionIndex;
            prepareCurrentReviewFocus(false);
            hybridSession.timelineFocusReview = false;
            hybridSession.timelineSeekTime = location.time;
            rememberCompositeTimelineScroll(location.scrollLeft);
            if (!refreshCurrentCompositeReview()) renderResult();
            return;
        }
        resumeMapPreview(gesture);
    });
    const clearMapGesture = event => {
        if (timelineViewportDom !== boundDom) return;
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId) return;
        if (boundDom.reviewRefreshPending) {
            discardMapGesture(event.pointerId);
            return;
        }
        const gesture = mapPointerGesture;
        if (gesture.frame) cancelAnimationFrame(gesture.frame);
        mapPointerGesture = null;
        if (gesture.resumePlaying && gesture.resumeMode) {
            const beat = beatOf(hybridSession.plan.beats, gesture.startTime);
            settleMapCamera(previewMapLocation({
                beat,
                time: gesture.startTime,
                scrollLeft: clampTimelineScroll(scroller,
                    compositeTimelineCenteredScrollPure({
                        beat,
                        context: boundDom.view.context,
                        zoom: compositeTimelineEffectiveZoom(
                            boundDom.view, boundDom.viewportWidth),
                        viewportWidth: scroller.clientWidth,
                    })),
            }));
        } else {
            seekCompositeTimelineAtTime(gesture.startTime, { center: true });
        }
        resumeMapPreview(gesture);
    };
    map?.addEventListener('pointercancel', clearMapGesture);
    map?.addEventListener('lostpointercapture', clearMapGesture);
    boundDom.cleanup.add(() => {
        if (mapPointerGesture?.frame) cancelAnimationFrame(mapPointerGesture.frame);
        mapPointerGesture = null;
    });
    byId('editor-composite-focus-review')?.addEventListener('click', () => {
        centerCurrentReviewInTimeline(boundDom.view, scroller);
    });
    const updateLaneResizeAria = (laneId, height) => {
        const value = compositeTimelineLaneHeightPure(height);
        for (const grip of content?.querySelectorAll('[data-composite-lane-resize]') || []) {
            if (grip.dataset.compositeLaneResize !== laneId) continue;
            grip.setAttribute('aria-valuemin', String(HYBRID_TIMELINE_LANE_MIN));
            grip.setAttribute('aria-valuemax', String(HYBRID_TIMELINE_LANE_MAX));
            grip.setAttribute('aria-valuenow', String(value));
            grip.setAttribute('aria-valuetext', `${value} pixels high`);
        }
    };
    const applyLaneHeights = laneHeights => {
        setHybridPreviewPreferences({
            ...hybridPreviewPreferences, laneHeights,
        });
        for (const [laneId, height] of Object.entries(
            hybridPreviewPreferences.laneHeights)) updateLaneResizeAria(laneId, height);
        refreshCompositeTimelineViewport(true);
    };
    byId('editor-composite-lanes-reset')?.addEventListener('click', () => {
        applyLaneHeights({ ...HYBRID_PREVIEW_DEFAULTS.laneHeights });
    });
    byId('editor-composite-lanes-equal')?.addEventListener('click', () => {
        const values = Object.values(hybridPreviewPreferences.laneHeights);
        const equal = Math.round(values.reduce((sum, value) => sum + value, 0)
            / Math.max(1, values.length));
        applyLaneHeights({ primary: equal, secondary: equal, result: equal });
    });
    scroller.addEventListener('click', event => {
        const note = event.target.closest?.('[data-composite-entry-id]');
        if (note) toggleCompositeCustomEntry(note.dataset.compositeEntryId);
    });
    scroller.addEventListener('keydown', event => {
        const note = event.target.closest?.('[data-composite-entry-id]');
        if (note && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggleCompositeCustomEntry(note.dataset.compositeEntryId);
            return;
        }
        if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']
            .includes(event.key)) prepareManualScroll();
    });
    const previewCompositeLaneHeight = (laneId, height, updateAria = true) => {
        for (const slot of boundDom.cameraSlots || []) {
            const laneDom = slot.lanes.get(laneId);
            if (laneDom?.row) laneDom.row.style.height = `${height}px`;
            // During the drag, stretch the current SVG viewport instead of
            // regenerating every note. Exact string geometry is rendered once
            // when the pointer is released.
            if (laneDom?.svg) laneDom.svg.style.height = `${height}px`;
        }
        const header = boundDom.headers?.get(laneId);
        if (header) header.style.height = `${height}px`;
        if (updateAria) updateLaneResizeAria(laneId, height);
        updateCompositeTimelineFixedLaneHeights(boundDom);
    };
    for (const grip of content?.querySelectorAll('[data-composite-lane-resize]') || []) {
        const reset = () => {
            const laneId = grip.dataset.compositeLaneResize;
            setHybridPreviewPreferences({
                ...hybridPreviewPreferences,
                laneHeights: {
                    ...hybridPreviewPreferences.laneHeights,
                    [laneId]: HYBRID_PREVIEW_DEFAULTS.laneHeights[laneId],
                },
            });
            updateLaneResizeAria(laneId, hybridPreviewPreferences.laneHeights[laneId]);
            refreshCompositeTimelineViewport(true);
        };
        grip.addEventListener('dblclick', event => { event.preventDefault(); reset(); });
        grip.addEventListener('keydown', event => {
            if (timelineViewportDom !== boundDom
                    || event.altKey || event.ctrlKey || event.metaKey) return;
            const laneId = grip.dataset.compositeLaneResize;
            const height = _compositeTimelineLaneResizeKeyPure(
                event.key, hybridPreviewPreferences.laneHeights[laneId]);
            if (height === null) return;
            event.preventDefault();
            event.stopPropagation();
            cancelCompositeTimelineStandbyWork(boundDom);
            setHybridPreviewPreferences({
                ...hybridPreviewPreferences,
                laneHeights: {
                    ...hybridPreviewPreferences.laneHeights,
                    [laneId]: height,
                },
            });
            previewCompositeLaneHeight(laneId, height);
            if (boundDom.reviewRefreshPending) {
                boundDom.reviewResizePending = true;
                return;
            }
            refreshCompositeTimelineViewport(true);
        });
        grip.addEventListener('pointerdown', event => {
            if (timelineViewportDom !== boundDom) return;
            event.preventDefault();
            cancelCompositeTimelineStandbyWork(boundDom);
            const laneId = grip.dataset.compositeLaneResize;
            const startY = event.clientY;
            const startHeight = hybridPreviewPreferences.laneHeights[laneId];
            let latestY = startY;
            let resizeFrame = 0;
            let finished = false;
            const applyLatestHeight = () => {
                resizeFrame = 0;
                if (finished || timelineViewportDom !== boundDom) return;
                setHybridPreviewPreferences({
                    ...hybridPreviewPreferences,
                    laneHeights: {
                        ...hybridPreviewPreferences.laneHeights,
                        [laneId]: startHeight + latestY - startY,
                    },
                }, { deferred: true });
                previewCompositeLaneHeight(
                    laneId, hybridPreviewPreferences.laneHeights[laneId], false);
            };
            const move = moveEvent => {
                if (timelineViewportDom !== boundDom) return;
                latestY = moveEvent.clientY;
                if (!resizeFrame) resizeFrame = requestAnimationFrame(applyLatestHeight);
            };
            const finish = (commit = true) => {
                if (finished) return;
                if (resizeFrame) {
                    cancelAnimationFrame(resizeFrame);
                    resizeFrame = 0;
                }
                if (commit) {
                    applyLatestHeight();
                    updateLaneResizeAria(
                        laneId, hybridPreviewPreferences.laneHeights[laneId]);
                }
                finished = true;
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', cancel);
                window.removeEventListener('blur', cancel);
                boundDom.cleanup.delete(cleanup);
                if (!commit || timelineViewportDom !== boundDom) return;
                flushHybridPreviewPreferences();
                if (boundDom.reviewRefreshPending) {
                    boundDom.reviewResizePending = true;
                    return;
                }
                refreshCompositeTimelineViewport(true);
            };
            const up = upEvent => {
                if (Number.isFinite(Number(upEvent?.clientY))) latestY = upEvent.clientY;
                finish(true);
            };
            const cancel = () => finish(true);
            const cleanup = () => finish(false);
            boundDom.cleanup.add(cleanup);
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up, { once: true });
            window.addEventListener('pointercancel', cancel, { once: true });
            window.addEventListener('blur', cancel, { once: true });
        });
    }
    if (typeof ResizeObserver === 'function') {
        timelineResizeObserver = new ResizeObserver(() => {
            if (timelineViewportDom !== boundDom) return;
            if (boundDom.reviewRefreshPending) {
                boundDom.reviewResizePending = true;
                return;
            }
            if (!compositeTimelineOverviewActive()) {
                resetCompositeTimelinePageFollow(boundDom, { immediateCatchup: true });
                scheduleCompositeTimelineViewport();
                return;
            }
            // A fit zoom depends on the measured viewport. Keep the last exact
            // camera crisp during the resize gesture, then atomically rebuild
            // its density geometry and stopped/playback marker at the new fit.
            if (timelineOverviewResizeTimer) clearTimeout(timelineOverviewResizeTimer);
            timelineOverviewResizeTimer = setTimeout(() => {
                timelineOverviewResizeTimer = 0;
                if (timelineViewportDom === boundDom) {
                    if (boundDom.reviewRefreshPending) {
                        boundDom.reviewResizePending = true;
                        return;
                    }
                    refreshCompositeTimelineViewport(true);
                    refreshCompositeTimelinePlayheadNow();
                }
            }, 60);
        });
        timelineResizeObserver.observe(scroller);
    }
    timelineBindFrame = requestAnimationFrame(() => {
        timelineBindFrame = 0;
        if (timelineViewportDom !== boundDom) return;
        const liveView = boundDom.view;
        let nextScroll;
        if (liveView.review && hybridSession.timelineFocusReview) {
            const beat = (liveView.review.startBeat + liveView.review.endBeat) / 2;
            nextScroll = clampTimelineScroll(scroller,
                compositeTimelineCenteredScrollPure({
                    beat, context: liveView.context,
                    zoom: compositeTimelineEffectiveZoom(liveView, boundDom.viewportWidth),
                    viewportWidth: scroller.clientWidth,
                }));
            hybridSession.timelineFocusReview = false;
        } else {
            nextScroll = clampTimelineScroll(scroller,
                hybridSession.timelineScrollLeft);
        }
        const primedScroll = clampCompositeTimelineScroll(boundDom, nextScroll);
        timelineProgrammaticScrollTarget = primedScroll;
        scroller.scrollLeft = primedScroll;
        boundDom.nativeScrollLeft = scroller.scrollLeft;
        boundDom.visualScrollLeft = primedScroll;
        boundDom.lastCoverageVisualScroll = primedScroll;
        rememberCompositeTimelineScroll(primedScroll);
        refreshCompositeTimelineViewport(true);
        refreshCompositeTimelinePlayheadNow();
    });
}

function renderFinalPreviewResult(plan, names, normalizationDetails, repeatNoticeMarkup) {
    const view = wholePlanPreviewView();
    const guided = plan.strategy === 'guided';
    const stats = plan.stats || {};
    const summary = guided
        ? _compositeGuidedSummaryPure(stats, plan.conflicts.length)
        : _compositeAutomaticSummaryPure(stats, names);
    const backReview = plan.conflicts.length
        ? `<button type="button" id="editor-composite-back-review" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">← Back to review choices</button>` : '';
    return `<section class="mx-auto max-w-none">`
        + `<div class="mb-2 rounded-lg border border-emerald-700/50 bg-emerald-950/20 px-3 py-2">`
        + `<div class="flex flex-wrap items-center justify-between gap-2"><div class="flex flex-wrap items-baseline gap-x-2"><b class="text-sm text-emerald-100">${_editorEscHtml(summary.title)}</b>`
        + `<p class="text-xs text-gray-300">${_editorEscHtml(summary.description)}</p></div><div class="flex flex-wrap gap-2">${backReview}`
        + `<button type="button" id="editor-composite-edit-settings" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">Back and adjust</button></div></div></div>`
        + renderCompositeTimelineWorkspace(view, view.wholeSong)
        + normalizationDetails + repeatNoticeMarkup
        + `</section>`;
}

function refreshCompositePlanDerivedState(plan) {
    if (plan.strategy === 'guided') guidedReviewGroups(plan);
}

function compositeResultNotices(plan) {
    const normalized = plan.stats?.timingAdjustments || 0;
    const normalizationNotice = normalized
        ? `<details class="mb-3 rounded border border-gray-700 bg-dark-900/50 px-3 py-2 text-xs text-gray-400">`
            + `<summary class="cursor-pointer hover:text-gray-200">Technical details: ${normalized} tiny import timing ${normalized === 1 ? 'seam was' : 'seams were'} cleaned up</summary>`
            + `<p class="mt-2">The cleanup stayed within the tempo-aware ${Math.round(COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS * 1000)} ms safety limit. Only the new hybrid uses the adjusted trail; both original tracks remain unchanged.</p></details>`
        : '';
    const repeatNotice = plan.repeatNotice;
    let repeatNoticeMarkup = '';
    if (repeatNotice && (repeatNotice.requested > 1 || repeatNotice.kind !== 'applied')) {
        if (repeatNotice.kind === 'partial') {
            const failures = repeatNotice.failed
                .map(failure => `${failure.label}: ${failure.error}`).join(' ');
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs text-amber-100"><b>Your choice worked in ${repeatNotice.applied} of ${repeatNotice.requested} matching sections.</b> ${repeatNotice.failed.length} ${repeatNotice.failed.length === 1 ? 'section needs' : 'sections need'} a separate choice because the surrounding notes differ. ${_editorEscHtml(failures)}</div>`;
        } else if (repeatNotice.kind === 'detached') {
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-sky-800/50 bg-sky-950/20 px-3 py-2 text-xs text-sky-100"><b>${_editorEscHtml(repeatNotice.label)} can now have its own choice.</b></div>`;
        } else {
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100"><b>Your choice was used in all ${repeatNotice.applied} matching sections.</b> Each section passed its own playability check.</div>`;
        }
    }
    return { normalizationNotice, repeatNoticeMarkup };
}

function elementFromCompositeMarkup(markup) {
    const template = document.createElement('template');
    template.innerHTML = String(markup || '').trim();
    return template.content.firstElementChild;
}

const COMPOSITE_REVIEW_FOCUS_KEYS = Object.freeze([
    'resolution', 'entryId', 'conflictIndex', 'guidedSplitBeat',
]);

function captureCompositeReviewUi(toolbar) {
    const active = document.activeElement;
    let focus = null;
    if (active && toolbar.contains(active)) {
        if (active.id) focus = { kind: 'id', value: active.id };
        if (!focus) {
            for (const key of COMPOSITE_REVIEW_FOCUS_KEYS) {
                if (active.dataset?.[key] != null) {
                    focus = { kind: 'data', key, value: active.dataset[key] };
                    break;
                }
            }
        }
        if (!focus && active.matches?.('summary')) {
            focus = {
                kind: 'summary',
                value: [...toolbar.querySelectorAll('summary')].indexOf(active),
            };
        }
    }
    return {
        focus,
        workspaceScrollTop: byId('editor-composite-result-workspace')?.scrollTop || 0,
        details: [...toolbar.querySelectorAll('details')].map(details => ({
            open: details.open,
            panelScrollTop: details.querySelector(
                '.editor-composite-review-details-panel')?.scrollTop || 0,
        })),
    };
}

function restoreCompositeReviewUi(toolbar, snapshot) {
    const details = [...toolbar.querySelectorAll('details')];
    for (const [index, state] of (snapshot?.details || []).entries()) {
        const current = details[index];
        if (!current) continue;
        current.open = state.open;
        const panel = current.querySelector('.editor-composite-review-details-panel');
        if (panel) panel.scrollTop = state.panelScrollTop;
    }
    const workspace = byId('editor-composite-result-workspace');
    if (workspace) workspace.scrollTop = snapshot?.workspaceScrollTop || 0;
    const focus = snapshot?.focus;
    let target = null;
    if (focus?.kind === 'id') {
        target = [...toolbar.querySelectorAll('[id]')]
            .find(candidate => candidate.id === focus.value);
    } else if (focus?.kind === 'data') {
        target = [...toolbar.querySelectorAll(`[data-${focus.key.replace(
            /[A-Z]/g, character => `-${character.toLowerCase()}`)}]`)]
            .find(candidate => candidate.dataset[focus.key] === focus.value);
    } else if (focus?.kind === 'summary') {
        target = toolbar.querySelectorAll('summary')[focus.value];
    }
    if (target?.disabled) target = null;
    if (!target && focus) {
        target = toolbar.querySelector(
            '[data-resolution][aria-pressed="true"], [data-resolution], button:not([disabled])');
    }
    if (!target?.focus) return;
    try { target.focus({ preventScroll: true }); }
    catch (_) { target.focus(); }
}

function refreshCompositePreviewAvailability(view) {
    const modes = new Map(compositePreviewModesPure(view, {
        audioAvailable: compositePreviewAudioAvailable(),
        resultReady: !!view.conflict?.resolution,
    }).map(mode => [mode.id, mode]));
    const shortcuts = { song: '1', primary: '2', secondary: '3', result: '4' };
    for (const button of document.querySelectorAll('[data-composite-preview]')) {
        const mode = modes.get(button.dataset.compositePreview);
        if (!mode) continue;
        button.dataset.compositePreviewAvailable = mode.available ? 'true' : 'false';
        button.title = mode.unavailableReason || `${mode.label} (${shortcuts[mode.id]})`;
    }
    updateCompositePreviewButtons();
}

function refreshCompositeTimelineHeaders(dom, view) {
    for (const lane of view.lanes) {
        const previous = dom.headers?.get(lane.id);
        if (!previous) continue;
        const replacement = elementFromCompositeMarkup(renderCompositeTimelineLaneHeader(
            view, lane.id,
            compositeTimelineLaneHeightPure(hybridPreviewPreferences.laneHeights[lane.id]),
            { fixed: true },
        ));
        if (!replacement) continue;
        previous.replaceWith(replacement);
        dom.headers.set(lane.id, replacement);
    }
}

function refreshCompositeTimelineStaticMap(dom, view) {
    const map = dom?.map;
    if (!map) return;
    const viewport = timelineActualViewportRange(view, dom.scroller,
        compositeTimelineVisualScrollLeft(dom), dom.viewportWidth);
    const nextInputs = compositeTimelineStaticMapInputs(view);
    if (!compositeTimelineStaticMapInputsMatch(dom.mapStaticInputs, nextInputs)) {
        const previousSvg = map.querySelector('svg');
        const replacementSvg = elementFromCompositeMarkup(
            renderCompositeTimelineMapSvg(view, viewport));
        if (previousSvg && replacementSvg) previousSvg.replaceWith(replacementSvg);
        dom.overviewIntervalIndex = compositeTimelineOverviewIntervalIndexPure(view);
        dom.mapStaticInputs = nextInputs;
        const key = map.parentElement?.querySelector('[data-composite-map-key]');
        if (key) key.innerHTML = compositeTimelineMapKeyMarkup(view);
    }
    refreshCompositeTimelineActiveDecisionOverlay(map, view);
    map.setAttribute('aria-label', compositeTimelineOverviewAccessibleLabelPure(view));
    updateCompositeTimelineSeekAria(
        dom, compositeTimelineDisplayBeatAtTime(view), { force: true });
    updateCompositeTimelineMapViewport(dom, view, dom.scroller,
        compositeTimelineVisualScrollLeft(dom), dom.viewportWidth);
}

function scheduleCompositeReviewTimelineRefresh(conflictId) {
    const generation = ++timelineReviewRefreshGeneration;
    if (timelineReviewRefreshFrame) cancelAnimationFrame(timelineReviewRefreshFrame);
    // Leave one real paint between the compact toolbar response and full-song
    // model construction. The second frame updates the bounded map/header
    // surfaces, while lane SVG work remains split across idle camera slices.
    timelineReviewRefreshFrame = requestAnimationFrame(() => {
        if (generation !== timelineReviewRefreshGeneration) {
            timelineReviewRefreshFrame = 0;
            return;
        }
        timelineReviewRefreshFrame = requestAnimationFrame(() => {
            timelineReviewRefreshFrame = 0;
            if (!requireCurrentCompositePlan()) return;
            const plan = hybridSession.plan;
            const dom = timelineViewportDom;
            const conflict = plan?.conflicts?.[hybridSession.conflictIndex];
            if (generation !== timelineReviewRefreshGeneration
                    || hybridSession.stage !== 'review' || !dom
                    || conflict?.id !== conflictId) return;
            refreshCompositePlanDerivedState(plan);
            invalidateCompositeTimelineView();
            const presentation = currentCompositeReviewPresentation(plan);
            if (!presentation?.timelineView) return;
            dom.view = presentation.timelineView;
            // Cancel work that still belongs to the previous decision before
            // preparing the new camera. A far review jump needs a fresh bounded
            // strip; cancelling coverage after requesting that strip leaves the
            // red playhead at the new decision while the tracks stay behind.
            resetCompositeTimelinePageFollow(dom, { immediateCatchup: true });
            cancelCompositeTimelineStandbyWork(dom);
            const reviewFocusScroll = hybridSession.timelineFocusReview
                ? currentReviewCenteredScroll(presentation.timelineView, dom.scroller)
                : null;
            dom.reviewRefreshPending = true;
            refreshCompositePreviewAvailability(presentation.timelineView);
            refreshCompositeTimelineHeaders(dom, presentation.timelineView);
            refreshCompositeTimelineStaticMap(dom, presentation.timelineView);
            let reviewRefreshOptions = null;
            const finishReviewRefresh = () => {
                if (timelineViewportDom !== dom) return;
                if (reviewRefreshOptions && dom.reviewRefreshOptions
                        && dom.reviewRefreshOptions !== reviewRefreshOptions) return;
                const resizePending = dom.reviewResizePending === true;
                dom.reviewResizePending = false;
                dom.reviewRefreshPending = false;
                dom.reviewRefreshOptions = null;
                if (resizePending) refreshCompositeTimelineViewport(true);
                if (resizePending && reviewFocusScroll !== null) {
                    hybridSession.timelineFocusReview = true;
                }
                // Zoom/display commits may replace a pending review render.
                // They call this shared completion hook, so retain the explicit
                // navigation focus even when that alternate path wins the race.
                if (hybridSession.timelineFocusReview) {
                    centerCurrentReviewInTimeline(dom.view, dom.scroller);
                    updateCompositeTimelineMapViewport(dom, dom.view, dom.scroller,
                        compositeTimelineVisualScrollLeft(dom), dom.viewportWidth);
                }
                updateCompositePreviewButtons();
                setCompositePreviewHelp('Tracks updated · choose a sound to preview.');
            };
            if ((dom.cameraSlots?.length || 0) > 1) {
                reviewRefreshOptions = {
                    freshnessDeadlineAt: (globalThis.performance?.now?.() || Date.now()) + 240,
                    beforeCommit: () => compositePreviewEventsForMode('result'),
                    onCommitted: finishReviewRefresh,
                };
                dom.reviewRefreshOptions = reviewRefreshOptions;
                if (reviewFocusScroll !== null) {
                    scheduleCompositeTimelineStandby(dom, reviewFocusScroll, {
                        ...reviewRefreshOptions,
                        holdReady: true,
                        purpose: 'review-focus',
                        onPrepared: (slotIndex, preparedScroll) => {
                            if (timelineViewportDom !== dom
                                    || dom.reviewRefreshOptions !== reviewRefreshOptions) return;
                            if (dom.view !== presentation.timelineView
                                    || plan.conflicts[hybridSession.conflictIndex]?.id
                                        !== conflictId) {
                                clearCompositeTimelinePagePrefetch(dom);
                                finishReviewRefresh();
                                return;
                            }
                            if (!commitCompositeTimelineCameraSlot(
                                dom, slotIndex, preparedScroll)) {
                                clearCompositeTimelinePagePrefetch(dom);
                                finishReviewRefresh();
                                return;
                            }
                            setCompositeTimelineNativeCamera(dom, preparedScroll, false);
                            hybridSession.timelineFocusReview = false;
                            updateCompositeTimelineMapViewport(
                                dom, dom.view, dom.scroller, preparedScroll, dom.viewportWidth);
                            refreshCompositeTimelinePlayheadNow();
                            finishReviewRefresh();
                        },
                    });
                } else {
                    scheduleCompositeTimelineStandby(
                        dom, compositeTimelineVisualScrollLeft(dom), reviewRefreshOptions);
                }
            } else {
                if (reviewFocusScroll !== null) {
                    timelineProgrammaticScrollTarget = reviewFocusScroll;
                    dom.scroller.scrollLeft = reviewFocusScroll;
                    dom.nativeScrollLeft = dom.scroller.scrollLeft;
                    dom.visualScrollLeft = reviewFocusScroll;
                    rememberCompositeTimelineScroll(reviewFocusScroll);
                    hybridSession.timelineFocusReview = false;
                }
                refreshCompositeTimelineViewport(true);
                compositePreviewEventsForMode('result');
                finishReviewRefresh();
            }
            refreshCompositeTimelinePlayheadNow();
        });
    });
}

// Choices, manual-note edits, and decision navigation retain the review
// workspace, controls, and listeners. Replace only the decision toolbar, then
// build the new focused model and lane SVGs after paint in the hidden camera.
function refreshCurrentCompositeReview() {
    if (!requireCurrentCompositePlan()) return false;
    const plan = hybridSession.plan;
    const previousToolbar = byId('editor-composite-result')
        ?.querySelector('.editor-composite-review-toolbar');
    const dom = timelineViewportDom;
    const conflict = plan?.conflicts?.[hybridSession.conflictIndex];
    if (hybridSession.stage !== 'review' || !plan || !conflict || !previousToolbar
            || !dom?.view?.review) {
        return false;
    }
    if (hybridSession.previewMode) endCompositePreviewPlayback();
    const snapshot = captureCompositeReviewUi(previousToolbar);
    refreshCompositePlanDerivedState(plan);
    invalidateCompositeTimelineView();
    const presentation = currentCompositeReviewPresentation(plan, {
        includeTimeline: false,
    });
    const nextToolbar = elementFromCompositeMarkup(presentation?.reviewToolbar);
    if (!presentation || !nextToolbar) {
        return false;
    }
    dom.reviewRefreshPending = true;
    updateCompositePreviewButtons();
    setCompositePreviewHelp('Updating the tracks for your choice…');
    previousToolbar.replaceWith(nextToolbar);
    bindCompositeReviewToolbarEvents(nextToolbar);
    const shell = nextToolbar.closest('[data-composite-review-shell]');
    if (shell) {
        shell.classList.remove(
            'border-red-700/60', 'border-emerald-700/60', 'border-amber-700/60');
        shell.classList.add(presentation.stateClass);
    }
    const notices = compositeResultNotices(plan);
    const noticeRegion = byId('editor-composite-result')
        ?.querySelector('[data-composite-review-notices]');
    if (noticeRegion) {
        noticeRegion.innerHTML = notices.normalizationNotice + notices.repeatNoticeMarkup;
    }
    const finish = byId('editor-composite-finish');
    if (finish) finish.disabled = plan.conflicts.some(block => !block.resolution);
    resetCompositeTimelinePageFollow(dom, { immediateCatchup: true });
    cancelCompositeTimelineStandbyWork(dom);
    restoreCompositeReviewUi(nextToolbar, snapshot);
    scheduleCompositeReviewDetailsPlacement();
    scheduleCompositeReviewTimelineRefresh(conflict.id);
    return true;
}

function renderResult() {
    if (!requireCurrentCompositePlan()) return;
    invalidateCompositeTimelineView({ base: true });
    stopCompositeTimelineUi();
    if (hybridSession.previewMode) endCompositePreviewPlayback();
    const result = byId('editor-composite-result');
    if (!result || !hybridSession.plan) return;
    updateCompositeStageIndicator(hybridSession.stage);
    refreshCompositePlanDerivedState(hybridSession.plan);
    const unresolvedBlocks = hybridSession.plan.conflicts.filter(c => !c.resolution).length;
    const { normalizationNotice, repeatNoticeMarkup } = compositeResultNotices(
        hybridSession.plan);
    const names = selectedSourceNames();
    if (hybridSession.stage === 'final-preview') {
        result.innerHTML = renderFinalPreviewResult(hybridSession.plan, names,
            normalizationNotice, repeatNoticeMarkup);
    } else {
        result.innerHTML = `<div data-composite-review-notices>${normalizationNotice}${repeatNoticeMarkup}</div>`
            + renderConflict(hybridSession.plan);
    }
    const finish = byId('editor-composite-finish');
    if (finish) {
        finish.hidden = hybridSession.stage !== 'final-preview';
        finish.disabled = unresolvedBlocks > 0;
    }
    bindResultEvents();
    recoverCompositeModalFocus();
}

function compositeAnalyzeButtonLabel() {
    if (hybridSession.plan) {
        return hybridSession.setupDirty ? 'Rebuild hybrid preview' : 'Rebuild preview';
    }
    if (selectedCompositeStrategy() === 'guided') return 'Find sections to review';
    return 'Preview automatic hybrid';
}

export function _compositeAnalysisConfigTokenPure(config) {
    return JSON.stringify(config || {});
}

export function _compositeTaskPhaseLabelPure(phase, config = {}) {
    if (phase === 'materialize') return 'Building the new Hybrid Track…';
    if (phase === 'analyze') {
        if (config.strategy === 'guided') return 'Finding sections to review…';
        return 'Finding safe gaps…';
    }
    return 'Preparing tracks…';
}

function waitForCompositeUiPaint() {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame !== 'function') {
            setTimeout(resolve, 0);
            return;
        }
        // A promise resolved by one rAF resumes in a microtask before that
        // frame paints. Waiting for the following rAF guarantees that the busy
        // label is visible even when Worker is unavailable and the local
        // fallback is about to perform synchronous analysis.
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

function setCompositeAnalysisUi(analyzing, phase = '') {
    const modal = byId('editor-composite-modal');
    if (modal) modal.setAttribute('aria-busy', analyzing ? 'true' : 'false');
    const setup = byId('editor-composite-setup');
    if (setup) setup.inert = !!analyzing;
    const analyze = byId('editor-composite-analyze');
    if (analyze) {
        const { arrangements } = readCompositeEditorSnapshot();
        analyze.disabled = !!analyzing || !_compositeSourcePairStatePure(
            arrangements,
            Number(byId('editor-composite-primary')?.value),
            Number(byId('editor-composite-secondary')?.value),
        ).ok || !validateCompositeTrackName().ok;
        analyze.textContent = analyzing
            ? phase || 'Preparing tracks…' : compositeAnalyzeButtonLabel();
    }
    const resume = byId('editor-composite-return-review');
    if (resume) resume.disabled = !!analyzing;
}

async function confirmCompositeRebuild() {
    if (!hybridSession.plan || !hybridSession.hasReviewWork) return true;
    const choice = await compositePromptChoice({
        title: 'Rebuild and discard review choices?',
        message: 'The current review choices belong to the existing preview. Rebuilding will replace them with a new analysis.',
        choices: [
            {
                key: 'keep',
                label: 'Keep current review',
                hint: 'Return to setup with every current choice intact.',
            },
            {
                key: 'discard',
                label: 'Discard choices and rebuild',
                hint: 'Use the settings shown now and start a new preview.',
            },
        ],
    });
    return choice === 'discard';
}

async function analyzeFromDialog() {
    if (hybridSession.analyzing) return;
    const nameValidation = validateCompositeTrackName({ focus: true });
    if (!nameValidation.ok) {
        showCompositeTrackNameError(nameValidation);
        return;
    }
    if (!(await confirmCompositeRebuild())) return;
    disposeCompositePreviewSession();
    const config = compositeAnalysisConfigFromDialog();
    const { primaryIndex, secondaryIndex, strategy } = config;
    const repeatMode = config.repeatMode || normalizeGuidedRepeatMode();
    const gapFill = config.gapFill || gapFillOptionsFromDialog();
    if (strategy === 'gap-fill') {
        const preferences = loadHybridGapFillPreferences();
        preferences.unit = gapFill.unit;
        preferences[gapFill.unit] = {
            minimumGap: gapFill.minimumGap,
            transitionMargin: gapFill.transitionMargin,
        };
        saveHybridGapFillPreferences(preferences);
    } else if (strategy === 'guided') {
        saveHybridGuidedPreferences({ repeatMode });
    }
    const error = byId('editor-composite-error');
    const editor = readCompositeAnalysisSnapshot(primaryIndex, secondaryIndex);
    const pairState = _compositeSourcePairStatePure(
        editor.arrangements, primaryIndex, secondaryIndex,
    );
    if (!pairState.ok) {
        if (error) error.textContent = pairState.message;
        return;
    }
    const sources = {
        primary: editor.primary,
        secondary: editor.secondary,
        beats: editor.beats,
        sections: editor.sections,
    };
    const modal = byId('editor-composite-modal');
    if (!modal) return;
    const sessionId = editor.sessionId;
    const configToken = _compositeAnalysisConfigTokenPure(config);
    const request = beginHybridAnalysis(hybridSession, {
        sessionId,
        configToken,
        editGeneration: editor.editGeneration,
        sourceGuard: editor.sourceGuard,
    });
    if (!request) return;
    const editorStillOwnsAnalysis = () => {
        const current = readCompositeEditorSnapshot();
        return current.format === 'sloppak' && current.sessionId === request.sessionId;
    };
    const requestIsCurrent = () => {
        if (byId('editor-composite-modal') !== modal) return false;
        let currentConfigToken = '';
        try {
            currentConfigToken = _compositeAnalysisConfigTokenPure(
                compositeAnalysisConfigFromDialog(),
            );
        } catch (_) { /* a replaced setup is stale by definition */ }
        const current = readCompositeEditorSnapshot();
        return current.format === 'sloppak'
            && compositeEditorSourceGuardIsCurrent(request.sourceGuard)
            && hybridAnalysisIsCurrent(hybridSession, request, {
                sessionId: current.sessionId,
                configToken: currentConfigToken,
                editGeneration: current.editGeneration,
                sourceGuard: request.sourceGuard,
            });
    };
    const settleStaleRequest = () => {
        const ownedLifecycle = completeHybridAnalysis(hybridSession, request);
        if (!ownedLifecycle || byId('editor-composite-modal') !== modal) return;
        if (!editorStillOwnsAnalysis()) {
            closeCompositeModalImmediately(modal);
        } else {
            setCompositeAnalysisUi(false);
            const message = 'The source tracks or Setup settings changed while Hybrid Track was analyzing. Review Setup and build a new preview.';
            const notice = byId('editor-composite-setup-notice');
            if (notice) {
                notice.hidden = false;
                notice.textContent = message;
            }
            if (error) error.textContent = message;
            setCompositeEditorStatus(`Hybrid Track: ${message}`);
        }
    };
    setCompositeAnalysisUi(true, _compositeTaskPhaseLabelPure('prepare', config));
    await waitForCompositeUiPaint();
    if (!requestIsCurrent()) {
        settleStaleRequest();
        return;
    }
    let plan;
    try {
        plan = await runHybridAnalysisTask({
            sources,
            strategy,
            repeatMode,
            gapFill,
        }, {
            signal: request.controller.signal,
            onProgress: phase => {
                if (!requestIsCurrent()) return;
                setCompositeAnalysisUi(true,
                    _compositeTaskPhaseLabelPure(phase, config));
            },
        });
    } catch (cause) {
        const current = requestIsCurrent();
        const ownedLifecycle = completeHybridAnalysis(hybridSession, request);
        if (!current || !ownedLifecycle || byId('editor-composite-modal') !== modal) {
            if (ownedLifecycle && byId('editor-composite-modal') === modal
                    && !editorStillOwnsAnalysis()) {
                closeCompositeModalImmediately(modal);
            }
            return;
        }
        setCompositeAnalysisUi(false);
        if (cause?.name !== 'AbortError' && error) {
            error.textContent = `Could not analyze the Hybrid Track: ${cause.message}`;
        }
        return;
    }
    if (!requestIsCurrent()) {
        settleStaleRequest();
        return;
    }
    if (!completeHybridAnalysis(hybridSession, request)) return;
    setCompositeAnalysisUi(false);
    if (!plan.ok) {
        if (error) error.textContent = plan.compatibility.errors.join(' ');
        const notice = byId('editor-composite-setup-notice');
        if (notice) {
            notice.hidden = false;
            notice.textContent = 'These tracks cannot be combined. Check their instrument, tuning, string count and capo.';
        }
        return;
    }
    if (error) error.textContent = '';
    installHybridPlan(hybridSession, plan, request.sessionId, request.editGeneration,
        request.sourceGuard);
    hybridSession.analysisConfig = structuredClone(config);
    hybridSession.setupDirty = false;
    hybridSession.setupDirtyMessage = '';
    hybridSession.hasReviewWork = false;
    hybridSession.conflictIndex = 0;
    hybridSession.customDrafts.clear();
    hybridSession.stage = strategy === 'guided' && plan.conflicts.length
        ? 'review' : 'final-preview';
    hybridSession.timelineSeekTime = 0;
    hybridSession.timelineScrollLeft = 0;
    hybridSession.timelineNotesScrollLeft = 0;
    hybridSession.timelineFocusReview = hybridSession.stage === 'review';
    if (hybridSession.stage === 'review') prepareCurrentReviewFocus(true);
    setCompositeReviewMode(true);
    renderResult();
    scheduleCompositePreviewEventPrewarm(plan);
}

async function finishMerge() {
    const error = byId('editor-composite-error');
    const modal = byId('editor-composite-modal');
    if (!modal || !requireCurrentCompositePlan()) return;
    const plan = hybridSession.plan;
    const unresolved = hybridSession.plan.conflicts.filter(c => !c.resolution);
    if (unresolved.length) {
        if (error) error.textContent = `Finish the ${unresolved.length} remaining ${unresolved.length === 1 ? 'choice' : 'choices'} first.`;
        return;
    }
    const nameValidation = validateCompositeTrackName({ focus: true });
    if (!nameValidation.ok) {
        showCompositeTrackNameError(nameValidation);
        setCompositeReviewMode(false);
        return;
    }
    const name = nameValidation.name;
    endCompositePreviewPlayback();
    const request = beginHybridCreation(hybridSession, {
        sessionId: hybridSession.planSessionId,
        editGeneration: hybridSession.planEditGeneration,
        plan,
    });
    if (!request) return;
    request.modal = modal;
    setCompositeCreationUi(true);
    if (error) error.textContent = 'Creating the new Hybrid Track…';
    const creationRequestIsCurrent = () => {
        const editor = readCompositeEditorSnapshot();
        return hybridPlanEditorIsCurrent(editor)
            && hybridCreationIsCurrent(hybridSession, request, {
                sessionId: editor.sessionId,
                editGeneration: editor.editGeneration,
                plan: hybridSession.plan,
            });
    };
    const editorStillOwnsCreation = () => {
        const editor = readCompositeEditorSnapshot();
        return editor.format === 'sloppak' && editor.sessionId === request.sessionId;
    };
    const settleStaleCreation = () => {
        const ownedLifecycle = hybridSession.createRequestId === request.id;
        completeHybridCreation(hybridSession, request);
        if (!ownedLifecycle || byId('editor-composite-modal') !== modal) return;
        if (!editorStillOwnsCreation()) {
            closeCompositeModalImmediately(modal);
        } else {
            setCompositeCreationUi(false);
            if (error) {
                error.textContent = 'The Hybrid preview changed while the track was being prepared. Review it and try creating the track again.';
            }
        }
    };
    let arrangement;
    try {
        // Make the disabled controls and Creating label visible before either
        // the Worker request or the functional local fallback can do heavy
        // materialization work.
        await waitForCompositeUiPaint();
        if (!creationRequestIsCurrent()
                || byId('editor-composite-modal') !== modal) {
            settleStaleCreation();
            return;
        }
        arrangement = await runHybridMaterializationTask(plan, name, {
            signal: request.controller.signal,
            onProgress: phase => {
                if (!creationRequestIsCurrent()
                        || byId('editor-composite-modal') !== modal) return;
                if (error) error.textContent = _compositeTaskPhaseLabelPure(phase);
            },
        });
        if (!creationRequestIsCurrent()
                || byId('editor-composite-modal') !== modal) {
            settleStaleCreation();
            return;
        }
        // If the user is currently deciding whether to cancel this request,
        // do not commit behind that prompt. Keeping the builder resumes this
        // exact request; discarding invalidates it before this continuation.
        const closeDecision = hybridSession.closeDecisionPromise;
        if (closeDecision) await closeDecision;

        const currentModal = byId('editor-composite-modal');
        const requestIsCurrent = creationRequestIsCurrent();
        if (!requestIsCurrent || currentModal !== modal) {
            const ownedLifecycle = hybridSession.createRequestId === request.id;
            completeHybridCreation(hybridSession, request);
            if (ownedLifecycle && currentModal === modal
                    && !editorStillOwnsCreation()) {
                closeCompositeModalImmediately(modal);
            } else if (ownedLifecycle && currentModal === modal) {
                setCompositeCreationUi(false);
                if (error) error.textContent = 'The Hybrid preview changed while the track was being prepared. Review it and try creating the track again.';
            }
            return;
        }
        if (compositeEditorContainsArrangement(arrangement)) {
            completeHybridCreation(hybridSession, request);
            closeCompositeModalImmediately(modal);
            return;
        }
        const nameWasTaken = compositeEditorArrangementNameTaken(name);
        if (nameWasTaken) {
            completeHybridCreation(hybridSession, request);
            setCompositeCreationUi(false);
            if (error) error.textContent = 'Another track started using that name while the Hybrid was being prepared. Choose a different name and try again.';
            return;
        }
        if (!creationRequestIsCurrent()
                || byId('editor-composite-modal') !== modal) {
            settleStaleCreation();
            return;
        }
        commitCompositeArrangement(arrangement);
        completeHybridCreation(hybridSession, request);
        closeCompositeModalImmediately(modal);
        setCompositeEditorStatus(`Created Hybrid Track “${name}” with ${arrangement.notes.length} notes. Save the song when you are ready.`);
    } catch (cause) {
        const requestIsCurrent = creationRequestIsCurrent();
        if (!requestIsCurrent || byId('editor-composite-modal') !== modal) {
            const ownedLifecycle = hybridSession.createRequestId === request.id;
            completeHybridCreation(hybridSession, request);
            if (ownedLifecycle && byId('editor-composite-modal') === modal
                    && !editorStillOwnsCreation()) {
                closeCompositeModalImmediately(modal);
            }
            return;
        }
        completeHybridCreation(hybridSession, request);
        setCompositeCreationUi(false);
        if (error) error.textContent = `Could not create the Hybrid Track: ${cause.message}`;
    }
}

function setCompositeCreationUi(creating) {
    const modal = byId('editor-composite-modal');
    if (!modal) return;
    modal.setAttribute('aria-busy', creating ? 'true' : 'false');
    const workspace = byId('editor-composite-workspace');
    if (workspace) workspace.inert = !!creating;
    const analyze = byId('editor-composite-analyze');
    if (analyze) analyze.disabled = !!creating;
    const finish = byId('editor-composite-finish');
    if (finish) {
        const unresolved = hybridSession.plan?.conflicts?.some(block => !block.resolution);
        finish.disabled = !!creating || !!unresolved;
        finish.textContent = creating ? 'Creating…' : 'Create Hybrid Track';
    }
    const cancel = byId('editor-composite-cancel');
    if (cancel) cancel.textContent = creating ? 'Cancel creation' : 'Cancel';
    updateCompositePreviewButtons();
}

function closeCompositeModalImmediately(modal = byId('editor-composite-modal')) {
    // Clear state before removing the DOM so the last slider/zoom/resize value
    // is committed while its controls still exist. clearTransientState owns
    // cancellation and preview disposal; keeping one path makes teardown
    // idempotent for close, screen reinjection, and stale-session failures.
    clearTransientState();
    modal?.remove();
}

// The feature modal lives under <body>, outside the persistent Editor screen.
// Suspending it when that screen becomes inactive preserves the in-progress
// review while ensuring private audio and document-level shortcuts cannot leak
// into another host screen.
export function editorSuspendCompositeArrangementUi() {
    endCompositePreviewPlayback();
    cancelCompositeChoicePrompt();
    stopCompositeModalDocumentKeyboard();
    const modal = byId('editor-composite-modal');
    if (!modal) return false;
    const active = document.activeElement;
    if (active && modal.contains(active)) active.blur?.();
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.dataset.editorScreenSuspended = 'true';
    return true;
}

export function editorResumeCompositeArrangementUi() {
    const modal = byId('editor-composite-modal');
    if (!modal) {
        stopCompositeModalDocumentKeyboard();
        compositeModalSessionId = null;
        return false;
    }
    const editor = readCompositeEditorSnapshot();
    const planSessionId = hybridSession.plan ? hybridSession.planSessionId : null;
    const sessionIsCurrent = _compositeModalSessionIsCurrentPure(
        compositeModalSessionId, editor, planSessionId,
    ) && (!hybridSession.plan || hybridPlanEditorIsCurrent(editor));
    if (!sessionIsCurrent) {
        closeCompositeModalImmediately(modal);
        setCompositeEditorStatus(
            'The open song changed, so Hybrid Track was closed. Open it again to continue.');
        return false;
    }
    modal.hidden = false;
    modal.removeAttribute('aria-hidden');
    delete modal.dataset.editorScreenSuspended;
    installCompositeModalDocumentKeyboard(modal);
    recoverCompositeModalFocus(modal);
    if (timelineViewportDom) scheduleCompositeTimelineViewport();
    return true;
}

export async function editorHideCompositeArrangementModal() {
    const modal = byId('editor-composite-modal');
    if (!modal) {
        closeCompositeModalImmediately(null);
        return true;
    }
    const guardKind = hybridCloseGuardKind(hybridSession);
    if (guardKind === 'none') {
        closeCompositeModalImmediately(modal);
        return true;
    }
    if (hybridSession.closePromptPending) return false;
    hybridSession.closePromptPending = true;
    let settleCloseDecision;
    const closeDecision = new Promise(resolve => { settleCloseDecision = resolve; });
    hybridSession.closeDecisionPromise = closeDecision;
    hybridSession.closeDecisionResolve = settleCloseDecision;
    const creating = guardKind === 'creating';
    const choice = await compositePromptChoice({
        title: creating ? 'Cancel Hybrid Track creation?' : 'Discard your Hybrid review?',
        message: creating
            ? 'The new track is still being prepared. Cancelling guarantees that this request cannot add a track later.'
            : 'Your review choices exist only inside this builder until you create the Hybrid Track.',
        choices: [
            {
                key: 'keep',
                label: creating ? 'Keep creating' : 'Keep reviewing',
                hint: creating ? 'Wait for the current request to finish.' : 'Return to the builder with every choice intact.',
            },
            {
                key: 'discard',
                label: creating ? 'Cancel creation' : 'Discard review',
                hint: creating ? 'Stop this request and close the builder.' : 'Close the builder and remove these review choices.',
            },
        ],
    });
    settleCloseDecision(choice || 'keep');
    if (hybridSession.closeDecisionPromise === closeDecision) hybridSession.closeDecisionPromise = null;
    if (hybridSession.closeDecisionResolve === settleCloseDecision) hybridSession.closeDecisionResolve = null;
    hybridSession.closePromptPending = false;
    const closeAction = hybridCloseAction(guardKind, choice);
    if (closeAction === 'keep' || byId('editor-composite-modal') !== modal) {
        if (byId('editor-composite-modal') === modal) recoverCompositeModalFocus(modal);
        return false;
    }
    closeCompositeModalImmediately(modal);
    return true;
}

function handleCompositeModalShortcut(event) {
    if (event.defaultPrevented) return;
    const target = event.target;
    const action = _compositeModalShortcutPure({
        key: event.key,
        editable: compositeModalControlEditingTarget(target),
        spaceEditable: compositeModalSpaceReservedTarget(target),
        modified: event.altKey || event.ctrlKey || event.metaKey,
        stage: hybridSession.stage,
        previewActive: hybridSession.previewPlaying || hybridSession.previewLoading,
        repeat: event.repeat,
        transportAvailable: compositePreviewTransportAvailable(),
        navigationReserved: target?.id === 'editor-composite-timeline-scroller',
    });
    if (!action) return;
    if (action.kind === 'consume') {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
    }
    if (action.kind === 'stop-preview') {
        event.preventDefault();
        event.stopImmediatePropagation();
        endCompositePreviewPlayback();
        setCompositeEditorStatus(
            'Hybrid preview stopped. Press Escape again to close the builder.');
        return;
    }
    if (action.kind === 'preview') {
        const result = byId('editor-composite-result-workspace');
        const button = result?.querySelector(
            `[data-composite-preview="${action.mode}"]:not([disabled])`);
        if (!button) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleCompositePreview(action.mode);
        return;
    }
    if (action.kind === 'play-toggle') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (hybridSession.previewPlaying || hybridSession.previewLoading) {
            endCompositePreviewPlayback();
        } else {
            const result = byId('editor-composite-result-workspace');
            const button = result?.querySelector(
                `[data-composite-preview="${hybridSession.previewLastMode}"]:not([disabled])`)
                || result?.querySelector('[data-composite-preview]:not([disabled])');
            if (button) toggleCompositePreview(button.dataset.compositePreview);
        }
        return;
    }
    if (action.kind === 'previous' || action.kind === 'next') {
        const button = byId(action.kind === 'previous'
            ? 'editor-composite-prev' : 'editor-composite-next');
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!button || button.disabled) return;
        button.click();
        return;
    }
    if (action.kind === 'focus-review') {
        event.preventDefault();
        event.stopImmediatePropagation();
        byId('editor-composite-focus-review')?.click();
    }
}

export async function editorShowCompositeArrangementModal() {
    if (byId('editor-composite-modal') && !(await editorHideCompositeArrangementModal())) return false;
    clearTransientState();
    const editor = readCompositeEditorSnapshot();
    if (!editor.sessionId || editor.format !== 'sloppak') {
        setCompositeEditorStatus('Open a song project before creating a Hybrid Track.');
        return false;
    }
    const sources = _compositeEligibleSourcesPure(editor.arrangements);
    if (sources.length < 2) {
        setCompositeEditorStatus('A Hybrid Track needs at least two guitar or bass tracks.');
        return false;
    }
    const primary = sources.some(source => source.index === editor.currentIndex)
        ? editor.currentIndex : sources[0].index;
    const secondary = sources.find(source => source.index !== primary
        && _compositeSourcePairStatePure(editor.arrangements, primary, source.index).ok)?.index
        ?? sources.find(source => source.index !== primary).index;
    const generatedNameBase = _compositeDefaultNameForSourcePure(
        editor.arrangements[primary]);
    const name = _compositeUniqueNamePure(
        editor.arrangements.map(arr => arr && arr.name), generatedNameBase,
    );
    const gapFillPreferences = loadHybridGapFillPreferences();
    const gapFillUnit = gapFillPreferences.unit;
    const gapFillValues = gapFillPreferences[gapFillUnit]
        || compositeGapFillDefaultsForUnit(gapFillUnit);
    const guidedPreferences = loadHybridGuidedPreferences();
    hybridPreviewPreferences = loadHybridPreviewPreferences();
    recordingPreviewLevelCache = null;
    const modal = document.createElement('div');
    modal.id = 'editor-composite-modal';
    modal.className = 'fixed inset-0 z-50 bg-black/75';
    modal.innerHTML = `<div id="editor-composite-dialog" class="max-w-full grid rounded-xl border border-gray-600 bg-dark-800 shadow-2xl" style="${HYBRID_DIALOG_STYLE}" role="dialog" aria-modal="true" aria-labelledby="editor-composite-title" aria-describedby="editor-composite-description">`
        + `<header class="editor-composite-header"><div class="min-w-0"><h3 id="editor-composite-title" class="text-lg font-semibold">Create a Hybrid Track</h3>`
        + `<p id="editor-composite-description" class="truncate text-xs text-gray-400" title="Combine two synchronized guitar or bass parts. Originals stay unchanged.">Combine two synchronized guitar or bass parts. Originals stay unchanged.</p></div>`
        + `<nav class="editor-composite-stage-indicator" aria-label="Hybrid Track progress" aria-live="polite"><span data-composite-stage-step="setup" class="editor-composite-stage-active">1. Setup</span><i aria-hidden="true">→</i><span data-composite-stage-step="review">2. Review</span><i aria-hidden="true">→</i><span data-composite-stage-step="final-preview">3. Preview</span></nav>`
        + `<div class="editor-composite-window-actions"><button type="button" id="editor-composite-maximize" class="editor-composite-window-button" aria-label="Maximize Hybrid workspace" aria-pressed="false" title="Maximize workspace">${hybridDialogMaximizeIcon(false)}</button>`
        + `<button type="button" id="editor-composite-close" class="editor-composite-window-button text-xl" aria-label="Close" title="Close">×</button></div></header>`
        + `<div id="editor-composite-workspace" class="grid min-h-0 overflow-hidden" style="grid-template-columns:minmax(0,1fr)">`
        + renderHybridSetupView({
            sources, name, gapFillUnit, gapFillValues,
            guidedRepeatMode: guidedPreferences.repeatMode,
        })
        + `<main id="editor-composite-result-workspace" hidden class="p-3 min-h-0 overflow-y-auto"><div id="editor-composite-result"><p class="text-sm text-gray-400">Choose two tracks and how you want to build the hybrid.</p></div></main></div>`
        + `<footer class="editor-composite-footer"><div id="editor-composite-error" class="text-sm text-red-300 max-w-xl" role="alert" aria-live="polite"></div>`
        + `<div class="editor-composite-footer-actions"><button type="button" id="editor-composite-return-review" hidden class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm">Return to current preview</button>`
        + `<button type="button" id="editor-composite-cancel" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm">Cancel</button>`
        + `<button type="button" id="editor-composite-analyze" class="px-4 py-2 rounded bg-accent hover:bg-accent-light text-sm font-medium">Preview automatic hybrid</button>`
        + `<button type="button" id="editor-composite-finish" hidden disabled class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">Create Hybrid Track</button></div></footer><span id="editor-composite-resize-grip" aria-hidden="true" title="Drag to resize the Hybrid workspace"></span></div>`;
    // Keep fixed positioning relative to the desktop viewport. `.editor-root`
    // is translated below the host chrome, so mounting there makes `inset:0`
    // extend past the bottom of the real window.
    document.body.appendChild(modal);
    applyHybridThemeInheritance(modal);
    compositeModalSessionId = editor.sessionId;
    const dialog = byId('editor-composite-dialog');
    restoreHybridDialogSize(dialog);
    beginHybridDialogSizePersistence(dialog);
    byId('editor-composite-primary').value = String(primary);
    byId('editor-composite-secondary').value = String(secondary);
    byId('editor-composite-close').addEventListener('click', editorHideCompositeArrangementModal);
    byId('editor-composite-maximize').addEventListener('click', toggleHybridDialogMaximized);
    byId('editor-composite-cancel').addEventListener('click', editorHideCompositeArrangementModal);
    byId('editor-composite-analyze').addEventListener('click', analyzeFromDialog);
    byId('editor-composite-finish').addEventListener('click', finishMerge);
    byId('editor-composite-return-review').addEventListener('click', () => {
        setCompositeReviewMode(true);
        renderResult();
    });
    const strategyInputs = [...document.querySelectorAll('input[name="editor-composite-strategy"]')];
    const unitSelect = byId('editor-composite-gap-unit');
    const repeatModeSelect = byId('editor-composite-repeat-mode');
    let currentGapFillUnit = gapFillUnit;
    let generatedName = name;
    let nameManuallyEdited = false;
    const updateGeneratedName = () => {
        if (nameManuallyEdited) return;
        const currentEditor = readCompositeEditorSnapshot();
        const arrangement = currentEditor.arrangements[
            Number(byId('editor-composite-primary')?.value)];
        generatedName = _compositeUniqueNamePure(
            currentEditor.arrangements.map(arr => arr && arr.name),
            _compositeDefaultNameForSourcePure(arrangement),
        );
        const nameInput = byId('editor-composite-name');
        if (nameInput) nameInput.value = generatedName;
    };
    const syncSourceControls = ({ chooseCompatible = true } = {}) => {
        const primarySelect = byId('editor-composite-primary');
        const secondarySelect = byId('editor-composite-secondary');
        const primaryIndex = Number(primarySelect?.value);
        if (!primarySelect || !secondarySelect) return _compositeSourcePairStatePure([], -1, -1);
        const { arrangements } = readCompositeEditorSnapshot();
        for (const option of secondarySelect.options) {
            const state = _compositeSourcePairStatePure(
                arrangements, primaryIndex, Number(option.value),
            );
            option.disabled = !state.ok;
        }
        let state = _compositeSourcePairStatePure(
            arrangements, primaryIndex, Number(secondarySelect.value),
        );
        if (!state.ok && chooseCompatible) {
            const next = [...secondarySelect.options].find(option => !option.disabled);
            if (next) {
                secondarySelect.value = next.value;
                state = _compositeSourcePairStatePure(
                    arrangements, primaryIndex, Number(next.value),
                );
            }
        }
        const compatibility = byId('editor-composite-source-compatibility');
        if (compatibility) {
            compatibility.textContent = state.message;
            compatibility.classList.toggle('text-emerald-300', state.ok);
            compatibility.classList.toggle('text-red-300', !state.ok);
            compatibility.classList.toggle('text-gray-400', false);
        }
        updateGeneratedName();
        const analyze = byId('editor-composite-analyze');
        if (analyze) analyze.disabled = !state.ok || hybridSession.analyzing
            || !validateCompositeTrackName().ok;
        return state;
    };
    const markSetupChanged = message => {
        const error = byId('editor-composite-error');
        if (error) error.textContent = '';
        updateCompositeSetupDirtyState(message);
    };
    const syncModeControls = () => {
        const strategy = selectedCompositeStrategy();
        const guidedControls = byId('editor-composite-guided-controls');
        const gapControls = byId('editor-composite-gap-controls');
        if (guidedControls) guidedControls.hidden = strategy !== 'guided';
        if (gapControls) gapControls.hidden = strategy !== 'gap-fill';
        for (const card of document.querySelectorAll('[data-composite-mode-card]')) {
            const selected = card.dataset.compositeModeCard === strategy;
            card.classList.toggle('border-accent', selected);
            card.classList.toggle('border-gray-600', !selected);
            card.classList.toggle('bg-sky-950/25', selected && strategy === 'gap-fill');
            card.classList.toggle('bg-violet-950/20', selected && strategy === 'guided');
            card.classList.toggle('bg-dark-700/50', !selected);
        }
        const analyze = byId('editor-composite-analyze');
        if (analyze) analyze.textContent = strategy === 'guided'
            ? 'Find sections to review'
            : 'Preview automatic hybrid';
        const sourceExplanation = byId('editor-composite-source-explanation');
        const modeExplanation = byId('editor-composite-mode-explanation');
        if (strategy === 'guided') {
            if (sourceExplanation) sourceExplanation.textContent = 'The base track is your starting arrangement. In reviewed sections you can use the fill track instead.';
            if (modeExplanation) modeExplanation.textContent = 'The base track stays except in sections where you choose the fill track or a manual mix.';
        } else {
            if (sourceExplanation) sourceExplanation.textContent = 'The base track is your starting arrangement. The fill track supplies extra notes in safe spaces.';
            if (modeExplanation) modeExplanation.textContent = 'Automatic keeps the complete base track and adds fill notes only in safe spaces.';
        }
        if (hybridSession.plan) updateCompositeSetupDirtyState();
    };
    const rememberCurrentGapFillValues = () => {
        const options = gapFillOptionsFromDialog(currentGapFillUnit);
        gapFillPreferences.unit = currentGapFillUnit;
        gapFillPreferences[currentGapFillUnit] = {
            minimumGap: options.minimumGap,
            transitionMargin: options.transitionMargin,
        };
        saveHybridGapFillPreferences(gapFillPreferences);
    };
    byId('editor-composite-name')?.addEventListener('input', event => {
        nameManuallyEdited = event.target.value !== generatedName;
        const validation = validateCompositeTrackName();
        const analyze = byId('editor-composite-analyze');
        if (analyze) {
            const pairState = _compositeSourcePairStatePure(
                readCompositeEditorSnapshot().arrangements,
                Number(byId('editor-composite-primary')?.value),
                Number(byId('editor-composite-secondary')?.value),
            );
            analyze.disabled = hybridSession.analyzing || !pairState.ok || !validation.ok;
        }
    });
    byId('editor-composite-primary')?.addEventListener('change', () => {
        syncSourceControls({ chooseCompatible: true });
        markSetupChanged('The source tracks changed. Rebuild the preview to use them.');
    });
    byId('editor-composite-secondary')?.addEventListener('change', () => {
        syncSourceControls({ chooseCompatible: false });
        markSetupChanged('The source tracks changed. Rebuild the preview to use them.');
    });
    byId('editor-composite-swap-sources')?.addEventListener('click', () => {
        const primarySelect = byId('editor-composite-primary');
        const secondarySelect = byId('editor-composite-secondary');
        const previousPrimary = primarySelect.value;
        primarySelect.value = secondarySelect.value;
        secondarySelect.value = previousPrimary;
        syncSourceControls({ chooseCompatible: true });
        markSetupChanged('Base and fill were swapped. Rebuild the preview to use them.');
        primarySelect.focus();
    });
    for (const input of strategyInputs) input.addEventListener('change', () => {
        syncModeControls();
        markSetupChanged('The building method changed. Rebuild the preview to use it.');
    });
    repeatModeSelect.addEventListener('change', () => {
        guidedPreferences.repeatMode = normalizeGuidedRepeatMode(repeatModeSelect.value);
        saveHybridGuidedPreferences(guidedPreferences);
        markSetupChanged('The repeated-riff setting changed. Rebuild the preview to use it.');
    });
    unitSelect.addEventListener('change', () => {
        rememberCurrentGapFillValues();
        currentGapFillUnit = unitSelect.value === 'seconds' ? 'seconds' : 'beats';
        gapFillPreferences.unit = currentGapFillUnit;
        applyGapFillUnitToDialog(currentGapFillUnit, gapFillPreferences[currentGapFillUnit]);
        saveHybridGapFillPreferences(gapFillPreferences);
        markSetupChanged('The timing unit changed. Rebuild the preview to use it.');
    });
    for (const input of [byId('editor-composite-min-gap'), byId('editor-composite-margin')]) {
        input.addEventListener('change', () => {
            rememberCurrentGapFillValues();
            markSetupChanged('The safety settings changed. Rebuild the preview to use them.');
        });
    }
    applyGapFillUnitToDialog(gapFillUnit, gapFillValues);
    syncModeControls();
    syncSourceControls({ chooseCompatible: true });
    updateCompositeStageIndicator('setup');
    modal.addEventListener('keydown', handleCompositeModalShortcut);
    _installModalKeyboard(modal, modal.firstElementChild, editorHideCompositeArrangementModal);
    installCompositeModalDocumentKeyboard(modal);
    byId('editor-composite-primary').focus();
    return true;
}

// Screen reinjection is not a user-requested close and must never leave this
// module's document capture listener, rAF, observers, or body-mounted modal
// attached to the replacement Editor instance.
export function editorTeardownCompositeArrangementUi() {
    closeCompositeModalImmediately(byId('editor-composite-modal'));
}
