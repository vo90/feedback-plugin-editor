/* Composite-arrangement resolver.
 *
 * This is the thin Editor integration over merge-engine.js: source/strategy
 * selection, Git-like conflict hunks, server-session registration, and one
 * structural history command. The merge rules remain DOM-free and testable.
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
    analyzeCompositeMerge,
    clearCompositeConflictResolution,
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    compositeGapFillDefaultsForUnit,
    compositeSelectionUnitIds,
    materializeCompositeArrangement,
    normalizeCompositeGapFillOptions,
    resolveCompositeConflict,
} from './merge-engine.js';
import {
    analyzeGuidedComposite,
    clearGuidedRepeatGroup,
    detachGuidedRepeatOccurrence,
    GUIDED_REPEAT_MODE_EVERY,
    GUIDED_REPEAT_MODE_MATCHING,
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

let activePlan = null;
let activeConflictIndex = 0;
let activePreviewMode = '';
let compositePreviewPlaying = false;
let compositePreviewRestore = null;
const customDrafts = new Map();
const COMPOSITE_GAP_FILL_PREFS_KEY = 'editorCompositeGapFill';
const COMPOSITE_GUIDED_PREFS_KEY = 'editorCompositeGuided';
const COMPOSITE_GAP_FILL_CONTROL_CONFIG = Object.freeze({
    beats: Object.freeze({ minimumMax: 16, minimumStep: 0.25, marginMax: 8, marginStep: 0.125 }),
    seconds: Object.freeze({ minimumMax: 30, minimumStep: 0.05, marginMax: 10, marginStep: 0.025 }),
});

function preferenceValuesForUnit(unit, value) {
    const normalized = normalizeCompositeGapFillOptions({ unit, ...(value || {}) });
    return {
        minimumGap: normalized.minimumGap,
        transitionMargin: normalized.transitionMargin,
    };
}

export function _compositeGapFillPreferencesPure(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const unit = parsed.unit === 'seconds' ? 'seconds' : 'beats';
    return {
        unit,
        beats: preferenceValuesForUnit('beats', parsed.beats),
        seconds: preferenceValuesForUnit('seconds', parsed.seconds),
    };
}

function loadCompositeGapFillPreferences() {
    let raw = null;
    try { raw = localStorage.getItem(COMPOSITE_GAP_FILL_PREFS_KEY); } catch (_) { /* blocked storage */ }
    return _compositeGapFillPreferencesPure(raw);
}

function saveCompositeGapFillPreferences(preferences) {
    try { localStorage.setItem(COMPOSITE_GAP_FILL_PREFS_KEY, JSON.stringify(preferences)); } catch (_) { /* blocked storage */ }
}

export function _compositeGuidedPreferencesPure(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    return { repeatMode: normalizeGuidedRepeatMode(parsed.repeatMode) };
}

function loadCompositeGuidedPreferences() {
    let raw = null;
    try { raw = localStorage.getItem(COMPOSITE_GUIDED_PREFS_KEY); } catch (_) { /* blocked storage */ }
    return _compositeGuidedPreferencesPure(raw);
}

