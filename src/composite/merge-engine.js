/* Shared Hybrid Track merge core.
 *
 * Pure, DOM-free source preparation, duplicate handling, selection safety,
 * and materialization shared by Automatic and Guided Hybrid Track planning.
 * Source arrangements are never mutated.
 */

import { beatOf, timeOf } from '../beats.js';
import { arrKind } from '../instrument.js';
import { _stringCountFor } from '../lanes.js';

export const COMPOSITE_BEAT_EPS = 1e-4;
export const COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS = 0.001;
export const COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS = 0.005;
export const COMPOSITE_TIMING_TOLERANCE_BEAT_FRACTION = 0.01;
function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function compositeTimingToleranceSeconds(beats, beat = 0) {
    const center = finite(beat);
    const before = timeOf(beats, center - 0.5);
    const after = timeOf(beats, center + 0.5);
    const localBeatSeconds = Math.abs(after - before);
    const proposed = Number.isFinite(localBeatSeconds) && localBeatSeconds > 1e-9
        ? localBeatSeconds * COMPOSITE_TIMING_TOLERANCE_BEAT_FRACTION
        : COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS;
    return Math.max(COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS,
        Math.min(COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS, proposed));
}

function timingNear(a, b, beats) {
    const left = timeOf(beats, a);
    const right = timeOf(beats, b);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return near(a, b);
    return Math.abs(left - right) <= compositeTimingToleranceSeconds(beats, (a + b) / 2) + 1e-9;
}

function entrySources(entry) {
    const sources = Array.isArray(entry && entry.sources) && entry.sources.length
        ? entry.sources : [entry && entry.source].filter(Boolean);
    return new Set(sources);
}

function entriesShareSource(a, b) {
    const aSources = entrySources(a);
    for (const source of entrySources(b)) if (aSources.has(source)) return true;
    return false;
}

export function compositeEntryHasSource(entry, source) {
    return entrySources(entry).has(source);
}

function mergeEntryProvenance(canonical, duplicate) {
    canonical.sources = [...new Set([...entrySources(canonical), ...entrySources(duplicate)])];
    canonical.duplicateEntryIds = [...new Set([
        ...(canonical.duplicateEntryIds || []), duplicate.id,
        ...(duplicate.duplicateEntryIds || []),
    ])];
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

function techniqueSignature(note) {
    const tech = note && note.techniques && typeof note.techniques === 'object'
        ? note.techniques : {};
    // Compare the entire bag, including fields introduced by future importers.
    // Duplicate removal must be conservative: an unknown authored distinction
    // is a conflict, never something this PoC silently discards.
    const picked = clone(tech);
    // Harmony function rides flattened chord notes. Treat a disagreement as a
    // variant rather than silently choosing one source's harmonic annotation.
    picked._fn = note && note._fn !== undefined ? note._fn : null;
    return stable(picked);
}

function noteBeat(note, beats) {
    return Number.isFinite(Number(note && note.beat))
        ? Number(note.beat) : beatOf(beats, finite(note && note.time));
}

function noteEndBeat(note, beats, startBeat) {
    const ends = [startBeat];
    if (Number.isFinite(Number(note && note.beatEnd))) ends.push(Number(note.beatEnd));
    const startTime = finite(note && note.time);
    const sustain = Math.max(0, finite(note && (note.sustain ?? note.sus)));
    ends.push(beatOf(beats, startTime + sustain));
    return Math.max(...ends);
}

function connectedToNext(entry, next) {
    if (!entry || !next || entry.string !== next.string) return false;
    const techniques = entry.note && entry.note.techniques || {};
    if (techniques.link_next) return true;
    const slideTarget = techniques.slide_to;
    return Number.isFinite(slideTarget) && slideTarget >= 0 && next.fret === slideTarget;
}

function extendConnectedPlayableSpans(entries) {
    const nextByString = new Map();
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        const next = nextByString.get(entry.string);
        if (connectedToNext(entry, next)) {
            entry.effectiveEndBeat = Math.max(entry.effectiveEndBeat, next.startBeat);
            entry.connectedToId = next.id;
        }
        nextByString.set(entry.string, entry);
    }
    return entries;
}

