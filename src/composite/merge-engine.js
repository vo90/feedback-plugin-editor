/* Shared Hybrid Track merge core.
 *
 * Pure, DOM-free source preparation, duplicate handling, selection safety,
 * and materialization shared by Automatic and Guided Hybrid Track planning.
 * Source arrangements are never mutated.
 */

import {
    arrangementKind,
} from './arrangement-ports.js';
import { stringCountForArrangement } from './fretboard-ports.js';
import { beatAtTime, timeAtBeat } from './timing-ports.js';

export const COMPOSITE_BEAT_EPS = 1e-4;
export const COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS = 0.001;
export const COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS = 0.005;
export const COMPOSITE_TIMING_TOLERANCE_BEAT_FRACTION = 0.01;
const compositePlanResolutionRevisions = new WeakMap();
const compositePlanResolutionIndexes = new WeakMap();

// Resolution state is intentionally kept outside the plan: plans cross the
// analysis Worker boundary and must remain structured-clone-safe. Consumers
// with derived indexes can use this O(1) revision to invalidate exact caches
// even when the unresolved count happens to stay unchanged.
export function compositePlanResolutionRevision(plan) {
    return plan && typeof plan === 'object'
        ? compositePlanResolutionRevisions.get(plan) || 0 : 0;
}

function markCompositePlanResolutionChanged(plan) {
    if (!plan || typeof plan !== 'object') return;
    compositePlanResolutionRevisions.set(plan, compositePlanResolutionRevision(plan) + 1);
}

/**
 * Hybrid plans are analysis-owned snapshots: conflict/fixed arrays, entries,
 * and the beat map remain immutable after analysis, while resolution changes
 * go through resolveCompositeConflict/clearCompositeConflictResolution. A
 * caller that deliberately changes any of those fields in place must call this
 * first-class escape hatch after the edit and before another cached resolution
 * operation.
 *
 * Derived indexes stay in WeakMaps, so invalidation changes no serialized plan
 * data and Worker-cloned plans build their own index on first use.
 */
export function invalidateCompositeConflictResolutionIndex(plan) {
    if (!plan || typeof plan !== 'object') return false;
    compositePlanResolutionIndexes.delete(plan);
    markCompositePlanResolutionChanged(plan);
    return true;
}

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
    const before = timeAtBeat(beats, center - 0.5);
    const after = timeAtBeat(beats, center + 0.5);
    const localBeatSeconds = Math.abs(after - before);
    const proposed = Number.isFinite(localBeatSeconds) && localBeatSeconds > 1e-9
        ? localBeatSeconds * COMPOSITE_TIMING_TOLERANCE_BEAT_FRACTION
        : COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS;
    return Math.max(COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS,
        Math.min(COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS, proposed));
}

function timingNear(a, b, beats) {
    const left = timeAtBeat(beats, a);
    const right = timeAtBeat(beats, b);
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
        ? Number(note.beat) : beatAtTime(beats, finite(note && note.time));
}

