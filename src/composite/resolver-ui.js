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
    analyzeCompositeMerge,
    clearCompositeConflictResolution,
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    compositeGapFillDefaultsForUnit,
    compositeResolvedEntries,
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
    return { repeatMode: parsed.repeatMode === GUIDED_REPEAT_MODE_EVERY
        ? GUIDED_REPEAT_MODE_EVERY : GUIDED_REPEAT_MODE_MATCHING };
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

function selectedCompositeStrategy() {
    return document.querySelector('input[name="editor-composite-strategy"]:checked')?.value === 'guided'
        ? 'guided' : 'gap-fill';
}

function applyGapFillUnitToDialog(unit, values) {
    const normalized = normalizeCompositeGapFillOptions({ unit, ...(values || {}) });
    const config = COMPOSITE_GAP_FILL_CONTROL_CONFIG[normalized.unit];
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
    activeConflictIndex = index;
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
            const current = index === activeConflictIndex;
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
    const draft = customDrafts.get(group.id)
        || (group.resolution === 'custom' ? group.selectedEntryIds : null);
    if (!draft) return '';
    const checked = new Set(draft);
    const stringCount = activePlan?.compatibility?.stringCount || 6;
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

function entryLastBeat(entry) {
    return Math.max(Number(entry?.startBeat) || 0, Number(entry?.endBeat) || 0,
        Number(entry?.effectiveEndBeat) || 0);
}

function wholePlanPreviewView() {
    if (!activePlan) return null;
    const names = selectedSourceNames();
    const primary = activePlan.sourceEntries?.primary || [];
    const secondary = activePlan.sourceEntries?.secondary || [];
    const result = compositeResolvedEntries(activePlan);
    const all = [...primary, ...secondary, ...result];
    const startBeat = all.length ? Math.max(0, Math.min(...all.map(entry => entry.startBeat))) : 0;
    const endBeat = all.length ? Math.max(startBeat + 1, ...all.map(entryLastBeat))
        : Math.max(1, activePlan.beats.length - 1);
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
    const region = compositePreviewRegionPure(view.context, activePlan.beats);
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
        lane ? lane.entries : [], activePlan.primary, activePlan.beats,
        activePlan.compatibility.stringCount);
    editorSetGuidePreview(events, arrKind(activePlan.primary));
    setCompositeContextLoop(view);
    activePreviewMode = mode;
    startPlayback();
    compositePreviewPlaying = !!S.playing;
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
    compositePreviewRestore = null;
    const button = byId('editor-composite-keep-loop');
    if (button) button.textContent = 'Editor loop set ✓';
    setStatus('This section will stay looped after you close the Hybrid Track builder.');
}

