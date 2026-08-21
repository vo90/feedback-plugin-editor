/* Composite-arrangement resolver.
 *
 * This is the thin Editor integration over merge-engine.js: source/strategy
 * selection, Git-like conflict hunks, server-session registration, and one
 * structural history command. The merge rules remain DOM-free and testable.
 */

import { arrKind, _isFrettedKind } from '../instrument.js';
import { S } from '../state.js';
import { host } from '../host.js';
import { _editorEscHtml, _installModalKeyboard, setStatus } from '../ui.js';
import {
    analyzeCompositeMerge,
    compositeGapFillDefaultsForUnit,
    materializeCompositeArrangement,
    normalizeCompositeGapFillOptions,
    resolveCompositeConflict,
} from './merge-engine.js';

let activePlan = null;
let activeConflictIndex = 0;
const customDrafts = new Map();
const COMPOSITE_GAP_FILL_PREFS_KEY = 'editorCompositeGapFill';
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

function clearTransientState() {
    activePlan = null;
    activeConflictIndex = 0;
    customDrafts.clear();
}

function resetResult(message = 'Choose two source tracks and analyze the merge.') {
    clearTransientState();
    const result = byId('editor-composite-result');
    if (result) result.innerHTML = `<p class="text-xs text-gray-400">${_editorEscHtml(message)}</p>`;
    const finish = byId('editor-composite-finish');
    if (finish) finish.disabled = true;
}

function optionMarkup(source) {
    return `<option value="${source.index}">${_editorEscHtml(source.arrangement.name || `Track ${source.index + 1}`)}</option>`;
}

function noteTechLabel(note) {
    const tech = note && note.techniques || {};
    const labels = [];
    if (tech.palm_mute) labels.push('PM');
    if (tech.hammer_on) labels.push('HO');
    if (tech.pull_off) labels.push('PO');
    if (tech.slide_to !== undefined && tech.slide_to !== null && Number(tech.slide_to) >= 0) labels.push('slide');
    if (tech.bend) labels.push('bend');
    if (tech.vibrato) labels.push('vibrato');
    if (tech.harmonic || tech.harmonic_pinch) labels.push('harmonic');
    if (tech.mute || tech.fret_hand_mute) labels.push('mute');
    return labels.join(', ');
}

function entryMarkup(entry, checkboxName = '') {
    const length = Math.max(0, entry.endBeat - entry.startBeat);
    const tech = noteTechLabel(entry.note);
    const body = `<span class="font-mono text-gray-200">Beat ${entry.startBeat.toFixed(3)}</span>`
        + `<span class="text-gray-400">S${entry.string + 1} · F${entry.fret}</span>`
        + (length > 1e-4 ? `<span class="text-gray-500">${length.toFixed(3)} beats</span>` : '')
        + (tech ? `<span class="text-amber-300">${_editorEscHtml(tech)}</span>` : '');
    if (!checkboxName) return `<li class="flex flex-wrap gap-x-3 gap-y-0.5 py-1">${body}</li>`;
    return `<label class="flex items-center gap-2 py-1 cursor-pointer hover:bg-dark-600/50 rounded px-1">`
        + `<input type="checkbox" data-entry-id="${entry.id}" name="${checkboxName}" class="accent-accent">`
        + `<span class="flex flex-wrap gap-x-3 gap-y-0.5">${body}</span></label>`;
}

function conflictReason(group) {
    const reasons = [];
    if (group.reasons.includes('same-string-overlap')) reasons.push('different notes overlap on the same string');
    if (group.reasons.includes('note-variant')) reasons.push('the same position has different sustain, technique, or harmony data');
    return reasons.join('; ') || 'source notes require a choice';
}

function selectedSourceNames() {
    const primaryIndex = Number(byId('editor-composite-primary')?.value);
    const secondaryIndex = Number(byId('editor-composite-secondary')?.value);
    return {
        primary: S.arrangements[primaryIndex]?.name || 'Primary',
        secondary: S.arrangements[secondaryIndex]?.name || 'Secondary',
    };
}

