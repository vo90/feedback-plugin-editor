/* Hybrid-track builder.
 *
 * This is the Editor integration over the DOM-free automatic and guided
 * planners: setup, musical-section review, preview, and one structural history
 * command. The merge rules remain DOM-free and testable.
 */

import { arrKind, _isFrettedKind } from '../instrument.js';
import {
    editorClearGuidePreview,
    editorSetGuidePreview,
    startPlayback,
    stopPlayback,
} from '../audio.js';
import { _setBarSel, _setLoopRegionEnabled } from '../loop.js';
import { S } from '../state.js';
import { host } from '../host.js';
import { _editorEscHtml, _installModalKeyboard, setStatus } from '../ui.js';
import {
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    compositeResolvedEntries,
    compositeSelectionUnitIds,
    materializeCompositeArrangement,
} from './merge-engine.js';
import {
    analyzeGapFillComposite,
    compositeGapFillDefaultsForUnit,
    normalizeCompositeGapFillOptions,
} from './gap-fill-engine.js';
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
    compositeTechniqueLabels,
    renderCompositeConflictTabSvg,
    renderCompositeDifferenceTable,
} from './conflict-view.js';
import { compositePreviewEventsPure, compositePreviewRegionPure } from './preview.js';
import { createHybridBuilderSession, resetHybridBuilderReview } from './session.js';
import { renderHybridSetupView } from './setup-view.js';
import {
    HYBRID_GAP_FILL_CONTROL_CONFIG,
    hybridGapFillPreferencesPure,
    hybridGuidedPreferencesPure,
    loadHybridGapFillPreferences,
    loadHybridGuidedPreferences,
    saveHybridGapFillPreferences,
    saveHybridGuidedPreferences,
} from './preferences.js';

export {
    hybridGapFillPreferencesPure as _compositeGapFillPreferencesPure,
    hybridGuidedPreferencesPure as _compositeGuidedPreferencesPure,
};

const hybridSession = createHybridBuilderSession();

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

function byId(id) {
    return document.getElementById(id);
}

function cloneLoopRegion(region) {
    return region ? { ...region } : null;
}

function rememberCompositePreviewSession() {
    if (hybridSession.previewRestore) return;
    hybridSession.previewRestore = {
        barSel: cloneLoopRegion(S.barSel),
        loopEnabled: !!S.loopEnabled,
        cursorTime: Number(S.cursorTime) || 0,
    };
}

function updateCompositePreviewButtons() {
    for (const button of document.querySelectorAll('[data-composite-preview]')) {
        const active = button.dataset.compositePreview === hybridSession.previewMode;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('ring-2', active);
        button.classList.toggle('ring-emerald-400', active);
    }
    const stop = byId('editor-composite-preview-stop');
    if (stop) stop.disabled = !hybridSession.previewPlaying;
}

function endCompositePreviewPlayback() {
    const hadPreview = hybridSession.previewPlaying || !!hybridSession.previewMode;
    if (hybridSession.previewPlaying && S.playing) stopPlayback();
    editorClearGuidePreview();
    hybridSession.previewPlaying = false;
    hybridSession.previewMode = '';
    updateCompositePreviewButtons();
    if (hadPreview) setStatus('Composite preview stopped.');
}

function restoreCompositePreviewSession() {
    endCompositePreviewPlayback();
    if (!hybridSession.previewRestore) return;
    const restore = hybridSession.previewRestore;
    hybridSession.previewRestore = null;
    _setBarSel(restore.barSel);
    _setLoopRegionEnabled(restore.loopEnabled);
    host.editorSeekToTime(restore.cursorTime);
}

function clearTransientState() {
    resetHybridBuilderReview(hybridSession);
}

function resetResult(message = 'Choose two tracks and how you want to build the hybrid.') {
    restoreCompositePreviewSession();
    clearTransientState();
    const result = byId('editor-composite-result');
    if (result) result.innerHTML = `<p class="text-sm text-gray-400">${_editorEscHtml(message)}</p>`;
    const finish = byId('editor-composite-finish');
    if (finish) {
        finish.disabled = true;
        finish.hidden = true;
    }
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
    const analyze = byId('editor-composite-analyze');
    if (analyze) analyze.hidden = reviewing;
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
    if (group.reasons.includes('same-string-overlap')) reasons.push('different notes overlap on the same string');
    if (group.reasons.includes('note-variant')) reasons.push('the same position has different sustain, technique, or harmony data');
    const overlapMilliseconds = Math.round(Math.max(0, Number(group.overlapSeconds) || 0) * 1000);
    const overlap = overlapMilliseconds > 0 ? ` (${overlapMilliseconds} ms overlap)` : '';
    return `${reasons.join('; ') || 'source notes require a choice'}${overlap}`;
}

