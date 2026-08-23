/* Hybrid-track builder.
 *
 * This is the Editor integration over the DOM-free automatic and guided
 * planners: setup, musical-section review, preview, and one structural history
 * command. The merge rules remain DOM-free and testable.
 */

import { arrKind, _isFrettedKind } from '../instrument.js';
import { beatOf, timeOf } from '../beats.js';
import {
    editorClearGuidePreview,
    editorPlaybackVisualTime,
    editorPrepareGuidePreview,
    editorSetGuidePreview,
    editorUpdateGuidePreviewMix,
    editorWarmGuidePreview,
    startPlayback,
    stopPlayback,
} from '../audio.js';
import { _setBarSel, _setLoopRegionEnabled } from '../loop.js';
import { S } from '../state.js';
import { host } from '../host.js';
import { _editorEscHtml, _editorPromptChoice, _installModalKeyboard, setStatus } from '../ui.js';
import {
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    clearCompositeConflictResolution,
    compositeCompatibility,
    compositeExperimentalMetadataPreview,
    compositeResolvedEntries,
    compositeSelectionUnitIds,
    resolveCompositeConflict,
} from './merge-engine.js';
import {
    compositeGapFillDefaultsForUnit,
    normalizeCompositeGapFillOptions,
} from './gap-fill-engine.js';
import {
    experimentalComparisonReport,
    experimentalPassageOutcome,
    normalizeExperimentalProfile,
    refreshExperimentalPlayability,
} from './experimental-auto-engine.js';
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
    buildCompositeConflictViewModel,
    buildCompositeReviewToolbarModel,
    compositeTechniqueLabels,
    renderCompositeDifferenceTable,
} from './conflict-view.js';
import {
    compositePreviewAudioPolicyPure,
    createCompositePreviewEventCache,
    compositePreviewMixPure,
    compositePreviewModesPure,
    compositePreviewRegionPure,
    compositeRecordingPreviewLevelPure,
    compositeRecordingPreviewLevelFromPeaksPure,
} from './preview.js';
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
    installHybridPlan,
    markHybridResolutionChanged,
    markHybridReviewWork,
    resetHybridBuilderReview,
} from './session.js';
import { renderHybridSetupView } from './setup-view.js';
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
    HYBRID_TIMELINE_ZOOM_CONTROL_MIN,
    HYBRID_TIMELINE_ZOOM_MAX,
    HYBRID_TIMELINE_ZOOM_STEP,
    createHybridPreferenceWriter,
    hybridGapFillPreferencesPure,
    hybridGuidedPreferencesPure,
    hybridExperimentalPreferencesPure,
    hybridPreviewPreferencesPure,
    loadHybridExperimentalPreferences,
    loadHybridDialogSize,
    loadHybridGapFillPreferences,
    loadHybridGuidedPreferences,
    loadHybridPreviewPreferences,
    saveHybridGapFillPreferences,
    saveHybridGuidedPreferences,
    saveHybridExperimentalPreferences,
    saveHybridDialogSize,
    saveHybridPreviewPreferences,
} from './preferences.js';

export {
    hybridGapFillPreferencesPure as _compositeGapFillPreferencesPure,
    hybridGuidedPreferencesPure as _compositeGuidedPreferencesPure,
    hybridExperimentalPreferencesPure as _compositeExperimentalPreferencesPure,
    hybridPreviewPreferencesPure as _compositePreviewPreferencesPure,
};

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
let timelinePendingZoom = null;
let timelineStandbyCancel = null;
let timelineStandbySwapFrame = 0;
let timelineRenderGeneration = 0;
let timelineBindFrame = 0;
let timelineReviewRefreshFrame = 0;
let timelineReviewRefreshGeneration = 0;
let timelineResizeObserver = null;
let timelineProgrammaticScrollTarget = null;
let dialogResizeObserver = null;
let dialogResizeSaveTimer = 0;
let timelineViewCache = null;
let timelineViewportDom = null;
let compositeModalDocumentKeydown = null;
const convertCompositePreviewEvents = createCompositePreviewEventCache();
const compositePreviewEventPlanCache = new WeakMap();
const COMPOSITE_MODAL_NON_EDITING_INPUT_TYPES = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio',
    'range', 'reset', 'submit',
]);

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
    if (!dialog || typeof ResizeObserver !== 'function') return;
    let initialNotification = true;
    dialogResizeObserver = new ResizeObserver(entries => {
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
        experimentalEnabled: byId('editor-composite-experimental')?.checked === true,
        experimentalProfile: normalizeExperimentalProfile(
            byId('editor-composite-experimental-profile')?.value,
        ),
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
        ? 'Continue to next choice →' : 'Preview full song →';
}

export function _compositeTimelineStageActivePure(stage) {
    return stage === 'review' || stage === 'final-preview';
}

export function _compositeModalShortcutPure({
    key = '', editable = false, modified = false, stage = 'review',
    previewActive = false, repeat = false, spaceEditable = editable,
} = {}) {
    // The Hybrid modal's generic keyboard trap closes on Escape. Consume the
    // first Escape here while auditioning so it behaves as Stop instead. A held
    // key produces repeat events after previewActive becomes false, so those
    // repeats must also stay consumed; a new physical press can then close.
    if (key === 'Escape' && repeat && !modified) return { kind: 'consume' };
    if (key === 'Escape' && previewActive && !modified) return { kind: 'stop-preview' };
    if (modified) return null;
    if (key === ' ') {
        if (spaceEditable) return null;
        return repeat ? { kind: 'consume' } : { kind: 'play-toggle' };
    }
    // Preserve arrows and character input for select/range/text controls. Only
    // Space is deliberately uniform across non-text modal controls.
    if (editable) return null;
    const modes = { '1': 'song', '2': 'primary', '3': 'secondary', '4': 'result' };
    if (repeat && modes[key]) return { kind: 'consume' };
    if (modes[key]) return { kind: 'preview', mode: modes[key] };
    if (stage === 'review' && key === 'ArrowLeft') return { kind: 'previous' };
    if (stage === 'review' && key === 'ArrowRight') return { kind: 'next' };
    if (stage === 'review' && key === 'Home') return { kind: 'focus-review' };
    return null;
}

function byId(id) {
    return document.getElementById(id);
}

function compositeModalTextEditingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (target.matches?.('textarea')) return true;
    if (!target.matches?.('input')) return false;
    // Range, checkbox, and button-like inputs are modal controls, not text
    // editors. Space therefore remains the same transport key whether focus is
    // on one of those controls, a <select>, <button>, or <summary>.
    return !COMPOSITE_MODAL_NON_EDITING_INPUT_TYPES.has(
        String(target.type || 'text').toLowerCase());
}

function compositeModalControlEditingTarget(target) {
    return compositeModalTextEditingTarget(target)
        || !!target?.matches?.('input, select, textarea');
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
        toneTrimGain: selectedHybridPreviewTone().trimGain,
        recordingGain: hybridSession.previewRecordingGain,
    });
}

let recordingPreviewLevelCache = null;
function recordingPreviewGainFor(view) {
    if (!S.audioBuffer || !view || !hybridSession.plan) return 1;
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    const shift = (Number(S.audioShift) || 0) + (Number(S.activeAudioSourceOffset) || 0);
    const startTime = region.startTime - shift;
    const endTime = region.endTime - shift;
    const cached = recordingPreviewLevelCache;
    if (cached && cached.buffer === S.audioBuffer
            && cached.startTime === startTime && cached.endTime === endTime) return cached.gain;
    // Audio decoding already produced a compact RMS/peak waveform summary.
    // Prefer it here so the Play/Space gesture never has to scan hundreds of
    // thousands of raw samples before Original Song playback can start.
    const level = S.waveformPeaks
        ? compositeRecordingPreviewLevelFromPeaksPure(
            S.waveformPeaks, S.audioBuffer.duration, startTime, endTime)
        : compositeRecordingPreviewLevelPure(S.audioBuffer, startTime, endTime);
    const gain = level.gain;
    recordingPreviewLevelCache = { buffer: S.audioBuffer, startTime, endTime, gain };
    return gain;
}

function updateActiveHybridPreviewMix() {
    if (!hybridSession.previewMode) return false;
    return editorUpdateGuidePreviewMix(hybridPreviewMixFor(hybridSession.previewMode));
}

function cloneLoopRegion(region) {
    return region ? { ...region } : null;
}

function rememberCompositePreviewSession() {
    if (hybridSession.previewRestore) return;
    hybridSession.previewRestore = {
        sessionId: S.sessionId,
        barSel: cloneLoopRegion(S.barSel),
        loopEnabled: !!S.loopEnabled,
        cursorTime: Number(S.cursorTime) || 0,
    };
}

function updateCompositePreviewButtons() {
    const reviewRefreshPending = !!timelineViewportDom?.reviewRefreshPending;
    for (const button of document.querySelectorAll('[data-composite-preview]')) {
        const active = button.dataset.compositePreview === hybridSession.previewMode;
        const available = button.dataset.compositePreviewAvailable === 'true';
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute('aria-busy', active && hybridSession.previewLoading
            || reviewRefreshPending ? 'true' : 'false');
        button.disabled = hybridSession.previewLoading || reviewRefreshPending || !available;
        button.classList.toggle('ring-2', active);
        button.classList.toggle('ring-emerald-400', active);
    }
    const stop = byId('editor-composite-preview-stop');
    if (stop) stop.disabled = !hybridSession.previewPlaying && !hybridSession.previewLoading;
}

function setCompositePreviewHelp(message) {
    const help = byId('editor-composite-preview-help');
    if (help) help.textContent = message;
}

function endCompositePreviewPlayback() {
    const hadPreview = hybridSession.previewPlaying || hybridSession.previewLoading
        || !!hybridSession.previewMode;
    if ((hybridSession.stage === 'final-preview' || hybridSession.stage === 'review')
            && Number.isFinite(Number(S.cursorTime))) {
        hybridSession.timelineSeekTime = Math.max(0, Number(S.cursorTime));
    }
    hybridSession.previewRequestId++;
    if (hybridSession.previewPlaying && S.playing) stopPlayback();
    // Settle any fractional compositor camera into the real scrollbar before
    // playback stops, so manual scrolling resumes from the exact visible view.
    syncCompositeTimelineNativeCamera(timelineViewportDom);
    editorClearGuidePreview();
    hybridSession.previewPlaying = false;
    hybridSession.previewLoading = false;
    hybridSession.previewMode = '';
    hybridSession.previewRecordingGain = 1;
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelinePlayheadFrame = 0;
    updateCompositePreviewButtons();
    // Leave both the main line and overview marker at the exact captured
    // transport position instead of the previous animation-frame sample.
    refreshCompositeTimelinePlayheadNow();
    setCompositePreviewHelp('One source at a time · level-matched.');
    if (hadPreview) setStatus('Composite preview stopped.');
}

function toggleCompositePreview(mode) {
    if (hybridSession.previewMode === mode
            && (hybridSession.previewPlaying || hybridSession.previewLoading)) {
        endCompositePreviewPlayback();
        return;
    }
    startCompositePreview(mode);
}

function restoreCompositePreviewSession() {
    if (hybridSession.previewRestore?.sessionId
            && hybridSession.previewRestore.sessionId !== S.sessionId) {
        hybridSession.previewRequestId++;
        hybridSession.previewRestore = null;
        hybridSession.previewPlaying = false;
        hybridSession.previewLoading = false;
        hybridSession.previewMode = '';
        hybridSession.previewRecordingGain = 1;
        return;
    }
    endCompositePreviewPlayback();
    if (!hybridSession.previewRestore) return;
    const restore = hybridSession.previewRestore;
    hybridSession.previewRestore = null;
    _setBarSel(restore.barSel);
    _setLoopRegionEnabled(restore.loopEnabled);
    host.editorSeekToTime(restore.cursorTime);
}