function renderOverview(plan) {
    if (!plan.conflicts.length) return '';
    const all = [...plan.fixedEntries, ...plan.conflicts.flatMap(c => [...c.primaryEntries, ...c.secondaryEntries])];
    const start = Math.min(...all.map(e => e.startBeat));
    const end = Math.max(start + 1, ...all.map(e => e.effectiveEndBeat));
    const markers = plan.conflicts.map((conflict, index) => {
        const left = ((conflict.startBeat - start) / (end - start)) * 100;
        const width = Math.max(0.7, ((conflict.endBeat - conflict.startBeat) / (end - start)) * 100);
        const resolved = !!conflict.resolution;
        return `<button type="button" data-conflict-index="${index}" class="absolute top-0 h-3 rounded-sm ${resolved ? 'bg-emerald-500' : 'bg-red-500'}"`
            + ` style="left:${left}%;width:${width}%" title="${resolved ? 'Resolved' : 'Unresolved'} conflict ${index + 1}"></button>`;
    }).join('');
    return `<div class="mb-3"><div class="flex justify-between text-[10px] text-gray-500 mb-1"><span>Merge overview</span><span>red unresolved · green resolved</span></div>`
        + `<div class="relative h-3 rounded bg-dark-900 overflow-hidden">${markers}</div></div>`;
}

function customMarkup(group) {
    const draft = customDrafts.get(group.id);
    if (!draft) return '';
    const checked = new Set(draft);
    const render = (entry) => entryMarkup(entry, `custom-${group.id}`).replace(
        `data-entry-id="${entry.id}"`, `data-entry-id="${entry.id}"${checked.has(entry.id) ? ' checked' : ''}`);
    return `<div class="mt-3 border-t border-gray-700 pt-2">`
        + `<p class="text-[11px] text-gray-400 mb-1">Choose individual notes. Cross-source notes may not overlap on one string.</p>`
        + [...group.primaryEntries, ...group.secondaryEntries].map(render).join('')
        + `<div id="editor-composite-custom-error" class="text-[11px] text-red-300 mt-1">${_editorEscHtml(group.validationError || '')}</div></div>`;
}

function renderConflict(plan) {
    if (!plan.conflicts.length) {
        return `<div class="rounded border border-emerald-700/50 bg-emerald-950/20 p-3 text-xs text-emerald-200">No manual conflicts. The merge is ready to finish.</div>`;
    }
    activeConflictIndex = Math.max(0, Math.min(activeConflictIndex, plan.conflicts.length - 1));
    const group = plan.conflicts[activeConflictIndex];
    const names = selectedSourceNames();
    const resolvedClass = group.resolution ? 'border-emerald-700/60' : 'border-red-700/60';
    return `<section class="rounded border ${resolvedClass} bg-dark-800/70 p-3">`
        + `<div class="flex items-center justify-between gap-3 mb-2">`
        + `<div><h4 class="text-sm font-semibold">Conflict ${activeConflictIndex + 1} of ${plan.conflicts.length}</h4>`
        + `<p class="text-[11px] text-gray-400">Beats ${group.startBeat.toFixed(3)}–${group.endBeat.toFixed(3)} · ${_editorEscHtml(conflictReason(group))}</p></div>`
        + `<div class="flex gap-1"><button type="button" id="editor-composite-prev" class="px-2 py-1 bg-dark-700 rounded text-xs disabled:opacity-40" ${activeConflictIndex === 0 ? 'disabled' : ''}>←</button>`
        + `<button type="button" id="editor-composite-next" class="px-2 py-1 bg-dark-700 rounded text-xs disabled:opacity-40" ${activeConflictIndex >= plan.conflicts.length - 1 ? 'disabled' : ''}>→</button></div></div>`
        + `<div class="grid grid-cols-1 lg:grid-cols-2 gap-2">`
        + `<div class="rounded bg-sky-950/20 border border-sky-800/40 p-2"><div class="text-xs font-medium text-sky-300 mb-1">${_editorEscHtml(names.primary)}</div><ul class="text-[11px]">${group.primaryEntries.map(e => entryMarkup(e)).join('')}</ul></div>`
        + `<div class="rounded bg-violet-950/20 border border-violet-800/40 p-2"><div class="text-xs font-medium text-violet-300 mb-1">${_editorEscHtml(names.secondary)}</div><ul class="text-[11px]">${group.secondaryEntries.map(e => entryMarkup(e)).join('')}</ul></div>`
        + `</div><div class="flex flex-wrap gap-2 mt-3">`
        + `<button type="button" data-resolution="primary" class="px-2.5 py-1 rounded text-xs ${group.resolution === 'primary' ? 'bg-sky-600 text-white' : 'bg-dark-700 hover:bg-dark-600'}">Use ${_editorEscHtml(names.primary)}</button>`
        + `<button type="button" data-resolution="secondary" class="px-2.5 py-1 rounded text-xs ${group.resolution === 'secondary' ? 'bg-violet-600 text-white' : 'bg-dark-700 hover:bg-dark-600'}">Use ${_editorEscHtml(names.secondary)}</button>`
        + `<button type="button" data-resolution="compatible" class="px-2.5 py-1 rounded text-xs ${group.resolution === 'compatible' ? 'bg-emerald-700 text-white' : 'bg-dark-700 hover:bg-dark-600'}">Keep primary + compatible secondary</button>`
        + `<button type="button" data-resolution="custom" class="px-2.5 py-1 rounded text-xs ${customDrafts.has(group.id) ? 'bg-amber-700 text-white' : 'bg-dark-700 hover:bg-dark-600'}">Custom notes…</button>`
        + `</div>${customMarkup(group)}</section>`;
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
    byId('editor-composite-prev')?.addEventListener('click', () => { activeConflictIndex--; renderResult(); });
    byId('editor-composite-next')?.addEventListener('click', () => { activeConflictIndex++; renderResult(); });
    for (const button of result.querySelectorAll('[data-resolution]')) {
        button.addEventListener('click', () => {
            const conflict = activePlan.conflicts[activeConflictIndex];
            const resolution = button.dataset.resolution;
            if (resolution === 'custom') {
                if (!customDrafts.has(conflict.id)) {
                    customDrafts.set(conflict.id, conflict.primaryEntries.map(e => e.id));
                }
                const draft = customDrafts.get(conflict.id);
                resolveCompositeConflict(activePlan, conflict.id, 'custom', draft);
            } else {
                customDrafts.delete(conflict.id);
                resolveCompositeConflict(activePlan, conflict.id, resolution);
            }
            renderResult();
        });
    }
    for (const checkbox of result.querySelectorAll('[data-entry-id]')) {
        checkbox.addEventListener('change', () => {
            const conflict = activePlan.conflicts[activeConflictIndex];
            const draft = new Set(customDrafts.get(conflict.id) || []);
            if (checkbox.checked) draft.add(checkbox.dataset.entryId);
            else draft.delete(checkbox.dataset.entryId);
            customDrafts.set(conflict.id, [...draft]);
            resolveCompositeConflict(activePlan, conflict.id, 'custom', [...draft]);
            renderResult();
        });
    }
}