function flattenArrangement(arrangement, source, beats) {
    const raw = [];
    for (const note of arrangement.notes || []) raw.push({ note, metadata: { kind: 'note' } });
    for (let chordIndex = 0; chordIndex < (arrangement.chords || []).length; chordIndex++) {
        const chord = arrangement.chords[chordIndex];
        const templateId = Math.trunc(finite(chord && chord.chord_id, -1));
        const template = templateId >= 0 ? arrangement.chord_templates?.[templateId] : null;
        for (const chordNote of chord.notes || []) {
            raw.push({ note: {
                ...chordNote,
                time: chordNote.time ?? chord.time,
                // Some importers author one duration on the chord, others put
                // it on every child. Preserve either representation so the
                // whole visible trail participates in merge occupancy.
                sustain: chordNote.sustain ?? chordNote.sus
                    ?? chord.sustain ?? chord.sus ?? 0,
                techniques: clone(chordNote.techniques || {}),
                _fn: clone(chord.fn || null),
            }, metadata: {
                kind: 'chord-note',
                chordIndex,
                chordKey: `${source}:chord:${chordIndex}`,
                templateId,
                templateKey: `${source}:template:${templateId}`,
                chordTemplate: clone(template),
            } });
        }
    }
    const entries = raw.map((item, index) => {
        const note = item.note;
        const startBeat = noteBeat(note, beats);
        const endBeat = noteEndBeat(note, beats, startBeat);
        return {
            id: `${source}:${index}`,
            source,
            sources: [source],
            sourceIndex: index,
            startBeat,
            endBeat,
            effectiveEndBeat: Math.max(endBeat, startBeat + COMPOSITE_BEAT_EPS),
            string: Math.trunc(finite(note.string, -1)),
            fret: Math.trunc(finite(note.fret, -1)),
            techniqueSignature: techniqueSignature(note),
            note: clone(note),
            metadata: clone(item.metadata),
        };
    }).filter(e => Number.isFinite(e.startBeat) && e.string >= 0 && e.fret >= 0)
        .sort(compareEntries);
    normalizeTinySourceBoundaries(entries, beats);
    return extendConnectedPlayableSpans(entries);
}

function compareEntries(a, b) {
    return a.startBeat - b.startBeat || a.string - b.string || a.fret - b.fret
        || a.endBeat - b.endBeat || a.id.localeCompare(b.id);
}

function near(a, b) {
    return Math.abs(a - b) <= COMPOSITE_BEAT_EPS;
}

function normalizeTinySourceBoundaries(entries, beats, { preserveConnections = false } = {}) {
    const byString = new Map();
    for (const entry of entries) {
        if (!byString.has(entry.string)) byString.set(entry.string, []);
        byString.get(entry.string).push(entry);
    }
    for (const stringEntries of byString.values()) {
        stringEntries.sort(compareEntries);
        for (let index = 0; index < stringEntries.length - 1; index++) {
            const entry = stringEntries[index];
            const next = stringEntries[index + 1];
            if (preserveConnections && entry.connectedToId) continue;
            if (next.startBeat <= entry.startBeat + COMPOSITE_BEAT_EPS
                || entry.endBeat <= next.startBeat + 1e-12) continue;
            const authoredEndTime = timeOf(beats, entry.endBeat);
            const nextStartTime = timeOf(beats, next.startBeat);
            const overlapSeconds = authoredEndTime - nextStartTime;
            if (!Number.isFinite(overlapSeconds) || overlapSeconds <= 0
                || overlapSeconds > compositeTimingToleranceSeconds(beats, next.startBeat) + 1e-9) continue;
            const fromEndBeat = entry.endBeat;
            if (!Number.isFinite(entry.authoredEndBeat)) entry.authoredEndBeat = fromEndBeat;
            entry.endBeat = next.startBeat;
            entry.collisionEndBeat = next.startBeat;
            entry.effectiveEndBeat = Math.max(entry.startBeat + COMPOSITE_BEAT_EPS, entry.endBeat);
            entry.timingAdjustment = {
                kind: 'boundary-clamp',
                fromEndBeat,
                toEndBeat: next.startBeat,
                overlapSeconds,
            };
        }
    }
}

function collisionOverlapSeconds(a, b, beats) {
    const earlier = a.startBeat <= b.startBeat ? a : b;
    const later = earlier === a ? b : a;
    const laterStart = timeOf(beats, later.startBeat);
    const earlierEnd = timeOf(beats, earlier.effectiveEndBeat);
    return Number.isFinite(laterStart) && Number.isFinite(earlierEnd)
        ? Math.max(0, earlierEnd - laterStart) : 0;
}