function selectedSourceNames() {
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

function renderOverview(plan) {
    if (plan.strategy === 'guided') {
        const names = selectedSourceNames();
        const start = Number.isFinite(plan.timelineStartBeat) ? plan.timelineStartBeat : 0;
        const end = Math.max(start + 1, Number(plan.timelineEndBeat) || start + 1);
        const automaticClass = {
            empty: 'bg-gray-700/50',
            identical: 'bg-slate-400',
            'primary-only': 'bg-sky-500',
            'secondary-only': 'bg-violet-500',
        };
        const automatic = (plan.automaticRegions || []).map(region => {
            const left = ((region.startBeat - start) / (end - start)) * 100;
            const width = Math.max(0.35, ((region.endBeat - region.startBeat) / (end - start)) * 100);
            const title = `${region.sectionName} · ${region.measureLabel} · ${region.kind.replace('-', ' ')}`;
            return `<span class="absolute top-0 h-4 ${automaticClass[region.kind] || 'bg-gray-600'}" style="left:${left}%;width:${width}%" title="${_editorEscHtml(title)}"></span>`;
        }).join('');
        const decisions = plan.conflicts.map((block, index) => {
            const left = ((block.startBeat - start) / (end - start)) * 100;
            const width = Math.max(0.7, (((block.rangeEndBeat || block.endBeat) - block.startBeat) / (end - start)) * 100);
            const current = index === hybridSession.conflictIndex;
            const stateClass = block.validationError ? 'bg-red-500'
                : block.resolution ? 'bg-emerald-500' : 'bg-amber-500';
            const state = block.validationError ? 'Choice needs attention'
                : block.resolution ? 'Choice made' : 'Needs review';
            return `<button type="button" data-conflict-index="${index}" aria-label="${state}: ${_editorEscHtml(block.label)}" aria-current="${current ? 'true' : 'false'}" class="absolute top-0 h-4 ${stateClass} ${current ? 'ring-2 ring-white ring-inset' : ''}"`
                + ` style="left:${left}%;width:${width}%" title="${_editorEscHtml(`${block.label} · ${state}`)}"></button>`;
        }).join('');
        return `<div class="mb-3" aria-label="Song review map"><div class="flex flex-wrap justify-between gap-2 text-xs text-gray-400 mb-1.5"><b class="text-gray-200">Song map</b>`
            + `<span><span aria-hidden="true" class="text-slate-300">●</span> same/empty · <span aria-hidden="true" class="text-sky-400">●</span> ${_editorEscHtml(names.primary)} · <span aria-hidden="true" class="text-violet-400">●</span> ${_editorEscHtml(names.secondary)} · <span aria-hidden="true" class="text-amber-400">◆</span> needs review · <span aria-hidden="true" class="text-emerald-400">✓</span> chosen</span></div>`
            + `<div class="relative h-4 rounded bg-dark-900 overflow-hidden">${automatic}${decisions}</div></div>`;
    }
    return '';
}

function customMarkup(group) {
    const draft = hybridSession.customDrafts.get(group.id)
        || (group.resolution === 'custom' ? group.selectedEntryIds : null);
    if (!draft) return '';
    const checked = new Set(draft);
    const stringCount = hybridSession.plan?.compatibility?.stringCount || 6;
    const render = (entry) => entryMarkup(entry, `custom-${group.id}`, stringCount).replace(
        `data-entry-id="${entry.id}"`, `data-entry-id="${entry.id}"${checked.has(entry.id) ? ' checked' : ''}`);
    const primarySelected = group.primaryEntries.filter(entry => checked.has(entry.id)).length;
    const secondarySelected = group.secondaryEntries.filter(entry => checked.has(entry.id)).length;
    const names = selectedSourceNames();
    return `<div class="mt-3 border-t border-gray-700 pt-2">`
        + `<div class="rounded-lg border border-amber-700/50 bg-amber-950/20 px-3 py-2">`
        + `<b class="text-sm text-amber-100">Mix notes yourself</b>`
        + `<p class="text-xs text-gray-300 mt-1">Click notes in the ${_editorEscHtml(names.primary)} or ${_editorEscHtml(names.secondary)} tablature above. Connected notes, chords, and trails stay together.</p>`
        + `<p class="text-xs text-amber-200 mt-2" aria-live="polite"><b>${primarySelected}</b> from ${_editorEscHtml(names.primary)} · <b>${secondarySelected}</b> from ${_editorEscHtml(names.secondary)}</p>`
        + `<div id="editor-composite-custom-error" class="text-xs text-red-300 mt-1" role="alert">${_editorEscHtml(group.validationError || '')}</div></div>`
        + `<details class="mt-2 text-xs text-gray-400"><summary class="cursor-pointer hover:text-gray-200">Advanced note list</summary>`
        + `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2"><div><b class="text-sky-300">${_editorEscHtml(names.primary)}</b>${group.primaryEntries.map(render).join('')}</div>`
        + `<div><b class="text-violet-300">${_editorEscHtml(names.secondary)}</b>${group.secondaryEntries.map(render).join('')}</div></div></details></div>`;
}

function renderPreviewControls(view, wholeSong = false) {
    const resultReady = wholeSong || !!view.conflict.resolution;
    const buttonClass = 'px-2.5 py-1.5 rounded border border-gray-600 bg-dark-700 hover:border-gray-400 text-xs disabled:opacity-40 disabled:cursor-not-allowed';
    return `<div class="mb-3 rounded-lg border border-gray-700 bg-dark-900/70 px-3 py-2">`
        + `<div class="flex flex-wrap items-center gap-2"><span class="text-xs text-gray-300 font-semibold mr-1">${wholeSong ? 'Preview the hybrid' : 'Listen to this section'}</span>`
        + `<button type="button" data-composite-preview="song" aria-pressed="false" class="${buttonClass}" ${S.audioBuffer ? '' : 'disabled'}>▶ Song audio</button>`
        + (wholeSong ? '' : `<button type="button" data-composite-preview="primary" aria-pressed="false" class="${buttonClass} text-sky-200">▶ ${_editorEscHtml(view.names.primary)}</button>`
            + `<button type="button" data-composite-preview="secondary" aria-pressed="false" class="${buttonClass} text-violet-200">▶ ${_editorEscHtml(view.names.secondary)}</button>`)
        + `<button type="button" data-composite-preview="result" aria-pressed="false" class="${buttonClass} text-emerald-200" ${resultReady ? '' : 'disabled'}>▶ Hybrid guide</button>`
        + `<button type="button" id="editor-composite-preview-stop" class="${buttonClass}" disabled>■ Stop</button>`
        + (wholeSong ? '' : `<button type="button" id="editor-composite-keep-loop" class="ml-auto ${buttonClass}">Keep this section looped in the editor</button>`)
        + `</div><p class="mt-1.5 text-xs text-gray-500">${wholeSong ? 'The guide plays the planned hybrid over your song. Nothing is created until you press Create Hybrid Track.' : 'The selected bars repeat while you compare the song and each playable part.'}</p></div>`;
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
    const primary = hybridSession.plan.sourceEntries?.primary || [];
    const secondary = hybridSession.plan.sourceEntries?.secondary || [];
    const result = compositeResolvedEntries(hybridSession.plan);
    const all = [...primary, ...secondary, ...result];
    const startBeat = all.length ? Math.max(0, Math.min(...all.map(entry => entry.startBeat))) : 0;
    const endBeat = all.length ? Math.max(startBeat + 1, ...all.map(entryLastBeat))
        : Math.max(1, hybridSession.plan.beats.length - 1);
    return {
        names,
        context: { startBeat, endBeat },
        conflict: { resolution: 'ready' },
        lanes: [
            { id: 'primary', entries: primary },
            { id: 'secondary', entries: secondary },
            { id: 'result', entries: result },
        ],
    };
}

function currentPreviewView() {
    return currentConflictView() || wholePlanPreviewView();
}

function setCompositeContextLoop(view) {
    const region = compositePreviewRegionPure(view.context, hybridSession.plan.beats);
    _setBarSel(region);
    _setLoopRegionEnabled(true);
    host.editorSeekToTime(region.startTime);
    return region;
}

function startCompositePreview(mode) {
    const view = currentPreviewView();
    if (!view) return;
    rememberCompositePreviewSession();
    if (S.playing) stopPlayback();
    editorClearGuidePreview();
    const lane = view.lanes.find(candidate => candidate.id === mode);
    const events = mode === 'song' ? [] : compositePreviewEventsPure(
        lane ? lane.entries : [], hybridSession.plan.primary, hybridSession.plan.beats,
        hybridSession.plan.compatibility.stringCount);
    editorSetGuidePreview(events, arrKind(hybridSession.plan.primary));
    setCompositeContextLoop(view);
    hybridSession.previewMode = mode;
    startPlayback();
    hybridSession.previewPlaying = !!S.playing;
    updateCompositePreviewButtons();
    const label = mode === 'song' ? 'song audio' : mode === 'result'
        ? 'hybrid guide over song audio' : `${view.names[mode]} guide over song audio`;
    setStatus(`Hybrid preview: playing ${label}.`);
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

function renderConflict(plan) {
    if (!plan.conflicts.length) {
        return `<div class="rounded border border-emerald-700/50 bg-emerald-950/20 p-4 text-sm text-emerald-100 flex flex-wrap items-center justify-between gap-3">`
            + `<div><b class="block text-base mb-1">No choices needed</b>The tracks match here, or only one track is playing at a time. The hybrid is ready to create.</div>`
            + `<button type="button" id="editor-composite-edit-settings" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">Back and adjust</button></div>`;
    }
    hybridSession.conflictIndex = Math.max(0, Math.min(hybridSession.conflictIndex, plan.conflicts.length - 1));
    const group = plan.conflicts[hybridSession.conflictIndex];
    const repeatContext = guidedRepeatContext(plan, group);
    const repeatBadge = repeatContext?.grouped
        ? `<span class="inline-block mt-1 rounded-full bg-sky-950/70 px-2 py-0.5 text-xs text-sky-200">Applies to ${repeatContext.members.length} matching sections</span>` : '';
    const names = selectedSourceNames();
    const draft = hybridSession.customDrafts.get(group.id);
    const view = buildCompositeConflictViewModel({
        plan,
        conflictIndex: hybridSession.conflictIndex,
        primaryName: names.primary,
        secondaryName: names.secondary,
        customEntryIds: Array.isArray(draft) ? draft : null,
    });
    const resolvedClass = group.validationError ? 'border-red-700/60'
        : group.resolution ? 'border-emerald-700/60' : 'border-amber-700/60';
    const unresolved = repeatContext
        ? repeatContext.unresolvedDecisions
        : plan.conflicts.filter(conflict => !conflict.resolution).length;
    const stateClass = group.validationError ? 'bg-red-900/70 text-red-200'
        : group.resolution ? 'bg-emerald-900/70 text-emerald-200'
            : 'bg-amber-900/70 text-amber-100';
    const stateLabel = group.validationError ? 'Choice needs attention'
        : group.resolution ? 'Choice made' : 'Needs review';
    const rangeLabel = `${group.label} · ${conflictReason(group)}`;
    const resolutionButtons = `<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">`
        + `<button type="button" data-resolution="primary" aria-pressed="${group.resolution === 'primary'}" class="text-left px-3 py-3 rounded-lg border text-sm ${group.resolution === 'primary' ? 'bg-sky-900/70 border-sky-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-sky-500'}"><b class="block text-sky-300">Play ${_editorEscHtml(names.primary)} here</b><span class="text-xs text-gray-400">Use this track for the complete section</span>${repeatBadge}</button>`
        + `<button type="button" data-resolution="secondary" aria-pressed="${group.resolution === 'secondary'}" class="text-left px-3 py-3 rounded-lg border text-sm ${group.resolution === 'secondary' ? 'bg-violet-900/70 border-violet-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-violet-500'}"><b class="block text-violet-300">Play ${_editorEscHtml(names.secondary)} here</b><span class="text-xs text-gray-400">Use this track for the complete section</span>${repeatBadge}</button>`
        + `<button type="button" data-resolution="custom" aria-pressed="${hybridSession.customDrafts.has(group.id) || group.resolution === 'custom'}" class="text-left px-3 py-3 rounded-lg border text-sm ${hybridSession.customDrafts.has(group.id) || group.resolution === 'custom' ? 'bg-amber-900/70 border-amber-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-amber-500'}"><b class="block text-amber-300">Mix notes manually</b><span class="text-xs text-gray-400">Advanced: choose notes from either track</span>${repeatBadge}</button></div>`;
    const splitMarkup = group.splitPoints && group.splitPoints.length
        ? `<div><b class="text-gray-300">Divide this review section at a bar</b><p class="mt-0.5">Use this if the musical part changes inside the highlighted area.</p><div class="flex flex-wrap gap-1 mt-2">${group.splitPoints.map(point => `<button type="button" data-guided-split-beat="${point.beat}" class="px-2 py-1 rounded border border-gray-600 bg-dark-700 hover:border-gray-400">${_editorEscHtml(point.label)}</button>`).join('')}</div></div>`
        : '';
    const decisionNumber = repeatContext ? repeatContext.groupIndex + 1 : hybridSession.conflictIndex + 1;
    const decisionTotal = repeatContext ? repeatContext.groups.length : plan.conflicts.length;
    const canReset = repeatContext
        ? repeatContext.members.some(candidate => candidate.block.resolution
            || hybridSession.customDrafts.has(candidate.block.id))
        : group.resolution || hybridSession.customDrafts.has(group.id);
    return `<section class="rounded border ${resolvedClass} bg-dark-800/70 p-3">`
        + `<div class="flex flex-wrap items-start justify-between gap-3 mb-3">`
        + `<div><div class="flex flex-wrap items-center gap-2"><h4 class="text-base font-semibold">Section ${decisionNumber} of ${decisionTotal}</h4>`
        + `<span class="rounded-full px-2 py-0.5 text-xs ${stateClass}">${stateLabel}</span>`
        + `<span class="text-xs text-gray-400">${unresolved} left</span></div>`
        + `<p class="text-xs text-gray-300 mt-1">${_editorEscHtml(rangeLabel)}</p></div>`
        + `<div class="flex flex-wrap gap-1"><button type="button" id="editor-composite-edit-settings" class="px-2.5 py-1.5 bg-dark-700 hover:bg-dark-600 rounded text-xs">Back and adjust</button>`
        + `<button type="button" id="editor-composite-prev" aria-label="Previous review section" class="px-2.5 py-1.5 bg-dark-700 rounded text-xs disabled:opacity-40" ${decisionNumber <= 1 ? 'disabled' : ''}>← Previous</button>`
        + `<button type="button" id="editor-composite-next" aria-label="Next review section" class="px-2.5 py-1.5 bg-dark-700 rounded text-xs disabled:opacity-40" ${decisionNumber >= decisionTotal ? 'disabled' : ''}>Next →</button></div></div>`
        + guidedOccurrenceMarkup(repeatContext, group)
        + renderPreviewControls(view)
        + `<div class="overflow-x-auto rounded-xl border border-gray-700/70 bg-slate-950">${renderCompositeConflictTabSvg(view)}</div>`
        + `<details class="mt-3 rounded-lg border border-gray-700 bg-dark-900/50 px-3 py-2 text-xs"><summary class="cursor-pointer text-gray-300 hover:text-white">Why does this section need review?</summary>`
        + `<p class="text-xs text-gray-200 mt-2">${_editorEscHtml(view.explanation)}</p>${renderCompositeDifferenceTable(view)}</details>`
        + `<div class="mt-3"><div class="text-xs font-semibold text-gray-300 mb-1.5">Choose what to play</div>`
        + `${resolutionButtons}</div>${customMarkup(group)}`
        + `<details class="mt-3 text-xs text-gray-400"><summary class="cursor-pointer hover:text-gray-200">More options and technical details</summary><div class="space-y-3 mt-2">${splitMarkup}<details class="text-xs text-gray-400"><summary class="cursor-pointer hover:text-gray-200">Technical note details</summary><div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">`
        + `<div><b class="text-sky-300">${_editorEscHtml(names.primary)}</b><ul>${group.primaryEntries.map(e => entryMarkup(e, '', plan.compatibility.stringCount)).join('')}</ul></div>`
        + `<div><b class="text-violet-300">${_editorEscHtml(names.secondary)}</b><ul>${group.secondaryEntries.map(e => entryMarkup(e, '', plan.compatibility.stringCount)).join('')}</ul></div></div></details></div></details>`
        + `<div class="sticky bottom-0 flex flex-wrap justify-end gap-2 mt-3 p-3 border border-gray-700 rounded-lg bg-dark-800/95 shadow-lg"><button type="button" id="editor-composite-reset-choice" class="px-3 py-2 rounded bg-dark-700 hover:bg-dark-600 text-sm disabled:opacity-40" ${canReset ? '' : 'disabled'}>Clear choice</button>`
        + `<button type="button" id="editor-composite-apply-next" class="px-4 py-2 rounded bg-accent hover:bg-accent-light text-sm font-medium disabled:opacity-40" ${group.resolution ? '' : 'disabled'}>Confirm choice &amp; continue →</button></div></section>`;
}

function bindResultEvents() {
    const result = byId('editor-composite-result');
    if (!result || !hybridSession.plan) return;
    for (const marker of result.querySelectorAll('[data-conflict-index]')) {
        marker.addEventListener('click', () => {
            hybridSession.conflictIndex = Number(marker.dataset.conflictIndex) || 0;
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
            for (const replacedId of split.replacedBlockIds || [block.id]) hybridSession.customDrafts.delete(replacedId);
            hybridSession.conflictIndex = split.index;
            renderResult();
        });
    }
    byId('editor-composite-edit-settings')?.addEventListener('click', () => {
        endCompositePreviewPlayback();
        setCompositeReviewMode(false);
        byId('editor-composite-primary')?.focus();
    });
    const moveDecision = offset => {
        const block = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        const context = guidedRepeatContext(hybridSession.plan, block);
        const target = context?.groups[context.groupIndex + offset];
        if (target) activateGuidedReviewGroup(hybridSession.plan, target, false);
        renderResult();
    };
    byId('editor-composite-prev')?.addEventListener('click', () => moveDecision(-1));
    byId('editor-composite-next')?.addEventListener('click', () => moveDecision(1));
    for (const button of result.querySelectorAll('[data-composite-preview]')) {
        button.addEventListener('click', () => startCompositePreview(button.dataset.compositePreview));
    }
    byId('editor-composite-preview-stop')?.addEventListener('click', endCompositePreviewPlayback);
    byId('editor-composite-keep-loop')?.addEventListener('click', keepCompositeContextLoop);
    for (const button of result.querySelectorAll('[data-resolution]')) {
        button.addEventListener('click', () => {
            const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
            const resolution = button.dataset.resolution;
            if (resolution === 'custom') {
                if (!hybridSession.customDrafts.has(conflict.id)) {
                    hybridSession.customDrafts.set(conflict.id, conflict.resolution === 'custom'
                        ? [...conflict.selectedEntryIds]
                        : conflict.primaryEntries.map(e => e.id));
                }
                const draft = hybridSession.customDrafts.get(conflict.id);
                resolveGuidedRepeatGroup(hybridSession.plan, conflict.id, 'custom', draft);
            } else {
                const repeatContext = guidedRepeatContext(hybridSession.plan, conflict);
                for (const member of repeatContext?.members || [{ block: conflict }]) {
                    hybridSession.customDrafts.delete(member.block.id);
                }
                resolveGuidedRepeatGroup(hybridSession.plan, conflict.id, resolution);
            }
            renderResult();
        });
    }
    const toggleCustomEntry = entryId => {
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        const draft = new Set(hybridSession.customDrafts.get(conflict.id)
            || (conflict.resolution === 'custom' ? conflict.selectedEntryIds : []));
        const unitIds = compositeSelectionUnitIds(conflict, entryId);
        const selected = unitIds.length && unitIds.every(unitId => draft.has(unitId));
        for (const unitId of unitIds) {
            if (selected) draft.delete(unitId);
            else draft.add(unitId);
        }
        hybridSession.customDrafts.set(conflict.id, [...draft]);
        resolveGuidedRepeatGroup(hybridSession.plan, conflict.id, 'custom', [...draft]);
        renderResult();
    };
    for (const checkbox of result.querySelectorAll('[data-entry-id]')) {
        checkbox.addEventListener('change', () => {
            toggleCustomEntry(checkbox.dataset.entryId);
        });
    }
    for (const note of result.querySelectorAll('[data-composite-entry-id]')) {
        note.addEventListener('click', () => toggleCustomEntry(note.dataset.compositeEntryId));
        note.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggleCustomEntry(note.dataset.compositeEntryId);
        });
    }
    byId('editor-composite-reset-choice')?.addEventListener('click', () => {
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        const context = guidedRepeatContext(hybridSession.plan, conflict);
        for (const member of context?.members || [{ block: conflict }]) hybridSession.customDrafts.delete(member.block.id);
        clearGuidedRepeatGroup(hybridSession.plan, conflict.id);
        renderResult();
    });
    byId('editor-composite-detach-occurrence')?.addEventListener('click', () => {
        const conflict = hybridSession.plan.conflicts[hybridSession.conflictIndex];
        hybridSession.customDrafts.delete(conflict.id);
        const detached = detachGuidedRepeatOccurrence(hybridSession.plan, conflict.id);
        if (!detached.ok) conflict.validationError = detached.error;
        renderResult();
    });
    byId('editor-composite-apply-next')?.addEventListener('click', () => {
        const context = guidedRepeatContext(hybridSession.plan, hybridSession.plan.conflicts[hybridSession.conflictIndex]);
        let target = null;
        for (let offset = 1; offset < context.groups.length; offset++) {
            const candidate = context.groups[(context.groupIndex + offset) % context.groups.length];
            if (candidate.memberIds.some(id => {
                const block = hybridSession.plan.conflicts.find(item => item.id === id);
                return block && !block.resolution;
            })) { target = candidate; break; }
        }
        if (target) activateGuidedReviewGroup(hybridSession.plan, target);
        renderResult();
    });
}

