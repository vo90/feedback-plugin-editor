/* Arrangement-composite merge engine.
 *
 * Pure, DOM-free planning for combining two fretted arrangements that share
 * the editor's song timeline. Source arrangements are never mutated. The
 * output of `analyzeCompositeMerge` is an explicit plan: safe material lives
 * in `fixedEntries`, while every cross-source physical collision is grouped
 * into a conflict hunk that must be resolved before materialization.
 */

import { beatOf, timeOf } from '../beats.js';
import { arrKind } from '../instrument.js';
import { _stringCountFor } from '../lanes.js';

export const COMPOSITE_BEAT_EPS = 1e-4;

function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
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
    if (Number.isFinite(Number(note && note.beatEnd))) return Math.max(startBeat, Number(note.beatEnd));
    const startTime = finite(note && note.time);
    const sustain = Math.max(0, finite(note && note.sustain));
    return Math.max(startBeat, beatOf(beats, startTime + sustain));
}

function flattenArrangement(arrangement, source, beats) {
    const raw = [];
    for (const note of arrangement.notes || []) raw.push(note);
    for (const chord of arrangement.chords || []) {
        for (const chordNote of chord.notes || []) {
            raw.push({
                ...chordNote,
                time: chordNote.time ?? chord.time,
                sustain: chordNote.sustain || 0,
                techniques: clone(chordNote.techniques || {}),
                _fn: clone(chord.fn || null),
            });
        }
    }
    return raw.map((note, index) => {
        const startBeat = noteBeat(note, beats);
        const endBeat = noteEndBeat(note, beats, startBeat);
        return {
            id: `${source}:${index}`,
            source,
            sourceIndex: index,
            startBeat,
            endBeat,
            effectiveEndBeat: Math.max(endBeat, startBeat + COMPOSITE_BEAT_EPS),
            string: Math.trunc(finite(note.string, -1)),
            fret: Math.trunc(finite(note.fret, -1)),
            techniqueSignature: techniqueSignature(note),
            note: clone(note),
        };
    }).filter(e => Number.isFinite(e.startBeat) && e.string >= 0 && e.fret >= 0)
        .sort(compareEntries);
}

function compareEntries(a, b) {
    return a.startBeat - b.startBeat || a.string - b.string || a.fret - b.fret
        || a.endBeat - b.endBeat || a.id.localeCompare(b.id);
}

function near(a, b) {
    return Math.abs(a - b) <= COMPOSITE_BEAT_EPS;
}

function overlap(a, b) {
    if (near(a.startBeat, b.startBeat)) return true;
    return a.startBeat < b.effectiveEndBeat - COMPOSITE_BEAT_EPS
        && b.startBeat < a.effectiveEndBeat - COMPOSITE_BEAT_EPS;
}

function exactDuplicate(a, b) {
    return a.string === b.string && a.fret === b.fret
        && near(a.startBeat, b.startBeat) && near(a.endBeat, b.endBeat)
        && a.techniqueSignature === b.techniqueSignature;
}