function overlap(a, b, beats) {
    if (timingNear(a.startBeat, b.startBeat, beats)) return true;
    const overlapSeconds = collisionOverlapSeconds(a, b, beats);
    if (overlapSeconds <= 0) return false;
    // Only a sequential end/start boundary receives timing slop. Near-simultaneous
    // different-fret attacks remain a real physical conflict.
    const laterStartBeat = Math.max(a.startBeat, b.startBeat);
    return overlapSeconds > compositeTimingToleranceSeconds(beats, laterStartBeat) + 1e-9;
}

function exactDuplicate(a, b, beats) {
    const aTarget = a.connectedTarget;
    const bTarget = b.connectedTarget;
    const connectionsMatch = !aTarget && !bTarget || aTarget && bTarget
        && aTarget.string === bTarget.string && aTarget.fret === bTarget.fret
        && timingNear(aTarget.startBeat, bTarget.startBeat, beats)
        && timingNear(aTarget.endBeat, bTarget.endBeat, beats)
        && aTarget.techniqueSignature === bTarget.techniqueSignature;
    return connectionsMatch && a.string === b.string && a.fret === b.fret
        && timingNear(a.startBeat, b.startBeat, beats) && timingNear(a.endBeat, b.endBeat, beats)
        && a.techniqueSignature === b.techniqueSignature;
}

export function compositeCollisionReason(a, b, beats) {
    if (a.string !== b.string || !overlap(a, b, beats)) return '';
    if (timingNear(a.startBeat, b.startBeat, beats) && a.fret === b.fret) return 'note-variant';
    return 'same-string-overlap';
}

function normalizedTuning(arrangement, count) {
    const tuning = Array.isArray(arrangement && arrangement.tuning)
        ? arrangement.tuning : [];
    const out = [];
    for (let i = 0; i < count; i++) out.push(finite(tuning[i]));
    return out;
}

export function compositeCompatibility(primary, secondary) {
    const errors = [];
    const primaryKind = arrKind(primary);
    const secondaryKind = arrKind(secondary);
    const fretted = new Set(['guitar', 'bass']);
    if (!fretted.has(primaryKind) || !fretted.has(secondaryKind)) {
        errors.push('Both sources must be guitar or bass arrangements.');
    } else if (primaryKind !== secondaryKind) {
        errors.push('Guitar and bass arrangements cannot be merged together.');
    }
    const primaryStrings = _stringCountFor(primary);
    const secondaryStrings = _stringCountFor(secondary);
    if (primaryStrings !== secondaryStrings) {
        errors.push(`String counts differ (${primaryStrings} vs ${secondaryStrings}).`);
    }
    if (stable(normalizedTuning(primary, primaryStrings))
        !== stable(normalizedTuning(secondary, secondaryStrings))) {
        errors.push('Tunings differ. Normalize both arrangements before merging.');
    }
    if (finite(primary && primary.capo) !== finite(secondary && secondary.capo)) {
        errors.push('Capos differ. Normalize both arrangements before merging.');
    }
    const primaryCents = finite(primary && primary.centOffset);
    const secondaryCents = finite(secondary && secondary.centOffset);
    if (primaryCents !== secondaryCents) {
        errors.push('Cent offsets differ. Normalize both arrangements before merging.');
    }
    return {
        ok: errors.length === 0,
        errors,
        kind: primaryKind,
        stringCount: primaryStrings,
    };
}

export function compositePlayableGroups(entries) {
    const parent = entries.map((_, index) => index);
    const find = index => {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    };
    const join = (left, right) => {
        const a = find(left);
        const b = find(right);
        if (a !== b) parent[b] = a;
    };
    const indexById = new Map(entries.map((entry, index) => [entry.id, index]));
    for (let i = 1; i < entries.length; i++) {
        if (near(entries[i - 1].startBeat, entries[i].startBeat)) join(i - 1, i);
    }
    for (let i = 0; i < entries.length; i++) {
        const target = indexById.get(entries[i].connectedToId);
        if (target !== undefined) join(i, target);
    }
    const groups = new Map();
    for (let i = 0; i < entries.length; i++) {
        const root = find(i);
        const group = groups.get(root) || {
            startBeat: entries[i].startBeat,
            endBeat: entries[i].effectiveEndBeat,
            entries: [],
        };
        group.startBeat = Math.min(group.startBeat, entries[i].startBeat);
        group.endBeat = Math.max(group.endBeat, entries[i].effectiveEndBeat);
        group.entries.push(entries[i]);
        groups.set(root, group);
    }
    return [...groups.values()].sort((a, b) => a.startBeat - b.startBeat);
}