function clearTransientState() {
    flushHybridPreviewPreferences();
    hybridSession.closeDecisionResolve?.('discard');
    stopCompositeModalDocumentKeyboard();
    stopHybridDialogSizePersistence();
    stopCompositeTimelineUi();
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
    if (group.reason === 'experimental-handoff-review') {
        return (group.reasons || []).join('; ') || 'the musical handoff is worth checking';
    }
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
    return {
        primary: S.arrangements[primaryIndex]?.name || 'Base track',
        secondary: S.arrangements[secondaryIndex]?.name || 'Fill track',
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
        + `<p class="mt-1 text-xs text-gray-300">You can click the outlined notes in the tracks above, or use these checkboxes. Connected notes, chords, and trails stay together.${hybridSession.plan?.strategy === 'experimental' ? ` The ${_editorEscHtml(names.primary)} track is already kept outside this optional fill passage.` : ''}</p>`
        + `<div class="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2"><div><b class="text-sky-300">${_editorEscHtml(names.primary)}</b>${group.primaryEntries.map(render).join('')}</div>`
        + `<div><b class="text-violet-300">${_editorEscHtml(names.secondary)}</b>${group.secondaryEntries.map(render).join('')}</div></div></div>`;
}

function renderPreviewControls(view, wholeSong = false) {
    const resultReady = wholeSong || !!view.conflict.resolution;
    const buttonClass = 'px-2.5 py-1.5 rounded border border-gray-600 bg-dark-700 hover:border-gray-400 text-xs disabled:opacity-40 disabled:cursor-not-allowed';
    const colors = { song: '', primary: ' text-sky-200', secondary: ' text-violet-200', result: ' text-emerald-200' };
    const modes = compositePreviewModesPure(view, {
        audioAvailable: !!S.audioBuffer,
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
        + `<label class="flex items-center gap-1.5 text-xs text-gray-300"><span class="font-semibold">Tone</span><select id="editor-composite-preview-tone" class="rounded border border-gray-600 bg-dark-700 px-2 py-1 text-xs text-gray-100" title="Used for Lead, Rhythm, and Hybrid previews">${toneOptions}</select></label>`
        + `<label class="flex items-center gap-1.5 text-xs text-gray-300"><span class="whitespace-nowrap font-semibold">Volume</span><input id="editor-composite-preview-volume" type="range" min="0" max="100" step="1" value="${hybridPreviewPreferences.volume}" class="w-20 flex-none accent-accent" aria-describedby="editor-composite-preview-help"><output id="editor-composite-preview-volume-value" for="editor-composite-preview-volume" class="w-9 text-right tabular-nums text-gray-200">${hybridPreviewPreferences.volume}%</output></label>`
        + (wholeSong
            ? `<button type="button" id="editor-composite-whole-loop" aria-pressed="${hybridSession.wholeSongLoop}" class="${buttonClass}${hybridSession.wholeSongLoop ? ' ring-2 ring-sky-400' : ''}" title="Repeat the whole song">↻ Loop</button>`
            : `<button type="button" id="editor-composite-keep-loop" class="${buttonClass}">Keep loop in editor</button>`)
        + `<span id="editor-composite-preview-help" class="ml-auto min-w-40 flex-1 text-right text-[11px] text-gray-400" aria-live="polite">One source at a time · level-matched.${wholeSong ? ' Loops only when Loop is on.' : ' This section repeats.'}</span></div></div>`;
}

function currentConflictView() {
    if (!hybridSession.plan || !hybridSession.plan.conflicts.length) return null;
    const group = hybridSession.plan.conflicts[hybridSession.conflictIndex];
    const names = selectedSourceNames();
    const draft = hybridSession.customDrafts.get(group.id);
    return buildCompositeConflictViewModel({
        plan: hybridSession.plan,
        conflictIndex: hybridSession.conflictIndex,
        primaryName: names.primary,
        secondaryName: names.secondary,
        customEntryIds: Array.isArray(draft) ? draft : null,
    });
}

function entryLastBeat(entry) {
    return Math.max(Number(entry?.startBeat) || 0, Number(entry?.endBeat) || 0,
        Number(entry?.effectiveEndBeat) || 0);
}

function wholePlanPreviewView() {
    if (!hybridSession.plan) return null;
    const names = selectedSourceNames();
    const result = compositeResolvedEntries(hybridSession.plan);
    const audioShift = (Number(S.audioShift) || 0) + (Number(S.activeAudioSourceOffset) || 0);
    const recordingEnd = S.audioBuffer ? Math.max(0, Number(S.audioBuffer.duration) + audioShift) : 0;
    const durationSeconds = Math.max(0, Number(S.duration) || 0,
        Number(S.masterAudioDuration) || 0, recordingEnd);
    const view = buildCompositeTimelineViewModel({
        plan: hybridSession.plan,
        primaryName: names.primary,
        secondaryName: names.secondary,
        resultEntries: result,
        durationSeconds,
        passageFocusId: hybridSession.inspectedPassageId,
    });
    const passage = hybridSession.plan.passages?.find(candidate =>
        candidate.id === hybridSession.inspectedPassageId);
    if (passage) {
        const previous = passage.handoff?.previousBaseBeat;
        const next = passage.handoff?.nextBaseBeat;
        view.playbackContext = {
            startBeat: Math.max(view.context.startBeat,
                Math.min(passage.startBeat, Number.isFinite(previous) ? previous : passage.startBeat) - 0.5),
            endBeat: Math.min(view.context.endBeat,
                Math.max(passage.endBeat, Number.isFinite(next) ? next : passage.endBeat) + 0.5),
        };
        view.inspectedPassage = passage;
        view.wholeSong = false;
    }
    return view;
}

function reviewPlanTimelineView() {
    const conflictView = currentConflictView();
    if (!conflictView || !hybridSession.plan) return null;
    const localResult = conflictView.lanes.find(lane => lane.id === 'result')?.entries || [];
    const resultById = new Map(compositeResolvedEntries(hybridSession.plan)
        .map(entry => [entry.id, entry]));
    for (const entry of localResult) resultById.set(entry.id, entry);
    const names = selectedSourceNames();
    const audioShift = (Number(S.audioShift) || 0) + (Number(S.activeAudioSourceOffset) || 0);
    const recordingEnd = S.audioBuffer ? Math.max(0, Number(S.audioBuffer.duration) + audioShift) : 0;
    const durationSeconds = Math.max(0, Number(S.duration) || 0,
        Number(S.masterAudioDuration) || 0, recordingEnd);
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
    const view = buildCompositeTimelineViewModel({
        plan: hybridSession.plan,
        primaryName: names.primary,
        secondaryName: names.secondary,
        resultEntries: [...resultById.values()],
        durationSeconds,
        review,
    });
    const annotations = new Map(conflictView.lanes.flatMap(lane => lane.entries
        .map(entry => [`${lane.id}:${entry.id}`, entry])));
    view.lanes = view.lanes.map(lane => ({
        ...lane,
        entries: lane.entries.map(entry => ({
            ...entry,
            ...(annotations.get(`${lane.id}:${entry.id}`) || {}),
        })),
    }));
    view.wholeSong = false;
    view.manualSelectionActive = hybridSession.customDrafts.has(group.id)
        || group.resolution === 'custom';
    view.selectedLaneId = view.manualSelectionActive ? 'result'
        : group.resolution === 'primary' || group.resolution === 'secondary'
            ? group.resolution : '';
    view.playbackContext = conflictView.context;
    view.conflict = conflictView.conflict;
    return view;
}

function currentTimelineView() {
    const cacheKey = `${hybridSession.stage}:${hybridSession.conflictIndex}:${hybridSession.inspectedPassageId}`
        + `:${hybridSession.planRevision}:${hybridSession.resolutionRevision}`
        + `:${hybridSession.viewRevision}`;
    if (timelineViewCache?.plan === hybridSession.plan
            && timelineViewCache.key === cacheKey) return timelineViewCache.view;
    const view = hybridSession.stage === 'final-preview'
        ? wholePlanPreviewView() : reviewPlanTimelineView();
    timelineViewCache = { plan: hybridSession.plan, key: cacheKey, view };
    return view;
}

function invalidateCompositeTimelineView() {
    timelineViewCache = null;
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
        ? compositeResolvedEntries(plan) : plan.sourceEntries?.[mode] || [];
    const events = convertCompositePreviewEvents(
        entries, arrangement, plan.beats, stringCount);
    cache[mode] = events;
    if (mode === 'result') cache.resultRevision = hybridSession.resolutionRevision;
    return events;
}

function scheduleCompositePreviewEventPrewarm(plan = hybridSession.plan) {
    if (!plan) return;
    const resolutionRevision = hybridSession.resolutionRevision;
    const modes = ['primary', 'secondary', 'result'];
    let index = 0;
    const queue = () => scheduleCompositeTimelineIdle(deadline => {
        if (hybridSession.plan !== plan
                || hybridSession.resolutionRevision !== resolutionRevision) return;
        if (compositeTimelineInputPending()
                || Math.max(0, Number(deadline?.timeRemaining?.()) || 0) < 8) {
            queue();
            return;
        }
        compositePreviewEventsForMode(modes[index++]);
        if (index < modes.length) queue();
    });
    queue();
}

function setCompositeContextLoop(view, requestedStartTime = null) {
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    _setBarSel(region);
    const wholeSong = !!view.wholeSong;
    _setLoopRegionEnabled(wholeSong ? hybridSession.wholeSongLoop : true);
    const requested = Number(requestedStartTime);
    const startTime = Number.isFinite(requested)
        ? Math.max(region.startTime, Math.min(region.endTime - 0.01, requested))
        : region.startTime;
    host.editorSeekToTime(startTime);
    hybridSession.timelineSeekTime = startTime;
    return region;
}

async function startCompositePreview(mode) {
    if (timelineViewportDom?.reviewRefreshPending) {
        const message = 'Updating the tracks for your choice…';
        setCompositePreviewHelp(message);
        setStatus(`Hybrid preview: ${message}`);
        return;
    }
    const view = currentPreviewView();
    if (!view) return;
    const requestedStartTime = (hybridSession.previewPlaying || hybridSession.previewMode)
        ? Number(S.cursorTime) : hybridSession.timelineSeekTime;
    const resultReady = !!view.conflict?.resolution;
    const modeModel = compositePreviewModesPure(view, {
        audioAvailable: !!S.audioBuffer,
        resultReady,
    }).find(candidate => candidate.id === mode);
    if (!modeModel || !modeModel.available) {
        const reason = modeModel?.unavailableReason || 'This preview is not available.';
        setCompositePreviewHelp(reason);
        setStatus(`Hybrid preview: ${reason}`);
        return;
    }
    const arrangement = mode === 'secondary'
        ? hybridSession.plan.secondary
        : hybridSession.plan.primary;
    const tone = selectedHybridPreviewTone();
    // A new choice replaces the sound already playing immediately; do not let
    // the previous Original/guide mode continue underneath a loading message.
    if (hybridSession.previewPlaying && S.playing) stopPlayback();
    if (hybridSession.previewPlaying || hybridSession.previewMode) editorClearGuidePreview();
    const requestId = ++hybridSession.previewRequestId;
    hybridSession.previewMode = mode;
    hybridSession.previewLastMode = mode;
    hybridSession.previewPlaying = false;
    hybridSession.previewLoading = mode !== 'song';
    updateCompositePreviewButtons();
    if (mode !== 'song') {
        setCompositePreviewHelp(`Loading ${modeModel.label} · ${tone.label}…`);
        setStatus(`Hybrid preview: loading the ${tone.label} tone for ${modeModel.label}.`);
        let ready = false;
        try { ready = await editorPrepareGuidePreview(arrKind(arrangement), { gm: tone.gm }); }
        catch (_) { ready = false; }
        if (requestId !== hybridSession.previewRequestId || !hybridSession.plan) return;
        hybridSession.previewLoading = false;
        if (!ready) {
            hybridSession.previewMode = '';
            updateCompositePreviewButtons();
            const message = `The ${tone.label} guide tone could not be loaded. The Original song preview is still available.`;
            setCompositePreviewHelp(message);
            setStatus(`Hybrid preview: ${message}`);
            return;
        }
    }
    if (requestId !== hybridSession.previewRequestId) return;
    rememberCompositePreviewSession();
    if (S.playing) stopPlayback();
    editorClearGuidePreview();
    const events = mode === 'song' ? [] : compositePreviewEventsForMode(mode);
    hybridSession.previewRecordingGain = mode === 'song' ? recordingPreviewGainFor(view) : 1;
    editorSetGuidePreview(events, arrKind(arrangement), {
        ...compositePreviewAudioPolicyPure(mode),
        ...hybridPreviewMixFor(mode),
        gm: tone.gm,
        voiceCap: hybridSession.plan.compatibility.stringCount,
        preSanitized: mode !== 'song',
    });
    setCompositeContextLoop(view, requestedStartTime);
    startPlayback();
    hybridSession.previewPlaying = !!S.playing;
    updateCompositePreviewButtons();
    if (!hybridSession.previewPlaying) {
        restoreCompositePreviewSession();
        const message = 'Playback could not start.';
        setCompositePreviewHelp(message);
        setStatus(`Hybrid preview: ${message}`);
        return;
    }
    startCompositeTimelinePlayhead();
    const help = mode === 'song'
        ? 'Original song · level-matched.'
        : `${modeModel.label} · ${tone.label} · level-matched.`;
    setCompositePreviewHelp(help);
    setStatus(`Hybrid preview: playing ${modeModel.label}.`);
}

function keepCompositeContextLoop() {
    const view = currentPreviewView();
    if (!view) return;
    rememberCompositePreviewSession();
    endCompositePreviewPlayback();
    setCompositeContextLoop(view);
    // This button is an explicit handoff: do not restore the user's previous
    // loop when the resolver closes.
    hybridSession.previewRestore = null;
    const button = byId('editor-composite-keep-loop');
    if (button) button.textContent = 'Editor loop set ✓';
    setStatus('This section will stay looped after you close the Hybrid Track builder.');
}

function restartCompositePreview() {
    const view = currentPreviewView();
    if (!view || !hybridSession.plan) return;
    const region = compositePreviewRegionPure(
        view.playbackContext || view.context, hybridSession.plan.beats);
    const activeMode = hybridSession.previewMode;
    if (activeMode) endCompositePreviewPlayback();
    rememberCompositePreviewSession();
    seekCompositeTimelineAtTime(region.startTime, {
        center: true,
    });
    if (activeMode) startCompositePreview(activeMode);
    else setStatus(`Hybrid preview returned to the beginning of the ${view.review || view.inspectedPassage ? 'selected section' : 'song'}.`);
}

function renderCompositeReviewToolbar({
    model, group, view, names, repeatContext, rangeLabel, splitMarkup,
} = {}) {
    if (!model || !group || !view) return '';
    const stateClass = `editor-composite-review-state editor-composite-review-state-${model.state}`;
    const choiceClass = id => `editor-composite-review-choice editor-composite-review-choice-${id}`
        + (model.resolution === id ? ' editor-composite-review-choice-active' : '');
    const choices = model.choices.map(choice => `<button type="button" data-resolution="${choice.id}" aria-pressed="${choice.selected}" class="${choiceClass(choice.id)}" title="${_editorEscHtml(choice.hint)}"><span>${_editorEscHtml(choice.label)}</span></button>`).join('');
    const repeatBadge = model.repeatCount > 1
        ? `<span class="editor-composite-review-repeat">${model.repeatCount} matching sections</span>` : '';
    const manualStatus = model.manualActive
        ? `<div class="editor-composite-manual-status" role="status"><b>Manual mix</b><span>${model.primarySelected} ${_editorEscHtml(names.primary)} + ${model.secondarySelected} ${_editorEscHtml(names.secondary)}</span><span>Click outlined notes to include or remove them.</span>${model.validationError ? `<span id="editor-composite-custom-error" class="editor-composite-review-error" role="alert">${_editorEscHtml(model.validationError)}</span>` : ''}</div>` : '';
    const occurrenceMarkup = guidedOccurrenceMarkup(repeatContext, group);
    const details = `<details class="editor-composite-review-details"><summary>Decision details</summary>`
        + `<div class="editor-composite-review-details-panel"><div class="editor-composite-review-details-heading"><b>${_editorEscHtml(group.label)}</b><span>${_editorEscHtml(conflictReason(group))}</span></div>`
        + occurrenceMarkup
        + `<div class="rounded-lg border border-gray-700 bg-dark-900/50 px-3 py-2"><b class="text-sm text-gray-100">Why does this section need review?</b><p class="mt-1 text-xs text-gray-200">${_editorEscHtml(view.explanation)}</p>${renderCompositeDifferenceTable(view)}</div>`
        + customDetailsMarkup(group)
        + (splitMarkup ? `<div class="border-t border-gray-700 pt-3 text-xs text-gray-400">${splitMarkup}</div>` : '')
        + `<details class="border-t border-gray-700 pt-3 text-xs text-gray-400"><summary class="cursor-pointer hover:text-gray-200">Technical note details</summary><div class="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">`
        + `<div><b class="text-sky-300">${_editorEscHtml(names.primary)}</b><ul>${group.primaryEntries.map(entry => entryMarkup(entry, '', view.stringCount)).join('')}</ul></div>`
        + `<div><b class="text-violet-300">${_editorEscHtml(names.secondary)}</b><ul>${group.secondaryEntries.map(entry => entryMarkup(entry, '', view.stringCount)).join('')}</ul></div></div></details></div></details>`;
    const secondaryActions = `<details class="editor-composite-review-more"><summary>More</summary><div>`
        + `<button type="button" id="editor-composite-edit-settings">Back and adjust settings</button>`
        + (model.experimental && model.unresolvedDecisions
            ? `<button type="button" id="editor-composite-skip-experimental-review" title="Keep only passages already added automatically">Leave all uncertain passages out</button>` : '')
        + `</div></details>`;
    const continueLabel = _compositeReviewContinueLabelPure(model.unresolvedDecisions);
    const modeLabel = model.experimental
        ? `Experimental · ${model.profile}` : 'Guided review';
    return `<section class="editor-composite-review-toolbar" aria-label="Review decision ${model.decisionNumber} of ${model.decisionTotal}">`
        + `<div class="editor-composite-review-summary"><div><b>Decision ${model.decisionNumber} of ${model.decisionTotal}</b><span class="editor-composite-review-mode">${_editorEscHtml(modeLabel)}</span><span class="editor-composite-review-location" title="${_editorEscHtml(rangeLabel)}">${_editorEscHtml(group.label)}</span></div>`
        + `<div><span class="${stateClass}">${_editorEscHtml(model.stateLabel)}</span><span class="editor-composite-review-left">${model.unresolvedDecisions} left</span>${repeatBadge}</div></div>`
        + `<div class="editor-composite-review-choices" role="group" aria-label="Choose what to play in this section">${choices}</div>`
        + manualStatus
        + `<div class="editor-composite-review-actions">`
        + `<button type="button" id="editor-composite-prev" aria-label="Previous review section" ${model.decisionNumber <= 1 ? 'disabled' : ''}>← Previous</button>`
        + `<button type="button" id="editor-composite-next" aria-label="Next review section" ${model.decisionNumber >= model.decisionTotal ? 'disabled' : ''}>Next →</button>`
        + `<button type="button" id="editor-composite-reset-choice" ${model.canReset ? '' : 'disabled'}>Clear</button>`
        + details + secondaryActions
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
    const draft = hasDraft ? hybridSession.customDrafts.get(group.id) : null;
    const view = buildCompositeConflictViewModel({
        plan,
        conflictIndex: hybridSession.conflictIndex,
        primaryName: names.primary,
        secondaryName: names.secondary,
        customEntryIds: hasDraft ? draft : null,
    });
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
        customEntryIds: hasDraft ? draft : null,
        decisionNumber,
        decisionTotal,
        unresolvedDecisions: unresolved,
        repeatCount: repeatContext?.members.length || 1,
        canReset: repeatContext
            ? repeatContext.members.some(candidate => candidate.block.resolution
                || hybridSession.customDrafts.has(candidate.block.id))
            : group.resolution || hasDraft,
    });
    const timelineView = includeTimeline ? currentTimelineView() : null;
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
    if (!hybridSession.plan) return false;
    if (hybridSession.plan.conflicts.some(block => !block.resolution)) return false;
    endCompositePreviewPlayback();
    hybridSession.stage = 'final-preview';
    hybridSession.timelineFocusReview = false;
    hybridSession.timelineFocusPassage = false;
    renderResult();
    const workspace = byId('editor-composite-result-workspace');
    if (workspace) workspace.scrollTop = 0;
    return true;
}

function toggleCompositeCustomEntry(entryId) {
    const conflict = hybridSession.plan?.conflicts?.[hybridSession.conflictIndex];
    if (!conflict) return;
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
}

function inspectExperimentalPassage(passageId) {
    const passage = hybridSession.plan?.passages?.find(candidate => candidate.id === passageId);
    if (!passage) return false;
    endCompositePreviewPlayback();
    hybridSession.inspectedPassageId = passage.id;
    hybridSession.timelineFocusPassage = true;
    hybridSession.timelineSeekTime = Math.max(0, timeOf(hybridSession.plan.beats,
        Math.max(0, passage.startBeat - 0.5)));
    host.editorSeekToTime(hybridSession.timelineSeekTime);
    invalidateCompositeTimelineView();
    renderResult();
    return true;
}

function applyExperimentalPassageFilter(value = hybridSession.passageFilter) {
    const allowed = new Set(['all', 'added', 'reviewed', 'review', 'left-out']);
    hybridSession.passageFilter = allowed.has(value) ? value : 'all';
    const select = byId('editor-composite-passage-filter');
    if (select) select.value = hybridSession.passageFilter;
    for (const button of document.querySelectorAll('[data-composite-passage-category]')) {
        button.hidden = hybridSession.passageFilter !== 'all'
            && button.dataset.compositePassageCategory !== hybridSession.passageFilter;
    }
}

function bindCompositeReviewDetails(details) {
    details?.addEventListener('toggle', () => {
        if (!details.open) return;
        requestAnimationFrame(() => {
            const panel = details.querySelector('.editor-composite-review-details-panel');
            const boundary = byId('editor-composite-result-workspace')
                || byId('editor-composite-dialog');
            if (!panel || !boundary) return;
            const summaryRect = details.querySelector('summary')?.getBoundingClientRect();
            const boundaryRect = boundary.getBoundingClientRect();
            if (!summaryRect) return;
            const below = Math.max(0, boundaryRect.bottom - summaryRect.bottom - 12);
            const above = Math.max(0, summaryRect.top - boundaryRect.top - 12);
            const desiredHeight = Math.min(480, panel.scrollHeight || 480);
            const openUp = desiredHeight > below && above > below;
            details.classList.toggle('editor-composite-review-details-open-up', openUp);
            const available = openUp ? above : below;
            panel.style.maxHeight = `${Math.max(144, Math.min(480, available))}px`;
        });
    });
}

function bindCompositeReviewToolbarEvents(toolbar) {
    if (!toolbar) return;
    for (const details of toolbar.querySelectorAll('.editor-composite-review-details')) {
        bindCompositeReviewDetails(details);
    }
    for (const marker of toolbar.querySelectorAll('[data-conflict-index]')) {
        marker.addEventListener('click', () => {
            hybridSession.conflictIndex = Number(marker.dataset.conflictIndex) || 0;
            prepareCurrentReviewFocus(true);
            renderResult();
        });
    }
    for (const button of toolbar.querySelectorAll('[data-guided-split-beat]')) {
        button.addEventListener('click', () => {
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
            renderResult();
        });
    }
    toolbar.querySelector('#editor-composite-edit-settings')?.addEventListener('click', () => {
        endCompositePreviewPlayback();
        setCompositeReviewMode(false);
        byId('editor-composite-primary')?.focus();
    });
    toolbar.querySelector('#editor-composite-skip-experimental-review')?.addEventListener('click', () => {
        for (const conflict of hybridSession.plan.conflicts) {
            if (!conflict.resolution) resolveCompositeConflict(
                hybridSession.plan, conflict.id, 'primary');
        }
        markHybridResolutionChanged(hybridSession);
        markHybridReviewWork(hybridSession);
        enterCompositeFinalPreview();
    });
    const moveDecision = offset => {
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
        renderResult();
    };
    toolbar.querySelector('#editor-composite-prev')?.addEventListener(
        'click', () => moveDecision(-1));
    toolbar.querySelector('#editor-composite-next')?.addEventListener(
        'click', () => moveDecision(1));
    for (const button of toolbar.querySelectorAll('[data-resolution]')) {
        button.addEventListener('click', () => {
            const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
            const resolution = button.dataset.resolution;
            if (resolution === 'custom') {
                if (!hybridSession.customDrafts.has(conflict.id)) {
                    hybridSession.customDrafts.set(conflict.id,
                        conflict.resolution === 'custom'
                            ? [...conflict.selectedEntryIds]
                            : hybridSession.plan.strategy === 'experimental'
                                ? conflict.secondaryEntries.map(entry => entry.id)
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
        });
    }
    for (const checkbox of toolbar.querySelectorAll('[data-entry-id]')) {
        checkbox.addEventListener('change', () => {
            toggleCompositeCustomEntry(checkbox.dataset.entryId);
        });
    }
    toolbar.querySelector('#editor-composite-reset-choice')?.addEventListener('click', () => {
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        const context = guidedRepeatContext(hybridSession.plan, conflict);
        for (const member of context?.members || [{ block: conflict }]) {
            hybridSession.customDrafts.delete(member.block.id);
        }
        clearReviewChoice(hybridSession.plan, conflict.id);
        markHybridResolutionChanged(hybridSession);
        markHybridReviewWork(hybridSession);
        refreshCurrentCompositeReview();
    });
    toolbar.querySelector('#editor-composite-detach-occurrence')?.addEventListener('click', () => {
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
        const context = guidedRepeatContext(hybridSession.plan,
            hybridSession.plan.conflicts[hybridSession.conflictIndex]);
        const target = context?.nextUnresolvedGroup || null;
        if (target) {
            activateGuidedReviewGroup(hybridSession.plan, target);
            prepareCurrentReviewFocus(true);
            renderResult();
        } else if (!context) {
            const next = hybridSession.plan.conflicts.findIndex((block, index) =>
                index > hybridSession.conflictIndex && !block.resolution);
            const wrapped = next >= 0 ? next
                : hybridSession.plan.conflicts.findIndex(block => !block.resolution);
            if (wrapped >= 0) {
                hybridSession.conflictIndex = wrapped;
                prepareCurrentReviewFocus(true);
                renderResult();
            } else {
                enterCompositeFinalPreview();
            }
        } else {
            enterCompositeFinalPreview();
        }
    });
}

function bindResultEvents() {
    const result = byId('editor-composite-result');
    if (!result || !hybridSession.plan) return;
    const reviewToolbar = result.querySelector('.editor-composite-review-toolbar');
    bindCompositeReviewToolbarEvents(reviewToolbar);
    if (!reviewToolbar) {
        byId('editor-composite-edit-settings')?.addEventListener('click', () => {
            endCompositePreviewPlayback();
            setCompositeReviewMode(false);
            byId('editor-composite-primary')?.focus();
        });
    }
    byId('editor-composite-copy-report')?.addEventListener('click', async () => {
        let report = hybridSession.plan?.comparisonReport
            || experimentalComparisonReport(hybridSession.plan);
        if (hybridSession.plan?.strategy === 'experimental') {
            const metadata = compositeExperimentalMetadataPreview(hybridSession.plan);
            report += `\nPreserved metadata: ${metadata.chordTemplates} chord shapes, ${metadata.handshapes} handshapes, ${metadata.phrases} phrases, ${metadata.toneChanges} tone changes`;
            if (metadata.warnings.length) report += `\nMetadata notes: ${metadata.warnings.join(' | ')}`;
        }
        try {
            await navigator.clipboard.writeText(report);
            const button = byId('editor-composite-copy-report');
            if (button) button.textContent = 'Copied ✓';
            setStatus('Experimental Hybrid comparison copied to the clipboard.');
        } catch (_) {
            setStatus('Could not copy the comparison report. Clipboard access is unavailable.');
        }
    });
    for (const button of document.querySelectorAll('[data-composite-inspect-passage]')) {
        button.addEventListener('click', () => inspectExperimentalPassage(
            button.dataset.compositeInspectPassage));
    }
    byId('editor-composite-passage-filter')?.addEventListener('change', event =>
        applyExperimentalPassageFilter(event.target.value));
    applyExperimentalPassageFilter();
    const moveInspectedPassage = delta => {
        const passages = hybridSession.plan?.passages || [];
        const index = passages.findIndex(passage => passage.id === hybridSession.inspectedPassageId);
        const next = passages[index + delta];
        if (next) inspectExperimentalPassage(next.id);
    };
    byId('editor-composite-passage-prev')?.addEventListener('click', () => moveInspectedPassage(-1));
    byId('editor-composite-passage-next')?.addEventListener('click', () => moveInspectedPassage(1));
    byId('editor-composite-passage-clear')?.addEventListener('click', () => {
        endCompositePreviewPlayback();
        hybridSession.inspectedPassageId = '';
        hybridSession.timelineFocusPassage = false;
        invalidateCompositeTimelineView();
        renderResult();
    });
    byId('editor-composite-back-review')?.addEventListener('click', () => {
        endCompositePreviewPlayback();
        hybridSession.stage = 'review';
        prepareCurrentReviewFocus(true);
        renderResult();
    });
    for (const button of result.querySelectorAll('[data-composite-preview]')) {
        button.addEventListener('click', () => toggleCompositePreview(
            button.dataset.compositePreview));
    }
    byId('editor-composite-preview-stop')?.addEventListener('click', endCompositePreviewPlayback);
    byId('editor-composite-preview-restart')?.addEventListener('click', restartCompositePreview);
    byId('editor-composite-keep-loop')?.addEventListener('click', keepCompositeContextLoop);
    byId('editor-composite-whole-loop')?.addEventListener('click', () => {
        hybridSession.wholeSongLoop = !hybridSession.wholeSongLoop;
        const button = byId('editor-composite-whole-loop');
        if (button) {
            button.setAttribute('aria-pressed', String(hybridSession.wholeSongLoop));
            button.classList.toggle('ring-2', hybridSession.wholeSongLoop);
            button.classList.toggle('ring-sky-400', hybridSession.wholeSongLoop);
        }
        if (hybridSession.stage === 'final-preview' && hybridSession.previewMode) {
            _setLoopRegionEnabled(hybridSession.wholeSongLoop);
        }
        setCompositePreviewHelp(hybridSession.wholeSongLoop
            ? 'Whole-song loop is on. Playback repeats until you press Stop.'
            : 'Whole-song loop is off. Playback stops at the end of the song.');
    });
    byId('editor-composite-preview-tone')?.addEventListener('change', event => {
        setHybridPreviewPreferences({
            ...hybridPreviewPreferences,
            tone: event.target.value,
        });
        const activeMode = hybridSession.previewMode;
        if (activeMode && activeMode !== 'song') {
            startCompositePreview(activeMode);
        } else {
            const tone = selectedHybridPreviewTone();
            setCompositePreviewHelp(`Guide tone set to ${tone.label}. It is used for Lead, Rhythm, and Hybrid previews.`);
        }
    });
    byId('editor-composite-preview-volume')?.addEventListener('input', event => {
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

export function _compositeExperimentalSummaryPure(stats = {}, names = {}) {
    const base = String(names.primary || 'Base track');
    const fill = String(names.secondary || 'Fill track');
    const added = Math.max(0, Number(stats.secondaryAddedCleanly) || 0);
    const reviewed = Math.max(0, Number(stats.secondaryAcceptedAfterReview
        ?? stats.secondaryReviewable) || 0);
    const skipped = Math.max(0, Number(stats.secondarySkippedByStrategy) || 0)
        + Math.max(0, Number(stats.secondaryLeftOutAfterReview) || 0);
    return {
        title: 'Experimental hybrid ready',
        description: `${base} unchanged · ${added} ${fill} added automatically · ${reviewed} added after review · ${skipped} left out`,
        added, reviewed, skipped,
    };
}

function experimentalComparisonMarkup(plan) {
    if (plan.strategy !== 'experimental') return '';
    const standard = plan.standardComparison || {};
    const stats = plan.stats || {};
    const sync = plan.sync || {};
    const outcome = plan.reviewOutcome || {};
    const syncClass = sync.status === 'verified' ? 'text-emerald-300' : 'text-amber-300';
    return `<details class="mb-2 rounded-lg border border-amber-800/60 bg-amber-950/15 px-3 py-2">`
        + `<summary class="cursor-pointer text-sm text-amber-100"><b>Experimental comparison</b><span class="ml-2 text-xs font-normal text-gray-400">Standard vs selected profile</span></summary>`
        + `<div class="mt-3 flex flex-wrap items-start justify-between gap-3"><p class="text-xs text-gray-300">Profile: ${_editorEscHtml(plan.profile)}. The Standard Automatic result was calculated unchanged as a control.</p><button type="button" id="editor-composite-copy-report" class="rounded bg-dark-700 px-3 py-2 text-xs hover:bg-dark-600">Copy comparison report</button></div>`
        + `<div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2"><div class="rounded border border-gray-700 bg-dark-900/60 p-3"><b class="text-sm text-gray-100">Standard Automatic</b><p class="mt-1 text-xs text-gray-300">${Number(standard.secondaryAddedCleanly) || 0} fill notes added · ${Number(standard.secondarySkippedByStrategy) || 0} left out</p></div>`
        + `<div class="rounded border border-amber-800/50 bg-dark-900/60 p-3"><b class="text-sm text-amber-100">Experimental</b><p class="mt-1 text-xs text-gray-300">${Number(stats.secondaryAddedCleanly) || 0} added automatically · ${Number(outcome.acceptedNotes) || 0} added after review · ${(Number(stats.secondarySkippedByStrategy) || 0) + (Number(outcome.leftOutNotes) || 0)} left out</p></div></div>`
        + `<div class="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-300 md:grid-cols-3"><p><b class="${syncClass}">Timing ${_editorEscHtml(sync.status || 'inconclusive')}</b><br>${_editorEscHtml(sync.message || '')}</p><p><b class="text-gray-100">Shared notes</b><br>${Number(stats.duplicatesRemoved) || 0} duplicates removed, including ${Number(stats.semanticDuplicates) || 0} that play the same despite different chart annotations.</p><p><b class="text-gray-100">Playability comparison</b><br>${plan.playability?.newWarnings?.length || 0} new advisory warnings versus the base track.</p></div></details>`;
}

function finiteMetric(value, suffix) {
    return Number.isFinite(value) ? `${value}${suffix}` : 'Song boundary';
}

export function _compositeExperimentalPassageInspectorPure(plan, {
    inspectedPassageId = '', passageFilter = 'all',
} = {}) {
    if (plan.strategy !== 'experimental' || !(plan.passages || []).length) return '';
    const states = plan.passages.map((passage, index) => ({
        passage,
        outcome: experimentalPassageOutcome(plan, passage),
        index,
    })).map(item => ({
        ...item,
        category: item.outcome.state === 'automatic' ? 'added'
            : ['accepted', 'accepted-partial'].includes(item.outcome.state) ? 'reviewed'
                : item.outcome.state === 'review' ? 'review' : 'left-out',
    }));
    const selectedAt = Math.max(0, states.findIndex(item =>
        item.passage.id === inspectedPassageId));
    const selected = inspectedPassageId ? states[selectedAt] : null;
    const automatic = states.filter(item => item.outcome.state === 'automatic').length;
    const reviewed = states.filter(item => ['accepted', 'accepted-partial']
        .includes(item.outcome.state)).length;
    const needsReview = states.filter(item => item.outcome.state === 'review').length;
    const leftOut = states.filter(item => ['left-out', 'declined'].includes(item.outcome.state)).length;
    // A pathological import can produce thousands of tiny passages. Keep the
    // inspector responsive while the overview remains the full-song navigator.
    // Preserve up to this many chronological examples in every filter group,
    // and always include a passage selected from the overview.
    const maximumPerCategory = 240;
    const categoryCounts = new Map();
    const displayed = states.filter(item => {
        const count = categoryCounts.get(item.category) || 0;
        const keep = count < maximumPerCategory || item.passage.id === inspectedPassageId;
        if (keep) categoryCounts.set(item.category, count + 1);
        return keep;
    });
    const buttons = displayed.map(({ passage, outcome, category, index }) => {
        const colors = category === 'added' ? 'border-violet-600/70 text-violet-100'
            : category === 'reviewed' ? 'border-emerald-600/70 text-emerald-100'
                : category === 'review' ? 'border-amber-600/70 text-amber-100'
                    : 'border-slate-600 text-slate-300';
        const active = passage.id === inspectedPassageId;
        const hidden = passageFilter !== 'all' && category !== passageFilter;
        return `<button type="button" data-composite-inspect-passage="${_editorEscHtml(passage.id)}" data-composite-passage-category="${category}" aria-pressed="${active}"${hidden ? ' hidden' : ''} class="rounded-lg border bg-dark-800 px-3 py-2 text-left text-xs ${colors}${active ? ' ring-2 ring-sky-400' : ''}"><b class="block">${index + 1}. ${_editorEscHtml(passage.label)}</b><span class="mt-0.5 block text-gray-400">${_editorEscHtml(outcome.state.replace('-', ' '))} · score ${passage.handoffScore}/100 · ${passage.noteCount} notes</span></button>`;
    }).join('');
    let detail = '<p class="mt-3 text-xs text-gray-400">Choose a passage to inspect its handoffs, reasons, and candidate notes. The timeline and preview buttons will focus on that passage.</p>';
    if (selected) {
        const { passage, outcome } = selected;
        const handoff = passage.handoff || {};
        const reasons = passage.reasons?.length
            ? `<ul class="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-300">${passage.reasons.map(reason => `<li>${_editorEscHtml(reason)}</li>`).join('')}</ul>`
            : '<p class="mt-2 text-xs text-emerald-300">No questionable handoff was found.</p>';
        const advisoryDetails = [...new Set((plan.playability?.newWarnings || [])
            .filter(issue => issue.passageId === passage.id)
            .map(issue => issue.detail).filter(Boolean))];
        const advisories = advisoryDetails.length
            ? `<div class="mt-3 rounded border border-amber-800/50 bg-amber-950/20 p-2"><b class="text-xs text-amber-100">Playability ${advisoryDetails.length === 1 ? 'advisory' : 'advisories'}</b><ul class="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-200">${advisoryDetails.map(detail => `<li>${_editorEscHtml(detail)}</li>`).join('')}</ul></div>` : '';
        detail = `<div class="mt-3 rounded-lg border border-sky-800/60 bg-sky-950/20 p-3">`
            + `<div class="flex flex-wrap items-start justify-between gap-2"><div><b class="text-sm text-sky-100">${_editorEscHtml(passage.label)}</b><p class="mt-1 text-xs text-gray-300">${_editorEscHtml(passage.explanation)}</p></div>`
            + `<div class="flex gap-1"><button type="button" id="editor-composite-passage-prev" class="rounded bg-dark-700 px-2 py-1 text-xs"${selectedAt <= 0 ? ' disabled' : ''}>←</button><button type="button" id="editor-composite-passage-next" class="rounded bg-dark-700 px-2 py-1 text-xs"${selectedAt >= states.length - 1 ? ' disabled' : ''}>→</button><button type="button" id="editor-composite-passage-clear" class="rounded bg-dark-700 px-2 py-1 text-xs">Whole song</button></div></div>`
            + `<div class="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4"><p><b class="text-gray-100">Entry space</b><br>${finiteMetric(handoff.entryGapBeats, ' beats')} · ${finiteMetric(handoff.entryGapSeconds, ' s')}</p><p><b class="text-gray-100">Exit space</b><br>${finiteMetric(handoff.exitGapBeats, ' beats')} · ${finiteMetric(handoff.exitGapSeconds, ' s')}</p><p><b class="text-gray-100">Position movement</b><br>${handoff.entryFretShift || 0} frets in · ${handoff.exitFretShift || 0} out</p><p><b class="text-gray-100">Result</b><br>${_editorEscHtml(outcome.state.replace('-', ' '))} · ${outcome.selectedNotes}/${outcome.offeredNotes} notes</p></div>${reasons}${advisories}</div>`;
    }
    return `<details class="mb-2 rounded-lg border border-slate-700 bg-dark-900/60 px-3 py-2" aria-label="Experimental passage inspector"${selected ? ' open' : ''}>`
        + `<summary class="cursor-pointer text-sm text-gray-100"><b>Passage inspector</b><span class="ml-2 text-xs font-normal text-gray-400">${automatic} automatic · ${reviewed} reviewed · ${needsReview} need review · ${leftOut} left out</span></summary>`
        + `<div class="mt-2 flex flex-wrap items-center justify-between gap-2"><p class="text-[11px] text-gray-500">Handoff score estimates how smoothly the parts switch; higher is smoother.</p>`
        + `<label class="text-xs text-gray-300">Show <select id="editor-composite-passage-filter" class="ml-1 rounded border border-gray-600 bg-dark-700 px-2 py-1"><option value="all"${passageFilter === 'all' ? ' selected' : ''}>All passages</option><option value="added"${passageFilter === 'added' ? ' selected' : ''}>Added automatically</option><option value="reviewed"${passageFilter === 'reviewed' ? ' selected' : ''}>Added after review</option><option value="review"${passageFilter === 'review' ? ' selected' : ''}>Still needs review</option><option value="left-out"${passageFilter === 'left-out' ? ' selected' : ''}>Left out</option></select></label></div>`
        + `<div id="editor-composite-passage-list" class="mt-3 grid max-h-40 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">${buttons}</div>`
        + (displayed.length < states.length ? `<p class="mt-2 text-[11px] text-gray-500">Showing up to ${maximumPerCategory} passages in each result group. Use the overview to inspect any later passage.</p>` : '')
        + `${detail}</details>`;
}

function experimentalMetadataMarkup(plan) {
    if (plan.strategy !== 'experimental') return '';
    const metadata = compositeExperimentalMetadataPreview(plan);
    const warnings = metadata.warnings.length
        ? `<ul class="mt-2 list-disc pl-5 text-xs text-amber-200">${metadata.warnings.map(warning => `<li>${_editorEscHtml(warning)}</li>`).join('')}</ul>` : '';
    return `<details class="mb-2 rounded-lg border border-gray-700 bg-dark-900/50 px-3 py-2"><summary class="cursor-pointer text-xs text-gray-300"><b>Preserved details</b> · ${metadata.chordTemplates} chords · ${metadata.handshapes} handshapes · ${metadata.phrases} phrases · ${metadata.toneChanges} tones</summary>${warnings}</details>`;
}

function experimentalToolsMarkup(plan) {
    if (plan.strategy !== 'experimental') return '';
    const open = hybridSession.inspectedPassageId ? ' open' : '';
    return `<details class="mb-2 rounded-lg border border-amber-800/50 bg-amber-950/10 px-3 py-2"${open}>`
        + `<summary class="cursor-pointer text-sm text-amber-100"><b>Experimental details</b><span class="ml-2 text-xs font-normal text-gray-400">comparison · passages · preserved data</span></summary>`
        + `<div class="mt-2">${experimentalComparisonMarkup(plan)}`
        + _compositeExperimentalPassageInspectorPure(plan, {
            inspectedPassageId: hybridSession.inspectedPassageId,
            passageFilter: hybridSession.passageFilter,
        })
        + experimentalMetadataMarkup(plan) + `</div></details>`;
}

export function _compositeAutomaticOverviewPure(plan, names) {
    const all = [...(plan.sourceEntries?.primary || []), ...(plan.sourceEntries?.secondary || [])];
    if (!all.length) return '';
    const start = Math.min(...all.map(entry => entry.startBeat));
    const end = Math.max(start + 1, ...all.map(entryLastBeat));
    const additions = plan.fixedEntries.filter(entry => entry.source === 'secondary').map(entry => {
        const left = ((entry.startBeat - start) / (end - start)) * 100;
        const width = Math.max(0.25, ((entryLastBeat(entry) - entry.startBeat) / (end - start)) * 100);
        return `<span aria-hidden="true" class="absolute inset-y-0 rounded" style="left:${left}%;width:${width}%;min-width:3px;background:#c084fc" title="Added from ${_editorEscHtml(names.secondary)}"></span>`;
    }).join('');
    return `<div class="rounded-lg border border-gray-700 bg-dark-900/60 px-3 py-3 mb-3" aria-label="Where fill-track notes were added">`
        + `<div class="flex flex-wrap justify-between gap-2 text-xs mb-2"><b class="text-gray-200">Where notes were added</b><span class="text-gray-400"><span aria-hidden="true" class="text-violet-300">●</span> ${_editorEscHtml(names.secondary)} added to the hybrid</span></div>`
        + `<div class="relative h-5 rounded bg-sky-950/70 border border-sky-900 overflow-hidden">${additions}</div>`
        + `<p class="text-xs text-gray-500 mt-1.5">The full bar represents the song. Colored marks show the safe gaps that received notes.</p></div>`;
}

const COMPOSITE_TIMELINE_ZOOM_PRESETS = Object.freeze([
    Object.freeze([60, 'Compact']),
    Object.freeze([120, 'Normal']),
    Object.freeze([240, 'Detailed']),
    Object.freeze([480, 'Maximum']),
]);

export function _compositeTimelineZoomControlsPure(zoom) {
    const rounded = Math.round(Number(zoom) || HYBRID_PREVIEW_DEFAULTS.timelineZoom);
    const presetOptions = COMPOSITE_TIMELINE_ZOOM_PRESETS
        .map(([value, label]) => `<option value="${value}"${rounded === value ? ' selected' : ''}>${label} — ${value} px/beat</option>`)
        .join('');
    const customPreset = COMPOSITE_TIMELINE_ZOOM_PRESETS.some(([value]) => rounded === value)
        ? '' : `<option value="${rounded}" selected>Custom — ${rounded} px/beat</option>`;
    const sliderValue = compositeTimelineSteppedZoomPure(rounded);
    return `<label class="text-xs font-semibold text-gray-300">Zoom <select id="editor-composite-time-preset" class="ml-1 rounded border border-gray-600 bg-dark-700 px-2 py-1.5 text-xs text-gray-100">${presetOptions}${customPreset}</select></label>`
        + `<button type="button" data-composite-time-zoom="out" class="rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs" aria-label="Zoom out by ${HYBRID_TIMELINE_ZOOM_STEP} pixels per beat">−</button>`
        + `<input id="editor-composite-time-zoom" type="range" min="${HYBRID_TIMELINE_ZOOM_CONTROL_MIN}" max="${HYBRID_TIMELINE_ZOOM_MAX}" step="${HYBRID_TIMELINE_ZOOM_STEP}" value="${sliderValue}" class="w-32 flex-none accent-accent" aria-label="Timeline zoom in pixels per beat" aria-valuetext="${rounded} pixels per beat" title="Fine zoom in ${HYBRID_TIMELINE_ZOOM_STEP} px/beat steps">`
        + `<button type="button" data-composite-time-zoom="in" class="rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs" aria-label="Zoom in by ${HYBRID_TIMELINE_ZOOM_STEP} pixels per beat">+</button>`
        + `<output id="editor-composite-time-zoom-value" for="editor-composite-time-zoom" class="inline-block w-24 text-right text-xs tabular-nums text-gray-100">${rounded} px/beat</output>`;
}

function compositeTimelineDisplayBeatAtTime(view, time = hybridSession.timelineSeekTime) {
    const seconds = Number(time);
    const rawBeat = beatOf(view?.beats || hybridSession.plan?.beats || [],
        Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
    return compositeTimelineDisplayBeatPure(rawBeat, view?.context);
}

function renderCompositeTimelineMapOverlays(view, viewportRange) {
    const viewport = compositeTimelineMapViewportPure(view, viewportRange);
    const initialBeat = compositeTimelineDisplayBeatAtTime(
        view, hybridSession.timelineSeekTime);
    const span = Math.max(1, view.context.endBeat - view.context.startBeat);
    const playheadX = Math.max(0, Math.min(1000,
        ((initialBeat - view.context.startBeat) / span) * 1000));
    const moverStyle = 'position:absolute;inset:0;width:100%;height:42px;pointer-events:none;will-change:transform;transform-origin:0 0';
    return `<span id="editor-composite-map-viewport" aria-hidden="true" style="${moverStyle};z-index:2;transform:translate3d(${(viewport.x / 10).toFixed(3)}%,0,0)">`
        + `<span data-composite-map-viewport-window style="position:absolute;left:0;top:3px;width:${(viewport.width / 10).toFixed(3)}%;height:36px;box-sizing:border-box;border:2px solid #7dd3fc;border-radius:5px;background:rgba(56,189,248,.08)"></span></span>`
        + `<span id="editor-composite-map-playhead" aria-hidden="true" style="${moverStyle};z-index:3;transform:translate3d(${(playheadX / 10).toFixed(3)}%,0,0)">`
        + `<span style="position:absolute;left:-1px;top:2px;width:2px;height:38px;background:#fb7185"></span></span>`;
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
    const passageKey = view.passages?.length
        ? '<span><i class="editor-composite-map-passage-auto" aria-hidden="true"></i>Automatic passage</span>'
            + (view.passages.some(passage => passage.state === 'review')
                ? '<span><i class="editor-composite-map-review" aria-hidden="true"></i>Passage to review</span>' : '')
            + (view.passages.some(passage => ['accepted', 'accepted-partial'].includes(passage.state))
                ? '<span><i class="editor-composite-map-resolved" aria-hidden="true"></i>Accepted passage</span>' : '')
            + (view.passages.some(passage => ['left-out', 'declined'].includes(passage.state))
                ? '<span><i class="editor-composite-map-passage-out" aria-hidden="true"></i>Left-out passage</span>' : '')
        : '';
    return `<span><i class="editor-composite-map-base" aria-hidden="true"></i>Hybrid notes</span>`
        + (view.hasFillAdditions
            ? `<span><i class="editor-composite-map-fill" aria-hidden="true"></i>Added from ${_editorEscHtml(view.names.secondary)}</span>` : '')
        + decisionKey + passageKey;
}

function renderCompositeTimelineWorkspace(view, wholeSong = false, reviewToolbar = '') {
    const zoom = hybridPreviewPreferences.timelineZoom;
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
                + `<button type="button" data-composite-lane-resize="${lane.id}" role="separator" aria-orientation="horizontal" aria-label="Resize ${_editorEscHtml(lane.label)} track" title="Drag to resize this track; double-click to reset" class="absolute bottom-0 left-0 z-30 h-2 w-full select-none border-0 bg-transparent" style="cursor:row-resize;touch-action:none;user-select:none"></button></div>`;
        }).join('');
        return `<div data-composite-timeline-camera data-composite-timeline-camera-slot="${slotIndex}" class="absolute top-0" style="left:0;width:1px;will-change:transform,opacity;contain:layout paint style;opacity:${slotIndex ? 0 : 1};pointer-events:${slotIndex ? 'none' : 'auto'}">`
            + `<div class="relative border-b border-slate-600" data-composite-timeline-ruler style="height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px;width:1px;min-width:100%">`
            + `<svg data-composite-timeline-ruler-svg width="1" height="${COMPOSITE_TIMELINE_RULER_HEIGHT}" role="img" aria-label="Bar and beat ruler; click to seek" style="position:absolute;inset:0;display:block;width:1px;height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px;max-width:none;cursor:pointer;contain:paint"></svg>`
            + `</div>${rows}</div>`;
    };
    const fixedHeaders = `<div data-composite-timeline-fixed-headers class="sticky left-0 top-0 z-50" style="width:${COMPOSITE_TIMELINE_GUTTER}px">`
        + `<div class="relative flex items-center border-b border-r border-slate-600 bg-gray-900 px-3 text-xs font-semibold text-gray-300 shadow-lg" style="width:${COMPOSITE_TIMELINE_GUTTER}px;height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px">Bars and beats</div>`
        + view.lanes.map(lane => renderCompositeTimelineLaneHeader(
            view, lane.id, laneHeights.get(lane.id), { fixed: true })).join('')
        + '</div>';
    const timelineHeight = COMPOSITE_TIMELINE_RULER_HEIGHT
        + [...laneHeights.values()].reduce((sum, height) => sum + height, 0);
    const followPressed = hybridPreviewPreferences.followPlayhead;
    const title = view.review ? `Decision ${view.review.index + 1}`
        : view.inspectedPassage ? `Inspect ${view.inspectedPassage.label}` : 'Tracks';
    const description = view.review
        ? 'The full song remains available while the highlighted decision stays in focus.'
        : view.inspectedPassage
            ? 'The full song remains scrollable while playback loops this passage and its handoffs.'
            : 'All three tracks stay aligned while you scroll, zoom, and resize them.';
    const manualChip = view.manualSelectionActive && !reviewToolbar
        ? `<span class="rounded-full border border-amber-600/60 bg-amber-950/50 px-2 py-1 text-[11px] text-amber-100" role="status" title="Select notes in the aligned tracks; white outlines show notes included in the hybrid">Manual mix · outlined notes are included</span>` : '';
    return `<div class="sticky top-0 z-50 -mx-1 mb-2 rounded-lg border border-slate-700 bg-slate-950/95 p-1.5 shadow-xl backdrop-blur-sm">`
        + renderPreviewControls(view, wholeSong)
        + reviewToolbar
        + `<div class="flex flex-wrap items-center gap-2" title="${_editorEscHtml(description)}"><b class="mr-auto text-sm text-gray-100">${_editorEscHtml(title)}</b>${manualChip}`
        + _compositeTimelineZoomControlsPure(zoom)
        + `<button type="button" id="editor-composite-time-follow" aria-pressed="${followPressed}" class="rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs${followPressed ? ' ring-2 ring-sky-400' : ''}" title="Keep the playhead visible during playback. Turn Follow off to browse elsewhere while the song keeps playing.">${followPressed ? 'Follow' : 'Follow off'}</button>`
        + (view.review ? `<button type="button" id="editor-composite-focus-review" class="rounded border border-amber-600/70 bg-amber-950/50 px-2.5 py-1.5 text-xs text-amber-100">Focus decision</button>` : '')
        + `<details class="relative"><summary class="cursor-pointer rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs">More</summary><div class="absolute right-0 z-50 mt-1 flex min-w-44 flex-col gap-1 rounded border border-gray-600 bg-dark-800 p-2 shadow-xl">`
        + `<button type="button" id="editor-composite-time-fit" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Overview entire song</button>`
        + `<button type="button" id="editor-composite-lanes-equal" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Make tracks equal</button>`
        + `<button type="button" id="editor-composite-lanes-reset" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Reset track sizes</button>`
        + `<p class="mt-1 border-t border-gray-700 pt-1 text-[11px] text-gray-500">Ruler: seek · Ctrl+wheel: zoom · drag lane edge: resize · Space: play/stop · 1–4: sound</p></div></details></div></div>`
        + `<section class="rounded-xl border border-slate-700 bg-slate-950/60 p-2">`
        + `<div data-composite-map-key class="editor-composite-map-key">${compositeTimelineMapKeyMarkup(view)}</div>`
        + `<button type="button" id="editor-composite-timeline-map" class="relative mb-1.5 block w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950 p-0 text-left" style="touch-action:none" title="Click or drag to move through the song" aria-label="Navigate the whole song">${renderCompositeTimelineMapSvg(view, viewport)}${renderCompositeTimelineMapOverlays(view, viewport)}</button>`
        + `<div id="editor-composite-timeline-scroller" class="relative overflow-x-auto overflow-y-hidden rounded-lg border border-slate-700 bg-slate-950" style="contain:layout paint style" tabindex="0" aria-label="Scrollable full-song Hybrid timeline; Control plus mouse wheel changes time zoom">`
        + `<div id="editor-composite-timeline-content" class="relative" style="width:${width}px;min-width:100%;height:${timelineHeight}px">`
        + cameraShell(0) + cameraShell(1)
        + fixedHeaders
        + renderCompositeTimelinePlayhead(initialPlayheadX)
        + `</div></div></section>`;
}

function cancelCompositeTimelineStandbyWork(dom = timelineViewportDom) {
    timelineRenderGeneration += 1;
    if (timelineStandbyCancel) timelineStandbyCancel();
    timelineStandbyCancel = null;
    if (timelineStandbySwapFrame) cancelAnimationFrame(timelineStandbySwapFrame);
    timelineStandbySwapFrame = 0;
    if (dom) dom.standbyPending = false;
}

function scheduleCompositeTimelineIdle(callback, timeoutMs = 0) {
    if (typeof globalThis.requestIdleCallback === 'function') {
        // Do not use a timeout here. A timed-out idle callback is allowed to
        // run with no frame budget, which previously forced a dense lane into
        // the middle of playback every 50 ms.
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

function compositeTimelineRenderSignature(dom, zoom = hybridPreviewPreferences.timelineZoom) {
    const laneHeights = (dom?.view?.lanes || []).map(lane =>
        compositeTimelineLaneHeightPure(hybridPreviewPreferences.laneHeights[lane.id]));
    return [Number(zoom).toFixed(4), Math.round(Number(dom?.viewportWidth) || 0),
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

function compositeTimelineCameraRenderPlan(dom, slot, geometry, zoom) {
    const view = dom.view;
    const visible = geometry.renderRange;
    const renderOptions = {
        renderOriginX: geometry.renderOriginX,
        surfaceWidth: geometry.surfaceWidth,
    };
    let timelineHeight = COMPOSITE_TIMELINE_RULER_HEIGHT;
    const steps = [() => {
        slot.camera.style.left = `${geometry.renderOriginX}px`;
        slot.camera.style.width = `${geometry.surfaceWidth}px`;
        slot.camera.dataset.compositeRenderOriginX = String(geometry.renderOriginX);
        if (slot.ruler) slot.ruler.style.width = `${geometry.surfaceWidth}px`;
        if (slot.rulerSvg) {
            slot.rulerSvg.setAttribute('width', String(geometry.surfaceWidth));
            slot.rulerSvg.style.width = `${geometry.surfaceWidth}px`;
            slot.rulerSvg.innerHTML = renderCompositeTimelineRulerContents(
                view, visible, zoom, renderOptions);
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
                laneDom.svg.setAttribute('width', String(geometry.surfaceWidth));
                laneDom.svg.setAttribute('height', String(height));
                laneDom.svg.style.width = `${geometry.surfaceWidth}px`;
                laneDom.svg.style.height = `${height}px`;
                laneDom.svg.innerHTML = renderCompositeTimelineLaneContents(
                    view, lane.id, height, visible, zoom, renderOptions);
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
    }
    (target || dom.scroller)?.focus?.({ preventScroll: true });
}

function refreshCompositeTimelineZoomControls(dom) {
    const zoom = hybridPreviewPreferences.timelineZoom;
    if (dom?.zoomOutput) dom.zoomOutput.textContent = `${Math.round(zoom)} px/beat`;
    if (dom?.zoomSlider) {
        dom.zoomSlider.value = String(compositeTimelineSteppedZoomPure(zoom));
        dom.zoomSlider.setAttribute('aria-valuetext', `${Math.round(zoom)} pixels per beat`);
    }
    const preset = dom?.zoomPreset;
    if (!preset) return;
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

function stopCompositeTimelineUi() {
    timelineReviewRefreshGeneration += 1;
    cancelCompositeTimelineStandbyWork();
    if (timelineViewportFrame) cancelAnimationFrame(timelineViewportFrame);
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    if (timelineZoomFrame) cancelAnimationFrame(timelineZoomFrame);
    if (timelineBindFrame) cancelAnimationFrame(timelineBindFrame);
    if (timelineReviewRefreshFrame) cancelAnimationFrame(timelineReviewRefreshFrame);
    for (const cleanup of timelineViewportDom?.cleanup || []) cleanup();
    timelineViewportFrame = 0;
    timelinePlayheadFrame = 0;
    timelineZoomFrame = 0;
    timelineBindFrame = 0;
    timelineReviewRefreshFrame = 0;
    timelinePendingZoom = null;
    timelineProgrammaticScrollTarget = null;
    timelineResizeObserver?.disconnect();
    timelineResizeObserver = null;
    timelineViewportDom = null;
}

function timelineActualViewportRange(view, scroller, scrollLeft = undefined,
    viewportWidth = scroller?.clientWidth || 1200) {
    return compositeTimelineViewportRangePure({
        context: view.context,
        zoom: hybridPreviewPreferences.timelineZoom,
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
    const zoom = hybridPreviewPreferences.timelineZoom;
    const width = compositeTimelineContentWidthPure(view.context, zoom);
    const viewportWidth = Math.max(1, scroller.clientWidth || 1);
    dom.viewportWidth = viewportWidth;
    dom.contentWidth = width;
    dom.maxScroll = Math.max(0, width - viewportWidth);
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

function scheduleCompositeTimelineStandby(dom, rawVisualScroll, options = {}) {
    if (!dom?.view || !dom.scroller || (dom.cameraSlots?.length || 0) < 2) return;
    const retainedOptions = dom.reviewRefreshOptions || {};
    const freshnessDeadlineAt = Math.max(0, Number(
        options.freshnessDeadlineAt ?? retainedOptions.freshnessDeadlineAt) || 0);
    const onCommitted = options.onCommitted || retainedOptions.onCommitted || null;
    const beforeCommit = options.beforeCommit || retainedOptions.beforeCommit || null;
    const zoom = hybridPreviewPreferences.timelineZoom;
    const visualScroll = clampCompositeTimelineScroll(dom, rawVisualScroll);
    const standbyIndex = dom.activeCameraIndex === 0 ? 1 : 0;
    const standby = dom.cameraSlots[standbyIndex];
    if (!standby) return;
    if (dom.standbyPending) {
        const currentViewport = timelineActualViewportRange(
            dom.view, dom.scroller, visualScroll, dom.viewportWidth);
        const pendingStillUseful = standby.pendingSignature
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
        if (dom === timelineViewportDom) dom.standbyPending = false;
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
        const viewportRange = timelineActualViewportRange(
            dom.view, dom.scroller, currentVisual, dom.viewportWidth);
        const stale = standby.renderSignature !== compositeTimelineRenderSignature(dom)
            || compositeTimelineRenderWindowNeedsRefreshPure({
                context: dom.view.context,
                zoom: hybridPreviewPreferences.timelineZoom,
                renderedZoom: standby.renderedZoom,
                renderedRange: standby.renderedRange,
                viewportRange,
                guardPx: 0,
            });
        return stale ? null : { currentVisual };
    };
    const rescheduleLatest = () => {
        const currentVisual = compositeTimelineVisualScrollLeft(dom);
        abandon();
        if (dom === timelineViewportDom) {
            scheduleCompositeTimelineStandby(dom, currentVisual, {
                freshnessDeadlineAt,
                onCommitted,
                beforeCommit,
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
            // Ordinary scroll/render-ahead work remains purely idle. A review
            // choice gets a bounded paused-transport escape hatch so the
            // visible lanes cannot disagree with the chosen/audio result
            // indefinitely under continuous pointer movement.
            const freshnessDue = freshnessDeadlineAt && currentTime >= freshnessDeadlineAt
                && !S.playing;
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
                    dom.nativeScrollLeft, warmState.currentVisual);
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
                    const previous = dom.cameraSlots[dom.activeCameraIndex];
                    const focusKey = compositeTimelineFocusedControl(previous.camera);
                    standby.camera.style.transform = `translate3d(${compositeTimelineCameraOffsetPure(
                        dom.nativeScrollLeft, swapState.currentVisual)}px,0,0)`;
                    setCompositeTimelineCameraSlotActive(standby, true);
                    activateCompositeTimelineCameraSlot(dom, standbyIndex);
                    restoreCompositeTimelineFocus(dom, standby, focusKey);
                    // Move keyboard focus before making the old subtree inert;
                    // Chromium otherwise rejects aria-hidden on its active node.
                    setCompositeTimelineCameraSlotActive(previous, false);
                    previous.ready = false;
                    dom.standbyPending = false;
                    standby.pendingSignature = '';
                    standby.pendingRange = null;
                    updateCompositeTimelineFixedLaneHeights(dom);
                    applyCompositeTimelineCamera(dom, swapState.currentVisual);
                    onCommitted?.();
                });
            });
        }, timeout);
    };
    queueStep();
}

function scheduleCompositeTimelineRenderAhead(dom, visualScroll) {
    const scroller = dom?.scroller;
    if (!dom?.view || !scroller) return;
    const viewportRange = timelineActualViewportRange(
        dom.view, scroller, visualScroll, dom.viewportWidth);
    const activeStillCoversViewport = !compositeTimelineRenderWindowNeedsRefreshPure({
        context: dom.view.context,
        zoom: hybridPreviewPreferences.timelineZoom,
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
        zoom: hybridPreviewPreferences.timelineZoom,
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
    const visualScroll = clampCompositeTimelineScroll(dom, rawVisualScroll);
    const cameraOffset = compositeTimelineCameraOffsetPure(
        dom.nativeScrollLeft, visualScroll);
    const layerTransform = `translate3d(${cameraOffset}px,0,0)`;
    if (dom.camera) dom.camera.style.transform = layerTransform;
    const playheadX = rawPlayheadX == null ? Number.NaN : Number(rawPlayheadX);
    if (Number.isFinite(playheadX)) dom.playheadX = playheadX;
    if (dom.playhead && dom.playheadX != null && Number.isFinite(Number(dom.playheadX))) {
        dom.playhead.style.transform = `translate3d(${Number(dom.playheadX) + cameraOffset}px,0,0)`;
    }
    dom.visualScrollLeft = visualScroll;
    if (dom.cameraSlots?.[dom.activeCameraIndex]?.ready) {
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
    hybridSession.timelineScrollLeft = visualScroll;
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
    const time = Math.max(0, Number(rawTime) || 0);
    const view = currentTimelineView();
    const dom = timelineViewportDom;
    const scroller = dom?.scroller
        || byId('editor-composite-timeline-scroller');
    hybridSession.timelineSeekTime = time;
    host.editorSeekToTime(time);
    if (center && view && scroller && hybridSession.plan) {
        const beat = beatOf(hybridSession.plan.beats, time);
        const nextScroll = clampTimelineScroll(scroller,
            compositeTimelineCenteredScrollPure({
                beat,
                context: view.context,
                zoom: hybridPreviewPreferences.timelineZoom,
                viewportWidth: scroller.clientWidth,
            }));
        if (dom) setCompositeTimelineNativeCamera(dom, nextScroll, false);
        else hybridSession.timelineScrollLeft = nextScroll;
    } else if (dom) {
        applyCompositeTimelineCamera(dom, compositeTimelineVisualScrollLeft(dom));
    }
    scheduleCompositeTimelineViewport();
    refreshCompositeTimelinePlayheadNow();
    return time;
}

function applyCompositeTimelineZoom(nextZoom, anchorX = null, forceStart = false,
    flushPreference = false) {
    const view = currentTimelineView();
    const scroller = byId('editor-composite-timeline-scroller');
    const content = byId('editor-composite-timeline-content');
    if (!view || !scroller || !content) return;
    const dom = timelineViewportDom;
    const currentScroll = dom ? compositeTimelineVisualScrollLeft(dom) : scroller.scrollLeft;
    const anchor = Number.isFinite(Number(anchorX)) ? Number(anchorX) : scroller.clientWidth / 2;
    const normalizedZoom = compositeTimelineZoomPure(nextZoom);
    const followsLivePlayback = hybridSession.previewPlaying && S.playing
        && hybridPreviewPreferences.followPlayhead && hybridSession.plan;
    const next = forceStart
        ? { zoom: normalizedZoom, scrollLeft: 0 }
        : followsLivePlayback
            ? {
                zoom: normalizedZoom,
                scrollLeft: compositeTimelineCenteredScrollPure({
                    beat: beatOf(hybridSession.plan.beats, editorPlaybackVisualTime()),
                    context: view.context,
                    zoom: normalizedZoom,
                    viewportWidth: scroller.clientWidth,
                }),
            }
        : compositeTimelineZoomAtPure({
            context: view.context,
            oldZoom: hybridPreviewPreferences.timelineZoom,
            newZoom: nextZoom,
            scrollLeft: currentScroll,
            anchorX: anchor,
            viewportWidth: scroller.clientWidth,
        });
    setHybridPreviewPreferences({
        ...hybridPreviewPreferences, timelineZoom: next.zoom,
    }, { deferred: true });
    if (flushPreference) flushHybridPreviewPreferences();
    const nextContentWidth = compositeTimelineContentWidthPure(view.context, next.zoom);
    content.style.width = `${nextContentWidth}px`;
    if (dom) {
        dom.contentWidth = nextContentWidth;
        dom.maxScroll = Math.max(0, nextContentWidth - dom.viewportWidth);
    }
    if (dom) setCompositeTimelineNativeCamera(dom, Math.max(0, next.scrollLeft), false);
    else {
        timelineProgrammaticScrollTarget = Math.max(0, next.scrollLeft);
        scroller.scrollLeft = Math.max(0, next.scrollLeft);
    }
    refreshCompositeTimelineViewport(true);
}

function pendingCompositeTimelineZoom() {
    return timelinePendingZoom?.zoom ?? hybridPreviewPreferences.timelineZoom;
}

// Slider and wheel input can fire much faster than the display. Keep the most
// recent request and rebuild the three aligned lanes at most once per frame.
function scheduleCompositeTimelineZoom(zoom, anchorX = null, forceStart = false,
    flushPreference = false) {
    timelinePendingZoom = { zoom, anchorX, forceStart, flushPreference };
    if (timelineZoomFrame) return;
    timelineZoomFrame = requestAnimationFrame(() => {
        timelineZoomFrame = 0;
        const pending = timelinePendingZoom;
        timelinePendingZoom = null;
        if (pending) applyCompositeTimelineZoom(
            pending.zoom, pending.anchorX, pending.forceStart, pending.flushPreference);
    });
}

function updateCompositeTimelineMapFrame(dom, beat, visualScroll, _frameTime = 0, force = false) {
    if (!dom?.view || !dom.scroller) return;
    const span = Math.max(1, dom.view.context.endBeat - dom.view.context.startBeat);
    const mapX = Math.max(0, Math.min(1000,
        ((beat - dom.view.context.startBeat) / span) * 1000));
    if (dom.mapPlayhead) {
        dom.mapPlayhead.style.transform = `translate3d(${(mapX / 10).toFixed(3)}%,0,0)`;
    }
    // The red marker is a single compositor transform and follows every
    // display frame. Recalculate the blue viewport only when its camera moved.
    if (force || !Number.isFinite(Number(dom.mapViewportVisualScroll))
            || Math.abs(Number(dom.mapViewportVisualScroll) - visualScroll) >= 0.25) {
        updateCompositeTimelineMapViewport(
            dom, dom.view, dom.scroller, visualScroll, dom.viewportWidth);
    }
}

function updateCompositeTimelinePlayhead(frameTime = 0) {
    timelinePlayheadFrame = 0;
    if (!_compositeTimelineStageActivePure(hybridSession.stage)) return;
    const dom = timelineViewportDom;
    const view = dom?.view;
    const scroller = dom?.scroller;
    const playhead = dom?.playhead;
    if (!view || !scroller || !playhead) return;
    const activelyPlaying = hybridSession.previewPlaying && S.playing;
    const playbackSettled = hybridSession.previewPlaying && !S.playing;
    if (playbackSettled && Number.isFinite(Number(S.cursorTime))) {
        // Natural completion resets the Editor transport to zero. Adopt that
        // exact stopped position before the Hybrid animation loop ends.
        hybridSession.timelineSeekTime = Math.max(0, Number(S.cursorTime));
    }
    const time = activelyPlaying
        ? editorPlaybackVisualTime() : hybridSession.timelineSeekTime;
    const beat = compositeTimelineDisplayBeatAtTime(view, time);
    const frame = compositeTimelineCameraFramePure({
        beat,
        context: view.context,
        zoom: hybridPreviewPreferences.timelineZoom,
        viewportWidth: dom.viewportWidth,
        visualScrollLeft: compositeTimelineVisualScrollLeft(dom),
        // A naturally completed preview adopts the Editor's stopped cursor
        // (normally zero). Give that one settling frame the same Follow
        // behavior so a long-song camera and overview box return with it.
        follow: (activelyPlaying || playbackSettled)
            && hybridPreviewPreferences.followPlayhead,
    });
    const visualScroll = frame.visualScrollLeft;
    if (activelyPlaying) {
        hybridSession.timelineSeekTime = Math.max(0, time);
        hybridSession.timelineScrollLeft = visualScroll;
        applyCompositeTimelineCamera(dom, visualScroll, frame.contentX);
        updateCompositeTimelineMapFrame(dom, beat, visualScroll, frameTime);
        timelinePlayheadFrame = requestAnimationFrame(updateCompositeTimelinePlayhead);
    } else if (playbackSettled) {
        applyCompositeTimelineCamera(dom, visualScroll, frame.contentX);
        updateCompositeTimelineMapFrame(dom, beat, visualScroll, frameTime, true);
        syncCompositeTimelineNativeCamera(dom);
        hybridSession.previewPlaying = false;
        updateCompositePreviewButtons();
    } else {
        applyCompositeTimelineCamera(dom, visualScroll, frame.contentX);
        updateCompositeTimelineMapFrame(dom, beat, visualScroll, frameTime, true);
    }
}

function startCompositeTimelinePlayhead() {
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelinePlayheadFrame = requestAnimationFrame(updateCompositeTimelinePlayhead);
}

function refreshCompositeTimelinePlayheadNow() {
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelinePlayheadFrame = 0;
    updateCompositeTimelinePlayhead();
}

function prepareCurrentReviewFocus(seek = false) {
    if (hybridSession.stage !== 'review') return;
    const view = currentConflictView();
    if (!view) return;
    hybridSession.timelineFocusReview = true;
    if (seek) {
        const time = Math.max(0, timeOf(hybridSession.plan.beats, view.context.startBeat));
        rememberCompositePreviewSession();
        seekCompositeTimelineAtTime(time);
    }
}

function centerCurrentReviewInTimeline(view, scroller) {
    if (!view?.review || !scroller) return;
    const beat = (view.review.startBeat + view.review.endBeat) / 2;
    const nextScroll = clampTimelineScroll(scroller,
        compositeTimelineCenteredScrollPure({
            beat, context: view.context,
            zoom: hybridPreviewPreferences.timelineZoom,
            viewportWidth: scroller.clientWidth,
        }));
    if (timelineViewportDom) setCompositeTimelineNativeCamera(
        timelineViewportDom, nextScroll, false);
    else hybridSession.timelineScrollLeft = nextScroll;
    hybridSession.timelineFocusReview = false;
    refreshCompositeTimelineViewport();
}

function refreshCompositeTimelineFollowButton() {
    const follow = byId('editor-composite-time-follow');
    if (!follow) return;
    const pressed = hybridPreviewPreferences.followPlayhead;
    follow.setAttribute('aria-pressed', String(pressed));
    follow.classList.toggle('ring-2', pressed);
    follow.classList.toggle('ring-sky-400', pressed);
    follow.textContent = pressed ? 'Follow' : 'Follow off';
}

function bindCompositeTimelineEvents() {
    const view = currentTimelineView();
    const scroller = byId('editor-composite-timeline-scroller');
    if (!view || !scroller) return;
    const content = byId('editor-composite-timeline-content');
    const map = byId('editor-composite-timeline-map');
    const viewportWidth = Math.max(1, scroller.clientWidth || 1);
    const contentWidth = compositeTimelineContentWidthPure(
        view.context, hybridPreviewPreferences.timelineZoom);
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
        mapViewport: map?.querySelector('#editor-composite-map-viewport'),
        mapViewportWindow: map?.querySelector('[data-composite-map-viewport-window]'),
        mapPlayhead: map?.querySelector('#editor-composite-map-playhead'),
        playhead: content?.querySelector('#editor-composite-timeline-playhead'),
        zoomOutput: byId('editor-composite-time-zoom-value'),
        zoomSlider: byId('editor-composite-time-zoom'),
        zoomPreset: byId('editor-composite-time-preset'),
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
        playheadX: compositeTimelineXForBeatPure(
            compositeTimelineDisplayBeatAtTime(view, hybridSession.timelineSeekTime),
            view.context, hybridPreviewPreferences.timelineZoom),
        mapViewportWidth: '',
        mapViewportVisualScroll: Number.NaN,
        standbyPending: false,
        cleanup: new Set(),
    };
    for (const [index, slot] of cameraSlots.entries()) {
        setCompositeTimelineCameraSlotActive(slot, index === 0);
    }
    if (primarySlot) {
        primarySlot.renderSignature = compositeTimelineRenderSignature(
            timelineViewportDom, hybridPreviewPreferences.timelineZoom);
    }
    activateCompositeTimelineCameraSlot(timelineViewportDom, 0);
    const boundDom = timelineViewportDom;
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
            const previousNative = Number.isFinite(Number(dom.nativeScrollLeft))
                ? Number(dom.nativeScrollLeft) : scroller.scrollLeft;
            const visualScroll = clampTimelineScroll(scroller,
                compositeTimelineVisualScrollLeft(dom) + scroller.scrollLeft - previousNative);
            dom.nativeScrollLeft = scroller.scrollLeft;
            hybridSession.timelineScrollLeft = visualScroll;
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
                hybridPreviewPreferences.timelineZoom)));
        const time = Math.max(0, timeOf(hybridSession.plan.beats, beat));
        rememberCompositePreviewSession();
        seekCompositeTimelineAtTime(time);
    };
    for (const slot of cameraSlots) {
        slot.rulerSvg?.addEventListener('click', event => seekFromRuler(event, slot));
    }
    for (const button of document.querySelectorAll('[data-composite-time-zoom]')) {
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
    byId('editor-composite-time-fit')?.addEventListener('click', () => {
        scheduleCompositeTimelineZoom(compositeTimelineFitZoomPure(
            boundDom.view.context, scroller.clientWidth), 0, true, true);
    });
    byId('editor-composite-time-follow')?.addEventListener('click', () => {
        setHybridPreviewPreferences({
            ...hybridPreviewPreferences,
            followPlayhead: !hybridPreviewPreferences.followPlayhead,
        });
        refreshCompositeTimelineFollowButton();
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
                zoom: hybridPreviewPreferences.timelineZoom,
                viewportWidth: scroller.clientWidth,
            }));
        return { beat, time, scrollLeft };
    };
    const previewMapLocation = location => {
        hybridSession.timelineSeekTime = location.time;
        hybridSession.timelineScrollLeft = location.scrollLeft;
        const contentX = compositeTimelineXForBeatPure(
            location.beat, boundDom.view.context, hybridPreviewPreferences.timelineZoom);
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
        const passage = event.target.closest?.('[data-composite-map-passage]');
        const decision = event.target.closest?.('[data-composite-map-decision]');
        const surface = map.querySelector('svg') || map;
        const resumeMode = hybridSession.previewMode;
        const resumePlaying = hybridSession.previewPlaying && S.playing;
        const gestureStartTime = hybridSession.timelineSeekTime;
        rememberCompositePreviewSession();
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
            passageId: passage?.dataset.compositeMapPassage || '',
            decisionIndex: decision ? Number(decision.dataset.compositeMapDecision) : -1,
            rect: surface.getBoundingClientRect(),
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
        if (Math.hypot(event.clientX - mapPointerGesture.startX,
            event.clientY - mapPointerGesture.startY) > 4) mapPointerGesture.moved = true;
        queueMapPreview(event.clientX);
    });
    map?.addEventListener('pointerup', event => {
        if (timelineViewportDom !== boundDom) return;
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId) return;
        const gesture = mapPointerGesture;
        const location = flushMapPreview(event.clientX);
        mapPointerGesture = null;
        map.releasePointerCapture?.(event.pointerId);
        const opensPassage = !gesture.moved && gesture.passageId
            && hybridSession.stage === 'final-preview';
        const opensDecision = !gesture.moved
            && Number.isInteger(gesture.decisionIndex) && gesture.decisionIndex >= 0
            && hybridSession.stage === 'review'
            && hybridSession.plan.conflicts[gesture.decisionIndex];
        if (gesture.resumePlaying && gesture.resumeMode
                && !opensPassage && !opensDecision) {
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
        if (opensPassage) {
            hybridSession.inspectedPassageId = gesture.passageId;
            hybridSession.timelineFocusPassage = false;
            hybridSession.timelineSeekTime = location.time;
            hybridSession.timelineScrollLeft = location.scrollLeft;
            renderResult();
            return;
        }
        if (opensDecision) {
            hybridSession.conflictIndex = gesture.decisionIndex;
            prepareCurrentReviewFocus(false);
            hybridSession.timelineFocusReview = false;
            hybridSession.timelineSeekTime = location.time;
            hybridSession.timelineScrollLeft = location.scrollLeft;
            renderResult();
            return;
        }
        resumeMapPreview(gesture);
    });
    const clearMapGesture = event => {
        if (timelineViewportDom !== boundDom) return;
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId) return;
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
                        zoom: hybridPreviewPreferences.timelineZoom,
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
    const applyLaneHeights = laneHeights => {
        setHybridPreviewPreferences({
            ...hybridPreviewPreferences, laneHeights,
        });
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
    const previewCompositeLaneHeight = (laneId, height) => {
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
            refreshCompositeTimelineViewport(true);
        };
        grip.addEventListener('dblclick', event => { event.preventDefault(); reset(); });
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
                    laneId, hybridPreviewPreferences.laneHeights[laneId]);
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
                if (commit) applyLatestHeight();
                finished = true;
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', cancel);
                window.removeEventListener('blur', cancel);
                boundDom.cleanup.delete(cleanup);
                if (!commit || timelineViewportDom !== boundDom) return;
                flushHybridPreviewPreferences();
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
            if (timelineViewportDom === boundDom) scheduleCompositeTimelineViewport();
        });
        timelineResizeObserver.observe(scroller);
    }
    timelineBindFrame = requestAnimationFrame(() => {
        timelineBindFrame = 0;
        if (timelineViewportDom !== boundDom) return;
        const liveView = boundDom.view;
        if (liveView.review && hybridSession.timelineFocusReview) {
            centerCurrentReviewInTimeline(liveView, scroller);
        } else if (liveView.passageFocus && hybridSession.timelineFocusPassage) {
            const beat = (liveView.passageFocus.startBeat
                + liveView.passageFocus.endBeat) / 2;
            const nextScroll = clampTimelineScroll(scroller,
                compositeTimelineCenteredScrollPure({
                    beat, context: liveView.context,
                    zoom: hybridPreviewPreferences.timelineZoom,
                    viewportWidth: scroller.clientWidth,
                }));
            setCompositeTimelineNativeCamera(timelineViewportDom, nextScroll, false);
            hybridSession.timelineFocusPassage = false;
        } else {
            const nextScroll = clampTimelineScroll(scroller,
                hybridSession.timelineScrollLeft);
            setCompositeTimelineNativeCamera(timelineViewportDom, nextScroll, false);
        }
        refreshCompositeTimelineViewport(true);
        refreshCompositeTimelinePlayheadNow();
    });
}

function renderFinalPreviewResult(plan, names, normalizationDetails, repeatNoticeMarkup) {
    const view = wholePlanPreviewView();
    const guided = plan.strategy === 'guided';
    const stats = plan.stats || {};
    const summary = guided ? {
        title: 'Review complete ✓',
        description: `${stats.reviewDecisions || 0} ${(stats.reviewDecisions || 0) === 1 ? 'choice' : 'choices'} complete · inspect or listen before creating`,
    } : plan.strategy === 'experimental'
        ? _compositeExperimentalSummaryPure({
            ...stats,
            secondaryAcceptedAfterReview: plan.reviewOutcome?.acceptedNotes,
            secondaryLeftOutAfterReview: plan.reviewOutcome?.leftOutNotes,
        }, names)
        : _compositeAutomaticSummaryPure(stats, names);
    const backReview = plan.conflicts.length
        ? `<button type="button" id="editor-composite-back-review" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">← Back to review choices</button>` : '';
    return `<section class="mx-auto max-w-none">`
        + `<div class="mb-2 rounded-lg border border-emerald-700/50 bg-emerald-950/20 px-3 py-2">`
        + `<div class="flex flex-wrap items-center justify-between gap-2"><div class="flex flex-wrap items-baseline gap-x-2"><b class="text-sm text-emerald-100">${_editorEscHtml(summary.title)}</b>`
        + `<p class="text-xs text-gray-300">${_editorEscHtml(summary.description)}</p></div><div class="flex flex-wrap gap-2">${backReview}`
        + `<button type="button" id="editor-composite-edit-settings" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">Back and adjust</button></div></div></div>`
        + experimentalToolsMarkup(plan)
        + renderCompositeTimelineWorkspace(view, view.wholeSong)
        + normalizationDetails + repeatNoticeMarkup
        + `</section>`;
}

function refreshCompositePlanDerivedState(plan, { includePlayability = true } = {}) {
    if (plan.strategy === 'experimental' && includePlayability) {
        refreshExperimentalPlayability(plan);
        plan.comparisonReport = experimentalComparisonReport(plan);
    }
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
        audioAvailable: !!S.audioBuffer,
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
    const previousSvg = map.querySelector('svg');
    const replacementSvg = elementFromCompositeMarkup(
        renderCompositeTimelineMapSvg(view, viewport));
    if (previousSvg && replacementSvg) previousSvg.replaceWith(replacementSvg);
    const key = map.parentElement?.querySelector('[data-composite-map-key]');
    if (key) key.innerHTML = compositeTimelineMapKeyMarkup(view);
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
            const plan = hybridSession.plan;
            const dom = timelineViewportDom;
            const conflict = plan?.conflicts?.[hybridSession.conflictIndex];
            if (generation !== timelineReviewRefreshGeneration
                    || hybridSession.stage !== 'review' || !dom
                    || conflict?.id !== conflictId) return;
            // Resolution-dependent Experimental reports and full-song
            // playability are not needed to redraw the current decision. They
            // are refreshed when entering final preview/copying the report,
            // away from this post-input frame.
            refreshCompositePlanDerivedState(plan, { includePlayability: false });
            invalidateCompositeTimelineView();
            const presentation = currentCompositeReviewPresentation(plan);
            if (!presentation?.timelineView) return;
            dom.view = presentation.timelineView;
            dom.reviewRefreshPending = true;
            refreshCompositePreviewAvailability(presentation.timelineView);
            refreshCompositeTimelineHeaders(dom, presentation.timelineView);
            refreshCompositeTimelineStaticMap(dom, presentation.timelineView);
            // A Stop/seek issued by the choice may have queued render-ahead
            // against the previous model between paints. Invalidate it again
            // now that the new live view is installed.
            cancelCompositeTimelineStandbyWork(dom);
            const finishReviewRefresh = () => {
                if (timelineViewportDom !== dom) return;
                dom.reviewRefreshPending = false;
                dom.reviewRefreshOptions = null;
                updateCompositePreviewButtons();
                setCompositePreviewHelp('Tracks updated · choose a sound to preview.');
            };
            if ((dom.cameraSlots?.length || 0) > 1) {
                const reviewRefreshOptions = {
                    freshnessDeadlineAt: (globalThis.performance?.now?.() || Date.now()) + 240,
                    beforeCommit: () => compositePreviewEventsForMode('result'),
                    onCommitted: finishReviewRefresh,
                };
                dom.reviewRefreshOptions = reviewRefreshOptions;
                scheduleCompositeTimelineStandby(
                    dom, compositeTimelineVisualScrollLeft(dom), reviewRefreshOptions);
            } else {
                refreshCompositeTimelineViewport(true);
                compositePreviewEventsForMode('result');
                finishReviewRefresh();
            }
            refreshCompositeTimelinePlayheadNow();
        });
    });
}