function noteEndBeat(note, beats, startBeat) {
    const ends = [startBeat];
    if (Number.isFinite(Number(note && note.beatEnd))) ends.push(Number(note.beatEnd));
    const startTime = finite(note && note.time);
    const sustain = Math.max(0, finite(note && (note.sustain ?? note.sus)));
    ends.push(beatAtTime(beats, startTime + sustain));
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
    for (let noteIndex = 0; noteIndex < (arrangement.notes || []).length; noteIndex++) {
        const note = arrangement.notes[noteIndex];
        // Editor arrangements normally arrive here already flattened: chord
        // children live in `notes`, while `_fromChord` / `_chordId` retain the
        // authored template link. Recover a stable chord-instance key from the
        // same rounded timestamp reconstructChords() uses on save. A lone child
        // moved away from its siblings consequently becomes an ordinary note
        // during materialization instead of keeping a stale chord template.
        const templateId = Math.trunc(finite(note && note._chordId, -1));
        const noteTime = Number(note && note.time);
        const noteBeatValue = Number(note && note.beat);
        const chordPositionKey = Number.isFinite(noteTime)
            ? `time:${noteTime.toFixed(4)}`
            : Number.isFinite(noteBeatValue) ? `beat:${noteBeatValue.toFixed(4)}`
                : `note:${noteIndex}`;
        const fromChord = safeWireBool(note && note._fromChord, false);
        const template = templateId >= 0 ? arrangement.chord_templates?.[templateId] : null;
        raw.push({ note, metadata: fromChord ? {
            kind: 'chord-note',
            chordIndex: -1,
            chordKey: `${source}:flat-chord:${chordPositionKey}`,
            chordTime: Number.isFinite(noteTime) ? noteTime : null,
            chordHighDensity: note && note._highDensity,
            templateId,
            templateKey: `${source}:template:${templateId}`,
            chordTemplate: clone(template),
        } : { kind: 'note' } });
    }
    for (let chordIndex = 0; chordIndex < (arrangement.chords || []).length; chordIndex++) {
        const chord = arrangement.chords[chordIndex];
        const templateId = Math.trunc(finite(chord && chord.chord_id, -1));
        const template = templateId >= 0 ? arrangement.chord_templates?.[templateId] : null;
        for (const chordNote of chord.notes || []) {
            const authoredChordTime = Number(chord && chord.time);
            const authoredNoteTime = Number(chordNote && chordNote.time);
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
                chordTime: Number.isFinite(authoredChordTime) ? authoredChordTime
                    : Number.isFinite(authoredNoteTime) ? authoredNoteTime : null,
                chordHighDensity: chord && (chord.high_density ?? chord.highDensity),
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

function lowerBound(list, value, getter = item => item) {
    let low = 0;
    let high = list.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (getter(list[middle]) < value) low = middle + 1;
        else high = middle;
    }
    return low;
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
            const authoredEndTime = timeAtBeat(beats, entry.endBeat);
            const nextStartTime = timeAtBeat(beats, next.startBeat);
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
    const laterStart = timeAtBeat(beats, later.startBeat);
    const earlierEnd = timeAtBeat(beats, earlier.effectiveEndBeat);
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
    const primaryKind = arrangementKind(primary);
    const secondaryKind = arrangementKind(secondary);
    const fretted = new Set(['guitar', 'bass']);
    if (!fretted.has(primaryKind) || !fretted.has(secondaryKind)) {
        errors.push('Both sources must be guitar or bass arrangements.');
    } else if (primaryKind !== secondaryKind) {
        errors.push('Guitar and bass arrangements cannot be merged together.');
    }
    const primaryStrings = stringCountForArrangement(primary);
    const secondaryStrings = stringCountForArrangement(secondary);
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
        primaryByPosition.get(key).push({
            entry,
            startTime: timeAtBeat(beats, entry.startBeat),
        });
    }
    for (const list of primaryByPosition.values()) {
        list.sort((left, right) => left.startTime - right.startTime
            || compareEntries(left.entry, right.entry));
    }
    const usedPrimaryIds = new Set();
    const duplicates = [];
    const uniqueSecondaryEntries = [];
    for (const entry of secondaryEntries) {
        const positionEntries = primaryByPosition.get(`${entry.string}:${entry.fret}`) || [];
        const entryStartTime = timeAtBeat(beats, entry.startBeat);
        const from = Number.isFinite(entryStartTime)
            ? lowerBound(positionEntries,
                entryStartTime - COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS - 1e-9,
                candidate => candidate.startTime)
            : 0;
        let duplicate = null;
        let duplicateDistance = Infinity;
        for (let index = from; index < positionEntries.length; index++) {
            const candidateRecord = positionEntries[index];
            if (Number.isFinite(entryStartTime) && Number.isFinite(candidateRecord.startTime)
                && candidateRecord.startTime
                    > entryStartTime + COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS + 1e-9) break;
            const candidate = candidateRecord.entry;
            if (usedPrimaryIds.has(candidate.id) || !exactDuplicate(candidate, entry, beats)) continue;
            const distance = Math.abs(candidateRecord.startTime - entryStartTime)
                + Math.abs(timeAtBeat(beats, candidate.endBeat) - timeAtBeat(beats, entry.endBeat));
            if (!duplicate || distance < duplicateDistance
                || distance === duplicateDistance && compareEntries(candidate, duplicate) < 0) {
                duplicate = candidate;
                duplicateDistance = distance;
            }
        }
        if (!duplicate) {
            uniqueSecondaryEntries.push(entry);
            continue;
        }
        usedPrimaryIds.add(duplicate.id);
        mergeEntryProvenance(duplicate, entry);
        duplicates.push({
            secondary: entry,
            primary: duplicate,
            startDeltaSeconds: Math.abs(timeAtBeat(beats, duplicate.startBeat) - timeAtBeat(beats, entry.startBeat)),
            endDeltaSeconds: Math.abs(timeAtBeat(beats, duplicate.endBeat) - timeAtBeat(beats, entry.endBeat)),
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

function collisionSweepCanRetain(earlier, later, beats) {
    if (!Number.isFinite(earlier.effectiveEndBeat)) return true;
    if (earlier.effectiveEndBeat > later.startBeat) return true;
    return timingNear(earlier.startBeat, later.startBeat, beats);
}

/**
 * Visit every cross-source, same-string collision without comparing unrelated
 * strings or notes whose playable intervals have already ended. The visitor
 * receives entries in their original input order so callers can retain the
 * legacy selection/error ordering even though detection is time-indexed.
 */
export function forEachCompositeSelectionCollision(entries, beats = [], visitor = () => {}) {
    const selected = Array.isArray(entries) ? entries : [];
    const byString = new Map();
    const indexedBySweep = new Array(selected.length).fill(false);
    for (let index = 0; index < selected.length; index++) {
        const entry = selected[index];
        if (!entry || !Number.isFinite(entry.startBeat)) continue;
        if (!byString.has(entry.string)) byString.set(entry.string, []);
        byString.get(entry.string).push({ entry, index });
        indexedBySweep[index] = true;
    }
    let collisionCount = 0;
    for (const stringEntries of byString.values()) {
        stringEntries.sort((left, right) => left.entry.startBeat - right.entry.startBeat
            || left.index - right.index);
        let active = [];
        for (const current of stringEntries) {
            active = active.filter(previous =>
                collisionSweepCanRetain(previous.entry, current.entry, beats));
            for (const previous of active) {
                if (entriesShareSource(previous.entry, current.entry)) continue;
                const reason = compositeCollisionReason(previous.entry, current.entry, beats);
                if (!reason) continue;
                collisionCount++;
                const left = previous.index < current.index ? previous : current;
                const right = left === previous ? current : previous;
                if (visitor(left.entry, right.entry, reason, left.index, right.index) === false) {
                    return collisionCount;
                }
            }
            active.push(current);
        }
    }
    // Planner entries always have numeric beat positions. Preserve the public
    // validator's legacy degradation for malformed/ad-hoc callers by checking
    // only pairs the ordered sweep could not index.
    for (let leftIndex = 0; leftIndex < selected.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex++) {
            if (indexedBySweep[leftIndex] && indexedBySweep[rightIndex]) continue;
            const left = selected[leftIndex];
            const right = selected[rightIndex];
            if (!left || !right || entriesShareSource(left, right)) continue;
            const reason = compositeCollisionReason(left, right, beats);
            if (!reason) continue;
            collisionCount++;
            if (visitor(left, right, reason, leftIndex, rightIndex) === false) {
                return collisionCount;
            }
        }
    }
    return collisionCount;
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

function selectionFor(group, resolution, selectedEntryIds, metadata = null) {
    const available = metadata ? metadata.entries : conflictEntries(group);
    if (resolution === 'primary') {
        return metadata ? metadata.primaryEntries
            : available.filter(entry => compositeEntryHasSource(entry, 'primary'));
    }
    if (resolution === 'secondary') {
        return metadata ? metadata.secondaryEntries
            : available.filter(entry => compositeEntryHasSource(entry, 'secondary'));
    }
    if (resolution === 'custom') {
        if (!metadata) {
            const ids = expandSelectionUnits(group, selectedEntryIds);
            return available.filter(entry => ids.has(entry.id));
        }
        const ids = new Set();
        for (const entryId of selectedEntryIds || []) {
            for (const entry of metadata.selectionUnitsByEntryId.get(entryId) || []) {
                ids.add(entry.id);
            }
        }
        return available.filter(entry => ids.has(entry.id));
    }
    return [];
}

function compositeSelectionFailure(a, b, beats, stringCount) {
    const displayString = Math.max(1, Math.trunc(finite(stringCount, 6)) - a.string);
    const overlapMilliseconds = Math.max(1,
        Math.round(collisionOverlapSeconds(a, b, beats) * 1000));
    return {
        ok: false,
        error: `String ${displayString} has source notes overlapping by ${overlapMilliseconds} ms.`,
        entryIds: [a.id, b.id],
    };
}

export function validateCompositeSelection(entries, beats = [], stringCount = 6) {
    const selected = entries || [];
    let first = null;
    forEachCompositeSelectionCollision(selected, beats, (a, b, reason, leftIndex, rightIndex) => {
        if (!first || leftIndex < first.leftIndex
            || leftIndex === first.leftIndex && rightIndex < first.rightIndex) {
            first = { a, b, reason, leftIndex, rightIndex };
        }
    });
    if (first) {
        return compositeSelectionFailure(first.a, first.b, beats, stringCount);
    }
    return { ok: true, error: '' };
}

function buildResolutionGroupMetadata(group, index) {
    const entries = conflictEntries(group);
    const entriesByPlayableGroup = new Map();
    for (const entry of entries) {
        if (!entry.playableGroupId) continue;
        if (!entriesByPlayableGroup.has(entry.playableGroupId)) {
            entriesByPlayableGroup.set(entry.playableGroupId, []);
        }
        entriesByPlayableGroup.get(entry.playableGroupId).push(entry);
    }
    const selectionUnitsByEntryId = new Map(entries.map(entry => [entry.id,
        entry.playableGroupId ? entriesByPlayableGroup.get(entry.playableGroupId) : [entry]]));
    return {
        group,
        index,
        entries,
        entryOrderById: new Map(entries.map((entry, entryIndex) => [entry.id, entryIndex])),
        primaryEntries: entries.filter(entry => compositeEntryHasSource(entry, 'primary')),
        secondaryEntries: entries.filter(entry => compositeEntryHasSource(entry, 'secondary')),
        selectionUnitsByEntryId,
    };
}

function resolutionGroupMetadata(index, groupIndex) {
    if (!Number.isInteger(groupIndex) || groupIndex < 0
            || groupIndex >= index.groupMetadata.length) return null;
    if (!index.groupMetadata[groupIndex]) {
        index.groupMetadata[groupIndex] = buildResolutionGroupMetadata(
            index.conflicts[groupIndex], groupIndex);
    }
    return index.groupMetadata[groupIndex];
}

function compositeEntryIntervalRecord(entry, beats) {
    const startTime = timeAtBeat(beats, entry && entry.startBeat);
    const endTime = timeAtBeat(beats, entry && entry.effectiveEndBeat);
    if (!entry || !Number.isFinite(startTime) || !Number.isFinite(endTime)
        || !Number.isFinite(entry.string)) return null;
    return {
        id: entry.id,
        string: entry.string,
        startTime: Math.min(startTime, endTime),
        endTime: Math.max(startTime, endTime),
    };
}

function buildCompositeIntervalIndex(records) {
    let sorted = true;
    for (let index = 1; index < records.length; index++) {
        if (records[index].startTime < records[index - 1].startTime) {
            sorted = false;
            break;
        }
    }
    if (!sorted) {
        records.sort((left, right) => left.startTime - right.startTime
            || left.endTime - right.endTime || String(left.id).localeCompare(String(right.id)));
    }
    const starts = new Float64Array(records.length);
    let leafBase = 1;
    while (leafBase < records.length) leafBase *= 2;
    const maxEnds = new Float64Array(leafBase * 2);
    maxEnds.fill(-Infinity);
    for (let index = 0; index < records.length; index++) {
        starts[index] = records[index].startTime;
        maxEnds[leafBase + index] = records[index].endTime;
    }
    for (let node = leafBase - 1; node > 0; node--) {
        maxEnds[node] = Math.max(maxEnds[node * 2], maxEnds[node * 2 + 1]);
    }
    return { records, starts, leafBase, maxEnds };
}

function queryCompositeIntervalIndex(intervalIndex, minimum, maximum, stats, visitor) {
    if (!intervalIndex) return;
    const { records, starts, leafBase, maxEnds } = intervalIndex;
    let lower = 0;
    let upper = records.length;
    while (lower < upper) {
        stats.intervalIndexBinarySteps++;
        const middle = (lower + upper) >> 1;
        if (starts[middle] <= maximum) lower = middle + 1;
        else upper = middle;
    }
    const pastLastCandidate = lower;
    const visit = (node, start, end) => {
        stats.intervalIndexNodesVisited++;
        if (start >= pastLastCandidate || maxEnds[node] < minimum) return;
        if (end - start === 1) {
            stats.intervalIndexEntriesVisited++;
            stats.intervalRecordsMatched++;
            visitor(records[start].id);
            return;
        }
        const middle = (start + end) >> 1;
        visit(node * 2, start, middle);
        if (middle < pastLastCandidate) visit(node * 2 + 1, middle, end);
    };
    if (pastLastCandidate) visit(1, 0, leafBase);
    // Retain the original diagnostic name as a combined bounded-work counter
    // while exposing its two deterministic components separately.
    stats.intervalTreeNodesVisited = stats.intervalIndexBinarySteps
        + stats.intervalIndexNodesVisited;
}

function compositeResolutionIntervalIndex(index, string) {
    if (index.intervalIndexesByString.has(string)) {
        return index.intervalIndexesByString.get(string);
    }
    const candidates = index.intervalEntriesByString.get(string) || [];
    const records = [];
    for (const entry of candidates) {
        const record = compositeEntryIntervalRecord(entry, index.plan.beats);
        if (record) records.push(record);
        else {
            index.stats.indexedEntries--;
            index.stats.unindexedEntries++;
        }
    }
    const intervalIndex = records.length ? buildCompositeIntervalIndex(records) : null;
    index.intervalIndexesByString.set(string, intervalIndex);
    index.stats.intervalBucketsBuilt++;
    index.stats.intervalEntriesMaterialized += candidates.length;
    return intervalIndex;
}

function compositeResolutionIndexIsCurrent(index, plan) {
    return index && index.conflicts === plan.conflicts
        && index.fixedEntries === plan.fixedEntries
        && index.revision === compositePlanResolutionRevision(plan);
}

function addCompositeCollisionEdge(index, a, b, reason) {
    if (!a || !b || a.id === b.id) return;
    const key = a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`;
    if (index.collisionEdges.has(key)) return;
    index.collisionEdges.set(key, { aId: a.id, bId: b.id, reason });
    for (const id of [a.id, b.id]) {
        if (!index.collisionEdgeKeysById.has(id)) index.collisionEdgeKeysById.set(id, new Set());
        index.collisionEdgeKeysById.get(id).add(key);
    }
}

function queryCompositePotentialActiveEntries(index, entry, visitor) {
    const record = compositeEntryIntervalRecord(entry, index.plan.beats);
    if (!record) {
        for (const active of index.activeEntriesById.values()) {
            index.stats.unindexedEntriesVisited++;
            visitor(active);
        }
        return;
    }
    const minimum = record.startTime - COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS - 1e-9;
    const maximum = record.endTime + COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS + 1e-9;
    const visitedIds = new Set();
    queryCompositeIntervalIndex(compositeResolutionIntervalIndex(index, record.string),
        minimum, maximum, index.stats, id => {
            if (visitedIds.has(id)) return;
            visitedIds.add(id);
            const active = index.activeEntriesById.get(id);
            if (active) visitor(active);
        });
    for (const id of index.unindexedActiveIds) {
        if (visitedIds.has(id)) continue;
        const active = index.activeEntriesById.get(id);
        if (!active) continue;
        index.stats.unindexedEntriesVisited++;
        visitor(active);
    }
}

function flagCompositeAmbiguousEntryId(index, entryId) {
    if (index.ambiguousEntryIds.has(entryId)) return;
    index.ambiguousEntryIds.add(entryId);
    index.hasDuplicateEntryIds = true;
    index.stats.duplicateEntryIds++;
}

function checkCompositeCandidateEntryIds(index, entries) {
    for (const entry of entries) {
        index.stats.candidateOwnershipEntriesChecked++;
        const active = index.activeEntriesById.get(entry && entry.id);
        if (active && active !== entry) flagCompositeAmbiguousEntryId(index, entry.id);
    }
}

function activateCompositeResolutionEntries(index, entries, ownerIndex,
    { indexCollisions = true } = {}) {
    for (const entry of entries) {
        if (!entry || entry.id == null) continue;
        index.stats.activeOwnershipEntriesChecked++;
        const activeEntry = index.activeEntriesById.get(entry.id);
        if (activeEntry && activeEntry !== entry) {
            flagCompositeAmbiguousEntryId(index, entry.id);
        }
        if (!index.activeOwnersById.has(entry.id)) index.activeOwnersById.set(entry.id, new Set());
        const owners = index.activeOwnersById.get(entry.id);
        if (owners.has(ownerIndex)) continue;
        const wasActive = owners.size > 0;
        owners.add(ownerIndex);
        if (wasActive) continue;
        if (indexCollisions) {
            queryCompositePotentialActiveEntries(index, entry, active => {
                if (entriesShareSource(entry, active)) return;
                index.stats.collisionPairsChecked++;
                const reason = compositeCollisionReason(entry, active, index.plan.beats);
                if (reason) addCompositeCollisionEdge(index, entry, active, reason);
            });
        }
        index.activeEntriesById.set(entry.id, entry);
        if (!compositeEntryIntervalRecord(entry, index.plan.beats)) {
            index.unindexedActiveIds.add(entry.id);
        }
    }
}

function deactivateCompositeResolutionEntries(index, entries, ownerIndex) {
    for (const entry of entries) {
        const owners = index.activeOwnersById.get(entry && entry.id);
        if (!owners || !owners.delete(ownerIndex) || owners.size) continue;
        index.activeOwnersById.delete(entry.id);
        index.activeEntriesById.delete(entry.id);
        index.unindexedActiveIds.delete(entry.id);
        for (const edgeKey of index.collisionEdgeKeysById.get(entry.id) || []) {
            const edge = index.collisionEdges.get(edgeKey);
            if (!edge) continue;
            index.collisionEdges.delete(edgeKey);
            const otherId = edge.aId === entry.id ? edge.bId : edge.aId;
            const otherKeys = index.collisionEdgeKeysById.get(otherId);
            if (otherKeys) {
                otherKeys.delete(edgeKey);
                if (!otherKeys.size) index.collisionEdgeKeysById.delete(otherId);
            }
        }
        index.collisionEdgeKeysById.delete(entry.id);
    }
}

function selectedCompositeResolutionEntries(metadata) {
    if (!metadata.group.resolution) return [];
    const ids = new Set(metadata.group.selectedEntryIds || []);
    return metadata.entries.filter(entry => ids.has(entry.id));
}

function entriesWithLegacyCandidateResolution(plan, currentGroup, selected) {
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

function resolveCompositeConflictWithLegacyValidation(plan, index, metadata,
    resolution, selected) {
    index.stats.legacyValidationAttempts++;
    const group = metadata.group;
    const wasResolved = Boolean(group.resolution);
    const validation = validateCompositeSelection(entriesWithLegacyCandidateResolution(
        plan, group, selected), plan.beats,
        plan.compatibility && plan.compatibility.stringCount);
    const selectedIds = new Set(selected.map(entry => entry.id));
    const crossesBlockBoundary = !validation.ok && (validation.entryIds || [])
        .some(entryId => !selectedIds.has(entryId));
    group.validationKind = crossesBlockBoundary ? 'transition' : validation.ok ? '' : 'selection';
    group.validationError = crossesBlockBoundary
        ? `Transition conflict: ${validation.error}` : validation.error;
    if (!validation.ok) {
        group.resolution = null;
        group.selectedEntryIds = [];
        if (wasResolved) index.unresolvedCount++;
        commitCompositeResolutionMutation(plan, index);
        return validation;
    }
    group.resolution = resolution;
    group.selectedEntryIds = selected.map(entry => entry.id);
    if (!wasResolved) index.unresolvedCount--;
    commitCompositeResolutionMutation(plan, index);
    return { ok: true, selected: selected.slice() };
}

function buildCompositeResolutionIndex(plan) {
    const conflicts = Array.isArray(plan && plan.conflicts) ? plan.conflicts : [];
    const fixedEntries = Array.isArray(plan && plan.fixedEntries) ? plan.fixedEntries : [];
    const groupMetadata = new Array(conflicts.length);
    const resolvedGroupIndexes = [];
    const groupIndexById = new Map();
    const intervalEntriesByString = new Map();
    let indexedEntryCount = 0;
    let unindexedEntryCount = 0;
    const classifyEntry = entry => {
        if (!entry || !Number.isFinite(entry.string)
                || !Number.isFinite(entry.startBeat)
                || !Number.isFinite(entry.effectiveEndBeat)) {
            unindexedEntryCount++;
            return;
        }
        indexedEntryCount++;
        let entries = intervalEntriesByString.get(entry.string);
        if (!entries) {
            entries = [];
            intervalEntriesByString.set(entry.string, entries);
        }
        entries.push(entry);
    };
    // The interval structure is only a spatial accelerator, so raw inactive
    // candidates remain compact. Active fixed/resolved ownership is checked as
    // it is registered below, and every future candidate is checked against it
    // before localized validation. Any ambiguous id permanently moves this
    // malformed plan to conservative legacy whole-selection validation.
    for (const entry of fixedEntries) classifyEntry(entry);
    let unresolvedCount = 0;
    for (let groupIndex = 0; groupIndex < conflicts.length; groupIndex++) {
        const group = conflicts[groupIndex];
        if (group.resolution) resolvedGroupIndexes.push(groupIndex);
        else unresolvedCount++;
        // Preserve the legacy Array.find behavior for malformed/restored plans
        // containing duplicate conflict ids.
        if (!groupIndexById.has(group.id)) groupIndexById.set(group.id, groupIndex);
        for (const entry of group.primaryEntries || []) classifyEntry(entry);
        for (const entry of group.secondaryEntries || []) classifyEntry(entry);
    }
    const intervalIndexesByString = new Map();
    const fixedOrderById = new Map();
    for (const entry of fixedEntries) {
        if (!fixedOrderById.has(entry.id)) fixedOrderById.set(entry.id, fixedOrderById.size);
    }
    const index = {
        plan,
        conflicts: plan.conflicts,
        fixedEntries: plan.fixedEntries,
        revision: compositePlanResolutionRevision(plan),
        groupMetadata,
        groupIndexById,
        fixedOrderById,
        intervalEntriesByString,
        intervalIndexesByString,
        hasDuplicateEntryIds: false,
        ambiguousEntryIds: new Set(),
        unindexedActiveIds: new Set(),
        activeEntriesById: new Map(),
        activeOwnersById: new Map(),
        selectedEntriesByGroupIndex: new Map(),
        collisionEdges: new Map(),
        collisionEdgeKeysById: new Map(),
        unresolvedCount,
        stats: {
            indexBuilds: 1,
            duplicateEntryIds: 0,
            nonStringEntryIds: 0,
            activeOwnershipEntriesChecked: 0,
            candidateOwnershipEntriesChecked: 0,
            legacyValidationAttempts: 0,
            indexedEntries: indexedEntryCount,
            unindexedEntries: unindexedEntryCount,
            resolutionAttempts: 0,
            candidateEntriesVisited: 0,
            intervalTreeNodesVisited: 0,
            intervalIndexBinarySteps: 0,
            intervalIndexNodesVisited: 0,
            intervalIndexEntriesVisited: 0,
            intervalBucketsBuilt: 0,
            intervalEntriesMaterialized: 0,
            intervalRecordsMatched: 0,
            unindexedEntriesVisited: 0,
            collisionPairsChecked: 0,
            existingCollisionPairsVisited: 0,
        },
    };
    activateCompositeResolutionEntries(index, fixedEntries, -1, { indexCollisions: false });
    for (const groupIndex of resolvedGroupIndexes) {
        const metadata = resolutionGroupMetadata(index, groupIndex);
        const selected = selectedCompositeResolutionEntries(metadata);
        index.selectedEntriesByGroupIndex.set(metadata.index, selected);
        activateCompositeResolutionEntries(index, selected, metadata.index,
            { indexCollisions: false });
    }
    const activeEntries = [...index.activeEntriesById.values()];
    forEachCompositeSelectionCollision(activeEntries, plan.beats, (a, b, reason) => {
        index.stats.collisionPairsChecked++;
        addCompositeCollisionEdge(index, a, b, reason);
    });
    compositePlanResolutionIndexes.set(plan, index);
    return index;
}

function compositeResolutionIndex(plan) {
    const cached = compositePlanResolutionIndexes.get(plan);
    return compositeResolutionIndexIsCurrent(cached, plan)
        ? cached : buildCompositeResolutionIndex(plan);
}

// Build the private index during idle time without changing any plan field or
// its resolution revision. The resolver can call this opportunistically so the
// first player choice does not pay the one-time indexing cost.
export function prewarmCompositeConflictResolutionIndex(plan) {
    if (!plan || typeof plan !== 'object') return false;
    compositeResolutionIndex(plan);
    return true;
}

function compareCompositeOrderKeys(left, right) {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const difference = finite(left[index]) - finite(right[index]);
        if (difference) return difference;
    }
    return 0;
}

function compositeResolutionEntryOrderKey(index, candidateOrderById, entry) {
    if (index.fixedOrderById.has(entry.id)) return [0, index.fixedOrderById.get(entry.id), 0];
    if (candidateOrderById.has(entry.id)) return [1, candidateOrderById.get(entry.id), 0];
    const owners = index.activeOwnersById.get(entry.id) || [];
    let ownerIndex = Infinity;
    for (const owner of owners) if (owner >= 0) ownerIndex = Math.min(ownerIndex, owner);
    const metadata = resolutionGroupMetadata(index, ownerIndex);
    return [2, ownerIndex,
        metadata ? finite(metadata.entryOrderById.get(entry.id), Infinity) : Infinity];
}

function validateCompositeResolutionCandidate(index, metadata, selected) {
    const candidateOrderById = new Map();
    for (const entry of selected) {
        if (!candidateOrderById.has(entry.id)) candidateOrderById.set(entry.id, candidateOrderById.size);
    }
    let first = null;
    const consider = (a, b, reason) => {
        const aKey = compositeResolutionEntryOrderKey(index, candidateOrderById, a);
        const bKey = compositeResolutionEntryOrderKey(index, candidateOrderById, b);
        const ordered = compareCompositeOrderKeys(aKey, bKey) <= 0
            ? { a, b, aKey, bKey, reason } : { a: b, b: a, aKey: bKey, bKey: aKey, reason };
        if (!first || compareCompositeOrderKeys(ordered.aKey, first.aKey) < 0
            || compareCompositeOrderKeys(ordered.aKey, first.aKey) === 0
                && compareCompositeOrderKeys(ordered.bKey, first.bKey) < 0) first = ordered;
    };
    for (const edge of index.collisionEdges.values()) {
        index.stats.existingCollisionPairsVisited++;
        const a = index.activeEntriesById.get(edge.aId);
        const b = index.activeEntriesById.get(edge.bId);
        if (a && b) consider(a, b, edge.reason);
    }
    forEachCompositeSelectionCollision(selected, index.plan.beats, (a, b, reason) => {
        index.stats.collisionPairsChecked++;
        consider(a, b, reason);
    });
    for (const entry of selected) {
        index.stats.candidateEntriesVisited++;
        queryCompositePotentialActiveEntries(index, entry, active => {
            if (active.id === entry.id || entriesShareSource(entry, active)) return;
            index.stats.collisionPairsChecked++;
            const reason = compositeCollisionReason(entry, active, index.plan.beats);
            if (reason) consider(entry, active, reason);
        });
    }
    if (!first) return { ok: true, error: '' };
    return compositeSelectionFailure(first.a, first.b, index.plan.beats,
        index.plan.compatibility && index.plan.compatibility.stringCount);
}

function commitCompositeResolutionMutation(plan, index) {
    if (plan.stats) plan.stats.unresolvedConflicts = index.unresolvedCount;
    markCompositePlanResolutionChanged(plan);
    index.revision = compositePlanResolutionRevision(plan);
}

export function compositeConflictResolutionDiagnostics(plan) {
    const index = compositePlanResolutionIndexes.get(plan);
    if (!index || !compositeResolutionIndexIsCurrent(index, plan)) return null;
    return {
        ...index.stats,
        activeEntries: index.activeEntriesById.size,
        unresolvedConflicts: index.unresolvedCount,
        collisionEdges: index.collisionEdges.size,
    };
}

export function resolveCompositeConflict(plan, conflictId, resolution, selectedEntryIds = []) {
    if (!plan || typeof plan !== 'object') {
        return { ok: false, error: 'Review section not found.' };
    }
    const index = compositeResolutionIndex(plan);
    const groupIndex = index.groupIndexById.get(conflictId);
    const metadata = Number.isInteger(groupIndex)
        ? resolutionGroupMetadata(index, groupIndex) : null;
    const group = metadata && metadata.group;
    if (!group) return { ok: false, error: 'Review section not found.' };
    if (!['primary', 'secondary', 'custom'].includes(resolution)) {
        return { ok: false, error: 'Unknown review choice.' };
    }
    index.stats.resolutionAttempts++;
    const selected = selectionFor(group, resolution, selectedEntryIds, metadata);
    checkCompositeCandidateEntryIds(index, selected);
    if (index.hasDuplicateEntryIds) {
        return resolveCompositeConflictWithLegacyValidation(
            plan, index, metadata, resolution, selected);
    }
    const previousSelected = index.selectedEntriesByGroupIndex.get(metadata.index) || [];
    const wasResolved = !!group.resolution;
    deactivateCompositeResolutionEntries(index, previousSelected, metadata.index);
    index.selectedEntriesByGroupIndex.set(metadata.index, []);
    const validation = validateCompositeResolutionCandidate(index, metadata, selected);
    const selectedIds = new Set(selected.map(entry => entry.id));
    const crossesBlockBoundary = !validation.ok && (validation.entryIds || [])
        .some(entryId => !selectedIds.has(entryId));
    group.validationKind = crossesBlockBoundary ? 'transition' : validation.ok ? '' : 'selection';
    group.validationError = crossesBlockBoundary
        ? `Transition conflict: ${validation.error}` : validation.error;
    if (!validation.ok) {
        group.resolution = null;
        group.selectedEntryIds = [];
        if (wasResolved) index.unresolvedCount++;
        commitCompositeResolutionMutation(plan, index);
        return validation;
    }
    group.resolution = resolution;
    group.selectedEntryIds = selected.map(e => e.id);
    const committedSelected = selected.slice();
    index.selectedEntriesByGroupIndex.set(metadata.index, committedSelected);
    activateCompositeResolutionEntries(index, committedSelected,
        metadata.index, { indexCollisions: false });
    if (!wasResolved) index.unresolvedCount--;
    commitCompositeResolutionMutation(plan, index);
    return { ok: true, selected: selected.slice() };
}

export function clearCompositeConflictResolution(plan, conflictId) {
    if (!plan || typeof plan !== 'object') return { ok: false, error: 'Conflict not found.' };
    const index = compositeResolutionIndex(plan);
    const groupIndex = index.groupIndexById.get(conflictId);
    const metadata = Number.isInteger(groupIndex)
        ? resolutionGroupMetadata(index, groupIndex) : null;
    const group = metadata && metadata.group;
    if (!group) return { ok: false, error: 'Conflict not found.' };
    const wasResolved = !!group.resolution;
    if (index.hasDuplicateEntryIds) {
        group.resolution = null;
        group.selectedEntryIds = [];
        group.validationError = '';
        group.validationKind = '';
        if (wasResolved) index.unresolvedCount++;
        commitCompositeResolutionMutation(plan, index);
        return { ok: true };
    }
    const selected = index.selectedEntriesByGroupIndex.get(metadata.index) || [];
    deactivateCompositeResolutionEntries(index, selected, metadata.index);
    index.selectedEntriesByGroupIndex.set(metadata.index, []);
    group.resolution = null;
    group.selectedEntryIds = [];
    group.validationError = '';
    group.validationKind = '';
    if (wasResolved) index.unresolvedCount++;
    commitCompositeResolutionMutation(plan, index);
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
    const startTime = timeAtBeat(beats, entry.startBeat);
    const endTime = timeAtBeat(beats, entry.endBeat);
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
    delete note._highDensity;
    return note;
}

function safeWireBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes'].includes(normalized)) return true;
        if (['false', '0', 'no', ''].includes(normalized)) return false;
    }
    return fallback;
}

function normalizedChordFrets(entries, stringCount) {
    const frets = new Array(stringCount).fill(-1);
    for (const entry of entries || []) {
        const string = Math.trunc(finite(entry && entry.string, -1));
        if (string >= 0 && string < stringCount) frets[string] = Math.trunc(finite(entry.fret, -1));
    }
    return frets;
}

function normalizedTemplateFrets(template, stringCount) {
    const source = Array.isArray(template && template.frets) ? template.frets : [];
    const frets = new Array(stringCount).fill(-1);
    for (let index = 0; index < stringCount && index < source.length; index++) {
        frets[index] = Number.isFinite(source[index]) ? Math.trunc(source[index]) : -1;
    }
    return frets;
}

function normalizedTemplateFingers(template, stringCount) {
    const source = Array.isArray(template && template.fingers) ? template.fingers : [];
    const fingers = new Array(stringCount).fill(-1);
    for (let index = 0; index < stringCount && index < source.length; index++) {
        fingers[index] = Number.isFinite(source[index]) ? Math.trunc(source[index]) : -1;
    }
    return fingers;
}

function materializedChordTemplate(authored, frets, stringCount) {
    const source = authored && typeof authored === 'object' ? authored : {};
    const template = clone(source) || {};
    const name = typeof source.name === 'string' ? source.name : '';
    template.name = name;
    template.frets = frets.slice(0, stringCount);
    while (template.frets.length < stringCount) template.frets.push(-1);
    template.fingers = normalizedTemplateFingers(source, stringCount);
    template.displayName = typeof source.displayName === 'string' ? source.displayName : name;
    template.arp = safeWireBool(source.arp, false);
    template.voicing = typeof source.voicing === 'string' ? source.voicing : '';
    template.caged = typeof source.caged === 'string' && /^[CAGED]$/.test(source.caged.trim())
        ? source.caged.trim() : '';
    template.guideTones = Array.isArray(source.guideTones)
        ? source.guideTones.filter(value => Number.isInteger(value) && value >= 0 && value <= 11)
        : [];
    return template;
}

function chordSourceEntries(plan, source) {
    const explicit = plan && plan.sourceEntries && plan.sourceEntries[source];
    if (Array.isArray(explicit)) return explicit;
    return flattenArrangement(plan && plan[source] || {}, source, plan && plan.beats || []);
}

function compositeChordGroups(plan, resolvedEntries, stringCount) {
    const selectedBySourceId = new Map();
    for (const entry of resolvedEntries || []) {
        if (!entry || !entry.id) continue;
        selectedBySourceId.set(entry.id, entry);
        for (const duplicateId of entry.duplicateEntryIds || []) {
            if (!selectedBySourceId.has(duplicateId)) selectedBySourceId.set(duplicateId, entry);
        }
    }

    const groups = [];
    for (const source of ['primary', 'secondary']) {
        const byKey = new Map();
        for (const entry of chordSourceEntries(plan, source)) {
            const metadata = entry && entry.metadata;
            if (metadata?.kind !== 'chord-note' || !metadata.chordKey) continue;
            let group = byKey.get(metadata.chordKey);
            if (!group) {
                group = {
                    source,
                    key: metadata.chordKey,
                    expectedById: new Map(),
                    templateCandidates: [],
                    templateIds: new Set(),
                    chordTimes: [],
                    highDensityVotes: [],
                };
                byKey.set(metadata.chordKey, group);
            }
            group.expectedById.set(entry.id, entry);
            const templateId = Math.trunc(finite(metadata.templateId, -1));
            if (templateId >= 0) group.templateIds.add(templateId);
            if (metadata.chordTemplate && typeof metadata.chordTemplate === 'object') {
                group.templateCandidates.push({
                    template: metadata.chordTemplate,
                    templateId,
                });
            }
            const chordTime = metadata.chordTime === null || metadata.chordTime === undefined
                ? Number.NaN : Number(metadata.chordTime);
            if (Number.isFinite(chordTime)) group.chordTimes.push(chordTime);
            if (metadata.chordHighDensity !== undefined) {
                group.highDensityVotes.push(safeWireBool(metadata.chordHighDensity, false));
            }
        }
        for (const group of byKey.values()) {
            group.expectedEntries = [...group.expectedById.values()];
            group.selectedEntries = [...new Set(group.expectedEntries
                .map(entry => selectedBySourceId.get(entry.id)).filter(Boolean))];
            group.complete = group.expectedEntries.length >= 2
                && group.selectedEntries.length === group.expectedEntries.length;
            group.frets = normalizedChordFrets(group.selectedEntries, stringCount);
            const fretKey = group.frets.join(',');
            const matchingTemplate = group.templateCandidates.find(candidate =>
                normalizedTemplateFrets(candidate.template, stringCount).join(',') === fretKey);
            const selectedTemplate = matchingTemplate || group.templateCandidates[0] || null;
            group.template = selectedTemplate?.template || null;
            group.templateId = selectedTemplate?.templateId ?? -1;
            if (group.templateId >= 0) group.templateIds.add(group.templateId);
            group.chordTime = group.chordTimes[0] ?? Number(group.selectedEntries[0]?.note?.time);
            const highVotes = group.highDensityVotes.filter(Boolean).length;
            group.highDensity = group.highDensityVotes.length > 0
                && highVotes * 2 > group.highDensityVotes.length;
            groups.push(group);
        }
    }
    return groups;
}

function compareChordGroups(left, right) {
    const sourceOrder = (left.source === 'primary' ? 0 : 1)
        - (right.source === 'primary' ? 0 : 1);
    if (sourceOrder) return sourceOrder;
    const leftBeat = Math.min(...left.selectedEntries.map(entry => entry.startBeat));
    const rightBeat = Math.min(...right.selectedEntries.map(entry => entry.startBeat));
    return leftBeat - rightBeat || left.key.localeCompare(right.key);
}

function compositeSaveTimeKey(entry, beats) {
    const seconds = timeAtBeat(beats || [], finite(entry?.startBeat));
    const rounded = Math.round(finite(seconds) * 1e6) / 1e6;
    // Keep this exactly aligned with reconstructChords(), which groups the
    // editable note surface at four decimal places before saving.
    return rounded.toFixed(4);
}

function markMetadataSafeChordGroups(groups, resolvedEntries, beats) {
    const selectedBySaveTime = new Map();
    for (const entry of resolvedEntries || []) {
        const key = compositeSaveTimeKey(entry, beats);
        if (!selectedBySaveTime.has(key)) selectedBySaveTime.set(key, new Set());
        selectedBySaveTime.get(key).add(entry.id);
    }
    for (const group of groups) {
        const keys = new Set(group.selectedEntries.map(entry =>
            compositeSaveTimeKey(entry, beats)));
        const selectedAtTime = keys.size === 1
            ? selectedBySaveTime.get([...keys][0]) : null;
        group.preserveMetadata = group.complete && !!selectedAtTime
            && selectedAtTime.size === group.selectedEntries.length
            && group.selectedEntries.every(entry => selectedAtTime.has(entry.id));
    }
    return groups;
}

function materializeCompositeHandshapes(plan, groups) {
    const handshapes = [];
    const dedupe = new Set();
    const epsilon = 1e-4;
    for (const source of ['primary', 'secondary']) {
        const arrangement = plan && plan[source] || {};
        const sourceGroups = groups.filter(group => group.source === source);
        for (const authored of arrangement.handshapes || []) {
            if (!authored) continue;
            const rawTemplateId = authored.chord_id;
            const templateId = rawTemplateId === null || rawTemplateId === undefined
                    || typeof rawTemplateId === 'string' && !rawTemplateId.trim()
                ? Number.NaN : Math.trunc(Number(rawTemplateId));
            const startTime = Number(authored.start_time);
            const endTime = Number(authored.end_time);
            if (!Number.isInteger(templateId) || templateId < 0
                    || !Number.isFinite(startTime) || !Number.isFinite(endTime)
                    || endTime < startTime) continue;
            const associated = sourceGroups.filter(group => group.templateIds.has(templateId)
                && Number.isFinite(group.chordTime)
                && group.chordTime >= startTime - epsilon
                && group.chordTime <= endTime + epsilon);
            if (!associated.length || associated.some(group => !group.preserveMetadata)) continue;
            const outputIds = new Set(associated.map(group => group.outputTemplateIndex));
            if (outputIds.size !== 1 || outputIds.has(undefined)) continue;
            const outputTemplateIndex = [...outputIds][0];
            const key = `${outputTemplateIndex}:${startTime}:${endTime}`
                + `:${safeWireBool(authored.arp, false)}`;
            if (dedupe.has(key)) continue;
            dedupe.add(key);
            handshapes.push({
                ...clone(authored),
                chord_id: outputTemplateIndex,
                start_time: startTime,
                end_time: endTime,
                arp: safeWireBool(authored.arp, false),
            });
        }
    }
    return handshapes.sort((left, right) => left.start_time - right.start_time
        || left.end_time - right.end_time || left.chord_id - right.chord_id);
}

function materializeCompositeChordMetadata(plan, resolvedEntries, stringCount) {
    const groups = markMetadataSafeChordGroups(
        compositeChordGroups(plan, resolvedEntries, stringCount),
        resolvedEntries,
        plan?.beats,
    );
    const completeGroups = groups.filter(group => group.preserveMetadata)
        .sort(compareChordGroups);
    const templates = [];
    const templateByFrets = new Map();
    const completeGroupByEntryId = new Map();
    const chordEntryIds = new Set();
    for (const group of groups) {
        for (const entry of group.selectedEntries) chordEntryIds.add(entry.id);
    }
    for (const group of completeGroups) {
        const fretKey = group.frets.join(',');
        let templateIndex = templateByFrets.get(fretKey);
        if (templateIndex === undefined) {
            templateIndex = templates.length;
            templateByFrets.set(fretKey, templateIndex);
            templates.push(materializedChordTemplate(group.template, group.frets, stringCount));
        }
        group.outputTemplateIndex = templateIndex;
        for (const entry of group.selectedEntries) {
            // The Base source is sorted first, so it deterministically owns
            // metadata when strict duplicate notes represent both sources.
            if (!completeGroupByEntryId.has(entry.id)) completeGroupByEntryId.set(entry.id, group);
        }
    }
    return {
        chordEntryIds,
        completeGroupByEntryId,
        templates,
        handshapes: materializeCompositeHandshapes(plan, groups),
    };
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
    const chordMetadata = materializeCompositeChordMetadata(
        plan, resolvedEntries, plan.compatibility.stringCount);
    const notes = resolvedEntries.map((entry) => {
        const note = materializeNote(entry, plan.beats);
        const chordGroup = chordMetadata.completeGroupByEntryId.get(entry.id);
        if (chordGroup) {
            note._fromChord = true;
            note._chordId = chordGroup.outputTemplateIndex;
            if (chordGroup.highDensity) note._highDensity = true;
        } else if (chordMetadata.chordEntryIds.has(entry.id)) {
            // Chord-level harmony cannot truthfully survive a partial group.
            // Leave the retained members as plain notes here. The Editor's
            // normal save invariant groups simultaneous notes into a reduced,
            // metadata-neutral chord, which then round-trips without a private
            // Hybrid marker or wire-format extension.
            delete note._fn;
        }
        return note;
    });
    const arrangement = {
        name: resultName,
        type: plan.compatibility.kind === 'bass' ? 'bass' : 'guitar',
        tuning: clone(primary.tuning || new Array(plan.compatibility.stringCount).fill(0)),
        capo: finite(primary.capo),
        notes,
        chords: [],
        chord_templates: chordMetadata.templates,
        // Base-track global navigation/fretboard metadata remains authoritative.
        // Fill contributes only selected, locally-provable chord metadata.
        anchors: clone(Array.isArray(primary.anchors) ? primary.anchors : []),
        anchors_user: clone(Array.isArray(primary.anchors_user) ? primary.anchors_user : []),
        handshapes: chordMetadata.handshapes,
        phrases: clone(Array.isArray(primary.phrases) ? primary.phrases : []),
    };
    if (primary.centOffset !== undefined) arrangement.centOffset = finite(primary.centOffset);
    if (primary._extendedStrings !== undefined) arrangement._extendedStrings = primary._extendedStrings;
    if (primary.tones && typeof primary.tones === 'object') arrangement.tones = clone(primary.tones);
    arrangement.notes.sort((a, b) => finite(a.beat, a.time) - finite(b.beat, b.time)
        || a.string - b.string || a.fret - b.fret);
    return arrangement;
}
