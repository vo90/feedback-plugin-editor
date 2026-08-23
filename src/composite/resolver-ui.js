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
    materializeCompositeArrangement,
    resolveCompositeConflict,
} from './merge-engine.js';
import {
    analyzeGapFillComposite,
    compositeGapFillDefaultsForUnit,
    normalizeCompositeGapFillOptions,
} from './gap-fill-engine.js';
import {
    analyzeExperimentalAutoComposite,
    experimentalComparisonReport,
    experimentalPassageOutcome,
    normalizeExperimentalProfile,
    refreshExperimentalPlayability,
} from './experimental-auto-engine.js';
import {
    analyzeGuidedComposite,
    clearGuidedRepeatGroup,
    detachGuidedRepeatOccurrence,
    guidedRepeatGroupForBlock,
    guidedReviewGroups,
    normalizeGuidedRepeatMode,
    resolveGuidedRepeatGroup,
    splitGuidedRepeatGroup,
} from './guided-engine.js';
import {
    buildCompositeConflictViewModel,
    buildCompositeReviewToolbarModel,
    compositeTechniqueLabels,
    renderCompositeDifferenceTable,
} from './conflict-view.js';
import {
    compositePreviewAudioPolicyPure,
    compositePreviewEventsPure,
    compositePreviewMixPure,
    compositePreviewModesPure,
    compositePreviewRegionPure,
    compositeRecordingPreviewLevelPure,
} from './preview.js';
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
} from './session.js';
import { renderHybridSetupView } from './setup-view.js';
import {
    buildCompositeTimelineViewModel,
    COMPOSITE_TIMELINE_GUTTER,
    COMPOSITE_TIMELINE_RULER_HEIGHT,
    compositeTimelineBeatForXPure,
    compositeTimelineCameraOffsetPure,
    compositeTimelineCameraShouldCommitPure,
    compositeTimelineCenteredScrollPure,
    compositeTimelineContentWidthPure,
    compositeTimelineFitZoomPure,
    compositeTimelineLaneHeightPure,
    compositeTimelineMapViewportPure,
    compositeTimelineMapBeatPure,
    compositeTimelineRenderWindowNeedsRefreshPure,
    compositeTimelineSteppedZoomPure,
    compositeTimelineVisibleRangePure,
    compositeTimelineViewportRangePure,
    compositeTimelineXForBeatPure,
    compositeTimelineZoomAtPure,
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
let timelineViewportFrame = 0;
let timelinePlayheadFrame = 0;
let timelineResizeObserver = null;
let timelineIgnoreNextScroll = false;
let dialogResizeObserver = null;
let dialogResizeSaveTimer = 0;
let timelineViewCache = null;
let timelineViewportDom = null;

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
        updateCompositeTimelinePlayhead();
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
    previewActive = false, repeat = false,
} = {}) {
    // The Hybrid modal's generic keyboard trap closes on Escape. Consume the
    // first Escape here while auditioning so it behaves as Stop instead. A held
    // key produces repeat events after previewActive becomes false, so those
    // repeats must also stay consumed; a new physical press can then close.
    if (key === 'Escape' && repeat && !modified) return { kind: 'consume' };
    if (key === 'Escape' && previewActive && !modified) return { kind: 'stop-preview' };
    if (editable || modified) return null;
    const modes = { '1': 'song', '2': 'primary', '3': 'secondary', '4': 'result' };
    if (modes[key]) return { kind: 'preview', mode: modes[key] };
    if (key === ' ') return { kind: 'play-toggle' };
    if (stage === 'review' && key === 'ArrowLeft') return { kind: 'previous' };
    if (stage === 'review' && key === 'ArrowRight') return { kind: 'next' };
    if (stage === 'review' && key === 'Home') return { kind: 'focus-review' };
    return null;
}