export function _compositeAutomaticSummaryPure(stats = {}, names = {}) {
    const base = String(names.primary || 'Base track');
    const fill = String(names.secondary || 'Fill track');
    const added = Math.max(0, Number(stats.secondaryAddedCleanly) || 0);
    const skipped = Math.max(0, Number(stats.secondarySkippedByStrategy) || 0);
    return {
        title: 'Ready to create',
        description: `${base} stays unchanged. ${added} ${fill} ${added === 1 ? 'note was' : 'notes were'} added in safe gaps. ${skipped} ${fill} ${skipped === 1 ? 'note was' : 'notes were'} left out because ${skipped === 1 ? 'it was' : 'they were'} too close to ${base}.`,
        added,
        skipped,
    };
}

function renderAutomaticOverview(plan, names) {
    const all = [...(plan.sourceEntries?.primary || []), ...(plan.sourceEntries?.secondary || [])];
    if (!all.length) return '';
    const start = Math.min(...all.map(entry => entry.startBeat));
    const end = Math.max(start + 1, ...all.map(entryLastBeat));
    const additions = plan.fixedEntries.filter(entry => entry.source === 'secondary').map(entry => {
        const left = ((entry.startBeat - start) / (end - start)) * 100;
        const width = Math.max(0.25, ((entryLastBeat(entry) - entry.startBeat) / (end - start)) * 100);
        return `<span class="absolute inset-y-0 rounded bg-violet-400" style="left:${left}%;width:${width}%" title="Added from ${_editorEscHtml(names.secondary)}"></span>`;
    }).join('');
    return `<div class="rounded-lg border border-gray-700 bg-dark-900/60 px-3 py-3 mb-3" aria-label="Where fill-track notes were added">`
        + `<div class="flex flex-wrap justify-between gap-2 text-xs mb-2"><b class="text-gray-200">Where notes were added</b><span class="text-gray-400"><span aria-hidden="true" class="text-violet-300">●</span> ${_editorEscHtml(names.secondary)} added to the hybrid</span></div>`
        + `<div class="relative h-5 rounded bg-sky-950/70 border border-sky-900 overflow-hidden">${additions}</div>`
        + `<p class="text-xs text-gray-500 mt-1.5">The full bar represents the song. Colored marks show the safe gaps that received notes.</p></div>`;
}