function annotatePlayableGroups(entries, source) {
    const groups = compositePlayableGroups(entries);
    for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const id = `${source}:gesture:${index}`;
        for (const entry of group.entries) {
            entry.playableGroupId = id;
            entry.playableStartBeat = group.startBeat;
            entry.playableEndBeat = group.endBeat;
        }
    }
    const entryById = new Map(entries.map(entry => [entry.id, entry]));
    for (const entry of entries) {
        const target = entryById.get(entry.connectedToId);
        if (!target) continue;
        entry.connectedTarget = {
            startBeat: target.startBeat,
            endBeat: target.endBeat,
            string: target.string,
            fret: target.fret,
            techniqueSignature: target.techniqueSignature,
        };
    }
    return groups;
}

/**
 * Shared, DOM-free preparation used by both automatic Gap Fill and Guided
 * Hybrid. Duplicate pairing is deliberately one-to-one: a repeated source
 * event may not consume the same canonical note twice.
 */
export function prepareCompositeSources({ primary, secondary, beats = [] } = {}) {
    const compatibility = compositeCompatibility(primary || {}, secondary || {});
    if (!compatibility.ok) {
        return {
            ok: false,
            compatibility,
            primaryEntries: [],
            secondaryEntries: [],
            uniqueSecondaryEntries: [],
            duplicates: [],
            timingAdjustments: [],
        };
    }
    const primaryEntries = flattenArrangement(primary, 'primary', beats);
    const secondaryEntries = flattenArrangement(secondary, 'secondary', beats);
    annotatePlayableGroups(primaryEntries, 'primary');
    annotatePlayableGroups(secondaryEntries, 'secondary');

    const primaryByPosition = new Map();
    for (const entry of primaryEntries) {
        const key = `${entry.string}:${entry.fret}`;
        if (!primaryByPosition.has(key)) primaryByPosition.set(key, []);
        primaryByPosition.get(key).push(entry);
    }
    const usedPrimaryIds = new Set();
    const duplicates = [];
    const uniqueSecondaryEntries = [];
    for (const entry of secondaryEntries) {
        const candidates = (primaryByPosition.get(`${entry.string}:${entry.fret}`) || [])
            .filter(candidate => !usedPrimaryIds.has(candidate.id) && exactDuplicate(candidate, entry, beats))
            .sort((left, right) => {
                const leftDelta = Math.abs(timeOf(beats, left.startBeat) - timeOf(beats, entry.startBeat))
                    + Math.abs(timeOf(beats, left.endBeat) - timeOf(beats, entry.endBeat));
                const rightDelta = Math.abs(timeOf(beats, right.startBeat) - timeOf(beats, entry.startBeat))
                    + Math.abs(timeOf(beats, right.endBeat) - timeOf(beats, entry.endBeat));
                return leftDelta - rightDelta || compareEntries(left, right);
            });
        const duplicate = candidates[0];
        if (!duplicate) {
            uniqueSecondaryEntries.push(entry);
            continue;
        }
        usedPrimaryIds.add(duplicate.id);
        mergeEntryProvenance(duplicate, entry);
        duplicates.push({
            secondary: entry,
            primary: duplicate,
            startDeltaSeconds: Math.abs(timeOf(beats, duplicate.startBeat) - timeOf(beats, entry.startBeat)),
            endDeltaSeconds: Math.abs(timeOf(beats, duplicate.endBeat) - timeOf(beats, entry.endBeat)),
        });
    }
    const timingAdjustments = [...primaryEntries, ...secondaryEntries]
        .filter(entry => entry.timingAdjustment).map(entry => entry.timingAdjustment);
    return {
        ok: true,
        compatibility,
        primaryEntries,
        secondaryEntries,
        uniqueSecondaryEntries,
        duplicates,
        timingAdjustments,
    };
}

function conflictEntries(group) {
    const unique = new Map();
    for (const entry of [...(group.primaryEntries || []), ...(group.secondaryEntries || [])]) {
        unique.set(entry.id, entry);
    }
    return [...unique.values()];
}