function renderConflict(plan) {
    const guided = plan.strategy === 'guided';
    if (!plan.conflicts.length) {
        return `<div class="rounded border border-emerald-700/50 bg-emerald-950/20 p-4 text-sm text-emerald-100 flex flex-wrap items-center justify-between gap-3">`
            + `<div><b class="block text-base mb-1">No choices needed</b>The tracks match here, or only one track is playing at a time. The hybrid is ready to create.</div>`
            + `<button type="button" id="editor-composite-edit-settings" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm text-gray-200">Back and adjust</button></div>`;
    }
    activeConflictIndex = Math.max(0, Math.min(activeConflictIndex, plan.conflicts.length - 1));
    const group = plan.conflicts[activeConflictIndex];
    const repeatContext = guided ? guidedRepeatContext(plan, group) : null;
    const repeatBadge = repeatContext?.grouped
        ? `<span class="inline-block mt-1 rounded-full bg-sky-950/70 px-2 py-0.5 text-xs text-sky-200">Applies to ${repeatContext.members.length} matching sections</span>` : '';
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
    const stateLabel = group.validationError ? 'Choice needs attention'
        : group.resolution ? 'Choice made' : 'Needs review';
    const rangeLabel = guided && group.label
        ? `${group.label} · ${conflictReason(group)}`
        : `Beats ${group.startBeat.toFixed(3)}–${group.endBeat.toFixed(3)} · ${conflictReason(group)}`;
    const resolutionButtons = `<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">`
        + `<button type="button" data-resolution="primary" aria-pressed="${group.resolution === 'primary'}" class="text-left px-3 py-3 rounded-lg border text-sm ${group.resolution === 'primary' ? 'bg-sky-900/70 border-sky-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-sky-500'}"><b class="block text-sky-300">Play ${_editorEscHtml(names.primary)} here</b><span class="text-xs text-gray-400">Use this track for the complete section</span>${repeatBadge}</button>`
        + `<button type="button" data-resolution="secondary" aria-pressed="${group.resolution === 'secondary'}" class="text-left px-3 py-3 rounded-lg border text-sm ${group.resolution === 'secondary' ? 'bg-violet-900/70 border-violet-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-violet-500'}"><b class="block text-violet-300">Play ${_editorEscHtml(names.secondary)} here</b><span class="text-xs text-gray-400">Use this track for the complete section</span>${repeatBadge}</button>`
        + `<button type="button" data-resolution="custom" aria-pressed="${customDrafts.has(group.id) || group.resolution === 'custom'}" class="text-left px-3 py-3 rounded-lg border text-sm ${customDrafts.has(group.id) || group.resolution === 'custom' ? 'bg-amber-900/70 border-amber-400 text-white' : 'bg-dark-700 border-gray-600 hover:border-amber-500'}"><b class="block text-amber-300">Mix notes manually</b><span class="text-xs text-gray-400">Advanced: choose notes from either track</span>${repeatBadge}</button></div>`;
    const splitMarkup = guided && group.splitPoints && group.splitPoints.length
        ? `<div><b class="text-gray-300">Divide this review section at a bar</b><p class="mt-0.5">Use this if the musical part changes inside the highlighted area.</p><div class="flex flex-wrap gap-1 mt-2">${group.splitPoints.map(point => `<button type="button" data-guided-split-beat="${point.beat}" class="px-2 py-1 rounded border border-gray-600 bg-dark-700 hover:border-gray-400">${_editorEscHtml(point.label)}</button>`).join('')}</div></div>`
        : '';
    const decisionNumber = repeatContext ? repeatContext.groupIndex + 1 : activeConflictIndex + 1;
    const decisionTotal = repeatContext ? repeatContext.groups.length : plan.conflicts.length;
    const canReset = repeatContext
        ? repeatContext.members.some(candidate => candidate.block.resolution
            || customDrafts.has(candidate.block.id))
        : group.resolution || customDrafts.has(group.id);
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
    if (activePreviewMode) endCompositePreviewPlayback();
    const result = byId('editor-composite-result');
    if (!result || !activePlan) return;
    if (activePlan.strategy === 'guided') guidedReviewGroups(activePlan);
    const stats = activePlan.stats;
    const unresolvedBlocks = activePlan.conflicts.filter(c => !c.resolution).length;
    const unresolved = activePlan.strategy === 'guided'
        ? stats.unresolvedReviewDecisions : unresolvedBlocks;
    const normalized = stats.timingAdjustments || 0;
    const normalizationNotice = normalized ? `<details class="mb-3 rounded border border-gray-700 bg-dark-900/50 px-3 py-2 text-xs text-gray-400">`
        + `<summary class="cursor-pointer hover:text-gray-200">Technical details: ${normalized} tiny import timing ${normalized === 1 ? 'seam was' : 'seams were'} cleaned up</summary>`
        + `<p class="mt-2">The cleanup stayed within the tempo-aware ${Math.round(COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS * 1000)} ms safety limit. Only the new hybrid uses the adjusted trail; both original tracks remain unchanged.</p></details>` : '';
    const repeatNotice = activePlan.repeatNotice;
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
    if (activePlan.strategy !== 'guided') {
        result.innerHTML = renderAutomaticResult(activePlan, names, normalizationNotice);
    } else {
        const occurrences = Math.max(stats.reviewDecisions || 0, stats.decisionBlocks || 0);
        const groupedText = occurrences > (stats.reviewDecisions || 0)
            ? ` across ${occurrences} song sections` : '';
        result.innerHTML = `<div class="mb-3 rounded-lg border border-gray-700 bg-dark-900/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2">`
            + `<div><b class="text-sm text-gray-100">${stats.reviewDecisions} ${stats.reviewDecisions === 1 ? 'choice' : 'choices'}${groupedText}</b>`
            + `<p class="text-xs text-gray-400">Choose which part you want to play in each different section.</p></div>`
            + `<b class="text-sm ${unresolved ? 'text-amber-300' : 'text-emerald-300'}">${unresolved ? `${unresolved} left` : 'All choices complete ✓'}</b></div>`
            + normalizationNotice + repeatNoticeMarkup + renderOverview(activePlan) + renderConflict(activePlan);
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
        : analyzeCompositeMerge({ ...sources, strategy: 'gap-fill', gapFill });
    if (!plan.ok) {
        if (error) error.textContent = plan.compatibility.errors.join(' ');
        resetResult('These tracks cannot be combined. Check that they use the same instrument, tuning, string count, and capo.');
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
        arrangement = materializeCompositeArrangement(activePlan, name);
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
    const gapFillPreferences = loadCompositeGapFillPreferences();
    const gapFillUnit = gapFillPreferences.unit;
    const gapFillValues = gapFillPreferences[gapFillUnit]
        || compositeGapFillDefaultsForUnit(gapFillUnit);
    const guidedPreferences = loadCompositeGuidedPreferences();
    const modal = document.createElement('div');
    modal.id = 'editor-composite-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4';
    modal.innerHTML = `<div class="max-w-full flex flex-col rounded-xl border border-gray-600 bg-dark-800 shadow-2xl" style="width:min(90rem, calc(100vw - 2rem));height:min(54rem, calc(100vh - 2rem))" role="dialog" aria-modal="true" aria-labelledby="editor-composite-title">`
        + `<header class="flex items-start justify-between gap-4 border-b border-gray-700 px-5 py-3"><div><h3 id="editor-composite-title" class="text-lg font-semibold">Create a Hybrid Guitar Track</h3>`
        + `<p class="text-sm text-gray-400 mt-0.5">Combine two synchronized guitar or bass parts into one playable track. Your original tracks stay unchanged.</p></div>`
        + `<button type="button" id="editor-composite-close" class="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button></header>`
        + `<div id="editor-composite-workspace" class="grid min-h-0 flex-1 overflow-hidden" style="grid-template-columns:minmax(0,1fr)">`
        + `<section id="editor-composite-setup" class="p-5 overflow-y-auto"><div class="max-w-5xl mx-auto space-y-5">`
        + `<section><h4 class="text-base font-semibold">1. Choose the two tracks</h4><p class="text-sm text-gray-400 mt-1">The base track is kept. The fill track supplies the extra or alternative parts.</p>`
        + `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">`
        + `<label class="block rounded-lg border border-sky-800/60 bg-sky-950/20 p-3 text-sm text-sky-100"><b>Base track — always kept</b><select id="editor-composite-primary" class="mt-2 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm">${sources.map(optionMarkup).join('')}</select></label>`
        + `<label class="block rounded-lg border border-violet-800/60 bg-violet-950/20 p-3 text-sm text-violet-100"><b>Fill track</b><select id="editor-composite-secondary" class="mt-2 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm">${sources.map(optionMarkup).join('')}</select></label></div></section>`
        + `<fieldset><legend class="text-base font-semibold">2. Choose how to build the hybrid</legend><div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">`
        + `<label data-composite-mode-card="gap-fill" class="cursor-pointer rounded-xl border border-accent bg-sky-950/25 p-4 hover:border-sky-400"><span class="flex items-start gap-3"><input type="radio" name="editor-composite-strategy" value="gap-fill" checked class="mt-1 accent-accent"><span><b class="block text-base text-white">Automatic</b><span class="block text-sm text-gray-300 mt-1">Keep the base track and add fill-track notes only where the complete notes and trails fit safely.</span><span class="block text-xs text-emerald-300 mt-2">Fastest · no section-by-section choices</span></span></span></label>`
        + `<label data-composite-mode-card="guided" class="cursor-pointer rounded-xl border border-gray-600 bg-dark-700/50 p-4 hover:border-violet-400"><span class="flex items-start gap-3"><input type="radio" name="editor-composite-strategy" value="guided" class="mt-1 accent-accent"><span><b class="block text-base text-white">Review sections yourself</b><span class="block text-sm text-gray-300 mt-1">The song is divided into musical sections. Choose the base track, fill track, or a manual mix where they differ.</span><span class="block text-xs text-violet-300 mt-2">More control · repeated riffs can share one choice</span></span></span></label>`
        + `</div></fieldset>`
        + `<section id="editor-composite-guided-controls" hidden class="rounded-lg border border-gray-700 bg-dark-900/50 p-4"><h4 class="text-sm font-semibold">Repeated riffs</h4>`
        + `<label class="block text-sm text-gray-300 mt-2">How should repeated sections be reviewed?<select id="editor-composite-repeat-mode" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"><option value="${GUIDED_REPEAT_MODE_MATCHING}"${guidedPreferences.repeatMode === GUIDED_REPEAT_MODE_MATCHING ? ' selected' : ''}>Review matching riffs once (recommended)</option><option value="${GUIDED_REPEAT_MODE_EVERY}"${guidedPreferences.repeatMode === GUIDED_REPEAT_MODE_EVERY ? ' selected' : ''}>Review every occurrence separately</option></select></label>`
        + `<p class="text-xs text-gray-400 mt-2">When the same playable riff appears again, one choice can be reused. Every copy still gets its own playability check.</p></section>`
        + `<details id="editor-composite-gap-controls" class="rounded-lg border border-gray-700 bg-dark-900/50 p-4"><summary class="cursor-pointer text-sm font-semibold hover:text-white">Advanced safety settings</summary>`
        + `<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3"><label class="block text-sm text-gray-300">Timing unit<select id="editor-composite-gap-unit" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"><option value="beats"${gapFillUnit === 'beats' ? ' selected' : ''}>Beats — follows song tempo</option><option value="seconds"${gapFillUnit === 'seconds' ? ' selected' : ''}>Seconds — fixed real time</option></select></label>`
        + `<label class="block text-sm text-gray-300"><span id="editor-composite-min-gap-label">Smallest gap to fill (${gapFillUnit})</span><input id="editor-composite-min-gap" type="number" min="0" value="${gapFillValues.minimumGap}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"></label>`
        + `<label class="block text-sm text-gray-300"><span id="editor-composite-margin-label">Extra space before and after (${gapFillUnit})</span><input id="editor-composite-margin" type="number" min="0" value="${gapFillValues.transitionMargin}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"></label></div>`
        + `<p class="text-xs text-gray-400 mt-2">A fill-track note is added only when its entire chord, trail, and connected technique fit between base-track parts.</p></details>`
        + `<section class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end"><label class="block text-sm text-gray-300"><b>3. Name the new track</b><input id="editor-composite-name" maxlength="60" value="${_editorEscHtml(name)}" class="mt-2 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"></label>`
        + `<button type="button" id="editor-composite-analyze" class="px-5 py-2.5 rounded bg-accent hover:bg-accent-light text-sm font-medium">Preview automatic hybrid</button></section>`
        + `</div></section><main id="editor-composite-result-workspace" hidden class="p-4 min-h-0 overflow-y-auto"><div id="editor-composite-result"><p class="text-sm text-gray-400">Choose two tracks and how you want to build the hybrid.</p></div></main></div>`
        + `<footer class="border-t border-gray-700 px-5 py-3 flex items-center gap-3"><div id="editor-composite-error" class="text-sm text-red-300 flex-1" role="alert" aria-live="polite"></div>`
        + `<button type="button" id="editor-composite-cancel" class="px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded text-sm">Cancel</button>`
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
        saveCompositeGapFillPreferences(gapFillPreferences);
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
        saveCompositeGuidedPreferences(guidedPreferences);
        resetResult('The repeated-riff setting changed. Find the review sections again when you are ready.');
    });
    unitSelect.addEventListener('change', () => {
        rememberCurrentGapFillValues();
        currentGapFillUnit = unitSelect.value === 'seconds' ? 'seconds' : 'beats';
        gapFillPreferences.unit = currentGapFillUnit;
        applyGapFillUnitToDialog(currentGapFillUnit, gapFillPreferences[currentGapFillUnit]);
        saveCompositeGapFillPreferences(gapFillPreferences);
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