function renderAutomaticResult(plan, names, normalizationDetails) {
    const summary = _compositeAutomaticSummaryPure(plan.stats, names);
    const preview = wholePlanPreviewView();
    return `<section class="max-w-5xl mx-auto">`
        + `<div class="rounded-xl border border-emerald-700/50 bg-emerald-950/20 p-5 mb-3">`
        + `<div class="flex flex-wrap items-start justify-between gap-3"><div><b class="block text-lg text-emerald-100">${summary.title}</b>`
        + `<p class="text-sm text-gray-200 mt-1 max-w-3xl">${_editorEscHtml(summary.description)}</p></div>`
        + `<button type="button" id="editor-composite-edit-settings" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">Back and adjust</button></div></div>`
        + renderAutomaticOverview(plan, names)
        + renderPreviewControls(preview, true)
        + normalizationDetails
        + `<p class="text-sm text-gray-400 mt-3">When the preview sounds right, choose <b class="text-gray-200">Create Hybrid Track</b> below. Your original tracks will remain unchanged.</p></section>`;
}

function renderResult() {
    if (hybridSession.previewMode) endCompositePreviewPlayback();
    const result = byId('editor-composite-result');
    if (!result || !hybridSession.plan) return;
    if (hybridSession.plan.strategy === 'guided') guidedReviewGroups(hybridSession.plan);
    const stats = hybridSession.plan.stats;
    const unresolvedBlocks = hybridSession.plan.conflicts.filter(c => !c.resolution).length;
    const unresolved = hybridSession.plan.strategy === 'guided'
        ? stats.unresolvedReviewDecisions : unresolvedBlocks;
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
    if (hybridSession.plan.strategy !== 'guided') {
        result.innerHTML = renderAutomaticResult(hybridSession.plan, names, normalizationNotice);
    } else {
        const occurrences = Math.max(stats.reviewDecisions || 0, stats.decisionBlocks || 0);
        const groupedText = occurrences > (stats.reviewDecisions || 0)
            ? ` across ${occurrences} song sections` : '';
        result.innerHTML = `<div class="mb-3 rounded-lg border border-gray-700 bg-dark-900/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2">`
            + `<div><b class="text-sm text-gray-100">${stats.reviewDecisions} ${stats.reviewDecisions === 1 ? 'choice' : 'choices'}${groupedText}</b>`
            + `<p class="text-xs text-gray-400">Choose which part you want to play in each different section.</p></div>`
            + `<b class="text-sm ${unresolved ? 'text-amber-300' : 'text-emerald-300'}">${unresolved ? `${unresolved} left` : 'All choices complete ✓'}</b></div>`
            + normalizationNotice + repeatNoticeMarkup + renderOverview(hybridSession.plan) + renderConflict(hybridSession.plan);
    }
    const finish = byId('editor-composite-finish');
    if (finish) {
        finish.hidden = false;
        finish.disabled = unresolvedBlocks > 0;
    }
    bindResultEvents();
}