// Resolution and manual-note changes keep the same review decision in place.
// Retain its workspace, controls, scroll camera, and listeners; replace only
// the decision toolbar, then build updated lane SVGs in the hidden camera and
// atomically swap them during idle time.
function refreshCurrentCompositeReview() {
    const plan = hybridSession.plan;
    const previousToolbar = byId('editor-composite-result')
        ?.querySelector('.editor-composite-review-toolbar');
    const dom = timelineViewportDom;
    const conflict = plan?.conflicts?.[hybridSession.conflictIndex];
    if (hybridSession.stage !== 'review' || !plan || !conflict || !previousToolbar
            || !dom?.view?.review || dom.view.review.id !== conflict.id) {
        return false;
    }
    if (hybridSession.previewMode) endCompositePreviewPlayback();
    const snapshot = captureCompositeReviewUi(previousToolbar);
    refreshCompositePlanDerivedState(plan, { includePlayability: false });
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
    cancelCompositeTimelineStandbyWork(dom);
    restoreCompositeReviewUi(nextToolbar, snapshot);
    scheduleCompositeReviewTimelineRefresh(conflict.id);
    return true;
}

function renderResult() {
    invalidateCompositeTimelineView();
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
    return byId('editor-composite-experimental')?.checked
        ? 'Analyze experimental hybrid' : 'Preview automatic hybrid';
}