function saveCompositeGuidedPreferences(preferences) {
    try { localStorage.setItem(COMPOSITE_GUIDED_PREFS_KEY, JSON.stringify(preferences)); } catch (_) { /* blocked storage */ }
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

function applyGapFillUnitToDialog(unit, values) {
    const normalized = normalizeCompositeGapFillOptions({ unit, ...(values || {}) });
    const config = COMPOSITE_GAP_FILL_CONTROL_CONFIG[normalized.unit];
    const minGap = byId('editor-composite-min-gap');
    const margin = byId('editor-composite-margin');
    const unitLabel = normalized.unit === 'seconds' ? 'seconds' : 'beats';
    const minLabel = byId('editor-composite-min-gap-label');
    const marginLabel = byId('editor-composite-margin-label');
    if (minLabel) minLabel.textContent = `Minimum usable gap (${unitLabel})`;
    if (marginLabel) marginLabel.textContent = `Transition margin each side (${unitLabel})`;
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
    if (compositePreviewRestore) return;
    compositePreviewRestore = {
        barSel: cloneLoopRegion(S.barSel),
        loopEnabled: !!S.loopEnabled,
        cursorTime: Number(S.cursorTime) || 0,
    };
}

function updateCompositePreviewButtons() {
    for (const button of document.querySelectorAll('[data-composite-preview]')) {
        const active = button.dataset.compositePreview === activePreviewMode;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('ring-2', active);
        button.classList.toggle('ring-emerald-400', active);
    }
    const stop = byId('editor-composite-preview-stop');
    if (stop) stop.disabled = !compositePreviewPlaying;
}

function endCompositePreviewPlayback() {
    const hadPreview = compositePreviewPlaying || !!activePreviewMode;
    if (compositePreviewPlaying && S.playing) stopPlayback();
    editorClearGuidePreview();
    compositePreviewPlaying = false;
    activePreviewMode = '';
    updateCompositePreviewButtons();
    if (hadPreview) setStatus('Composite preview stopped.');
}

function restoreCompositePreviewSession() {
    endCompositePreviewPlayback();
    if (!compositePreviewRestore) return;
    const restore = compositePreviewRestore;
    compositePreviewRestore = null;
    _setBarSel(restore.barSel);
    _setLoopRegionEnabled(restore.loopEnabled);
    host.editorSeekToTime(restore.cursorTime);
}

function clearTransientState() {
    activePlan = null;
    activeConflictIndex = 0;
    customDrafts.clear();
}

function resetResult(message = 'Choose two source tracks and analyze the merge.') {
    restoreCompositePreviewSession();
    clearTransientState();
    const result = byId('editor-composite-result');
    if (result) result.innerHTML = `<p class="text-xs text-gray-400">${_editorEscHtml(message)}</p>`;
    const finish = byId('editor-composite-finish');
    if (finish) finish.disabled = true;
}

function setCompositeReviewMode(reviewing) {
    const workspace = byId('editor-composite-workspace');
    const setup = byId('editor-composite-setup');
    if (setup) setup.hidden = reviewing;
    if (workspace) workspace.style.gridTemplateColumns = reviewing
        ? 'minmax(0, 1fr)' : '18rem minmax(0, 1fr)';
}

function optionMarkup(source) {
    return `<option value="${source.index}">${_editorEscHtml(source.arrangement.name || `Track ${source.index + 1}`)}</option>`;
}

function noteTechLabel(note) {
    return compositeTechniqueLabels(note).join(', ');
}

function entryMarkup(entry, checkboxName = '', stringCount = 6) {
    const length = Math.max(0, entry.endBeat - entry.startBeat);
    const tech = noteTechLabel(entry.note);
    const displayString = Math.max(1, stringCount - entry.string);
    const body = `<span class="font-mono text-gray-200">Beat ${entry.startBeat.toFixed(3)}</span>`
        + `<span class="text-gray-400">S${displayString} · F${entry.fret}</span>`
        + (length > 1e-4 ? `<span class="text-gray-500">${length.toFixed(3)} beats</span>` : '')
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
        primary: S.arrangements[primaryIndex]?.name || 'Primary',
        secondary: S.arrangements[secondaryIndex]?.name || 'Secondary',
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
        + `<div class="flex flex-wrap items-center justify-between gap-2"><div><b class="text-xs text-sky-100">Matching repetition group</b>`
        + `<p class="text-[10px] text-sky-200/70">This choice applies to ${context.members.length} musically matching occurrences. Select one below to inspect or audition its surrounding context.</p></div>`
        + `<button type="button" id="editor-composite-detach-occurrence" class="px-2 py-1 rounded bg-dark-700 hover:bg-dark-600 text-[10px]">Review this occurrence separately</button></div>`
        + `<div class="flex flex-wrap gap-1.5 mt-2">${chips}</div></div>`;
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
    activeConflictIndex = index;
    return true;
}

function renderOverview(plan) {
    if (plan.strategy === 'guided') {
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
            const current = index === activeConflictIndex;
            const stateClass = block.validationError ? 'bg-red-500'
                : block.resolution ? 'bg-emerald-500' : 'bg-amber-500';
            const state = block.validationError ? 'Invalid transition'
                : block.resolution ? 'Resolved' : 'Needs a choice';
            return `<button type="button" data-conflict-index="${index}" aria-label="${state}: ${_editorEscHtml(block.label)}" aria-current="${current ? 'true' : 'false'}" class="absolute top-0 h-4 ${stateClass} ${current ? 'ring-2 ring-white ring-inset' : ''}"`
                + ` style="left:${left}%;width:${width}%" title="${_editorEscHtml(`${block.label} · ${state}`)}"></button>`;
        }).join('');
        return `<div class="mb-3"><div class="flex flex-wrap justify-between gap-2 text-[10px] text-gray-500 mb-1"><span>Guided song overview</span>`
            + `<span>gray identical/empty · blue primary · violet secondary · amber review · green resolved · red invalid</span></div>`
            + `<div class="relative h-4 rounded bg-dark-900 overflow-hidden">${automatic}${decisions}</div></div>`;
    }
    if (!plan.conflicts.length) return '';
    const all = [...plan.fixedEntries, ...plan.conflicts.flatMap(c => [...c.primaryEntries, ...c.secondaryEntries])];
    const start = Math.min(...all.map(e => e.startBeat));
    const end = Math.max(start + 1, ...all.map(e => e.effectiveEndBeat));
    const markers = plan.conflicts.map((conflict, index) => {
        const left = ((conflict.startBeat - start) / (end - start)) * 100;
        const width = Math.max(0.7, ((conflict.endBeat - conflict.startBeat) / (end - start)) * 100);
        const resolved = !!conflict.resolution;
        const current = index === activeConflictIndex;
        return `<button type="button" data-conflict-index="${index}" aria-label="${resolved ? 'Resolved' : 'Unresolved'} conflict ${index + 1}" aria-current="${current ? 'true' : 'false'}" class="absolute top-0 h-3 rounded-sm ${resolved ? 'bg-emerald-500' : 'bg-red-500'} ${current ? 'ring-2 ring-white ring-inset' : ''}"`
            + ` style="left:${left}%;width:${width}%" title="${resolved ? 'Resolved' : 'Unresolved'} conflict ${index + 1}"></button>`;
    }).join('');
    return `<div class="mb-3"><div class="flex justify-between text-[10px] text-gray-500 mb-1"><span>Merge overview</span><span>red unresolved · green resolved</span></div>`
        + `<div class="relative h-3 rounded bg-dark-900 overflow-hidden">${markers}</div></div>`;
}

function customMarkup(group) {
    const draft = customDrafts.get(group.id)
        || (group.resolution === 'custom' ? group.selectedEntryIds : null);
    if (!draft) return '';
    const checked = new Set(draft);
    const stringCount = activePlan?.compatibility?.stringCount || 6;
    const render = (entry) => entryMarkup(entry, `custom-${group.id}`, stringCount).replace(
        `data-entry-id="${entry.id}"`, `data-entry-id="${entry.id}"${checked.has(entry.id) ? ' checked' : ''}`);
    return `<div class="mt-3 border-t border-gray-700 pt-2">`
        + `<p class="text-[11px] text-gray-400 mb-1">Choose notes here or click them directly in either source tab. Cross-source notes may not overlap on one string.</p>`
        + [...group.primaryEntries, ...group.secondaryEntries].map(render).join('')
        + `<div id="editor-composite-custom-error" class="text-[11px] text-red-300 mt-1">${_editorEscHtml(group.validationError || '')}</div></div>`;
}