function analyzeFromDialog() {
    restoreCompositePreviewSession();
    const primaryIndex = Number(byId('editor-composite-primary')?.value);
    const secondaryIndex = Number(byId('editor-composite-secondary')?.value);
    const strategy = selectedCompositeStrategy();
    const repeatMode = normalizeGuidedRepeatMode(byId('editor-composite-repeat-mode')?.value);
    const gapFill = gapFillOptionsFromDialog();
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
    if (primaryIndex === secondaryIndex) {
        if (error) error.textContent = 'Choose two different source tracks.';
        resetResult('The base track and fill track must be different.');
        return;
    }
    const sources = {
        primary: S.arrangements[primaryIndex],
        secondary: S.arrangements[secondaryIndex],
        beats: S.beats,
    };
    const plan = strategy === 'guided'
        ? analyzeGuidedComposite({ ...sources, sections: S.sections, repeatMode })
        : analyzeGapFillComposite({ ...sources, gapFill });
    if (!plan.ok) {
        if (error) error.textContent = plan.compatibility.errors.join(' ');
        resetResult('These tracks cannot be combined. Check that they use the same instrument, tuning, string count, and capo.');
        return;
    }
    if (error) error.textContent = '';
    hybridSession.plan = plan;
    hybridSession.conflictIndex = 0;
    hybridSession.customDrafts.clear();
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
    if (!hybridSession.plan) return;
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
        arrangement = materializeCompositeArrangement(hybridSession.plan, name);
    } catch (cause) {
        if (error) error.textContent = cause.message;
        return;
    }
    const finish = byId('editor-composite-finish');
    if (finish) finish.disabled = true;
    if (error) error.textContent = 'Creating the new Hybrid Track…';
    try {
        const response = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, arrangement }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
        S.history.exec(new CreateCompositeArrangementCmd(arrangement));
        editorHideCompositeArrangementModal();
        setStatus(`Created Hybrid Track “${name}” with ${arrangement.notes.length} notes. Save the song when you are ready.`);
    } catch (cause) {
        if (error) error.textContent = `Could not create the Hybrid Track: ${cause.message}`;
        if (finish) finish.disabled = false;
    }
}