export function _compositeAnalysisConfigTokenPure(config) {
    return JSON.stringify(config || {});
}

export function _compositeTaskPhaseLabelPure(phase, config = {}) {
    if (phase === 'materialize') return 'Building the new Hybrid Track…';
    if (phase === 'analyze') {
        if (config.strategy === 'guided') return 'Finding sections to review…';
        if (config.experimentalEnabled) return 'Checking experimental fill…';
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
        analyze.disabled = !!analyzing || !_compositeSourcePairStatePure(
            S.arrangements,
            Number(byId('editor-composite-primary')?.value),
            Number(byId('editor-composite-secondary')?.value),
        ).ok;
        analyze.textContent = analyzing
            ? phase || 'Preparing tracks…' : compositeAnalyzeButtonLabel();
    }
    const resume = byId('editor-composite-return-review');
    if (resume) resume.disabled = !!analyzing;
}

async function confirmCompositeRebuild() {
    if (!hybridSession.plan || !hybridSession.hasReviewWork) return true;
    const choice = await _editorPromptChoice({
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
    if (!(await confirmCompositeRebuild())) return;
    restoreCompositePreviewSession();
    const config = compositeAnalysisConfigFromDialog();
    const { primaryIndex, secondaryIndex, strategy } = config;
    const experimentalEnabled = config.experimentalEnabled === true;
    const experimentalProfile = config.experimentalProfile || 'balanced';
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
        saveHybridExperimentalPreferences({
            enabled: experimentalEnabled,
            profile: experimentalProfile,
        });
    } else if (strategy === 'guided') {
        saveHybridGuidedPreferences({ repeatMode });
    }
    const error = byId('editor-composite-error');
    const pairState = _compositeSourcePairStatePure(
        S.arrangements, primaryIndex, secondaryIndex,
    );
    if (!pairState.ok) {
        if (error) error.textContent = pairState.message;
        return;
    }
    const sources = {
        primary: S.arrangements[primaryIndex],
        secondary: S.arrangements[secondaryIndex],
        beats: S.beats,
        sections: S.sections,
    };
    const modal = byId('editor-composite-modal');
    if (!modal) return;
    const sessionId = S.sessionId;
    const configToken = _compositeAnalysisConfigTokenPure(config);
    const request = beginHybridAnalysis(hybridSession, { sessionId, configToken });
    if (!request) return;
    const requestIsCurrent = () => {
        if (byId('editor-composite-modal') !== modal) return false;
        let currentConfigToken = '';
        try {
            currentConfigToken = _compositeAnalysisConfigTokenPure(
                compositeAnalysisConfigFromDialog(),
            );
        } catch (_) { /* a replaced setup is stale by definition */ }
        return hybridAnalysisIsCurrent(hybridSession, request, {
            sessionId: S.sessionId,
            configToken: currentConfigToken,
        });
    };
    const settleStaleRequest = () => {
        const ownedLifecycle = completeHybridAnalysis(hybridSession, request);
        if (!ownedLifecycle || byId('editor-composite-modal') !== modal) return;
        if (S.sessionId !== request.sessionId) {
            closeCompositeModalImmediately(modal, { restorePreview: false });
        } else {
            setCompositeAnalysisUi(false);
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
            experimentalEnabled,
            experimentalProfile,
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
                    && S.sessionId !== request.sessionId) {
                closeCompositeModalImmediately(modal, { restorePreview: false });
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
            notice.textContent = plan.sync?.blocked
                ? 'Experimental smart fill stopped because the source timing appears misaligned. Align the tracks in the main editor, then rebuild.'
                : 'These tracks cannot be combined. Check their instrument, tuning, string count and capo.';
        }
        return;
    }
    if (error) error.textContent = '';
    installHybridPlan(hybridSession, plan);
    hybridSession.analysisConfig = structuredClone(config);
    hybridSession.setupDirty = false;
    hybridSession.setupDirtyMessage = '';
    hybridSession.hasReviewWork = false;
    hybridSession.conflictIndex = 0;
    hybridSession.customDrafts.clear();
    hybridSession.stage = (strategy === 'guided' || experimentalEnabled) && plan.conflicts.length
        ? 'review' : 'final-preview';
    hybridSession.timelineSeekTime = 0;
    hybridSession.timelineScrollLeft = 0;
    hybridSession.timelineFocusReview = hybridSession.stage === 'review';
    hybridSession.timelineFocusPassage = false;
    hybridSession.inspectedPassageId = '';
    if (hybridSession.stage === 'review') prepareCurrentReviewFocus(true);
    editorWarmGuidePreview(arrKind(plan.primary), { gm: selectedHybridPreviewTone().gm });
    setCompositeReviewMode(true);
    renderResult();
    scheduleCompositePreviewEventPrewarm(plan);
}

function clearEditorSelection() {
    S.sel.clear();
    S.toneSel = null;
    S.anchorSel = null;
    S.handshapeSel = null;
    S.drumEditMode = false;
    S.partsViewMode = false;
    S.tempoMapMode = false;
    S.tabViewMode = false;
}

export class CreateCompositeArrangementCmd {
    constructor(arrangement) {
        this.arrangement = arrangement;
        this.previousArr = S.currentArr;
        this.insertIndex = -1;
        this.songScope = true;
    }

    exec() {
        const drumIndex = S.arrangements.findIndex(arr => arrKind(arr) === 'drums');
        this.insertIndex = drumIndex >= 0 ? drumIndex : S.arrangements.length;
        S.arrangements.splice(this.insertIndex, 0, this.arrangement);
        S.currentArr = this.insertIndex;
        clearEditorSelection();
        host.updateArrangementSelector();
        const selector = byId('editor-arrangement');
        if (selector) selector.value = String(S.currentArr);
        host.updateStatus();
        host.draw();
    }

    rollback() {
        const index = S.arrangements.indexOf(this.arrangement);
        if (index >= 0) S.arrangements.splice(index, 1);
        S.currentArr = Math.max(0, Math.min(this.previousArr, S.arrangements.length - 1));
        clearEditorSelection();
        host.updateArrangementSelector();
        const selector = byId('editor-arrangement');
        if (selector) selector.value = String(S.currentArr);
        host.updateStatus();
        host.draw();
    }
}

async function finishMerge() {
    const error = byId('editor-composite-error');
    const plan = hybridSession.plan;
    const modal = byId('editor-composite-modal');
    if (!plan || !modal) return;
    const unresolved = hybridSession.plan.conflicts.filter(c => !c.resolution);
    if (unresolved.length) {
        if (error) error.textContent = `Finish the ${unresolved.length} remaining ${unresolved.length === 1 ? 'choice' : 'choices'} first.`;
        return;
    }
    const name = String(byId('editor-composite-name')?.value || '').trim();
    if (!name) {
        if (error) error.textContent = 'Enter a name for the new Hybrid Track.';
        return;
    }
    const duplicateName = S.arrangements.some(arr => String(arr && arr.name || '').trim().toLowerCase() === name.toLowerCase());
    if (duplicateName) {
        if (error) error.textContent = 'Another track already uses that name.';
        return;
    }
    const request = beginHybridCreation(hybridSession, {
        sessionId: S.sessionId,
        plan,
    });
    if (!request) return;
    request.modal = modal;
    setCompositeCreationUi(true);
    if (error) error.textContent = 'Creating the new Hybrid Track…';
    const settleStaleCreation = () => {
        const ownedLifecycle = hybridSession.createRequestId === request.id;
        completeHybridCreation(hybridSession, request);
        if (!ownedLifecycle || byId('editor-composite-modal') !== modal) return;
        if (S.sessionId !== request.sessionId) {
            closeCompositeModalImmediately(modal, { restorePreview: false });
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
        if (!hybridCreationIsCurrent(hybridSession, request, {
            sessionId: S.sessionId,
            plan: hybridSession.plan,
        }) || byId('editor-composite-modal') !== modal) {
            settleStaleCreation();
            return;
        }
        arrangement = await runHybridMaterializationTask(plan, name, {
            signal: request.controller.signal,
            onProgress: phase => {
                if (!hybridCreationIsCurrent(hybridSession, request, {
                    sessionId: S.sessionId,
                    plan: hybridSession.plan,
                }) || byId('editor-composite-modal') !== modal) return;
                if (error) error.textContent = _compositeTaskPhaseLabelPure(phase);
            },
        });
        if (!hybridCreationIsCurrent(hybridSession, request, {
            sessionId: S.sessionId,
            plan: hybridSession.plan,
        }) || byId('editor-composite-modal') !== modal) {
            settleStaleCreation();
            return;
        }
        const response = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: request.sessionId, arrangement }),
            signal: request.controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);

        // If the user is currently deciding whether to cancel this request,
        // do not commit behind that prompt. Keeping the builder resumes this
        // exact request; discarding invalidates it before this continuation.
        const closeDecision = hybridSession.closeDecisionPromise;
        if (closeDecision) await closeDecision;

        const currentModal = byId('editor-composite-modal');
        const requestIsCurrent = hybridCreationIsCurrent(hybridSession, request, {
            sessionId: S.sessionId,
            plan: hybridSession.plan,
        });
        if (!requestIsCurrent || currentModal !== modal) {
            const ownedLifecycle = hybridSession.createRequestId === request.id;
            completeHybridCreation(hybridSession, request);
            if (ownedLifecycle && currentModal === modal && S.sessionId !== request.sessionId) {
                closeCompositeModalImmediately(modal, { restorePreview: false });
            } else if (ownedLifecycle && currentModal === modal) {
                setCompositeCreationUi(false);
                if (error) error.textContent = 'The Hybrid preview changed while the track was being prepared. Review it and try creating the track again.';
            }
            return;
        }
        if (S.arrangements.includes(arrangement)) {
            completeHybridCreation(hybridSession, request);
            closeCompositeModalImmediately(modal);
            return;
        }
        const nameWasTaken = S.arrangements.some(arr => String(arr && arr.name || '').trim().toLowerCase() === name.toLowerCase());
        if (nameWasTaken) {
            completeHybridCreation(hybridSession, request);
            setCompositeCreationUi(false);
            if (error) error.textContent = 'Another track started using that name while the Hybrid was being prepared. Choose a different name and try again.';
            return;
        }
        S.history.exec(new CreateCompositeArrangementCmd(arrangement));
        completeHybridCreation(hybridSession, request);
        closeCompositeModalImmediately(modal);
        setStatus(`Created Hybrid Track “${name}” with ${arrangement.notes.length} notes. Save the song when you are ready.`);
    } catch (cause) {
        const requestIsCurrent = hybridCreationIsCurrent(hybridSession, request, {
            sessionId: S.sessionId,
            plan: hybridSession.plan,
        });
        if (!requestIsCurrent || byId('editor-composite-modal') !== modal) {
            const ownedLifecycle = hybridSession.createRequestId === request.id;
            completeHybridCreation(hybridSession, request);
            if (ownedLifecycle && byId('editor-composite-modal') === modal
                    && S.sessionId !== request.sessionId) {
                closeCompositeModalImmediately(modal, { restorePreview: false });
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
}

function closeCompositeModalImmediately(modal = byId('editor-composite-modal'), {
    restorePreview = true,
} = {}) {
    // Commit the last slider/zoom/resize value before DOM teardown cancels its
    // event stream. This also clears every pending persistence timer.
    flushHybridPreviewPreferences();
    cancelHybridAnalysis(hybridSession);
    cancelHybridCreation(hybridSession);
    if (restorePreview) {
        restoreCompositePreviewSession();
    } else {
        // The Editor has already moved to another song. Clear only this
        // builder's bookkeeping; seeking/stopping here could mutate the new
        // song with the old song's preview state.
        editorClearGuidePreview();
        hybridSession.previewRequestId++;
        hybridSession.previewRestore = null;
        hybridSession.previewPlaying = false;
        hybridSession.previewLoading = false;
        hybridSession.previewMode = '';
        hybridSession.previewRecordingGain = 1;
    }
    modal?.remove();
    clearTransientState();
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
    const choice = await _editorPromptChoice({
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
    const textEditing = compositeModalTextEditingTarget(target);
    const action = _compositeModalShortcutPure({
        key: event.key,
        editable: compositeModalControlEditingTarget(target),
        spaceEditable: textEditing,
        modified: event.altKey || event.ctrlKey || event.metaKey,
        stage: hybridSession.stage,
        previewActive: hybridSession.previewPlaying || hybridSession.previewLoading,
        repeat: event.repeat,
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
        restoreCompositePreviewSession();
        setStatus('Hybrid preview stopped. Press Escape again to close the builder.');
        return;
    }
    if (action.kind === 'preview') {
        const button = document.querySelector(
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
            const button = document.querySelector(
                `[data-composite-preview="${hybridSession.previewLastMode}"]:not([disabled])`)
                || document.querySelector('[data-composite-preview]:not([disabled])');
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
    if (!S.sessionId || S.format !== 'sloppak') {
        setStatus('Open a song project before creating a Hybrid Track.');
        return false;
    }
    const sources = _compositeEligibleSourcesPure(S.arrangements);
    if (sources.length < 2) {
        setStatus('A Hybrid Track needs at least two guitar or bass tracks.');
        return false;
    }
    const primary = sources.some(source => source.index === S.currentArr)
        ? S.currentArr : sources[0].index;
    const secondary = sources.find(source => source.index !== primary
        && _compositeSourcePairStatePure(S.arrangements, primary, source.index).ok)?.index
        ?? sources.find(source => source.index !== primary).index;
    const generatedNameBase = _compositeDefaultNameForSourcePure(S.arrangements[primary]);
    const name = _compositeUniqueNamePure(
        S.arrangements.map(arr => arr && arr.name), generatedNameBase,
    );
    const gapFillPreferences = loadHybridGapFillPreferences();
    const gapFillUnit = gapFillPreferences.unit;
    const gapFillValues = gapFillPreferences[gapFillUnit]
        || compositeGapFillDefaultsForUnit(gapFillUnit);
    const guidedPreferences = loadHybridGuidedPreferences();
    const experimentalPreferences = loadHybridExperimentalPreferences();
    hybridPreviewPreferences = loadHybridPreviewPreferences();
    recordingPreviewLevelCache = null;
    const modal = document.createElement('div');
    modal.id = 'editor-composite-modal';
    modal.className = 'fixed inset-0 z-50 bg-black/75';
    modal.innerHTML = `<div id="editor-composite-dialog" class="max-w-full grid rounded-xl border border-gray-600 bg-dark-800 shadow-2xl" style="${HYBRID_DIALOG_STYLE}" role="dialog" aria-modal="true" aria-labelledby="editor-composite-title" aria-describedby="editor-composite-description">`
        + `<header class="editor-composite-header"><div class="min-w-0"><h3 id="editor-composite-title" class="text-lg font-semibold">Create a Hybrid Track</h3>`
        + `<p id="editor-composite-description" class="truncate text-xs text-gray-400" title="Combine two synchronized guitar or bass parts. Originals stay unchanged.">Combine two synchronized guitar or bass parts. Originals stay unchanged.</p></div>`
        + `<nav class="editor-composite-stage-indicator" aria-label="Hybrid Track progress"><span data-composite-stage-step="setup" class="editor-composite-stage-active">1. Setup</span><i aria-hidden="true">→</i><span data-composite-stage-step="review">2. Review</span><i aria-hidden="true">→</i><span data-composite-stage-step="final-preview">3. Preview</span></nav>`
        + `<div class="editor-composite-window-actions"><button type="button" id="editor-composite-maximize" class="editor-composite-window-button" aria-label="Maximize Hybrid workspace" aria-pressed="false" title="Maximize workspace">${hybridDialogMaximizeIcon(false)}</button>`
        + `<button type="button" id="editor-composite-close" class="editor-composite-window-button text-xl" aria-label="Close" title="Close">×</button></div></header>`
        + `<div id="editor-composite-workspace" class="grid min-h-0 overflow-hidden" style="grid-template-columns:minmax(0,1fr)">`
        + renderHybridSetupView({
            sources, name, gapFillUnit, gapFillValues,
            guidedRepeatMode: guidedPreferences.repeatMode,
            experimentalEnabled: experimentalPreferences.enabled,
            experimentalProfile: experimentalPreferences.profile,
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
    const experimentalToggle = byId('editor-composite-experimental');
    const experimentalProfileSelect = byId('editor-composite-experimental-profile');
    let currentGapFillUnit = gapFillUnit;
    let generatedName = name;
    let nameManuallyEdited = false;
    const updateGeneratedName = () => {
        if (nameManuallyEdited) return;
        const arrangement = S.arrangements[Number(byId('editor-composite-primary')?.value)];
        generatedName = _compositeUniqueNamePure(
            S.arrangements.map(arr => arr && arr.name),
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
        for (const option of secondarySelect.options) {
            const state = _compositeSourcePairStatePure(
                S.arrangements, primaryIndex, Number(option.value),
            );
            option.disabled = !state.ok;
        }
        let state = _compositeSourcePairStatePure(
            S.arrangements, primaryIndex, Number(secondarySelect.value),
        );
        if (!state.ok && chooseCompatible) {
            const next = [...secondarySelect.options].find(option => !option.disabled);
            if (next) {
                secondarySelect.value = next.value;
                state = _compositeSourcePairStatePure(
                    S.arrangements, primaryIndex, Number(next.value),
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
        const analyze = byId('editor-composite-analyze');
        if (analyze) analyze.disabled = !state.ok || hybridSession.analyzing;
        updateGeneratedName();
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
        const experimentalControls = byId('editor-composite-experimental-controls');
        const experimentalProfileControls = byId('editor-composite-experimental-profile-controls');
        if (guidedControls) guidedControls.hidden = strategy !== 'guided';
        if (gapControls) gapControls.hidden = strategy !== 'gap-fill';
        if (experimentalControls) experimentalControls.hidden = strategy !== 'gap-fill';
        if (experimentalControls && experimentalToggle?.checked) experimentalControls.open = true;
        if (experimentalProfileControls) {
            experimentalProfileControls.hidden = strategy !== 'gap-fill'
                || experimentalToggle?.checked !== true;
        }
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
            : experimentalToggle?.checked
                ? 'Analyze experimental hybrid' : 'Preview automatic hybrid';
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
    experimentalToggle?.addEventListener('change', () => {
        experimentalPreferences.enabled = experimentalToggle.checked;
        experimentalPreferences.profile = normalizeExperimentalProfile(
            experimentalProfileSelect?.value,
        );
        saveHybridExperimentalPreferences(experimentalPreferences);
        syncModeControls();
        markSetupChanged(experimentalToggle.checked
            ? 'Experimental smart fill is on. Rebuild to compare it with Standard Automatic.'
            : 'Standard Automatic is selected. Rebuild the preview to use it.');
    });
    experimentalProfileSelect?.addEventListener('change', () => {
        experimentalPreferences.profile = normalizeExperimentalProfile(
            experimentalProfileSelect.value,
        );
        saveHybridExperimentalPreferences(experimentalPreferences);
        markSetupChanged('The experimental profile changed. Rebuild the preview to use it.');
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