function renderPreviewControls(view) {
    const resultReady = !!view.conflict.resolution;
    const buttonClass = 'px-2.5 py-1.5 rounded border border-gray-600 bg-dark-700 hover:border-gray-400 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed';
    return `<div class="mb-3 rounded-lg border border-gray-700 bg-dark-900/70 px-3 py-2">`
        + `<div class="flex flex-wrap items-center gap-2"><span class="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mr-1">Audition this section</span>`
        + `<button type="button" data-composite-preview="song" aria-pressed="false" class="${buttonClass}" ${S.audioBuffer ? '' : 'disabled'}>▶ Song audio</button>`
        + `<button type="button" data-composite-preview="primary" aria-pressed="false" class="${buttonClass} text-sky-200">▶ ${_editorEscHtml(view.names.primary)} guide</button>`
        + `<button type="button" data-composite-preview="secondary" aria-pressed="false" class="${buttonClass} text-violet-200">▶ ${_editorEscHtml(view.names.secondary)} guide</button>`
        + `<button type="button" data-composite-preview="result" aria-pressed="false" class="${buttonClass} text-emerald-200" ${resultReady ? '' : 'disabled'}>▶ Result guide</button>`
        + `<button type="button" id="editor-composite-preview-stop" class="${buttonClass}" disabled>■ Stop</button>`
        + `<button type="button" id="editor-composite-keep-loop" class="ml-auto ${buttonClass}">Send section to Editor loop</button></div>`
        + `<p class="mt-1.5 text-[10px] text-gray-500">The selected bars loop automatically. Pitched guides play over the imported song audio; Song audio suppresses arrangement guides. Your metronome setting remains active.</p></div>`;
}

function currentConflictView() {
    if (!activePlan || !activePlan.conflicts.length) return null;
    const group = activePlan.conflicts[activeConflictIndex];
    const names = selectedSourceNames();
    const draft = customDrafts.get(group.id);
    return buildCompositeConflictViewModel({
        plan: activePlan,
        conflictIndex: activeConflictIndex,
        primaryName: names.primary,
        secondaryName: names.secondary,
        customEntryIds: Array.isArray(draft) ? draft : null,
    });
}

function setCompositeContextLoop(view) {
    const region = compositePreviewRegionPure(view.context, activePlan.beats);
    _setBarSel(region);
    _setLoopRegionEnabled(true);
    host.editorSeekToTime(region.startTime);
    return region;
}

function startCompositePreview(mode) {
    const view = currentConflictView();
    if (!view) return;
    rememberCompositePreviewSession();
    if (S.playing) stopPlayback();
    editorClearGuidePreview();
    const lane = view.lanes.find(candidate => candidate.id === mode);
    const events = mode === 'song' ? [] : compositePreviewEventsPure(
        lane ? lane.entries : [], activePlan.primary, activePlan.beats,
        activePlan.compatibility.stringCount);
    editorSetGuidePreview(events, arrKind(activePlan.primary));
    setCompositeContextLoop(view);
    activePreviewMode = mode;
    startPlayback();
    compositePreviewPlaying = !!S.playing;
    updateCompositePreviewButtons();
    const label = mode === 'song' ? 'song audio' : `${mode} guide over song audio`;
    setStatus(`Composite preview: looping ${label}.`);
}

function keepCompositeContextLoop() {
    const view = currentConflictView();
    if (!view) return;
    rememberCompositePreviewSession();
    endCompositePreviewPlayback();
    setCompositeContextLoop(view);
    // This button is an explicit handoff: do not restore the user's previous
    // loop when the resolver closes.
    compositePreviewRestore = null;
    const button = byId('editor-composite-keep-loop');
    if (button) button.textContent = 'Editor loop set ✓';
    setStatus('Conflict context sent to the Editor loop. It will remain after you close the resolver.');
}