export function compositeSelectionUnitIds(group, entryId) {
    const available = conflictEntries(group || {});
    const target = available.find(entry => entry.id === entryId);
    if (!target || !target.playableGroupId) return target ? [target.id] : [];
    return available.filter(entry => entry.playableGroupId === target.playableGroupId)
        .map(entry => entry.id);
}

function expandSelectionUnits(group, selectedEntryIds) {
    const expanded = new Set();
    for (const entryId of selectedEntryIds || []) {
        for (const unitId of compositeSelectionUnitIds(group, entryId)) expanded.add(unitId);
    }
    return expanded;
}

function selectionFor(group, resolution, selectedEntryIds) {
    const available = conflictEntries(group);
    if (resolution === 'primary') return available.filter(entry => compositeEntryHasSource(entry, 'primary'));
    if (resolution === 'secondary') return available.filter(entry => compositeEntryHasSource(entry, 'secondary'));
    if (resolution === 'custom') {
        const ids = expandSelectionUnits(group, selectedEntryIds);
        return available.filter(e => ids.has(e.id));
    }
    return [];
}

export function validateCompositeSelection(entries, beats = [], stringCount = 6) {
    const selected = entries || [];
    for (let i = 0; i < selected.length; i++) {
        for (let j = i + 1; j < selected.length; j++) {
            const a = selected[i];
            const b = selected[j];
            if (!entriesShareSource(a, b) && compositeCollisionReason(a, b, beats)) {
                const displayString = Math.max(1, Math.trunc(finite(stringCount, 6)) - a.string);
                const overlapMilliseconds = Math.max(1,
                    Math.round(collisionOverlapSeconds(a, b, beats) * 1000));
                return {
                    ok: false,
                    error: `String ${displayString} has source notes overlapping by ${overlapMilliseconds} ms.`,
                    entryIds: [a.id, b.id],
                };
            }
        }
    }
    return { ok: true, error: '' };
}

function entriesWithCandidateResolution(plan, currentGroup, selected) {
    const entries = [...(plan.fixedEntries || []), ...selected];
    for (const group of plan.conflicts || []) {
        if (group === currentGroup || !group.resolution) continue;
        const ids = new Set(group.selectedEntryIds || []);
        entries.push(...conflictEntries(group).filter(entry => ids.has(entry.id)));
    }
    const unique = new Map();
    for (const entry of entries) unique.set(entry.id, entry);
    return [...unique.values()];
}

export function resolveCompositeConflict(plan, conflictId, resolution, selectedEntryIds = []) {
    const group = plan && plan.conflicts && plan.conflicts.find(c => c.id === conflictId);
    if (!group) return { ok: false, error: 'Review section not found.' };
    if (!['primary', 'secondary', 'custom'].includes(resolution)) {
        return { ok: false, error: 'Unknown review choice.' };
    }
    const selected = selectionFor(group, resolution, selectedEntryIds);
    const validation = validateCompositeSelection(
        entriesWithCandidateResolution(plan, group, selected),
        plan.beats,
        plan.compatibility && plan.compatibility.stringCount,
    );
    const selectedIds = new Set(selected.map(entry => entry.id));
    const crossesBlockBoundary = !validation.ok && (validation.entryIds || [])
        .some(entryId => !selectedIds.has(entryId));
    group.validationKind = crossesBlockBoundary ? 'transition' : validation.ok ? '' : 'selection';
    group.validationError = crossesBlockBoundary
        ? `Transition conflict: ${validation.error}` : validation.error;
    if (!validation.ok) {
        group.resolution = null;
        group.selectedEntryIds = [];
        plan.stats.unresolvedConflicts = plan.conflicts.filter(c => !c.resolution).length;
        return validation;
    }
    group.resolution = resolution;
    group.selectedEntryIds = selected.map(e => e.id);
    plan.stats.unresolvedConflicts = plan.conflicts.filter(c => !c.resolution).length;
    return { ok: true, selected };
}

export function clearCompositeConflictResolution(plan, conflictId) {
    const group = plan && plan.conflicts && plan.conflicts.find(c => c.id === conflictId);
    if (!group) return { ok: false, error: 'Conflict not found.' };
    group.resolution = null;
    group.selectedEntryIds = [];
    group.validationError = '';
    group.validationKind = '';
    plan.stats.unresolvedConflicts = plan.conflicts.filter(c => !c.resolution).length;
    return { ok: true };
}