function byId(id) {
    return document.getElementById(id);
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
    const gain = compositeRecordingPreviewLevelPure(S.audioBuffer, startTime, endTime).gain;
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
    for (const button of document.querySelectorAll('[data-composite-preview]')) {
        const active = button.dataset.compositePreview === hybridSession.previewMode;
        const available = button.dataset.compositePreviewAvailable === 'true';
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute('aria-busy', active && hybridSession.previewLoading ? 'true' : 'false');
        button.disabled = hybridSession.previewLoading || !available;
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
    syncCompositeTimelineNativeCamera(timelineViewportDom, true);
    editorClearGuidePreview();
    hybridSession.previewPlaying = false;
    hybridSession.previewLoading = false;
    hybridSession.previewMode = '';
    hybridSession.previewRecordingGain = 1;
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelinePlayheadFrame = 0;
    updateCompositePreviewButtons();
    setCompositePreviewHelp('One source at a time · level-matched.');
    if (hadPreview) setStatus('Composite preview stopped.');
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
    hybridSession.closeDecisionResolve?.('discard');
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
    if (!plan || plan.strategy !== 'guided' || !block) return null;
    const groups = guidedReviewGroups(plan);
    const group = guidedRepeatGroupForBlock(plan, block);
    const memberIds = new Set(group && group.memberIds || [block.id]);
    const members = plan.conflicts.map((candidate, index) => ({ block: candidate, index }))
        .filter(candidate => memberIds.has(candidate.block.id));
    const groupIndex = Math.max(0, groups.findIndex(candidate => candidate.id === group?.id));
    return {
        group,
        groups,
        members,
        groupIndex,
        grouped: members.length > 1,
        allResolved: members.every(candidate => !!candidate.block.resolution),
        unresolvedDecisions: groups.filter(candidate => candidate.memberIds.some(id => {
            const candidateBlock = plan.conflicts.find(item => item.id === id);
            return candidateBlock && !candidateBlock.resolution;
        })).length,
    };
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
    const cacheKey = `${hybridSession.stage}:${hybridSession.conflictIndex}:${hybridSession.inspectedPassageId}`;
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
    const lane = view.lanes.find(candidate => candidate.id === mode);
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
    const events = mode === 'song' ? [] : compositePreviewEventsPure(
        lane ? lane.entries : [], arrangement, hybridSession.plan.beats,
        hybridSession.plan.compatibility.stringCount);
    hybridSession.previewRecordingGain = mode === 'song' ? recordingPreviewGainFor(view) : 1;
    editorSetGuidePreview(events, arrKind(arrangement), {
        ...compositePreviewAudioPolicyPure(mode),
        ...hybridPreviewMixFor(mode),
        gm: tone.gm,
        voiceCap: hybridSession.plan.compatibility.stringCount,
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
        suspendFollow: false,
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

function renderConflict(plan) {
    if (!plan.conflicts.length) {
        return `<div class="rounded border border-emerald-700/50 bg-emerald-950/20 p-4 text-sm text-emerald-100 flex flex-wrap items-center justify-between gap-3">`
            + `<div><b class="block text-base mb-1">No choices needed</b>The tracks match here, or only one track is playing at a time. The hybrid is ready to create.</div>`
            + `<button type="button" id="editor-composite-edit-settings" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">Back and adjust</button></div>`;
    }
    hybridSession.conflictIndex = Math.max(0, Math.min(hybridSession.conflictIndex, plan.conflicts.length - 1));
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
    const resolvedClass = group.validationError ? 'border-red-700/60'
        : group.resolution ? 'border-emerald-700/60' : 'border-amber-700/60';
    const unresolved = repeatContext
        ? repeatContext.unresolvedDecisions
        : plan.conflicts.filter(conflict => !conflict.resolution).length;
    const rangeLabel = `${group.label} · ${conflictReason(group)}`;
    const splitMarkup = group.splitPoints && group.splitPoints.length
        ? `<div><b class="text-gray-300">Divide this review section at a bar</b><p class="mt-0.5">Use this if the musical part changes inside the highlighted area.</p><div class="flex flex-wrap gap-1 mt-2">${group.splitPoints.map(point => `<button type="button" data-guided-split-beat="${point.beat}" class="px-2 py-1 rounded border border-gray-600 bg-dark-700 hover:border-gray-400">${_editorEscHtml(point.label)}</button>`).join('')}</div></div>`
        : '';
    const decisionNumber = repeatContext ? repeatContext.groupIndex + 1 : hybridSession.conflictIndex + 1;
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
    const timelineView = reviewPlanTimelineView();
    timelineView.selectedLaneId = model.selectedLaneId;
    const reviewToolbar = renderCompositeReviewToolbar({
        model, group, view, names, repeatContext, rangeLabel, splitMarkup,
    });
    return `<section class="rounded border ${resolvedClass} bg-dark-800/70 p-2.5">`
        + renderCompositeTimelineWorkspace(timelineView, false, reviewToolbar)
        + `</section>`;
}

function enterCompositeFinalPreview() {
    if (!hybridSession.plan) return false;
    if (hybridSession.plan.conflicts.some(block => !block.resolution)) return false;
    endCompositePreviewPlayback();
    hybridSession.stage = 'final-preview';
    hybridSession.timelineFocusReview = false;
    hybridSession.timelineFocusPassage = false;
    hybridSession.timelineFollowSuspended = false;
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
    markHybridReviewWork(hybridSession);
    renderResult();
}

function inspectExperimentalPassage(passageId) {
    const passage = hybridSession.plan?.passages?.find(candidate => candidate.id === passageId);
    if (!passage) return false;
    endCompositePreviewPlayback();
    hybridSession.inspectedPassageId = passage.id;
    hybridSession.timelineFocusPassage = true;
    hybridSession.timelineFollowSuspended = false;
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

function bindResultEvents() {
    const result = byId('editor-composite-result');
    if (!result || !hybridSession.plan) return;
    for (const details of result.querySelectorAll('.editor-composite-review-details')) {
        details.addEventListener('toggle', () => {
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
    for (const marker of result.querySelectorAll('[data-conflict-index]')) {
        marker.addEventListener('click', () => {
            hybridSession.conflictIndex = Number(marker.dataset.conflictIndex) || 0;
            prepareCurrentReviewFocus(true);
            renderResult();
        });
    }
    for (const button of result.querySelectorAll('[data-guided-split-beat]')) {
        button.addEventListener('click', () => {
            const block = hybridSession.plan.conflicts[hybridSession.conflictIndex];
            const split = splitGuidedRepeatGroup(hybridSession.plan, block.id,
                Number(button.dataset.guidedSplitBeat));
            if (!split.ok) {
                block.validationError = split.error;
                renderResult();
                return;
            }
            markHybridReviewWork(hybridSession);
            for (const replacedId of split.replacedBlockIds || [block.id]) hybridSession.customDrafts.delete(replacedId);
            hybridSession.conflictIndex = split.index;
            prepareCurrentReviewFocus(true);
            renderResult();
        });
    }
    byId('editor-composite-edit-settings')?.addEventListener('click', () => {
        endCompositePreviewPlayback();
        setCompositeReviewMode(false);
        byId('editor-composite-primary')?.focus();
    });
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
    byId('editor-composite-skip-experimental-review')?.addEventListener('click', () => {
        for (const conflict of hybridSession.plan.conflicts) {
            if (!conflict.resolution) resolveCompositeConflict(
                hybridSession.plan, conflict.id, 'primary');
        }
        markHybridReviewWork(hybridSession);
        enterCompositeFinalPreview();
    });
    byId('editor-composite-back-review')?.addEventListener('click', () => {
        endCompositePreviewPlayback();
        hybridSession.stage = 'review';
        hybridSession.timelineFollowSuspended = false;
        prepareCurrentReviewFocus(true);
        renderResult();
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
    byId('editor-composite-prev')?.addEventListener('click', () => moveDecision(-1));
    byId('editor-composite-next')?.addEventListener('click', () => moveDecision(1));
    for (const button of result.querySelectorAll('[data-composite-preview]')) {
        button.addEventListener('click', () => startCompositePreview(button.dataset.compositePreview));
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
        hybridPreviewPreferences = saveHybridPreviewPreferences({
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
        hybridPreviewPreferences = saveHybridPreviewPreferences({
            ...hybridPreviewPreferences,
            volume: event.target.value,
        });
        const value = byId('editor-composite-preview-volume-value');
        if (value) value.textContent = `${hybridPreviewPreferences.volume}%`;
        updateActiveHybridPreviewMix();
    });
    for (const button of result.querySelectorAll('[data-resolution]')) {
        button.addEventListener('click', () => {
            const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
            const resolution = button.dataset.resolution;
            if (resolution === 'custom') {
                if (!hybridSession.customDrafts.has(conflict.id)) {
                    hybridSession.customDrafts.set(conflict.id, conflict.resolution === 'custom'
                        ? [...conflict.selectedEntryIds]
                        : hybridSession.plan.strategy === 'experimental'
                            ? conflict.secondaryEntries.map(e => e.id)
                            : conflict.primaryEntries.map(e => e.id));
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
            markHybridReviewWork(hybridSession);
            renderResult();
        });
    }
    for (const checkbox of result.querySelectorAll('[data-entry-id]')) {
        checkbox.addEventListener('change', () => {
            toggleCompositeCustomEntry(checkbox.dataset.entryId);
        });
    }
    byId('editor-composite-reset-choice')?.addEventListener('click', () => {
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        const context = guidedRepeatContext(hybridSession.plan, conflict);
        for (const member of context?.members || [{ block: conflict }]) hybridSession.customDrafts.delete(member.block.id);
        clearReviewChoice(hybridSession.plan, conflict.id);
        markHybridReviewWork(hybridSession);
        renderResult();
    });
    byId('editor-composite-detach-occurrence')?.addEventListener('click', () => {
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        hybridSession.customDrafts.delete(conflict.id);
        const detached = detachGuidedRepeatOccurrence(hybridSession.plan, conflict.id);
        if (!detached.ok) conflict.validationError = detached.error;
        else markHybridReviewWork(hybridSession);
        renderResult();
    });
    byId('editor-composite-apply-next')?.addEventListener('click', () => {
        const context = guidedRepeatContext(hybridSession.plan, hybridSession.plan.conflicts[hybridSession.conflictIndex]);
        let target = null;
        if (context) {
            for (let offset = 1; offset < context.groups.length; offset++) {
                const candidate = context.groups[(context.groupIndex + offset) % context.groups.length];
                if (candidate.memberIds.some(id => {
                    const block = hybridSession.plan.conflicts.find(item => item.id === id);
                    return block && !block.resolution;
                })) { target = candidate; break; }
            }
        }
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

function timelineInitialRange(view, zoom) {
    return compositeTimelineVisibleRangePure({
        context: view.context, zoom, scrollLeft: 0, viewportWidth: 1400,
    });
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

function renderCompositeTimelineWorkspace(view, wholeSong = false, reviewToolbar = '') {
    const zoom = hybridPreviewPreferences.timelineZoom;
    const width = compositeTimelineContentWidthPure(view.context, zoom);
    const visible = timelineInitialRange(view, zoom);
    const viewport = compositeTimelineViewportRangePure({
        context: view.context, zoom, scrollLeft: 0, viewportWidth: 1400,
    });
    const rows = view.lanes.map(lane => {
        const height = compositeTimelineLaneHeightPure(hybridPreviewPreferences.laneHeights[lane.id]);
        return `<div class="relative border-t border-slate-700/80" data-composite-timeline-row="${lane.id}" style="height:${height}px;width:${width}px;min-width:100%">`
            + `<svg data-composite-timeline-lane-svg="${lane.id}" width="${width}" height="${height}" role="group" aria-label="${_editorEscHtml(lane.label)} full-song tablature" style="position:absolute;inset:0;display:block;width:${width}px;height:${height}px;max-width:none;contain:paint;will-change:transform">`
            + renderCompositeTimelineLaneContents(view, lane.id, height, visible, zoom) + '</svg>'
            + renderCompositeTimelineLaneHeader(view, lane.id, height)
            + `<button type="button" data-composite-lane-resize="${lane.id}" role="separator" aria-orientation="horizontal" aria-label="Resize ${_editorEscHtml(lane.label)} track" title="Drag to resize this track; double-click to reset" class="absolute bottom-0 left-0 z-30 h-2 w-full select-none border-0 bg-transparent" style="cursor:row-resize;touch-action:none;user-select:none"></button></div>`;
    }).join('');
    const followPressed = hybridPreviewPreferences.followPlayhead
        && !hybridSession.timelineFollowSuspended;
    const title = view.review ? `Decision ${view.review.index + 1}`
        : view.inspectedPassage ? `Inspect ${view.inspectedPassage.label}` : 'Tracks';
    const description = view.review
        ? 'The full song remains available while the highlighted decision stays in focus.'
        : view.inspectedPassage
            ? 'The full song remains scrollable while playback loops this passage and its handoffs.'
            : 'All three tracks stay aligned while you scroll, zoom, and resize them.';
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
    const manualChip = view.manualSelectionActive && !reviewToolbar
        ? `<span class="rounded-full border border-amber-600/60 bg-amber-950/50 px-2 py-1 text-[11px] text-amber-100" role="status" title="Select notes in the aligned tracks; white outlines show notes included in the hybrid">Manual mix · outlined notes are included</span>` : '';
    return `<div class="sticky top-0 z-50 -mx-1 mb-2 rounded-lg border border-slate-700 bg-slate-950/95 p-1.5 shadow-xl backdrop-blur-sm">`
        + renderPreviewControls(view, wholeSong)
        + reviewToolbar
        + `<div class="flex flex-wrap items-center gap-2" title="${_editorEscHtml(description)}"><b class="mr-auto text-sm text-gray-100">${_editorEscHtml(title)}</b>${manualChip}`
        + _compositeTimelineZoomControlsPure(zoom)
        + `<button type="button" id="editor-composite-time-follow" aria-pressed="${followPressed}" class="rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs${followPressed ? ' ring-2 ring-sky-400' : ''}" title="Keep the playhead visible during playback">${hybridSession.timelineFollowSuspended ? 'Follow paused' : hybridPreviewPreferences.followPlayhead ? 'Follow' : 'Follow off'}</button>`
        + (view.review ? `<button type="button" id="editor-composite-focus-review" class="rounded border border-amber-600/70 bg-amber-950/50 px-2.5 py-1.5 text-xs text-amber-100">Focus decision</button>` : '')
        + `<details class="relative"><summary class="cursor-pointer rounded border border-gray-600 bg-dark-700 px-2.5 py-1.5 text-xs">More</summary><div class="absolute right-0 z-50 mt-1 flex min-w-44 flex-col gap-1 rounded border border-gray-600 bg-dark-800 p-2 shadow-xl">`
        + `<button type="button" id="editor-composite-time-fit" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Overview entire song</button>`
        + `<button type="button" id="editor-composite-lanes-equal" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Make tracks equal</button>`
        + `<button type="button" id="editor-composite-lanes-reset" class="rounded bg-dark-700 px-2.5 py-1.5 text-left text-xs">Reset track sizes</button>`
        + `<p class="mt-1 border-t border-gray-700 pt-1 text-[11px] text-gray-500">Ruler: seek · Ctrl+wheel: zoom · drag lane edge: resize · Space: play/stop · 1–4: sound</p></div></details></div></div>`
        + `<section class="rounded-xl border border-slate-700 bg-slate-950/60 p-2">`
        + `<div class="editor-composite-map-key"><span><i class="editor-composite-map-base" aria-hidden="true"></i>Hybrid notes</span>${view.hasFillAdditions ? `<span><i class="editor-composite-map-fill" aria-hidden="true"></i>Added from ${_editorEscHtml(view.names.secondary)}</span>` : ''}${decisionKey}${passageKey}</div>`
        + `<button type="button" id="editor-composite-timeline-map" class="mb-1.5 block w-full rounded-lg border border-slate-700 bg-slate-950 p-0 text-left" title="Click or drag to move through the song" aria-label="Navigate the whole song">${renderCompositeTimelineMapSvg(view, viewport)}</button>`
        + `<div id="editor-composite-timeline-scroller" class="relative overflow-x-auto overflow-y-hidden rounded-lg border border-slate-700 bg-slate-950" style="will-change:scroll-position;contain:layout paint style" tabindex="0" aria-label="Scrollable full-song Hybrid timeline; Control plus mouse wheel changes time zoom">`
        + `<div id="editor-composite-timeline-content" class="relative" style="width:${width}px;min-width:100%">`
        + `<div class="relative border-b border-slate-600" data-composite-timeline-ruler style="height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px;width:${width}px;min-width:100%">`
        + `<svg data-composite-timeline-ruler-svg width="${width}" height="${COMPOSITE_TIMELINE_RULER_HEIGHT}" role="img" aria-label="Bar and beat ruler; click to seek" style="position:absolute;inset:0;display:block;width:${width}px;height:${COMPOSITE_TIMELINE_RULER_HEIGHT}px;max-width:none;cursor:pointer;contain:paint;will-change:transform">${renderCompositeTimelineRulerContents(view, visible, zoom)}</svg>`
        + `<div class="sticky left-0 z-50 flex h-full items-center border-r border-slate-600 bg-gray-900 px-3 text-xs font-semibold text-gray-300 shadow-lg" style="width:${COMPOSITE_TIMELINE_GUTTER}px">Bars and beats</div></div>`
        + rows
        + renderCompositeTimelinePlayhead()
        + `</div></div></section>`;
}

function stopCompositeTimelineUi() {
    if (timelineViewportFrame) cancelAnimationFrame(timelineViewportFrame);
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelineViewportFrame = 0;
    timelinePlayheadFrame = 0;
    timelineResizeObserver?.disconnect();
    timelineResizeObserver = null;
    timelineViewportDom = null;
}

function timelineViewportRange(view, scroller, bufferPx = undefined, scrollLeft = undefined) {
    return compositeTimelineVisibleRangePure({
        context: view.context,
        zoom: hybridPreviewPreferences.timelineZoom,
        scrollLeft: Number.isFinite(Number(scrollLeft))
            ? Number(scrollLeft) : scroller?.scrollLeft || 0,
        viewportWidth: scroller?.clientWidth || 1200,
        ...(bufferPx === undefined ? {} : { bufferPx }),
    });
}

function timelineActualViewportRange(view, scroller, scrollLeft = undefined) {
    return compositeTimelineViewportRangePure({
        context: view.context,
        zoom: hybridPreviewPreferences.timelineZoom,
        scrollLeft: Number.isFinite(Number(scrollLeft))
            ? Number(scrollLeft) : scroller?.scrollLeft || 0,
        viewportWidth: scroller?.clientWidth || 1200,
    });
}

function updateCompositeTimelineMapViewport(dom, view, scroller, scrollLeft = undefined) {
    if (!dom || !view || !scroller) return;
    const exact = timelineActualViewportRange(view, scroller, scrollLeft);
    const mapViewport = compositeTimelineMapViewportPure(view, exact);
    if (dom.mapViewport) {
        dom.mapViewport.setAttribute('x', mapViewport.x.toFixed(1));
        dom.mapViewport.setAttribute('width', mapViewport.width.toFixed(1));
    }
    return exact;
}

function refreshCompositeTimelineViewport(force = false) {
    timelineViewportFrame = 0;
    if (!_compositeTimelineStageActivePure(hybridSession.stage)) return;
    const dom = timelineViewportDom;
    const view = dom?.view;
    const scroller = dom?.scroller;
    const content = dom?.content;
    if (!view || !scroller || !content) return;
    const zoom = hybridPreviewPreferences.timelineZoom;
    const width = compositeTimelineContentWidthPure(view.context, zoom);
    const visualScroll = compositeTimelineVisualScrollLeft(dom);
    const exact = updateCompositeTimelineMapViewport(dom, view, scroller, visualScroll);
    const rebuildMarkup = compositeTimelineRenderWindowNeedsRefreshPure({
        context: view.context,
        zoom,
        renderedZoom: dom.renderedZoom,
        renderedRange: dom.renderedRange,
        viewportRange: exact,
        force,
    });
    if (!rebuildMarkup) return;
    content.style.width = `${width}px`;
    const visible = timelineViewportRange(view, scroller, undefined, visualScroll);
    const ruler = dom.ruler;
    const rulerSvg = dom.rulerSvg;
    if (ruler) ruler.style.width = `${width}px`;
    if (rulerSvg) {
        rulerSvg.setAttribute('width', String(width));
        rulerSvg.style.width = `${width}px`;
        rulerSvg.innerHTML = renderCompositeTimelineRulerContents(view, visible, zoom);
    }
    for (const lane of view.lanes) {
        const laneDom = dom.lanes.get(lane.id);
        const row = laneDom?.row;
        const svg = laneDom?.svg;
        const header = laneDom?.header;
        const height = compositeTimelineLaneHeightPure(hybridPreviewPreferences.laneHeights[lane.id]);
        if (row) { row.style.width = `${width}px`; row.style.height = `${height}px`; }
        if (header && header.style.height !== `${height}px`) {
            header.outerHTML = renderCompositeTimelineLaneHeader(view, lane.id, height);
            laneDom.header = row.querySelector(`[data-composite-timeline-header="${lane.id}"]`);
        }
        if (svg) {
            svg.setAttribute('width', String(width));
            svg.setAttribute('height', String(height));
            svg.style.width = `${width}px`;
            svg.style.height = `${height}px`;
            svg.innerHTML = renderCompositeTimelineLaneContents(view, lane.id, height, visible, zoom);
        }
    }
    dom.renderedRange = visible;
    dom.renderedZoom = zoom;
    const output = dom.zoomOutput;
    if (output) output.textContent = `${Math.round(zoom)} px/beat`;
    const slider = dom.zoomSlider;
    if (slider) {
        slider.value = String(compositeTimelineSteppedZoomPure(zoom));
        slider.setAttribute('aria-valuetext', `${Math.round(zoom)} pixels per beat`);
    }
    const preset = dom.zoomPreset;
    if (preset) {
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
}

function scheduleCompositeTimelineViewport() {
    if (!timelineViewportFrame) timelineViewportFrame = requestAnimationFrame(refreshCompositeTimelineViewport);
}

function clampTimelineScroll(scroller, value) {
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    return Math.max(0, Math.min(max, Number(value) || 0));
}

function compositeTimelineVisualScrollLeft(dom = timelineViewportDom) {
    const scroller = dom?.scroller;
    if (!scroller) return 0;
    return clampTimelineScroll(scroller, Number.isFinite(Number(dom.visualScrollLeft))
        ? Number(dom.visualScrollLeft) : scroller.scrollLeft);
}

// The sticky track labels remain native DOM elements while every time-bearing
// SVG moves on the compositor. This gives Follow a fractional, frame-by-frame
// visual camera without asking Chromium to relayout a huge scroll surface on
// every frame.
function applyCompositeTimelineCamera(dom = timelineViewportDom, rawVisualScroll,
    rawPlayheadX = dom?.playheadX) {
    const scroller = dom?.scroller;
    if (!dom || !scroller) return 0;
    const visualScroll = clampTimelineScroll(scroller, rawVisualScroll);
    const cameraOffset = compositeTimelineCameraOffsetPure(
        scroller.scrollLeft, visualScroll);
    const layerTransform = `translate3d(${cameraOffset}px,0,0)`;
    if (dom.rulerSvg) dom.rulerSvg.style.transform = layerTransform;
    for (const lane of dom.lanes?.values?.() || []) {
        if (lane?.svg) lane.svg.style.transform = layerTransform;
    }
    const playheadX = Number(rawPlayheadX);
    if (Number.isFinite(playheadX)) dom.playheadX = playheadX;
    if (dom.playhead && Number.isFinite(Number(dom.playheadX))) {
        dom.playhead.style.transform = `translate3d(${Number(dom.playheadX) + cameraOffset}px,0,0)`;
    }
    dom.visualScrollLeft = visualScroll;
    updateCompositeTimelineMapViewport(dom, dom.view, scroller, visualScroll);
    return visualScroll;
}

function setCompositeTimelineNativeCamera(dom = timelineViewportDom,
    rawVisualScroll = compositeTimelineVisualScrollLeft(dom), refresh = true) {
    const scroller = dom?.scroller;
    if (!dom || !scroller) return 0;
    const visualScroll = clampTimelineScroll(scroller, rawVisualScroll);
    if (Math.abs(scroller.scrollLeft - visualScroll) >= 0.5) {
        timelineIgnoreNextScroll = true;
        scroller.scrollLeft = visualScroll;
    }
    applyCompositeTimelineCamera(dom, visualScroll);
    hybridSession.timelineScrollLeft = visualScroll;
    if (refresh) scheduleCompositeTimelineViewport();
    return visualScroll;
}

function syncCompositeTimelineNativeCamera(dom = timelineViewportDom, force = false) {
    const scroller = dom?.scroller;
    if (!dom || !scroller) return false;
    const visualScroll = compositeTimelineVisualScrollLeft(dom);
    if (!force && !compositeTimelineCameraShouldCommitPure(
        scroller.scrollLeft, visualScroll)) return false;
    setCompositeTimelineNativeCamera(dom, visualScroll);
    return true;
}

function seekCompositeTimelineAtTime(rawTime, {
    center = false,
    suspendFollow = null,
} = {}) {
    const time = Math.max(0, Number(rawTime) || 0);
    const view = currentTimelineView();
    const dom = timelineViewportDom;
    const scroller = dom?.scroller
        || byId('editor-composite-timeline-scroller');
    hybridSession.timelineSeekTime = time;
    if (suspendFollow !== null) setCompositeTimelineFollowSuspended(!!suspendFollow);
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
    refreshCompositeTimelineViewport();
    updateCompositeTimelinePlayhead();
    return time;
}

function applyCompositeTimelineZoom(nextZoom, anchorX = null, forceStart = false) {
    const view = currentTimelineView();
    const scroller = byId('editor-composite-timeline-scroller');
    const content = byId('editor-composite-timeline-content');
    if (!view || !scroller || !content) return;
    const dom = timelineViewportDom;
    const currentScroll = dom ? compositeTimelineVisualScrollLeft(dom) : scroller.scrollLeft;
    const anchor = Number.isFinite(Number(anchorX)) ? Number(anchorX) : scroller.clientWidth / 2;
    const next = forceStart
        ? { zoom: nextZoom, scrollLeft: 0 }
        : compositeTimelineZoomAtPure({
            context: view.context,
            oldZoom: hybridPreviewPreferences.timelineZoom,
            newZoom: nextZoom,
            scrollLeft: currentScroll,
            anchorX: anchor,
            viewportWidth: scroller.clientWidth,
        });
    hybridPreviewPreferences = saveHybridPreviewPreferences({
        ...hybridPreviewPreferences, timelineZoom: next.zoom,
    });
    content.style.width = `${compositeTimelineContentWidthPure(view.context, next.zoom)}px`;
    if (dom) setCompositeTimelineNativeCamera(dom, Math.max(0, next.scrollLeft), false);
    else {
        timelineIgnoreNextScroll = true;
        scroller.scrollLeft = Math.max(0, next.scrollLeft);
    }
    refreshCompositeTimelineViewport(true);
}

function updateCompositeTimelinePlayhead() {
    timelinePlayheadFrame = 0;
    if (!_compositeTimelineStageActivePure(hybridSession.stage)) return;
    const dom = timelineViewportDom;
    const view = dom?.view;
    const scroller = dom?.scroller;
    const playhead = dom?.playhead;
    if (!view || !scroller || !playhead) return;
    const time = hybridSession.previewPlaying && S.playing
        ? Number(S.cursorTime) || 0 : hybridSession.timelineSeekTime;
    const beat = beatOf(hybridSession.plan.beats, time);
    const x = compositeTimelineXForBeatPure(beat, view.context,
        hybridPreviewPreferences.timelineZoom);
    let visualScroll = compositeTimelineVisualScrollLeft(dom);
    const mapPlayhead = dom.mapPlayhead;
    if (mapPlayhead) {
        const span = Math.max(1, view.context.endBeat - view.context.startBeat);
        const mapX = Math.max(0, Math.min(1000,
            ((beat - view.context.startBeat) / span) * 1000));
        mapPlayhead.setAttribute('x1', String(mapX));
        mapPlayhead.setAttribute('x2', String(mapX));
    }
    if (hybridSession.previewPlaying && S.playing) {
        hybridSession.timelineSeekTime = Math.max(0, time);
        if (hybridPreviewPreferences.followPlayhead && !hybridSession.timelineFollowSuspended) {
            visualScroll = clampTimelineScroll(scroller,
                compositeTimelineCenteredScrollPure({
                    beat,
                    context: view.context,
                    zoom: hybridPreviewPreferences.timelineZoom,
                    viewportWidth: scroller.clientWidth,
                }));
            hybridSession.timelineScrollLeft = visualScroll;
        }
        applyCompositeTimelineCamera(dom, visualScroll, x);
        syncCompositeTimelineNativeCamera(dom);
        timelinePlayheadFrame = requestAnimationFrame(updateCompositeTimelinePlayhead);
    } else if (hybridSession.previewPlaying && !S.playing) {
        applyCompositeTimelineCamera(dom, visualScroll, x);
        syncCompositeTimelineNativeCamera(dom, true);
        hybridSession.previewPlaying = false;
        updateCompositePreviewButtons();
    } else {
        applyCompositeTimelineCamera(dom, visualScroll, x);
    }
}

function startCompositeTimelinePlayhead() {
    if (timelinePlayheadFrame) cancelAnimationFrame(timelinePlayheadFrame);
    timelinePlayheadFrame = requestAnimationFrame(updateCompositeTimelinePlayhead);
}

function prepareCurrentReviewFocus(seek = false) {
    if (hybridSession.stage !== 'review') return;
    const view = currentConflictView();
    if (!view) return;
    hybridSession.timelineFocusReview = true;
    hybridSession.timelineFollowSuspended = false;
    if (seek) {
        const time = Math.max(0, timeOf(hybridSession.plan.beats, view.context.startBeat));
        rememberCompositePreviewSession();
        seekCompositeTimelineAtTime(time, { suspendFollow: false });
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

function setCompositeTimelineFollowSuspended(suspended) {
    hybridSession.timelineFollowSuspended = hybridPreviewPreferences.followPlayhead
        && !!suspended;
    const follow = byId('editor-composite-time-follow');
    if (!follow) return;
    const pressed = hybridPreviewPreferences.followPlayhead
        && !hybridSession.timelineFollowSuspended;
    follow.setAttribute('aria-pressed', String(pressed));
    follow.classList.toggle('ring-2', pressed);
    follow.classList.toggle('ring-sky-400', pressed);
    follow.textContent = hybridSession.timelineFollowSuspended
        ? 'Follow paused' : hybridPreviewPreferences.followPlayhead ? 'Follow' : 'Follow off';
}

function bindCompositeTimelineEvents() {
    const view = currentTimelineView();
    const scroller = byId('editor-composite-timeline-scroller');
    if (!view || !scroller) return;
    const content = byId('editor-composite-timeline-content');
    const map = byId('editor-composite-timeline-map');
    const lanes = new Map(view.lanes.map(lane => [lane.id, {
        row: content?.querySelector(`[data-composite-timeline-row="${lane.id}"]`),
        svg: content?.querySelector(`[data-composite-timeline-lane-svg="${lane.id}"]`),
        header: content?.querySelector(`[data-composite-timeline-header="${lane.id}"]`),
    }]));
    timelineViewportDom = {
        view,
        scroller,
        content,
        ruler: content?.querySelector('[data-composite-timeline-ruler]'),
        rulerSvg: content?.querySelector('[data-composite-timeline-ruler-svg]'),
        lanes,
        map,
        mapViewport: map?.querySelector('#editor-composite-map-viewport'),
        mapPlayhead: map?.querySelector('#editor-composite-map-playhead'),
        playhead: content?.querySelector('#editor-composite-timeline-playhead'),
        zoomOutput: byId('editor-composite-time-zoom-value'),
        zoomSlider: byId('editor-composite-time-zoom'),
        zoomPreset: byId('editor-composite-time-preset'),
        renderedRange: null,
        renderedZoom: null,
        visualScrollLeft: scroller.scrollLeft,
        playheadX: null,
    };
    scroller.addEventListener('scroll', () => {
        const internalCameraCommit = timelineIgnoreNextScroll;
        if (internalCameraCommit) {
            timelineIgnoreNextScroll = false;
            applyCompositeTimelineCamera(timelineViewportDom,
                compositeTimelineVisualScrollLeft(timelineViewportDom));
        } else {
            hybridSession.timelineScrollLeft = scroller.scrollLeft;
            applyCompositeTimelineCamera(timelineViewportDom, scroller.scrollLeft);
            if (S.playing) setCompositeTimelineFollowSuspended(true);
        }
        scheduleCompositeTimelineViewport();
    }, { passive: true });
    scroller.addEventListener('wheel', event => {
        if (!event.ctrlKey || !event.deltaY) return;
        event.preventDefault();
        const rect = scroller.getBoundingClientRect();
        const anchor = event.clientX - rect.left;
        applyCompositeTimelineZoom(compositeTimelineSteppedZoomPure(
            hybridPreviewPreferences.timelineZoom, event.deltaY < 0 ? 1 : -1), anchor);
    }, { passive: false });
    const ruler = timelineViewportDom.rulerSvg;
    ruler?.addEventListener('click', event => {
        const rect = ruler.getBoundingClientRect();
        const contentX = event.clientX - rect.left;
        if (contentX < COMPOSITE_TIMELINE_GUTTER) return;
        const beat = Math.max(view.context.startBeat, Math.min(view.context.endBeat,
            compositeTimelineBeatForXPure(contentX, view.context,
                hybridPreviewPreferences.timelineZoom)));
        const time = Math.max(0, timeOf(hybridSession.plan.beats, beat));
        rememberCompositePreviewSession();
        seekCompositeTimelineAtTime(time);
    });
    for (const button of document.querySelectorAll('[data-composite-time-zoom]')) {
        button.addEventListener('click', () => applyCompositeTimelineZoom(
            compositeTimelineSteppedZoomPure(hybridPreviewPreferences.timelineZoom,
                button.dataset.compositeTimeZoom === 'in' ? 1 : -1)));
    }
    byId('editor-composite-time-zoom')?.addEventListener('input', event => {
        applyCompositeTimelineZoom(Number(event.target.value));
    });
    byId('editor-composite-time-preset')?.addEventListener('change', event => {
        applyCompositeTimelineZoom(Number(event.target.value));
    });
    byId('editor-composite-time-fit')?.addEventListener('click', () => {
        applyCompositeTimelineZoom(compositeTimelineFitZoomPure(
            view.context, scroller.clientWidth), 0, true);
    });
    byId('editor-composite-time-follow')?.addEventListener('click', () => {
        const resumeSuspended = hybridSession.timelineFollowSuspended;
        hybridPreviewPreferences = saveHybridPreviewPreferences({
            ...hybridPreviewPreferences,
            followPlayhead: resumeSuspended ? true : !hybridPreviewPreferences.followPlayhead,
        });
        setCompositeTimelineFollowSuspended(false);
    });
    const navigateMap = event => {
        const surface = map.querySelector('svg') || map;
        const rect = surface.getBoundingClientRect();
        const beat = compositeTimelineMapBeatPure({
            clientX: event.clientX,
            mapLeft: rect.left,
            mapWidth: rect.width,
            context: view.context,
        });
        const time = Math.max(0, timeOf(hybridSession.plan.beats, beat));
        rememberCompositePreviewSession();
        seekCompositeTimelineAtTime(time, { center: true, suspendFollow: true });
        return { beat, time, scrollLeft: scroller.scrollLeft };
    };
    let mapPointerGesture = null;
    map?.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const passage = event.target.closest?.('[data-composite-map-passage]');
        const decision = event.target.closest?.('[data-composite-map-decision]');
        mapPointerGesture = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            followWasSuspended: hybridSession.timelineFollowSuspended,
            passageId: passage?.dataset.compositeMapPassage || '',
            decisionIndex: decision ? Number(decision.dataset.compositeMapDecision) : -1,
        };
        map.setPointerCapture?.(event.pointerId);
        navigateMap(event);
    });
    map?.addEventListener('pointermove', event => {
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId
            || !(event.buttons & 1)) return;
        if (Math.hypot(event.clientX - mapPointerGesture.startX,
            event.clientY - mapPointerGesture.startY) > 4) mapPointerGesture.moved = true;
        navigateMap(event);
    });
    map?.addEventListener('pointerup', event => {
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId) return;
        const gesture = mapPointerGesture;
        mapPointerGesture = null;
        const location = navigateMap(event);
        map.releasePointerCapture?.(event.pointerId);
        setCompositeTimelineFollowSuspended(gesture.followWasSuspended);
        if (gesture.moved) return;
        if (gesture.passageId && hybridSession.stage === 'final-preview') {
            endCompositePreviewPlayback();
            hybridSession.inspectedPassageId = gesture.passageId;
            hybridSession.timelineFocusPassage = false;
            hybridSession.timelineSeekTime = location.time;
            hybridSession.timelineScrollLeft = location.scrollLeft;
            host.editorSeekToTime(location.time);
            renderResult();
            return;
        }
        if (Number.isInteger(gesture.decisionIndex) && gesture.decisionIndex >= 0
            && hybridSession.stage === 'review'
            && hybridSession.plan.conflicts[gesture.decisionIndex]) {
            endCompositePreviewPlayback();
            hybridSession.conflictIndex = gesture.decisionIndex;
            prepareCurrentReviewFocus(false);
            hybridSession.timelineFocusReview = false;
            hybridSession.timelineSeekTime = location.time;
            hybridSession.timelineScrollLeft = location.scrollLeft;
            host.editorSeekToTime(location.time);
            renderResult();
        }
    });
    const clearMapGesture = event => {
        if (!mapPointerGesture || event.pointerId !== mapPointerGesture.pointerId) return;
        const gesture = mapPointerGesture;
        mapPointerGesture = null;
        setCompositeTimelineFollowSuspended(gesture.followWasSuspended);
    };
    map?.addEventListener('pointercancel', clearMapGesture);
    map?.addEventListener('lostpointercapture', clearMapGesture);
    byId('editor-composite-focus-review')?.addEventListener('click', () => {
        centerCurrentReviewInTimeline(view, scroller);
    });
    const applyLaneHeights = laneHeights => {
        hybridPreviewPreferences = saveHybridPreviewPreferences({
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
        if (!note || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        toggleCompositeCustomEntry(note.dataset.compositeEntryId);
    });
    for (const grip of document.querySelectorAll('[data-composite-lane-resize]')) {
        const reset = () => {
            const laneId = grip.dataset.compositeLaneResize;
            hybridPreviewPreferences = saveHybridPreviewPreferences({
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
            event.preventDefault();
            const laneId = grip.dataset.compositeLaneResize;
            const startY = event.clientY;
            const startHeight = hybridPreviewPreferences.laneHeights[laneId];
            const move = moveEvent => {
                hybridPreviewPreferences = hybridPreviewPreferencesPure({
                    ...hybridPreviewPreferences,
                    laneHeights: {
                        ...hybridPreviewPreferences.laneHeights,
                        [laneId]: startHeight + moveEvent.clientY - startY,
                    },
                });
                refreshCompositeTimelineViewport(true);
            };
            const up = () => {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                hybridPreviewPreferences = saveHybridPreviewPreferences(hybridPreviewPreferences);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up, { once: true });
        });
    }
    if (typeof ResizeObserver === 'function') {
        timelineResizeObserver = new ResizeObserver(scheduleCompositeTimelineViewport);
        timelineResizeObserver.observe(scroller);
    }
    requestAnimationFrame(() => {
        if (view.review && hybridSession.timelineFocusReview) {
            centerCurrentReviewInTimeline(view, scroller);
        } else if (view.passageFocus && hybridSession.timelineFocusPassage) {
            const beat = (view.passageFocus.startBeat + view.passageFocus.endBeat) / 2;
            const nextScroll = clampTimelineScroll(scroller,
                compositeTimelineCenteredScrollPure({
                    beat, context: view.context,
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
        updateCompositeTimelinePlayhead();
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

function renderResult() {
    invalidateCompositeTimelineView();
    stopCompositeTimelineUi();
    if (hybridSession.previewMode) endCompositePreviewPlayback();
    const result = byId('editor-composite-result');
    if (!result || !hybridSession.plan) return;
    updateCompositeStageIndicator(hybridSession.stage);
    if (hybridSession.plan.strategy === 'experimental') {
        refreshExperimentalPlayability(hybridSession.plan);
        hybridSession.plan.comparisonReport = experimentalComparisonReport(hybridSession.plan);
    }
    if (hybridSession.plan.strategy === 'guided') guidedReviewGroups(hybridSession.plan);
    const stats = hybridSession.plan.stats;
    const unresolvedBlocks = hybridSession.plan.conflicts.filter(c => !c.resolution).length;
    const normalized = stats.timingAdjustments || 0;
    const normalizationNotice = normalized ? `<details class="mb-3 rounded border border-gray-700 bg-dark-900/50 px-3 py-2 text-xs text-gray-400">`
        + `<summary class="cursor-pointer hover:text-gray-200">Technical details: ${normalized} tiny import timing ${normalized === 1 ? 'seam was' : 'seams were'} cleaned up</summary>`
        + `<p class="mt-2">The cleanup stayed within the tempo-aware ${Math.round(COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS * 1000)} ms safety limit. Only the new hybrid uses the adjusted trail; both original tracks remain unchanged.</p></details>` : '';
    const repeatNotice = hybridSession.plan.repeatNotice;
    let repeatNoticeMarkup = '';
    if (repeatNotice && (repeatNotice.requested > 1 || repeatNotice.kind !== 'applied')) {
        if (repeatNotice.kind === 'partial') {
            const failures = repeatNotice.failed.map(failure => `${failure.label}: ${failure.error}`).join(' ');
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs text-amber-100"><b>Your choice worked in ${repeatNotice.applied} of ${repeatNotice.requested} matching sections.</b> ${repeatNotice.failed.length} ${repeatNotice.failed.length === 1 ? 'section needs' : 'sections need'} a separate choice because the surrounding notes differ. ${_editorEscHtml(failures)}</div>`;
        } else if (repeatNotice.kind === 'detached') {
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-sky-800/50 bg-sky-950/20 px-3 py-2 text-xs text-sky-100"><b>${_editorEscHtml(repeatNotice.label)} can now have its own choice.</b></div>`;
        } else {
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100"><b>Your choice was used in all ${repeatNotice.applied} matching sections.</b> Each section passed its own playability check.</div>`;
        }
    }
    const names = selectedSourceNames();
    if (hybridSession.stage === 'final-preview') {
        result.innerHTML = renderFinalPreviewResult(hybridSession.plan, names,
            normalizationNotice, repeatNoticeMarkup);
    } else {
        result.innerHTML = normalizationNotice + repeatNoticeMarkup
            + renderConflict(hybridSession.plan);
    }
    const finish = byId('editor-composite-finish');
    if (finish) {
        finish.hidden = hybridSession.stage !== 'final-preview';
        finish.disabled = unresolvedBlocks > 0;
    }
    bindResultEvents();
}

function compositeAnalyzeButtonLabel() {
    if (hybridSession.plan) {
        return hybridSession.setupDirty ? 'Rebuild hybrid preview' : 'Rebuild preview';
    }
    if (selectedCompositeStrategy() === 'guided') return 'Find sections to review';
    return byId('editor-composite-experimental')?.checked
        ? 'Analyze experimental hybrid' : 'Preview automatic hybrid';
}

function setCompositeAnalysisUi(analyzing) {
    hybridSession.analyzing = !!analyzing;
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
        analyze.textContent = analyzing ? 'Analyzing…' : compositeAnalyzeButtonLabel();
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
    setCompositeAnalysisUi(true);
    // Let the busy label paint before the DOM-free planner occupies the main
    // thread. Majesty-sized Experimental analysis is roughly half a second.
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    let plan;
    try {
        plan = strategy === 'guided'
            ? analyzeGuidedComposite({ ...sources, sections: S.sections, repeatMode })
            : experimentalEnabled
                ? analyzeExperimentalAutoComposite({
                    ...sources, gapFill, profile: experimentalProfile,
                })
                : analyzeGapFillComposite({ ...sources, gapFill });
    } catch (cause) {
        setCompositeAnalysisUi(false);
        if (error) error.textContent = `Could not analyze the Hybrid Track: ${cause.message}`;
        return;
    }
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
    hybridSession.plan = plan;
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
    hybridSession.timelineFollowSuspended = false;
    if (hybridSession.stage === 'review') prepareCurrentReviewFocus(true);
    editorWarmGuidePreview(arrKind(plan.primary), { gm: selectedHybridPreviewTone().gm });
    setCompositeReviewMode(true);
    renderResult();
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
    let arrangement;
    try {
        arrangement = materializeCompositeArrangement(plan, name);
    } catch (cause) {
        if (error) error.textContent = cause.message;
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
    try {
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
    cancelHybridCreation(hybridSession);
    if (restorePreview) {
        restoreCompositePreviewSession();
    } else {
        // The Editor has already moved to another song. Clear only this
        // builder's bookkeeping; seeking/stopping here could mutate the new
        // song with the old song's preview state.
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
    if (closeAction === 'keep' || byId('editor-composite-modal') !== modal) return false;
    closeCompositeModalImmediately(modal);
    return true;
}

function handleCompositeModalShortcut(event) {
    if (event.defaultPrevented) return;
    const target = event.target;
    const action = _compositeModalShortcutPure({
        key: event.key,
        editable: !!target?.matches?.('input, select, textarea, [contenteditable="true"]'),
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
        button.click();
        return;
    }
    if (action.kind === 'play-toggle') {
        if (target?.matches?.('button, summary')) return;
        event.preventDefault();
        if (hybridSession.previewPlaying || hybridSession.previewLoading) {
            endCompositePreviewPlayback();
        } else {
            const button = document.querySelector(
                `[data-composite-preview="${hybridSession.previewLastMode}"]:not([disabled])`)
                || document.querySelector('[data-composite-preview]:not([disabled])');
            button?.click();
        }
        return;
    }
    if (action.kind === 'previous' || action.kind === 'next') {
        const button = byId(action.kind === 'previous'
            ? 'editor-composite-prev' : 'editor-composite-next');
        if (!button || button.disabled) return;
        event.preventDefault();
        button.click();
        return;
    }
    if (action.kind === 'focus-review') {
        event.preventDefault();
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
    byId('editor-composite-primary').focus();
    return true;
}