function renderConflict(plan) {
    const guided = plan.strategy === 'guided';
    if (!plan.conflicts.length) {
        return `<div class="rounded border border-emerald-700/50 bg-emerald-950/20 p-4 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-3">`
            + `<div><b class="block text-sm mb-1">${guided ? 'No review needed' : 'No manual conflicts'}</b>${guided ? 'The two tracks are identical or contain only unambiguous single-source material.' : 'The analyzed merge is ready to finish.'}</div>`
            + `<button type="button" id="editor-composite-edit-settings" class="px-2.5 py-1.5 bg-dark-700 hover:bg-dark-600 rounded text-xs text-gray-200">Edit setup</button></div>`;
    }
    activeConflictIndex = Math.max(0, Math.min(activeConflictIndex, plan.conflicts.length - 1));
    const group = plan.conflicts[activeConflictIndex];
    const repeatContext = guided ? guidedRepeatContext(plan, group) : null;
    const repeatCountSuffix = repeatContext?.grouped ? ` for all ${repeatContext.members.length}` : '';
    const names = selectedSourceNames();
    const draft = customDrafts.get(group.id);
    const view = buildCompositeConflictViewModel({
        plan,
        conflictIndex: activeConflictIndex,
        primaryName: names.primary,
        secondaryName: names.secondary,
        customEntryIds: Array.isArray(draft) ? draft : null,
    });
    const resolvedClass = group.validationError ? 'border-red-700/60'
        : group.resolution ? 'border-emerald-700/60' : guided ? 'border-amber-700/60' : 'border-red-700/60';
    const unresolved = repeatContext
        ? repeatContext.unresolvedDecisions
        : plan.conflicts.filter(conflict => !conflict.resolution).length;
    const stateClass = group.validationError ? 'bg-red-900/70 text-red-200'
        : group.resolution ? 'bg-emerald-900/70 text-emerald-200'
            : guided ? 'bg-amber-900/70 text-amber-100' : 'bg-red-900/70 text-red-200';
    const stateLabel = group.validationError ? 'Invalid transition'
        : group.resolution ? 'Resolved' : 'Needs a choice';
    const rangeLabel = guided && group.label
        ? `${group.label} · ${conflictReason(group)}`
        : `Beats ${group.startBeat.toFixed(3)}–${group.endBeat.toFixed(3)} · ${conflictReason(group)}`;
    const resolutionButtons = guided
        ? `<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">`
            + `<button type="button" data-resolution="primary" aria-pressed="${group.resolution === 'primary'}" class="text-left px-3 py-2 rounded-lg border text-xs ${group.resolution === 'primary' ? 'bg-sky-900/70 border-sky-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-sky-500'}"><b class="block text-sky-300">Use ${_editorEscHtml(names.primary)}${repeatCountSuffix}</b><span class="text-[10px] text-gray-400">Choose this arrangement for the complete ${repeatContext?.grouped ? 'repetition group' : 'block'}</span></button>`
            + `<button type="button" data-resolution="secondary" aria-pressed="${group.resolution === 'secondary'}" class="text-left px-3 py-2 rounded-lg border text-xs ${group.resolution === 'secondary' ? 'bg-violet-900/70 border-violet-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-violet-500'}"><b class="block text-violet-300">Use ${_editorEscHtml(names.secondary)}${repeatCountSuffix}</b><span class="text-[10px] text-gray-400">Choose this arrangement for the complete ${repeatContext?.grouped ? 'repetition group' : 'block'}</span></button>`
            + `<button type="button" data-resolution="custom" aria-pressed="${customDrafts.has(group.id) || group.resolution === 'custom'}" class="text-left px-3 py-2 rounded-lg border text-xs ${customDrafts.has(group.id) || group.resolution === 'custom' ? 'bg-amber-900/70 border-amber-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-amber-500'}"><b class="block text-amber-300">Custom selection${repeatCountSuffix}</b><span class="text-[10px] text-gray-400">Pick complete notes and gestures from either track</span></button></div>`
        : `<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">`
            + `<button type="button" data-resolution="primary" aria-pressed="${group.resolution === 'primary'}" class="text-left px-3 py-2 rounded-lg border text-xs ${group.resolution === 'primary' ? 'bg-sky-900/70 border-sky-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-sky-500'}"><b class="block text-sky-300">Keep ${_editorEscHtml(names.primary)}</b><span class="text-[10px] text-gray-400">Use the complete primary gesture</span></button>`
            + `<button type="button" data-resolution="secondary" aria-pressed="${group.resolution === 'secondary'}" class="text-left px-3 py-2 rounded-lg border text-xs ${group.resolution === 'secondary' ? 'bg-violet-900/70 border-violet-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-violet-500'}"><b class="block text-violet-300">Use ${_editorEscHtml(names.secondary)}</b><span class="text-[10px] text-gray-400">Use the complete secondary gesture</span></button>`
            + `<button type="button" data-resolution="compatible" aria-pressed="${group.resolution === 'compatible'}" class="text-left px-3 py-2 rounded-lg border text-xs ${group.resolution === 'compatible' ? 'bg-emerald-900/70 border-emerald-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-emerald-500'}"><b class="block text-emerald-300">Combine compatible</b><span class="text-[10px] text-gray-400">Primary plus safe secondary notes</span></button>`
            + `<button type="button" data-resolution="custom" aria-pressed="${customDrafts.has(group.id)}" class="text-left px-3 py-2 rounded-lg border text-xs ${customDrafts.has(group.id) ? 'bg-amber-900/70 border-amber-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-amber-500'}"><b class="block text-amber-300">Custom selection</b><span class="text-[10px] text-gray-400">Pick notes directly from either tab</span></button></div>`;
    const splitMarkup = guided && group.splitPoints && group.splitPoints.length
        ? `<details class="text-[11px] text-gray-400"><summary class="cursor-pointer hover:text-gray-200">Split ${repeatContext?.grouped ? `all ${repeatContext.members.length} matching occurrences` : 'this block'} at a bar</summary><div class="flex flex-wrap gap-1 mt-2">${group.splitPoints.map(point => `<button type="button" data-guided-split-beat="${point.beat}" class="px-2 py-1 rounded border border-gray-600 bg-dark-700 hover:border-gray-400">${_editorEscHtml(point.label)}</button>`).join('')}</div></details>`
        : '';
    const decisionNumber = repeatContext ? repeatContext.groupIndex + 1 : activeConflictIndex + 1;
    const decisionTotal = repeatContext ? repeatContext.groups.length : plan.conflicts.length;
    const canReset = repeatContext
        ? repeatContext.members.some(candidate => candidate.block.resolution
            || customDrafts.has(candidate.block.id))
        : group.resolution || customDrafts.has(group.id);
    return `<section class="rounded border ${resolvedClass} bg-dark-800/70 p-3">`
        + `<div class="flex flex-wrap items-start justify-between gap-3 mb-3">`
        + `<div><div class="flex flex-wrap items-center gap-2"><h4 class="text-sm font-semibold">${guided ? 'Review decision' : 'Conflict'} ${decisionNumber} of ${decisionTotal}</h4>`
        + `<span class="rounded-full px-2 py-0.5 text-[10px] ${stateClass}">${stateLabel}</span>`
        + `<span class="text-[10px] text-gray-500">${unresolved} ${guided ? 'decisions left' : 'unresolved'}</span></div>`
        + `<p class="text-[11px] text-gray-400 mt-1">${_editorEscHtml(rangeLabel)}</p></div>`
        + `<div class="flex flex-wrap gap-1"><button type="button" id="editor-composite-edit-settings" class="px-2.5 py-1 bg-dark-700 hover:bg-dark-600 rounded text-xs">Edit setup</button>`
        + `<button type="button" id="editor-composite-prev" aria-label="Previous review decision" class="px-2 py-1 bg-dark-700 rounded text-xs disabled:opacity-40" ${decisionNumber <= 1 ? 'disabled' : ''}>←</button>`
        + `<button type="button" id="editor-composite-next" aria-label="Next review decision" class="px-2 py-1 bg-dark-700 rounded text-xs disabled:opacity-40" ${decisionNumber >= decisionTotal ? 'disabled' : ''}>→</button></div></div>`
        + guidedOccurrenceMarkup(repeatContext, group)
        + renderPreviewControls(view)
        + `<div class="overflow-x-auto rounded-xl border border-gray-700/70 bg-slate-950">${renderCompositeConflictTabSvg(view)}</div>`
        + `<div class="mt-3 rounded-lg border ${guided ? 'border-amber-800/40 bg-amber-950/20' : 'border-red-800/40 bg-red-950/20'} px-3 py-2">`
        + `<div class="text-[10px] uppercase tracking-wide ${guided ? 'text-amber-300' : 'text-red-300'} font-semibold">${guided ? 'Why this block needs review' : 'Why this needs a choice'}</div>`
        + `<p class="text-xs text-gray-200 mt-1">${_editorEscHtml(view.explanation)}</p>${renderCompositeDifferenceTable(view)}</div>`
        + `<div class="mt-3"><div class="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Build the merged result</div>`
        + `${resolutionButtons}</div>${customMarkup(group)}`
        + `<div class="flex flex-wrap justify-between items-center gap-2 mt-3 pt-3 border-t border-gray-700">`
        + `<div class="space-y-2">${splitMarkup}<details class="text-[11px] text-gray-400"><summary class="cursor-pointer hover:text-gray-200">Technical note details</summary><div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">`
        + `<div><b class="text-sky-300">${_editorEscHtml(names.primary)}</b><ul>${group.primaryEntries.map(e => entryMarkup(e, '', plan.compatibility.stringCount)).join('')}</ul></div>`
        + `<div><b class="text-violet-300">${_editorEscHtml(names.secondary)}</b><ul>${group.secondaryEntries.map(e => entryMarkup(e, '', plan.compatibility.stringCount)).join('')}</ul></div></div></details></div>`
        + `<div class="flex gap-2"><button type="button" id="editor-composite-reset-choice" class="px-2.5 py-1.5 rounded bg-dark-700 hover:bg-dark-600 text-xs disabled:opacity-40" ${canReset ? '' : 'disabled'}>Reset ${repeatContext?.grouped ? 'group ' : ''}choice</button>`
        + `<button type="button" id="editor-composite-apply-next" class="px-3 py-1.5 rounded bg-accent hover:bg-accent-light text-xs font-medium disabled:opacity-40" ${group.resolution ? '' : 'disabled'}>Apply &amp; Next →</button></div></div></section>`;
}