function renderResult() {
    const result = byId('editor-composite-result');
    if (!result || !activePlan) return;
    const stats = activePlan.stats;
    const unresolved = activePlan.conflicts.filter(c => !c.resolution).length;
    result.innerHTML = `<div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-center text-[11px]">`
        + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.primaryNotes}</b>primary notes</div>`
        + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.secondaryAddedCleanly}</b>clean additions</div>`
        + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.duplicatesRemoved}</b>duplicates removed</div>`
        + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm text-gray-100">${stats.secondarySkippedByStrategy}</b>strategy skips</div>`
        + `<div class="rounded bg-dark-900 p-2"><b class="block text-sm ${unresolved ? 'text-red-300' : 'text-emerald-300'}">${unresolved}</b>unresolved</div></div>`
        + renderOverview(activePlan) + renderConflict(activePlan);
    const finish = byId('editor-composite-finish');
    if (finish) finish.disabled = unresolved > 0;
    bindResultEvents();
}

function analyzeFromDialog() {
    const primaryIndex = Number(byId('editor-composite-primary')?.value);
    const secondaryIndex = Number(byId('editor-composite-secondary')?.value);
    const strategy = byId('editor-composite-strategy')?.value || 'gap-fill';
    const gapFill = gapFillOptionsFromDialog();
    const preferences = loadCompositeGapFillPreferences();
    preferences.unit = gapFill.unit;
    preferences[gapFill.unit] = {
        minimumGap: gapFill.minimumGap,
        transitionMargin: gapFill.transitionMargin,
    };
    saveCompositeGapFillPreferences(preferences);
    const error = byId('editor-composite-error');
    if (primaryIndex === secondaryIndex) {
        if (error) error.textContent = 'Choose two different source tracks.';
        resetResult('The primary and secondary source must be different.');
        return;
    }
    const plan = analyzeCompositeMerge({
        primary: S.arrangements[primaryIndex],
        secondary: S.arrangements[secondaryIndex],
        beats: S.beats,
        strategy,
        gapFill,
    });
    if (!plan.ok) {
        if (error) error.textContent = plan.compatibility.errors.join(' ');
        resetResult('The selected arrangements are not merge-compatible.');
        return;
    }
    if (error) error.textContent = '';
    activePlan = plan;
    activeConflictIndex = 0;
    customDrafts.clear();
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
    const modal = document.createElement('div');
    modal.id = 'editor-composite-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4';
    modal.innerHTML = `<div class="w-[68rem] max-w-full flex flex-col rounded-xl border border-gray-600 bg-dark-800 shadow-2xl" style="height:min(46rem, calc(100vh - 2rem))" role="dialog" aria-modal="true" aria-labelledby="editor-composite-title">`
        + `<header class="flex items-start justify-between gap-4 border-b border-gray-700 px-5 py-3"><div><h3 id="editor-composite-title" class="text-base font-semibold">Create Composite Arrangement</h3>`
        + `<p class="text-xs text-gray-400 mt-0.5">Combine two synchronized fretted tracks. Both sources stay unchanged.</p></div>`
        + `<button type="button" id="editor-composite-close" class="text-gray-400 hover:text-white text-xl leading-none" aria-label="Close">×</button></header>`
        + `<div class="grid grid-cols-1 md:grid-cols-[18rem_1fr] min-h-0 flex-1 overflow-hidden">`
        + `<aside class="border-r border-gray-700 p-4 space-y-3 overflow-y-auto">`
        + `<label class="block text-xs text-gray-300">Primary track<select id="editor-composite-primary" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs">${sources.map(optionMarkup).join('')}</select></label>`
        + `<label class="block text-xs text-gray-300">Secondary track<select id="editor-composite-secondary" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs">${sources.map(optionMarkup).join('')}</select></label>`
        + `<label class="block text-xs text-gray-300">Merge strategy<select id="editor-composite-strategy" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"><option value="gap-fill">Gap Fill — secondary during rests</option><option value="full-union">Full Union — all compatible notes</option></select></label>`
        + `<fieldset id="editor-composite-gap-controls" class="rounded border border-gray-700 p-2 space-y-2"><legend class="px-1 text-[11px] text-gray-400">Gap Fill safety</legend>`
        + `<label class="block text-xs text-gray-300">Timing unit<select id="editor-composite-gap-unit" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"><option value="beats"${gapFillUnit === 'beats' ? ' selected' : ''}>Beats — follows song tempo</option><option value="seconds"${gapFillUnit === 'seconds' ? ' selected' : ''}>Seconds — fixed real time</option></select></label>`
        + `<label class="block text-xs text-gray-300"><span id="editor-composite-min-gap-label">Minimum usable gap (${gapFillUnit})</span><input id="editor-composite-min-gap" type="number" min="0" value="${gapFillValues.minimumGap}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"></label>`
        + `<label class="block text-xs text-gray-300"><span id="editor-composite-margin-label">Transition margin each side (${gapFillUnit})</span><input id="editor-composite-margin" type="number" min="0" value="${gapFillValues.transitionMargin}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"></label>`
        + `<p class="text-[10px] text-gray-500">Every complete note, chord, trail, and connected gesture must fit inside the protected gap.</p></fieldset>`
        + `<label class="block text-xs text-gray-300">New track name<input id="editor-composite-name" maxlength="60" value="${_editorEscHtml(name)}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-2 py-1.5 text-xs"></label>`
        + `<button type="button" id="editor-composite-analyze" class="w-full px-3 py-2 rounded bg-accent hover:bg-accent-light text-xs font-medium">Analyze merge</button>`
        + `<div class="rounded bg-dark-900/70 p-2 text-[11px] text-gray-400"><b class="text-gray-300">Gap Fill</b> adds only complete events whose full trails fit between protected lead passages. <b class="text-gray-300">Full Union</b> keeps all compatible material and exposes physical collisions.</div>`
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
    let currentGapFillUnit = gapFillUnit;
    const syncGapControls = () => {
        const disabled = strategySelect?.value !== 'gap-fill';
        for (const input of [unitSelect, byId('editor-composite-min-gap'), byId('editor-composite-margin')]) {
            if (input) input.disabled = disabled;
        }
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