export function compositeResolvedEntries(plan) {
    if (!plan || !plan.ok) return [];
    const entries = plan.fixedEntries.slice();
    for (const group of plan.conflicts) {
        if (!group.resolution) continue;
        const ids = new Set(group.selectedEntryIds);
        entries.push(...[...group.primaryEntries, ...group.secondaryEntries].filter(e => ids.has(e.id)));
    }
    const unique = new Map();
    for (const entry of entries) unique.set(entry.id, entry);
    return [...unique.values()].sort(compareEntries);
}

function materializeNote(entry, beats) {
    const note = clone(entry.note) || {};
    const startTime = timeOf(beats, entry.startBeat);
    const endTime = timeOf(beats, entry.endBeat);
    note.time = Math.round(startTime * 1e6) / 1e6;
    note.sustain = Math.max(0, Math.round((endTime - startTime) * 1e6) / 1e6);
    note.beat = entry.startBeat;
    if (entry.endBeat > entry.startBeat + COMPOSITE_BEAT_EPS) note.beatEnd = entry.endBeat;
    else delete note.beatEnd;
    note.string = entry.string;
    note.fret = entry.fret;
    note.techniques = clone(note.techniques || {});
    delete note._fromChord;
    delete note._chordId;
    return note;
}

function prepareCompositeEntries(entries, beats) {
    const prepared = (entries || []).map(entry => ({
        ...entry,
        sources: [...entrySources(entry)],
        duplicateEntryIds: [...(entry.duplicateEntryIds || [])],
        note: clone(entry.note),
        timingAdjustment: clone(entry.timingAdjustment),
    })).sort(compareEntries);
    normalizeTinySourceBoundaries(prepared, beats, { preserveConnections: true });
    return prepared.sort(compareEntries);
}

function toneDefinitionKey(definition) {
    if (!definition || typeof definition !== 'object') return '';
    return String(definition.Key ?? definition.key ?? definition.Name ?? definition.name ?? '').trim();
}

function activeToneName(tones, time) {
    if (!tones || typeof tones !== 'object') return '';
    let active = typeof tones.base === 'string' ? tones.base : '';
    for (const change of (tones.changes || []).slice().sort((left, right) =>
        finite(left?.t, Infinity) - finite(right?.t, Infinity))) {
        if (finite(change?.t, Infinity) > time + 1e-6) break;
        if (typeof change?.name === 'string' && change.name) active = change.name;
    }
    return active;
}

function preserveExperimentalPhrases(plan, selectedOriginalIds) {
    const output = [];
    const add = phrase => {
        const time = finite(phrase?.start_time, Number.NaN);
        if (!Number.isFinite(time)) return;
        if (output.some(existing => Math.abs(finite(existing.start_time) - time) <= 0.005)) return;
        output.push(clone(phrase));
    };
    for (const phrase of plan.primary?.phrases || []) add(phrase);
    const secondaryPhrases = (plan.secondary?.phrases || []).slice().sort((left, right) =>
        finite(left?.start_time) - finite(right?.start_time));
    const secondaryEntries = plan.sourceEntries?.secondary || [];
    for (let index = 0; index < secondaryPhrases.length; index++) {
        const phrase = secondaryPhrases[index];
        const start = finite(phrase?.start_time, Number.NaN);
        const end = index + 1 < secondaryPhrases.length
            ? finite(secondaryPhrases[index + 1]?.start_time, Infinity) : Infinity;
        if (!Number.isFinite(start)) continue;
        const span = secondaryEntries.filter(entry => {
            const time = timeOf(plan.beats, entry.startBeat);
            return time >= start - 1e-4 && time < end - 1e-4;
        });
        if (span.length && span.every(entry => selectedOriginalIds.has(entry.id))) add(phrase);
    }
    return output.sort((left, right) => finite(left.start_time) - finite(right.start_time));
}