export function editorHideCompositeArrangementModal() {
    restoreCompositePreviewSession();
    byId('editor-composite-modal')?.remove();
    clearTransientState();
}

export function editorShowCompositeArrangementModal() {
    editorHideCompositeArrangementModal();
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
    const secondary = sources.find(source => source.index !== primary).index;
    const name = _compositeUniqueNamePure(S.arrangements.map(arr => arr && arr.name));
    const gapFillPreferences = loadHybridGapFillPreferences();
    const gapFillUnit = gapFillPreferences.unit;
    const gapFillValues = gapFillPreferences[gapFillUnit]
        || compositeGapFillDefaultsForUnit(gapFillUnit);
    const guidedPreferences = loadHybridGuidedPreferences();
    const modal = document.createElement('div');
    modal.id = 'editor-composite-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4';
    modal.innerHTML = `<div class="max-w-full flex flex-col rounded-xl border border-gray-600 bg-dark-800 shadow-2xl" style="width:min(90rem, calc(100vw - 2rem));height:min(54rem, calc(100vh - 2rem))" role="dialog" aria-modal="true" aria-labelledby="editor-composite-title">`
        + `<header class="flex items-start justify-between gap-4 border-b border-gray-700 px-5 py-3"><div><h3 id="editor-composite-title" class="text-lg font-semibold">Create a Hybrid Guitar Track</h3>`
        + `<p class="text-sm text-gray-400 mt-0.5">Combine two synchronized guitar or bass parts into one playable track. Your original tracks stay unchanged.</p></div>`
        + `<button type="button" id="editor-composite-close" class="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button></header>`
        + `<div id="editor-composite-workspace" class="grid min-h-0 flex-1 overflow-hidden" style="grid-template-columns:minmax(0,1fr)">`
        + renderHybridSetupView({
            sources, name, gapFillUnit, gapFillValues,
            guidedRepeatMode: guidedPreferences.repeatMode,
        })
        + `<main id="editor-composite-result-workspace" hidden class="p-4 min-h-0 overflow-y-auto"><div id="editor-composite-result"><p class="text-sm text-gray-400">Choose two tracks and how you want to build the hybrid.</p></div></main></div>`
        + `<footer class="border-t border-gray-700 px-5 py-3 flex items-center gap-3"><div id="editor-composite-error" class="text-sm text-red-300 flex-1" role="alert" aria-live="polite"></div>`
        + `<button type="button" id="editor-composite-cancel" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm">Cancel</button>`
        + `<button type="button" id="editor-composite-analyze" class="px-4 py-2 rounded bg-accent hover:bg-accent-light text-sm font-medium">Preview automatic hybrid</button>`
        + `<button type="button" id="editor-composite-finish" hidden disabled class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">Create Hybrid Track</button></footer></div>`;
    (document.querySelector('.editor-root') || document.body).appendChild(modal);
    byId('editor-composite-primary').value = String(primary);
    byId('editor-composite-secondary').value = String(secondary);
    byId('editor-composite-close').addEventListener('click', editorHideCompositeArrangementModal);
    byId('editor-composite-cancel').addEventListener('click', editorHideCompositeArrangementModal);
    byId('editor-composite-analyze').addEventListener('click', analyzeFromDialog);
    byId('editor-composite-finish').addEventListener('click', finishMerge);
    const strategyInputs = [...document.querySelectorAll('input[name="editor-composite-strategy"]')];
    const unitSelect = byId('editor-composite-gap-unit');
    const repeatModeSelect = byId('editor-composite-repeat-mode');
    let currentGapFillUnit = gapFillUnit;
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
            ? 'Find sections to review' : 'Preview automatic hybrid';
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
    for (const control of [byId('editor-composite-primary'), byId('editor-composite-secondary')]) {
        control.addEventListener('change', () => {
            resetResult('The selected tracks changed. Build the preview again when you are ready.');
        });
    }
    for (const input of strategyInputs) input.addEventListener('change', () => {
        syncModeControls();
        resetResult('The building method changed. Continue with the settings shown below.');
    });
    repeatModeSelect.addEventListener('change', () => {
        guidedPreferences.repeatMode = normalizeGuidedRepeatMode(repeatModeSelect.value);
        saveHybridGuidedPreferences(guidedPreferences);
        resetResult('The repeated-riff setting changed. Find the review sections again when you are ready.');
    });
    unitSelect.addEventListener('change', () => {
        rememberCurrentGapFillValues();
        currentGapFillUnit = unitSelect.value === 'seconds' ? 'seconds' : 'beats';
        gapFillPreferences.unit = currentGapFillUnit;
        applyGapFillUnitToDialog(currentGapFillUnit, gapFillPreferences[currentGapFillUnit]);
        saveHybridGapFillPreferences(gapFillPreferences);
        resetResult('The timing unit changed. Preview the automatic hybrid again when you are ready.');
    });
    for (const input of [byId('editor-composite-min-gap'), byId('editor-composite-margin')]) {
        input.addEventListener('change', () => {
            rememberCurrentGapFillValues();
            resetResult('The safety settings changed. Preview the automatic hybrid again when you are ready.');
        });
    }
    applyGapFillUnitToDialog(gapFillUnit, gapFillValues);
    syncModeControls();
    _installModalKeyboard(modal, modal.firstElementChild, editorHideCompositeArrangementModal);
    byId('editor-composite-primary').focus();
    return true;
}