function bindResultEvents() {
    const result = byId('editor-composite-result');
    if (!result || !activePlan) return;
    for (const marker of result.querySelectorAll('[data-conflict-index]')) {
        marker.addEventListener('click', () => {
            activeConflictIndex = Number(marker.dataset.conflictIndex) || 0;
            renderResult();
        });
    }
    for (const button of result.querySelectorAll('[data-guided-split-beat]')) {
        button.addEventListener('click', () => {
            const block = activePlan.conflicts[activeConflictIndex];
            const split = splitGuidedRepeatGroup(activePlan, block.id,
                Number(button.dataset.guidedSplitBeat));
            if (!split.ok) {
                block.validationError = split.error;
                renderResult();
                return;
            }
            for (const replacedId of split.replacedBlockIds || [block.id]) customDrafts.delete(replacedId);
            activeConflictIndex = split.index;
            renderResult();
        });
    }
    byId('editor-composite-edit-settings')?.addEventListener('click', () => {
        endCompositePreviewPlayback();
        setCompositeReviewMode(false);
        byId('editor-composite-primary')?.focus();
    });
    const moveDecision = offset => {
        if (activePlan.strategy !== 'guided') {
            activeConflictIndex += offset;
        } else {
            const block = activePlan.conflicts[activeConflictIndex];
            const context = guidedRepeatContext(activePlan, block);
            const target = context?.groups[context.groupIndex + offset];
            if (target) activateGuidedReviewGroup(activePlan, target, false);
        }
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
            const conflict = activePlan.conflicts[activeConflictIndex];
            const resolution = button.dataset.resolution;
            if (resolution === 'custom') {
                if (!customDrafts.has(conflict.id)) {
                    customDrafts.set(conflict.id, conflict.resolution === 'custom'
                        ? [...conflict.selectedEntryIds]
                        : conflict.primaryEntries.map(e => e.id));
                }
                const draft = customDrafts.get(conflict.id);
                if (activePlan.strategy === 'guided') {
                    resolveGuidedRepeatGroup(activePlan, conflict.id, 'custom', draft);
                } else {
                    resolveCompositeConflict(activePlan, conflict.id, 'custom', draft);
                }
            } else {
                const repeatContext = activePlan.strategy === 'guided'
                    ? guidedRepeatContext(activePlan, conflict) : null;
                for (const member of repeatContext?.members || [{ block: conflict }]) {
                    customDrafts.delete(member.block.id);
                }
                if (activePlan.strategy === 'guided') {
                    resolveGuidedRepeatGroup(activePlan, conflict.id, resolution);
                } else {
                    resolveCompositeConflict(activePlan, conflict.id, resolution);
                }
            }
            renderResult();
        });
    }
    const toggleCustomEntry = entryId => {
        const conflict = activePlan.conflicts[activeConflictIndex];
        const draft = new Set(customDrafts.get(conflict.id)
            || (conflict.resolution === 'custom' ? conflict.selectedEntryIds : []));
        const unitIds = compositeSelectionUnitIds(conflict, entryId);
        const selected = unitIds.length && unitIds.every(unitId => draft.has(unitId));
        for (const unitId of unitIds) {
            if (selected) draft.delete(unitId);
            else draft.add(unitId);
        }
        customDrafts.set(conflict.id, [...draft]);
        if (activePlan.strategy === 'guided') {
            resolveGuidedRepeatGroup(activePlan, conflict.id, 'custom', [...draft]);
        } else {
            resolveCompositeConflict(activePlan, conflict.id, 'custom', [...draft]);
        }
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
        const conflict = activePlan.conflicts[activeConflictIndex];
        if (activePlan.strategy === 'guided') {
            const context = guidedRepeatContext(activePlan, conflict);
            for (const member of context?.members || [{ block: conflict }]) customDrafts.delete(member.block.id);
            clearGuidedRepeatGroup(activePlan, conflict.id);
        } else {
            customDrafts.delete(conflict.id);
            clearCompositeConflictResolution(activePlan, conflict.id);
        }
        renderResult();
    });
    byId('editor-composite-detach-occurrence')?.addEventListener('click', () => {
        const conflict = activePlan.conflicts[activeConflictIndex];
        customDrafts.delete(conflict.id);
        const detached = detachGuidedRepeatOccurrence(activePlan, conflict.id);
        if (!detached.ok) conflict.validationError = detached.error;
        renderResult();
    });
    byId('editor-composite-apply-next')?.addEventListener('click', () => {
        if (activePlan.strategy === 'guided') {
            const context = guidedRepeatContext(activePlan, activePlan.conflicts[activeConflictIndex]);
            let target = null;
            for (let offset = 1; offset < context.groups.length; offset++) {
                const candidate = context.groups[(context.groupIndex + offset) % context.groups.length];
                if (candidate.memberIds.some(id => {
                    const block = activePlan.conflicts.find(item => item.id === id);
                    return block && !block.resolution;
                })) { target = candidate; break; }
            }
            if (target) activateGuidedReviewGroup(activePlan, target);
        } else {
            const total = activePlan.conflicts.length;
            let next = -1;
            for (let offset = 1; offset < total; offset++) {
                const candidate = (activeConflictIndex + offset) % total;
                if (!activePlan.conflicts[candidate].resolution) { next = candidate; break; }
            }
            if (next < 0 && activeConflictIndex < total - 1) next = activeConflictIndex + 1;
            if (next >= 0) activeConflictIndex = next;
        }
        renderResult();
    });
}