function preserveExperimentalTones(plan, selectedOriginalIds) {
    const warnings = [];
    const primary = plan.primary?.tones;
    const secondary = plan.secondary?.tones;
    if (!primary || typeof primary !== 'object') {
        if (secondary && (plan.passages || []).some(passage =>
            !passage.partialSourcePassage
            && (passage.entries || []).length
            && passage.entries.every(entry => selectedOriginalIds.has(entry.id)))) {
            warnings.push('Secondary tone changes were not copied because the base track has no tone schedule to restore afterward.');
        }
        return { tones: null, warnings };
    }
    const tones = clone(primary);
    tones.changes = Array.isArray(tones.changes) ? tones.changes.map(clone) : [];
    tones.definitions = Array.isArray(tones.definitions) ? tones.definitions.map(clone) : [];
    if (!secondary || typeof secondary !== 'object') return { tones, warnings };
    const definitionByKey = new Map(tones.definitions.map(definition =>
        [toneDefinitionKey(definition), definition]).filter(([key]) => key));
    const secondaryDefinitions = new Map((secondary.definitions || []).map(definition =>
        [toneDefinitionKey(definition), definition]).filter(([key]) => key));
    const availableNames = new Set([
        tones.base,
        ...(tones.changes || []).map(change => change?.name),
        ...(tones.slots || []),
        ...definitionByKey.keys(),
    ].filter(Boolean));
    const canImportName = name => {
        if (!name) return false;
        const incoming = secondaryDefinitions.get(name);
        const existing = definitionByKey.get(name);
        if (!incoming && !existing && !availableNames.has(name)) {
            warnings.push(`Tone “${name}” was not copied because its sound definition is missing.`);
            return false;
        }
        if (incoming && existing && stable(incoming) !== stable(existing)) {
            warnings.push(`Tone “${name}” was not copied because both tracks define it differently.`);
            return false;
        }
        if (!existing && incoming) {
            definitionByKey.set(name, clone(incoming));
            tones.definitions.push(clone(incoming));
        }
        if (Array.isArray(tones.slots) && !tones.slots.includes(name)) {
            if (tones.slots.length >= 5) {
                warnings.push(`Tone “${name}” was not copied because the Hybrid already uses all five tone slots.`);
                return false;
            }
            tones.slots.push(name);
        }
        availableNames.add(name);
        return true;
    };
    const events = tones.changes.map(change => ({ ...clone(change), _priority: 1 }));
    for (const passage of plan.passages || []) {
        if (passage.partialSourcePassage || !(passage.entries || []).length
            || !passage.entries.every(entry => selectedOriginalIds.has(entry.id))) continue;
        const start = timeOf(plan.beats, passage.startBeat);
        const end = timeOf(plan.beats, passage.endBeat);
        const passageEvents = [
            { t: start, name: activeToneName(secondary, start), _priority: 2 },
            ...(secondary.changes || []).filter(change => finite(change?.t, -Infinity) > start + 1e-6
                && finite(change?.t, Infinity) < end - 1e-6)
                .map(change => ({ ...clone(change), _priority: 2 })),
        ];
        for (const event of passageEvents) if (canImportName(event.name)) events.push(event);
        const restore = activeToneName(primary, end);
        if (restore) events.push({ t: end, name: restore, _priority: 3 });
    }
    events.sort((left, right) => finite(left.t) - finite(right.t)
        || finite(left._priority) - finite(right._priority));
    const byTime = new Map();
    for (const event of events) byTime.set(Math.round(finite(event.t) * 1000), event);
    tones.changes = [...byTime.values()].sort((left, right) => finite(left.t) - finite(right.t))
        .map(({ _priority, ...event }) => event)
        .filter((event, index, list) => index === 0 || event.name !== list[index - 1].name);
    return { tones, warnings: [...new Set(warnings)] };
}

