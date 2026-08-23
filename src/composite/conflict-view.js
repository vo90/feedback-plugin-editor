/* Hybrid-track review visualization.
 *
 * Converts a DOM-free merge plan into synchronized review metadata used by
 * the shared Hybrid timeline. Keeping this model pure makes selection and
 * musical alignment testable without alphaTab or a browser.
 */

import {
    compositeBeatBoundaryIndex,
    compositeConflictContextFromIndex,
    compositeImmutableEntryIndex,
    compositeIndexedEntriesInRange,
    compositePreparedEntryIndex,
} from './review-model-cache.js';

const EPS = 1e-4;
const FALLBACK_CONTEXT_BEATS = 4;

const TECHNIQUE_LABELS = Object.freeze({
    hammer_on: 'Hammer-on',
    pull_off: 'Pull-off',
    palm_mute: 'Palm mute',
    fret_hand_mute: 'Fret-hand mute',
    mute: 'String mute',
    harmonic: 'Harmonic',
    harmonic_pinch: 'Pinch harmonic',
    accent: 'Accent',
    vibrato: 'Vibrato',
    tremolo: 'Tremolo',
    tap: 'Tap',
    slap: 'Slap',
    pluck: 'Pop',
    link_next: 'Linked note',
    ignore: 'Ignored',
    slide_to: 'Slide',
    slide_unpitch_to: 'Unpitched slide',
    bend: 'Bend',
    bend_values: 'Bend curve',
    bend_intent: 'Bend intent',
    pick_direction: 'Pick direction',
    fret_finger: 'Finger',
    scale_degree: 'Scale degree',
    strum_group: 'Strum group',
    hand: 'Hand',
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function escapeMarkup(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function humanizeTechniqueKey(key) {
    return String(key || '').replace(/^_+/, '').replaceAll('_', ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function techniqueValueIsActive(value) {
    if (value === false || value === null || value === undefined || value === '') return false;
    if (typeof value === 'number') return value >= 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

export function compositeTechniqueLabels(note) {
    const techniques = note && note.techniques && typeof note.techniques === 'object'
        ? note.techniques : {};
    return Object.keys(techniques).sort().filter(key => techniqueValueIsActive(techniques[key]))
        .map(key => TECHNIQUE_LABELS[key] || humanizeTechniqueKey(key));
}

function uniqueEntries(entries) {
    const unique = new Map();
    for (const entry of entries || []) if (entry && entry.id) unique.set(entry.id, entry);
    return [...unique.values()].sort((a, b) => a.startBeat - b.startBeat
        || a.string - b.string || a.fret - b.fret || a.id.localeCompare(b.id));
}

function fallbackSourceEntries(plan, source) {
    const entries = (plan.fixedEntries || []).filter(entry => entry.source === source);
    for (const conflict of plan.conflicts || []) {
        entries.push(...(source === 'primary' ? conflict.primaryEntries : conflict.secondaryEntries));
    }
    if (source === 'primary') {
        for (const duplicate of plan.duplicates || []) if (duplicate.primary) entries.push(duplicate.primary);
    } else {
        for (const duplicate of plan.duplicates || []) if (duplicate.secondary) entries.push(duplicate.secondary);
        entries.push(...(plan.skippedEntries || []));
    }
    return uniqueEntries(entries);
}

export function compositeConflictContextPure(beats, conflict, fallbackPadding = FALLBACK_CONTEXT_BEATS) {
    return compositeConflictContextFromIndex(compositeBeatBoundaryIndex(beats), conflict, {
        fallbackPadding,
        epsilon: EPS,
    });
}

function entryEnd(entry) {
    return Math.max(finite(entry && entry.startBeat), finite(entry && entry.endBeat),
        finite(entry && entry.effectiveEndBeat));
}

function entriesInContext(entries, context) {
    return (entries || []).filter(entry => entry.startBeat <= context.endBeat + EPS
        && entryEnd(entry) >= context.startBeat - EPS);
}

function resolvedResultEntries(plan, currentConflict, currentSelectionIds) {
    const entries = [...(plan.fixedEntries || [])];
    for (const conflict of plan.conflicts || []) {
        const selected = conflict === currentConflict && currentSelectionIds
            ? currentSelectionIds : conflict.selectedEntryIds;
        const ids = new Set(selected || []);
        entries.push(...[...(conflict.primaryEntries || []), ...(conflict.secondaryEntries || [])]
            .filter(entry => ids.has(entry.id)));
    }
    return uniqueEntries(entries);
}

function sourceEntryInput(plan, source) {
    const explicit = plan?.sourceEntries?.[source];
    return Array.isArray(explicit) ? explicit : fallbackSourceEntries(plan || {}, source);
}

export function createCompositeConflictViewIndex({
    plan,
    resolvedEntries = null,
} = {}) {
    if (!plan) return null;
    const primaryInput = sourceEntryInput(plan, 'primary');
    const secondaryInput = sourceEntryInput(plan, 'secondary');
    const preparedResult = Array.isArray(resolvedEntries) ? resolvedEntries : null;
    return {
        plan,
        beats: plan.beats,
        primaryInput,
        secondaryInput,
        resolvedEntries: preparedResult,
        boundaries: compositeBeatBoundaryIndex(plan.beats),
        primary: compositeImmutableEntryIndex(primaryInput),
        secondary: compositeImmutableEntryIndex(secondaryInput),
        result: preparedResult ? compositePreparedEntryIndex(preparedResult) : null,
    };
}

export function compositeConflictViewIndexMatches(index, {
    plan,
    resolvedEntries = null,
} = {}) {
    if (!index || index.plan !== plan || index.beats !== plan?.beats) return false;
    const primaryInput = plan?.sourceEntries?.primary;
    const secondaryInput = plan?.sourceEntries?.secondary;
    if (Array.isArray(primaryInput) && index.primaryInput !== primaryInput) return false;
    if (Array.isArray(secondaryInput) && index.secondaryInput !== secondaryInput) return false;
    return index.resolvedEntries === (Array.isArray(resolvedEntries) ? resolvedEntries : null);
}

function overlappingPair(conflict) {
    for (const primary of conflict.primaryEntries || []) {
        for (const secondary of conflict.secondaryEntries || []) {
            if (primary.string !== secondary.string) continue;
            if (Math.abs(primary.startBeat - secondary.startBeat) <= EPS
                || (primary.startBeat < entryEnd(secondary) - EPS
                    && secondary.startBeat < entryEnd(primary) - EPS)) {
                return { primary, secondary };
            }
        }
    }
    return { primary: conflict.primaryEntries && conflict.primaryEntries[0],
        secondary: conflict.secondaryEntries && conflict.secondaryEntries[0] };
}

function harmonyLabel(note) {
    if (!note || note._fn === undefined || note._fn === null) return 'None';
    if (typeof note._fn === 'string') return note._fn || 'None';
    try { return JSON.stringify(note._fn); } catch (_) { return 'Authored harmony'; }
}

function entryDuration(entry) {
    return Math.max(0, finite(entry && entry.endBeat) - finite(entry && entry.startBeat));
}

function propertyDifferences(conflict) {
    if (!(conflict.reasons || []).includes('note-variant')) return [];
    const pair = overlappingPair(conflict);
    if (!pair.primary || !pair.secondary) return [];
    const candidates = [
        ['Start beat', pair.primary.startBeat.toFixed(3), pair.secondary.startBeat.toFixed(3)],
        ['Sustain', `${entryDuration(pair.primary).toFixed(3)} beats`, `${entryDuration(pair.secondary).toFixed(3)} beats`],
        ['Techniques', compositeTechniqueLabels(pair.primary.note).join(', ') || 'None',
            compositeTechniqueLabels(pair.secondary.note).join(', ') || 'None'],
        ['Harmony', harmonyLabel(pair.primary.note), harmonyLabel(pair.secondary.note)],
    ];
    return candidates.filter(([, primary, secondary]) => primary !== secondary)
        .map(([property, primary, secondary]) => ({ property, primary, secondary }));
}

function conflictExplanation(conflict, names, stringCount) {
    if ((conflict.reasons || []).includes('guided-choice')) {
        if ((conflict.reasons || []).includes('transition')) {
            return 'Nearby notes are included in this review section because a complete trail crosses the handoff. Choose which track should play through it; no trail will be cut off.';
        }
        const common = Math.max(0, Math.trunc(finite(conflict.commonCount)));
        const commonText = common
            ? ` ${common} identical ${common === 1 ? 'note is' : 'notes are'} already included once.` : '';
        return `Both tracks play different parts here.${commonText} Choose a track, or mix the notes yourself.`;
    }
    const pair = overlappingPair(conflict);
    if (!pair.primary || !pair.secondary) return 'These source notes require a choice.';
    const displayString = Math.max(1, stringCount - pair.primary.string);
    const overlapMilliseconds = Math.round(Math.max(0, finite(conflict.overlapSeconds)) * 1000);
    const overlap = overlapMilliseconds > 0 ? ` They overlap by ${overlapMilliseconds} ms, including their trails.`
        : ' Their attacks fall within the timing tolerance.';
    if ((conflict.reasons || []).includes('same-string-overlap')) {
        return `String ${displayString} cannot play fret ${pair.primary.fret} from ${names.primary}`
            + ` and fret ${pair.secondary.fret} from ${names.secondary} together.${overlap}`;
    }
    return `String ${displayString}, fret ${pair.primary.fret} starts in both tracks, but its sustain, technique, or harmony data differs.${overlap}`;
}

function laneEntry(entry, conflictIds, selectedIds, selectable, invalid = false) {
    return {
        ...entry,
        techniques: compositeTechniqueLabels(entry.note),
        inConflict: conflictIds.has(entry.id),
        selected: selectedIds.has(entry.id),
        selectable: selectable && conflictIds.has(entry.id),
        invalid: invalid && conflictIds.has(entry.id),
    };
}

export function buildCompositeConflictViewModel({
    plan, conflictIndex = 0, primaryName = 'Primary', secondaryName = 'Secondary',
    customEntryIds = null, modelIndex = null, resolvedEntries = null,
} = {}) {
    if (!plan || !Array.isArray(plan.conflicts) || !plan.conflicts.length) return null;
    const index = Math.max(0, Math.min(Math.trunc(finite(conflictIndex)), plan.conflicts.length - 1));
    const conflict = plan.conflicts[index];
    const names = { primary: primaryName || 'Primary', secondary: secondaryName || 'Secondary' };
    const prepared = compositeConflictViewIndexMatches(modelIndex, { plan, resolvedEntries })
        ? modelIndex : createCompositeConflictViewIndex({ plan, resolvedEntries });
    const context = compositeConflictContextFromIndex(prepared.boundaries, conflict, {
        fallbackPadding: FALLBACK_CONTEXT_BEATS,
        epsilon: EPS,
    });
    const conflictEntries = [...(conflict.primaryEntries || []), ...(conflict.secondaryEntries || [])];
    const conflictIds = new Set(conflictEntries.map(entry => entry.id));
    const currentSelection = Array.isArray(customEntryIds) ? customEntryIds : conflict.selectedEntryIds;
    const selectedIds = new Set(currentSelection || []);
    const custom = Array.isArray(customEntryIds);
    const invalid = Boolean(conflict.validationError);
    const primary = compositeIndexedEntriesInRange(prepared.primary, context)
        .map(entry => laneEntry(entry, conflictIds, selectedIds, custom));
    const secondary = compositeIndexedEntriesInRange(prepared.secondary, context)
        .map(entry => laneEntry(entry, conflictIds, selectedIds, custom));
    // A manual draft temporarily replaces one committed conflict selection;
    // preserve that uncommon mutation-aware path exactly. Ordinary navigation
    // reads the already-sorted resolved revision through its range index.
    const localResult = custom
        ? entriesInContext(resolvedResultEntries(plan, conflict, currentSelection), context)
        : prepared.result
            ? compositeIndexedEntriesInRange(prepared.result, context)
            : entriesInContext(resolvedResultEntries(plan, conflict, null), context);
    const result = localResult
        .map(entry => laneEntry(entry, conflictIds, selectedIds, false, invalid));
    const stringCount = Math.max(1, Math.trunc(finite(plan.compatibility && plan.compatibility.stringCount, 6)));
    return {
        conflict,
        conflictIndex: index,
        conflictCount: plan.conflicts.length,
        context,
        stringCount,
        names,
        custom,
        invalid,
        explanation: conflictExplanation(conflict, names, stringCount),
        differences: propertyDifferences(conflict),
        lanes: [
            { id: 'primary', label: names.primary,
                subtitle: 'Base track · kept outside reviewed sections', entries: primary },
            { id: 'secondary', label: names.secondary,
                subtitle: 'Fill track · alternative part for this section', entries: secondary },
            { id: 'result', label: 'Hybrid result', subtitle: conflict.resolution || custom
                ? 'Your current choice' : 'Choose what to play here', entries: result },
        ],
    };
}

export function buildCompositeReviewToolbarModel({
    plan, conflict, primaryName = 'Base', secondaryName = 'Fill',
    customEntryIds = null, decisionNumber = 1, decisionTotal = 1,
    unresolvedDecisions = 0, repeatCount = 1, canReset = null,
} = {}) {
    if (!plan || !conflict) return null;
    const draftActive = Array.isArray(customEntryIds);
    const manualActive = draftActive || conflict.resolution === 'custom';
    const selection = draftActive ? customEntryIds
        : conflict.resolution === 'custom' ? conflict.selectedEntryIds || [] : [];
    const selectedIds = new Set(selection);
    const primarySelected = (conflict.primaryEntries || [])
        .filter(entry => selectedIds.has(entry.id)).length;
    const secondarySelected = (conflict.secondaryEntries || [])
        .filter(entry => selectedIds.has(entry.id)).length;
    const validationError = String(conflict.validationError || '');
    const resolution = manualActive ? 'custom' : conflict.resolution || '';
    const state = validationError ? 'invalid' : conflict.resolution ? 'resolved' : 'unresolved';
    const choices = [
        { id: 'primary', label: `Use ${primaryName}`, hint: 'Use the base track here' },
        { id: 'secondary', label: `Use ${secondaryName}`, hint: 'Use the fill track here' },
        { id: 'custom', label: 'Mix notes', hint: 'Choose notes from either track' },
    ];
    return {
        decisionNumber: Math.max(1, Math.trunc(finite(decisionNumber, 1))),
        decisionTotal: Math.max(1, Math.trunc(finite(decisionTotal, 1))),
        unresolvedDecisions: Math.max(0, Math.trunc(finite(unresolvedDecisions))),
        repeatCount: Math.max(1, Math.trunc(finite(repeatCount, 1))),
        resolution,
        state,
        stateLabel: state === 'invalid' ? 'Needs attention'
            : state === 'resolved' ? 'Choice made' : 'Needs review',
        selectedLaneId: resolution === 'primary' || resolution === 'secondary'
            ? resolution : resolution === 'custom' ? 'result' : '',
        choices: choices.map(choice => ({
            ...choice,
            selected: resolution === choice.id,
        })),
        canReset: canReset === null
            ? Boolean(conflict.resolution || draftActive) : Boolean(canReset),
        canContinue: Boolean(conflict.resolution),
        manualActive,
        primarySelected,
        secondarySelected,
        validationError,
    };
}

export function renderCompositeDifferenceTable(view) {
    if (!view || !view.differences.length) return '';
    const rows = view.differences.map(difference => `<tr class="border-t border-gray-700/70">`
        + `<th class="text-left font-normal text-gray-400 py-1.5 pr-3">${escapeMarkup(difference.property)}</th>`
        + `<td class="text-sky-200 py-1.5 pr-3">${escapeMarkup(difference.primary)}</td>`
        + `<td class="text-violet-200 py-1.5">${escapeMarkup(difference.secondary)}</td></tr>`).join('');
    return `<div class="mt-3 overflow-x-auto"><table class="w-full text-[11px]"><thead><tr>`
        + `<th class="text-left text-gray-500 font-normal pb-1">Different property</th>`
        + `<th class="text-left text-sky-400 font-medium pb-1">${escapeMarkup(view.names.primary)}</th>`
        + `<th class="text-left text-violet-400 font-medium pb-1">${escapeMarkup(view.names.secondary)}</th>`
        + `</tr></thead><tbody>${rows}</tbody></table></div>`;
}