function renderResult() {
    if (activePreviewMode) endCompositePreviewPlayback();
    const result = byId('editor-composite-result');
    if (!result || !activePlan) return;
    if (activePlan.strategy === 'guided') guidedReviewGroups(activePlan);
    const stats = activePlan.stats;
    const unresolvedBlocks = activePlan.conflicts.filter(c => !c.resolution).length;
    const unresolved = activePlan.strategy === 'guided'
        ? stats.unresolvedReviewDecisions : unresolvedBlocks;
    const normalized = stats.timingAdjustments || 0;
    const normalizationNotice = normalized ? `<div class="mb-3 rounded border border-sky-800/50 bg-sky-950/20 px-3 py-2 text-[11px] text-sky-100">`
        + `<b>${normalized} tiny imported note ${normalized === 1 ? 'boundary was' : 'boundaries were'} normalized</b> within the tempo-aware ${Math.round(COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS * 1000)} ms safety limit. `
        + `Only the new composite will use the trimmed trail; both source tracks remain unchanged.</div>` : '';
    const repeatNotice = activePlan.repeatNotice;
    let repeatNoticeMarkup = '';
    if (repeatNotice && (repeatNotice.requested > 1 || repeatNotice.kind !== 'applied')) {
        if (repeatNotice.kind === 'partial') {
            const failures = repeatNotice.failed.map(failure => `${failure.label}: ${failure.error}`).join(' ');
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-100"><b>Applied to ${repeatNotice.applied} of ${repeatNotice.requested} matching occurrences.</b> ${repeatNotice.failed.length} exceptional occurrence${repeatNotice.failed.length === 1 ? '' : 's'} remains for individual review. ${_editorEscHtml(failures)}</div>`;
        } else if (repeatNotice.kind === 'detached') {
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-sky-800/50 bg-sky-950/20 px-3 py-2 text-[11px] text-sky-100"><b>${_editorEscHtml(repeatNotice.label)} is now reviewed separately.</b></div>`;
        } else {
            repeatNoticeMarkup = `<div class="mb-3 rounded border border-emerald-800/50 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-100"><b>Choice applied to all ${repeatNotice.applied} matching occurrences.</b> Every occurrence passed its own transition validation.</div>`;
        }
    }
    const statCards = activePlan.strategy === 'guided'
        ? `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.primaryNotes}</b>primary notes</div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.secondaryNotes}</b>secondary notes</div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.duplicatesRemoved}</b>duplicates collapsed</div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.reviewDecisions}</b>review decisions <span class="block text-[9px] text-gray-500">${stats.decisionBlocks} occurrences</span></div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm ${unresolved ? 'text-amber-300' : 'text-emerald-300'}">${unresolved}</b>decisions left</div>`
        : `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.primaryNotes}</b>primary notes</div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.secondaryAddedCleanly}</b>clean additions</div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.duplicatesRemoved}</b>duplicates removed</div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.secondarySkippedByStrategy}</b>strategy skips</div>`
            + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm ${unresolved ? 'text-red-300' : 'text-emerald-300'}">${unresolved}</b>unresolved</div>`;
    result.innerHTML = `<div class="grid gap-2 mb-3 text-center text-[11px]" style="grid-template-columns:repeat(5,minmax(0,1fr))">${statCards}</div>`
        + normalizationNotice + repeatNoticeMarkup + renderOverview(activePlan) + renderConflict(activePlan);
    const finish = byId('editor-composite-finish');
    if (finish) finish.disabled = unresolvedBlocks > 0;
    bindResultEvents();
}