function experimentalMaterializationMetadata(plan, resolvedEntries) {
    if (plan.strategy !== 'experimental') {
        return { chordTemplates: [], handshapes: [], phrases: [], tones: null, warnings: [] };
    }
    const templates = [];
    const templateIndex = new Map();
    const ensureTemplate = (source, oldId, template) => {
        if (!Number.isInteger(oldId) || oldId < 0 || !template) return -1;
        const key = `${source}:template:${oldId}`;
        if (!templateIndex.has(key)) {
            templateIndex.set(key, templates.length);
            templates.push(clone(template));
        }
        return templateIndex.get(key);
    };
    for (const entry of resolvedEntries) {
        const metadata = entry.metadata || {};
        ensureTemplate(entry.source, metadata.templateId, metadata.chordTemplate);
    }
    const selectedOriginalIds = new Set();
    for (const entry of resolvedEntries) {
        selectedOriginalIds.add(entry.id);
        for (const id of entry.duplicateEntryIds || []) selectedOriginalIds.add(id);
    }
    const handshapes = [];
    const seenHandshapes = new Set();
    for (const source of ['primary', 'secondary']) {
        const arrangement = plan[source] || {};
        const sourceEntries = plan.sourceEntries?.[source] || [];
        for (const handshape of arrangement.handshapes || []) {
            const startTime = finite(handshape && handshape.start_time, Number.NaN);
            const endTime = finite(handshape && handshape.end_time, Number.NaN);
            const sourceSpan = sourceEntries.filter(entry => {
                const time = timeOf(plan.beats, entry.startBeat);
                return Number.isFinite(startTime) && Number.isFinite(endTime)
                    && time >= startTime - 1e-4 && time <= endTime + 1e-4;
            });
            if (!sourceSpan.length || sourceSpan.some(entry => !selectedOriginalIds.has(entry.id))) continue;
            const oldId = Math.trunc(finite(handshape && handshape.chord_id, -1));
            const mapped = ensureTemplate(source, oldId, arrangement.chord_templates?.[oldId]);
            if (mapped < 0) continue;
            const key = `${source}:${oldId}:${startTime}:${endTime}:${!!handshape.arp}`;
            if (seenHandshapes.has(key)) continue;
            seenHandshapes.add(key);
            handshapes.push({ ...clone(handshape), chord_id: mapped });
        }
    }
    const phrases = preserveExperimentalPhrases(plan, selectedOriginalIds);
    const toneProjection = preserveExperimentalTones(plan, selectedOriginalIds);
    return {
        chordTemplates: templates,
        handshapes,
        phrases,
        tones: toneProjection.tones,
        warnings: toneProjection.warnings,
    };
}

export function compositeExperimentalMetadataPreview(plan) {
    if (!plan || plan.strategy !== 'experimental') {
        return { chordTemplates: 0, handshapes: 0, phrases: 0, toneChanges: 0, warnings: [] };
    }
    const metadata = experimentalMaterializationMetadata(plan, compositeResolvedEntries(plan));
    return {
        chordTemplates: metadata.chordTemplates.length,
        handshapes: metadata.handshapes.length,
        phrases: metadata.phrases.length,
        toneChanges: metadata.tones?.changes?.length || 0,
        warnings: metadata.warnings.slice(),
    };
}

export function materializeCompositeArrangement(plan, name) {
    if (!plan || !plan.ok) throw new Error('A valid merge plan is required.');
    const unresolved = plan.conflicts.filter(c => !c.resolution);
    if (unresolved.length) throw new Error(`${unresolved.length} review choice(s) remain unfinished.`);
    // Work on plan-entry clones so both imported tracks and the review plan
    // preserve their authored timing. The generated composite alone receives
    // any final cross-source sub-tolerance boundary clamps.
    const resolvedEntries = prepareCompositeEntries(compositeResolvedEntries(plan), plan.beats);
    const validation = validateCompositeSelection(
        resolvedEntries,
        plan.beats,
        plan.compatibility && plan.compatibility.stringCount,
    );
    if (!validation.ok) throw new Error(`The Hybrid Track is not playable: ${validation.error}`);
    const primary = plan.primary || {};
    const resultName = String(name || '').trim();
    if (!resultName) throw new Error('The Hybrid Track needs a name.');
    const metadata = experimentalMaterializationMetadata(plan, resolvedEntries);
    const arrangement = {
        name: resultName,
        type: plan.compatibility.kind === 'bass' ? 'bass' : 'guitar',
        tuning: clone(primary.tuning || new Array(plan.compatibility.stringCount).fill(0)),
        capo: finite(primary.capo),
        notes: resolvedEntries.map(entry => materializeNote(entry, plan.beats)),
        chords: [],
        chord_templates: metadata.chordTemplates,
        anchors: [],
        anchors_user: [],
        handshapes: metadata.handshapes,
        phrases: metadata.phrases,
    };
    if (primary.centOffset !== undefined) arrangement.centOffset = finite(primary.centOffset);
    if (primary._extendedStrings !== undefined) arrangement._extendedStrings = primary._extendedStrings;
    const tones = plan.strategy === 'experimental' ? metadata.tones : primary.tones;
    if (tones && typeof tones === 'object') arrangement.tones = clone(tones);
    arrangement.notes.sort((a, b) => finite(a.beat, a.time) - finite(b.beat, b.time)
        || a.string - b.string || a.fret - b.fret);
    return arrangement;
}