function collisionReason(a, b) {
    if (a.string !== b.string || !overlap(a, b)) return '';
    if (near(a.startBeat, b.startBeat) && a.fret === b.fret) return 'note-variant';
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

function duplicateLookup(primaryEntries) {
    const map = new Map();
    for (const entry of primaryEntries) {
        const bucket = Math.round(entry.startBeat / COMPOSITE_BEAT_EPS);
        const key = `${entry.string}:${entry.fret}:${bucket}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(entry);
    }
    return map;
}

function duplicateOf(entry, lookup) {
    const bucket = Math.round(entry.startBeat / COMPOSITE_BEAT_EPS);
    for (let delta = -1; delta <= 1; delta++) {
        const candidates = lookup.get(`${entry.string}:${entry.fret}:${bucket + delta}`) || [];
        const found = candidates.find(primary => exactDuplicate(primary, entry));
        if (found) return found;
    }
    return null;
}

function mergeIntervals(entries) {
    const spans = entries.map(e => ({ start: e.startBeat, end: e.effectiveEndBeat }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const span of spans) {
        const tail = merged[merged.length - 1];
        if (tail && span.start <= tail.end + COMPOSITE_BEAT_EPS) tail.end = Math.max(tail.end, span.end);
        else merged.push({ ...span });
    }
    return merged;
}

function overlapsIntervals(entry, intervals) {
    let lo = 0;
    let hi = intervals.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (intervals[mid].end < entry.startBeat - COMPOSITE_BEAT_EPS) lo = mid + 1;
        else hi = mid;
    }
    const span = intervals[lo];
    if (!span) return false;

    // Zero-sustain notes still occupy their onset. Treat coincident attacks as
    // activity so gap-fill does not layer a second part on the same beat.
    if (Math.abs(span.start - entry.startBeat) <= COMPOSITE_BEAT_EPS) return true;
    return span.start < entry.effectiveEndBeat - COMPOSITE_BEAT_EPS
        && entry.startBeat < span.end - COMPOSITE_BEAT_EPS;
}

function collisionPairs(primaryEntries, secondaryEntries) {
    const byString = new Map();
    for (const entry of primaryEntries) {
        if (!byString.has(entry.string)) byString.set(entry.string, []);
        byString.get(entry.string).push(entry);
    }
    const pairs = [];
    for (const secondary of secondaryEntries) {
        const candidates = byString.get(secondary.string) || [];
        for (const primary of candidates) {
            if (primary.startBeat > secondary.effectiveEndBeat + COMPOSITE_BEAT_EPS) break;
            if (primary.effectiveEndBeat < secondary.startBeat - COMPOSITE_BEAT_EPS) continue;
            const reason = collisionReason(primary, secondary);
            if (reason) pairs.push({ primary, secondary, reason });
        }
    }
    return pairs.sort((a, b) => Math.min(a.primary.startBeat, a.secondary.startBeat)
        - Math.min(b.primary.startBeat, b.secondary.startBeat));
}

function groupConflictPairs(pairs) {
    const groups = [];
    for (const pair of pairs) {
        const startBeat = Math.min(pair.primary.startBeat, pair.secondary.startBeat);
        const endBeat = Math.max(pair.primary.effectiveEndBeat, pair.secondary.effectiveEndBeat);
        let group = groups[groups.length - 1];
        if (!group || startBeat > group.endBeat + COMPOSITE_BEAT_EPS) {
            group = {
                id: `conflict:${groups.length + 1}`,
                startBeat,
                endBeat,
                primaryEntries: [],
                secondaryEntries: [],
                reasons: [],
                resolution: null,
                selectedEntryIds: [],
                validationError: '',
            };
            groups.push(group);
        } else {
            group.endBeat = Math.max(group.endBeat, endBeat);
        }
        if (!group.primaryEntries.some(e => e.id === pair.primary.id)) group.primaryEntries.push(pair.primary);
        if (!group.secondaryEntries.some(e => e.id === pair.secondary.id)) group.secondaryEntries.push(pair.secondary);
        if (!group.reasons.includes(pair.reason)) group.reasons.push(pair.reason);
    }
    for (const group of groups) {
        group.primaryEntries.sort(compareEntries);
        group.secondaryEntries.sort(compareEntries);
    }
    return groups;
}

export function analyzeCompositeMerge({ primary, secondary, beats = [], strategy = 'gap-fill' } = {}) {
    const compatibility = compositeCompatibility(primary || {}, secondary || {});
    if (!compatibility.ok) {
        return { ok: false, compatibility, strategy, fixedEntries: [], conflicts: [], stats: {} };
    }
    if (!['gap-fill', 'full-union'].includes(strategy)) {
        return {
            ok: false,
            compatibility: { ...compatibility, ok: false, errors: ['Unknown merge strategy.'] },
            strategy,
            fixedEntries: [], conflicts: [], stats: {},
        };
    }

    const primaryEntries = flattenArrangement(primary, 'primary', beats);
    const allSecondary = flattenArrangement(secondary, 'secondary', beats);
    const lookup = duplicateLookup(primaryEntries);
    const duplicates = [];
    const secondaryEntries = [];
    for (const entry of allSecondary) {
        const duplicate = duplicateOf(entry, lookup);
        if (duplicate) duplicates.push({ secondary: entry, primary: duplicate });
        else secondaryEntries.push(entry);
    }

    const skippedEntries = [];
    let candidates = secondaryEntries;
    if (strategy === 'gap-fill') {
        const activity = mergeIntervals(primaryEntries);
        candidates = [];
        for (const entry of secondaryEntries) {
            if (overlapsIntervals(entry, activity)) skippedEntries.push(entry);
            else candidates.push(entry);
        }
    }

    const pairs = collisionPairs(primaryEntries, candidates);
    const conflicts = groupConflictPairs(pairs);
    const conflictingPrimary = new Set(pairs.map(p => p.primary.id));
    const conflictingSecondary = new Set(pairs.map(p => p.secondary.id));
    const fixedEntries = primaryEntries.filter(e => !conflictingPrimary.has(e.id));
    for (const entry of candidates) if (!conflictingSecondary.has(entry.id)) fixedEntries.push(entry);
    fixedEntries.sort(compareEntries);

    return {
        ok: true,
        strategy,
        compatibility,
        primary,
        secondary,
        beats,
        fixedEntries,
        conflicts,
        duplicates,
        skippedEntries,
        stats: {
            primaryNotes: primaryEntries.length,
            secondaryNotes: allSecondary.length,
            duplicatesRemoved: duplicates.length,
            secondaryAddedCleanly: fixedEntries.filter(e => e.source === 'secondary').length,
            secondarySkippedByStrategy: skippedEntries.length,
            conflictHunks: conflicts.length,
            unresolvedConflicts: conflicts.length,
        },
    };
}

function selectionFor(group, resolution, selectedEntryIds) {
    if (resolution === 'primary') return group.primaryEntries;
    if (resolution === 'secondary') return group.secondaryEntries;
    if (resolution === 'compatible') {
        const chosen = group.primaryEntries.slice();
        for (const entry of group.secondaryEntries) {
            if (!chosen.some(other => other.source !== entry.source && collisionReason(other, entry))) chosen.push(entry);
        }
        return chosen;
    }
    if (resolution === 'custom') {
        const ids = new Set(selectedEntryIds || []);
        return [...group.primaryEntries, ...group.secondaryEntries].filter(e => ids.has(e.id));
    }
    return [];
}

export function validateCompositeSelection(entries) {
    const selected = entries || [];
    for (let i = 0; i < selected.length; i++) {
        for (let j = i + 1; j < selected.length; j++) {
            const a = selected[i];
            const b = selected[j];
            if (a.source !== b.source && collisionReason(a, b)) {
                return { ok: false, error: `String ${a.string + 1} has overlapping source notes.` };
            }
        }
    }
    return { ok: true, error: '' };
}

export function resolveCompositeConflict(plan, conflictId, resolution, selectedEntryIds = []) {
    const group = plan && plan.conflicts && plan.conflicts.find(c => c.id === conflictId);
    if (!group) return { ok: false, error: 'Conflict not found.' };
    if (!['primary', 'secondary', 'compatible', 'custom'].includes(resolution)) {
        return { ok: false, error: 'Unknown conflict resolution.' };
    }
    const selected = selectionFor(group, resolution, selectedEntryIds);
    const validation = validateCompositeSelection(selected);
    group.validationError = validation.error;
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

export function materializeCompositeArrangement(plan, name) {
    if (!plan || !plan.ok) throw new Error('A valid merge plan is required.');
    const unresolved = plan.conflicts.filter(c => !c.resolution);
    if (unresolved.length) throw new Error(`${unresolved.length} merge conflict(s) remain unresolved.`);
    const primary = plan.primary || {};
    const resultName = String(name || '').trim();
    if (!resultName) throw new Error('The composite arrangement needs a name.');
    const arrangement = {
        name: resultName,
        type: plan.compatibility.kind === 'bass' ? 'bass' : 'guitar',
        tuning: clone(primary.tuning || new Array(plan.compatibility.stringCount).fill(0)),
        capo: finite(primary.capo),
        notes: compositeResolvedEntries(plan).map(entry => materializeNote(entry, plan.beats)),
        chords: [],
        chord_templates: [],
        anchors: [],
        anchors_user: [],
        handshapes: [],
        phrases: [],
    };
    if (primary.centOffset !== undefined) arrangement.centOffset = finite(primary.centOffset);
    if (primary._extendedStrings !== undefined) arrangement._extendedStrings = primary._extendedStrings;
    if (primary.tones && typeof primary.tones === 'object') arrangement.tones = clone(primary.tones);
    arrangement.notes.sort((a, b) => finite(a.beat, a.time) - finite(b.beat, b.time)
        || a.string - b.string || a.fret - b.fret);
    return arrangement;
}