function analyzeFromDialog() {
    restoreCompositePreviewSession();
    const primaryIndex = Number(byId('editor-composite-primary')?.value);
    const secondaryIndex = Number(byId('editor-composite-secondary')?.value);
    const strategy = byId('editor-composite-strategy')?.value || 'gap-fill';
    const repeatMode = normalizeGuidedRepeatMode(byId('editor-composite-repeat-mode')?.value);
    const gapFill = gapFillOptionsFromDialog();
    if (strategy === 'gap-fill') {
        const preferences = loadCompositeGapFillPreferences();
        preferences.unit = gapFill.unit;
        preferences[gapFill.unit] = {
            minimumGap: gapFill.minimumGap,
            transitionMargin: gapFill.transitionMargin,
        };
        saveCompositeGapFillPreferences(preferences);
    } else if (strategy === 'guided') {
        saveCompositeGuidedPreferences({ repeatMode });
    }
    const error = byId('editor-composite-error');
    if (primaryIndex === secondaryIndex) {
        if (error) error.textContent = 'Choose two different source tracks.';
        resetResult('The primary and secondary source must be different.');
        return;
    }
    const sources = {
        primary: S.arrangements[primaryIndex],
        secondary: S.arrangements[secondaryIndex],
        beats: S.beats,
    };
    const plan = strategy === 'guided'
        ? analyzeGuidedComposite({ ...sources, sections: S.sections, repeatMode })
        : analyzeCompositeMerge({ ...sources, strategy: 'gap-fill', gapFill });
    if (!plan.ok) {
        if (error) error.textContent = plan.compatibility.errors.join(' ');
        resetResult('The selected arrangements are not merge-compatible.');
        return;
    }
    if (error) error.textContent = '';
    activePlan = plan;
    activeConflictIndex = 0;
    customDrafts.clear();
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
    if (!activePlan) return;
    const unresolved = activePlan.conflicts.filter(c => !c.resolution);
    if (unresolved.length) {
        if (error) error.textContent = `Resolve ${unresolved.length} remaining conflict(s).`;
        return;
    }
    const name = String(byId('editor-composite-name')?.value || '').trim();
    if (!name) {
        if (error) error.textContent = 'Enter a name for the composite track.';
        return;
    }
    const duplicateName = S.arrangements.some(arr => String(arr && arr.name || '').trim().toLowerCase() === name.toLowerCase());
    if (duplicateName) {
        if (error) error.textContent = 'Another track already uses that name.';
        return;
    }
    let arrangement;
    try {
        arrangement = materializeCompositeArrangement(activePlan, name);
    } catch (cause) {
        if (error) error.textContent = cause.message;
        return;
    }
    const finish = byId('editor-composite-finish');
    if (finish) finish.disabled = true;
    if (error) error.textContent = 'Registering the new arrangement…';
    try {
        const response = await fetch('/api/plugins/editor/add-arrangement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: S.sessionId, arrangement }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
        S.history.exec(new CreateCompositeArrangementCmd(arrangement));
        const summary = activePlan.stats;
        editorHideCompositeArrangementModal();
        setStatus(`Created “${name}”: ${arrangement.notes.length} notes, ${summary.duplicatesRemoved} duplicate${summary.duplicatesRemoved === 1 ? '' : 's'} removed. Save to commit.`);
    } catch (cause) {
        if (error) error.textContent = `Could not add the arrangement: ${cause.message}`;
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
        setStatus('Composite arrangements require an open feedpak project.');
        return false;
    }
    const sources = _compositeEligibleSourcesPure(S.arrangements);
    if (sources.length < 2) {
        setStatus('Add at least two guitar or bass tracks before creating a composite.');
        return false;
    }
    const primary = sources.some(source => source.index === S.currentArr)
        ? S.currentArr : sources[0].index;
    const secondary = sources.find(source => source.index !== primary).index;
    const name = _compositeUniqueNamePure(S.arrangements.map(arr => arr && arr.name));
    const gapFillPreferences = loadCompositeGapFillPreferences();
    const gapFillUnit = gapFillPreferences.unit;
    const gapFillValues = gapFillPreferences[gapFillUnit]
        || compositeGapFillDefaultsForUnit(gapFillUnit);
    const guidedPreferences = loadCompositeGuidedPreferences();
    const modal = document.createElement('div');
    modal.id = 'editor-composite-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4';
    modal.innerHTML = `<div class="max-w-full flex flex-col rounded-xl border border-gray-600 bg-dark-800 shadow-2xl" style="width:min(90rem, calc(100vw - 2rem));height:min(54rem, calc(100vh - 2rem))" role="dialog" aria-modal="true" aria-labelledby="editor-composite-title">`
        + `<header class="flex items-start justify-between gap-4 border-b border-gray-700 px-5 py-3"><div><h3 id="editor-composite-title" class="text-base font-semibold">Create Composite Arrangement</h3>`
        + `<p class="text-xs text-gray-400 mt-0.5">Combine two synchronized fretted tracks. Both sources stay unchanged.</p></div>`
        + `<button type="button" id="editor-composite-close" class="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button></header>`
        + `<div id="editor-composite-workspace" class="grid min-h-0 flex-1 overflow-hidden" style="grid-template-columns:18rem minmax(0,1fr)">`
        + `<aside id="editor-composite-setup" class="border-r border-gray-700 p-4 space-y-3 overflow-y-auto">`
        + `<label class="block text-xs text-gray-300">Primary track<select id="editor-composite-primary" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs">${sources.map(optionMarkup).join('')}</select></label>`
        + `<label class="block text-xs text-gray-300">Secondary track<select id="editor-composite-secondary" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs">${sources.map(optionMarkup).join('')}</select></label>`
        + `<label class="block text-xs text-gray-300">Hybrid mode<select id="editor-composite-strategy" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"><option value="gap-fill">Quick Hybrid — fill primary rests</option><option value="guided">Guided Hybrid — choose musical blocks</option></select></label>`
        + `<fieldset id="editor-composite-guided-controls" class="rounded border border-gray-700 p-2 space-y-2"><legend class="px-1 text-[11px] text-gray-400">Guided repetition review</legend>`
        + `<label class="block text-xs text-gray-300">Repeated material<select id="editor-composite-repeat-mode" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"><option value="${GUIDED_REPEAT_MODE_EVERY}"${guidedPreferences.repeatMode === GUIDED_REPEAT_MODE_EVERY ? ' selected' : ''}>Review every occurrence</option><option value="${GUIDED_REPEAT_MODE_MATCHING}"${guidedPreferences.repeatMode === GUIDED_REPEAT_MODE_MATCHING ? ' selected' : ''}>Group matching repetitions</option></select></label>`
        + `<p class="text-[10px] text-gray-500">Matching repetitions are compared note-for-note in both tracks. Every occurrence still receives its own transition safety check.</p></fieldset>`
        + `<fieldset id="editor-composite-gap-controls" class="rounded border border-gray-700 p-2 space-y-2"><legend class="px-1 text-[11px] text-gray-400">Gap Fill safety</legend>`
        + `<label class="block text-xs text-gray-300">Timing unit<select id="editor-composite-gap-unit" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"><option value="beats"${gapFillUnit === 'beats' ? ' selected' : ''}>Beats — follows song tempo</option><option value="seconds"${gapFillUnit === 'seconds' ? ' selected' : ''}>Seconds — fixed real time</option></select></label>`
        + `<label class="block text-xs text-gray-300"><span id="editor-composite-min-gap-label">Minimum usable gap (${gapFillUnit})</span><input id="editor-composite-min-gap" type="number" min="0" value="${gapFillValues.minimumGap}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"></label>`
        + `<label class="block text-xs text-gray-300"><span id="editor-composite-margin-label">Transition margin each side (${gapFillUnit})</span><input id="editor-composite-margin" type="number" min="0" value="${gapFillValues.transitionMargin}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"></label>`
        + `<p class="text-[10px] text-gray-500">Every complete note, chord, trail, and connected gesture must fit inside the protected gap.</p></fieldset>`
        + `<label class="block text-xs text-gray-300">New track name<input id="editor-composite-name" maxlength="60" value="${_editorEscHtml(name)}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"></label>`
        + `<button type="button" id="editor-composite-analyze" class="w-full px-3 py-2 rounded bg-accent hover:bg-accent-light text-xs font-medium">Analyze merge</button>`
        + `<div class="rounded bg-dark-900/70 p-2 text-[11px] text-gray-400"><b class="text-gray-300">Quick Hybrid</b> adds complete secondary gestures only inside protected primary rests. <b class="text-gray-300">Guided Hybrid</b> skips identical and unambiguous material, then asks you to choose only where both arrangements differ. Matching-repetition mode can reuse one reviewed choice across musically identical occurrences.</div>`
        + `</aside><main class="p-4 min-h-0 overflow-y-auto"><div id="editor-composite-result"><p class="text-xs text-gray-400">Choose two source tracks and analyze the merge.</p></div></main></div>`
        + `<footer class="border-t border-gray-700 px-5 py-3 flex items-center gap-3"><div id="editor-composite-error" class="text-xs text-red-300 flex-1"></div>`
        + `<button type="button" id="editor-composite-cancel" class="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 rounded text-xs">Cancel</button>`
        + `<button type="button" id="editor-composite-finish" disabled class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">Finish Merge</button></footer></div>`;
    (document.querySelector('.editor-root') || document.body).appendChild(modal);
    byId('editor-composite-primary').value = String(primary);
    byId('editor-composite-secondary').value = String(secondary);
    byId('editor-composite-close').addEventListener('click', editorHideCompositeArrangementModal);
    byId('editor-composite-cancel').addEventListener('click', editorHideCompositeArrangementModal);
    byId('editor-composite-analyze').addEventListener('click', analyzeFromDialog);
    byId('editor-composite-finish').addEventListener('click', finishMerge);
    const strategySelect = byId('editor-composite-strategy');
    const unitSelect = byId('editor-composite-gap-unit');
    const repeatModeSelect = byId('editor-composite-repeat-mode');
    let currentGapFillUnit = gapFillUnit;
    const syncGapControls = () => {
        const gapDisabled = strategySelect?.value !== 'gap-fill';
        for (const input of [unitSelect, byId('editor-composite-min-gap'), byId('editor-composite-margin')]) {
            if (input) input.disabled = gapDisabled;
        }
        if (repeatModeSelect) repeatModeSelect.disabled = strategySelect?.value !== 'guided';
    };
    const rememberCurrentGapFillValues = () => {
        const options = gapFillOptionsFromDialog(currentGapFillUnit);
        gapFillPreferences.unit = currentGapFillUnit;
        gapFillPreferences[currentGapFillUnit] = {
            minimumGap: options.minimumGap,
            transitionMargin: options.transitionMargin,
        };
        saveCompositeGapFillPreferences(gapFillPreferences);
    };
    for (const control of [byId('editor-composite-primary'), byId('editor-composite-secondary'), strategySelect]) {
        control.addEventListener('change', () => {
            syncGapControls();
            resetResult('Sources or merge settings changed. Analyze the merge again.');
        });
    }
    repeatModeSelect.addEventListener('change', () => {
        guidedPreferences.repeatMode = normalizeGuidedRepeatMode(repeatModeSelect.value);
        saveCompositeGuidedPreferences(guidedPreferences);
        resetResult('Guided repetition review changed. Analyze the merge again.');
    });
    unitSelect.addEventListener('change', () => {
        rememberCurrentGapFillValues();
        currentGapFillUnit = unitSelect.value === 'seconds' ? 'seconds' : 'beats';
        gapFillPreferences.unit = currentGapFillUnit;
        applyGapFillUnitToDialog(currentGapFillUnit, gapFillPreferences[currentGapFillUnit]);
        saveCompositeGapFillPreferences(gapFillPreferences);
        resetResult('Gap Fill timing unit changed. Analyze the merge again.');
    });
    for (const input of [byId('editor-composite-min-gap'), byId('editor-composite-margin')]) {
        input.addEventListener('change', () => {
            rememberCurrentGapFillValues();
            resetResult('Gap Fill safety settings changed. Analyze the merge again.');
        });
    }
    applyGapFillUnitToDialog(gapFillUnit, gapFillValues);
    syncGapControls();
    _installModalKeyboard(modal, modal.firstElementChild, editorHideCompositeArrangementModal);
    byId('editor-composite-primary').focus();
    return true;
}
