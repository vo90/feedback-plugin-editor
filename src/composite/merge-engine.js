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
export const COMPOSITE_TIMING_TOLERANCE_MIN_SECONDS = 0.001;
export const COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS = 0.005;
export const COMPOSITE_TIMING_TOLERANCE_BEAT_FRACTION = 0.01;
export const COMPOSITE_GAP_FILL_DEFAULTS = Object.freeze({
    unit: 'beats',
    minimumGap: 1,
    transitionMargin: 0.25,
});

const COMPOSITE_GAP_FILL_UNIT_DEFAULTS = Object.freeze({
    beats: Object.freeze({ minimumGap: 1, transitionMargin: 0.25 }),
    // The first-time seconds values match the beat defaults at 120 BPM.
    seconds: Object.freeze({ minimumGap: 0.5, transitionMargin: 0.125 }),
});

const COMPOSITE_GAP_FILL_UNIT_LIMITS = Object.freeze({
    beats: Object.freeze({ minimumGap: 16, transitionMargin: 8 }),
    seconds: Object.freeze({ minimumGap: 30, transitionMargin: 10 }),
});

export function compositeGapFillDefaultsForUnit(unit) {
    const normalizedUnit = unit === 'seconds' ? 'seconds' : 'beats';
    return { unit: normalizedUnit, ...COMPOSITE_GAP_FILL_UNIT_DEFAULTS[normalizedUnit] };
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

function entryHasSource(entry, source) {
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
    for (const note of arrangement.notes || []) raw.push(note);
    for (const chord of arrangement.chords || []) {
        for (const chordNote of chord.notes || []) {
            raw.push({
                ...chordNote,
                time: chordNote.time ?? chord.time,
                // Some importers author one duration on the chord, others put
                // it on every child. Preserve either representation so the
                // whole visible trail participates in merge occupancy.
                sustain: chordNote.sustain ?? chordNote.sus
                    ?? chord.sustain ?? chord.sus ?? 0,
                techniques: clone(chordNote.techniques || {}),
                _fn: clone(chord.fn || null),
            });
        }
    }
    const entries = raw.map((note, index) => {
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
            entry.endBeat = next.startBeat;
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
    const start = Math.max(timeOf(beats, a.startBeat), timeOf(beats, b.startBeat));
    const end = Math.min(timeOf(beats, a.effectiveEndBeat), timeOf(beats, b.effectiveEndBeat));
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
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
    return a.string === b.string && a.fret === b.fret
        && timingNear(a.startBeat, b.startBeat, beats) && timingNear(a.endBeat, b.endBeat, beats)
        && a.techniqueSignature === b.techniqueSignature;
}

function collisionReason(a, b, beats) {
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

function duplicateLookup(primaryEntries) {
    const map = new Map();
    for (const entry of primaryEntries) {
        const key = `${entry.string}:${entry.fret}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(entry);
    }
    return map;
}

function duplicateOf(entry, lookup, beats) {
    const candidates = lookup.get(`${entry.string}:${entry.fret}`) || [];
    return candidates.find(primary => exactDuplicate(primary, entry, beats)) || null;
}

function mergeIntervals(entries, padding = 0, coordinate = beat => beat) {
    const pad = Math.max(0, finite(padding));
    const spans = entries.map(e => ({
        start: coordinate(e.startBeat) - pad,
        end: coordinate(e.effectiveEndBeat) + pad,
    }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const span of spans) {
        const tail = merged[merged.length - 1];
        if (tail && span.start <= tail.end + COMPOSITE_BEAT_EPS) tail.end = Math.max(tail.end, span.end);
        else merged.push({ ...span });
    }
    return merged;
}

export function normalizeCompositeGapFillOptions(options = {}) {
    const unit = options.unit === 'seconds' ? 'seconds' : 'beats';
    const defaults = COMPOSITE_GAP_FILL_UNIT_DEFAULTS[unit];
    const limits = COMPOSITE_GAP_FILL_UNIT_LIMITS[unit];
    // Accept the first PoC's beat-specific field names so an open dialog or
    // downstream caller from that build degrades to the new shared-unit model.
    const legacyMinimum = unit === 'beats' ? options.minimumGapBeats : options.minimumGapSeconds;
    const legacyMargin = unit === 'beats' ? options.transitionMarginBeats : options.transitionMarginSeconds;
    const minimumGap = Math.max(0, Math.min(limits.minimumGap,
        finite(options.minimumGap, finite(legacyMinimum, defaults.minimumGap))));
    const transitionMargin = Math.max(0, Math.min(limits.transitionMargin,
        finite(options.transitionMargin, finite(legacyMargin, defaults.transitionMargin))));
    return { unit, minimumGap, transitionMargin };
}

function groupPlayableEntries(entries) {
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

function eligibleGapFillWindows(primaryEntries, secondaryEntries, beats, options) {
    const { unit, minimumGap, transitionMargin } = options;
    // Beat mode follows the musical grid. Seconds mode projects every boundary
    // through the real tempo map first, so its safety time remains constant
    // through tempo changes and ramps.
    const coordinate = unit === 'seconds' ? beat => timeOf(beats, beat) : beat => beat;
    const allEntries = [...primaryEntries, ...secondaryEntries];
    const contentStartBeat = Math.min(0, ...allEntries.map(entry => entry.startBeat));
    const contentEndBeat = Math.max(
        Array.isArray(beats) && beats.length ? beats.length - 1 : 0,
        ...allEntries.map(entry => entry.effectiveEndBeat),
    );
    const contentStart = coordinate(contentStartBeat);
    const contentEnd = coordinate(contentEndBeat);
    const occupied = mergeIntervals(primaryEntries, transitionMargin, coordinate);
    const windows = [];
    let cursor = contentStart;
    for (const span of occupied) {
        if (span.end < contentStart + COMPOSITE_BEAT_EPS) continue;
        if (span.start > contentEnd - COMPOSITE_BEAT_EPS) break;
        const start = Math.max(contentStart, span.start);
        const end = Math.min(contentEnd, span.end);
        if (start - cursor + COMPOSITE_BEAT_EPS >= minimumGap) {
            windows.push({ start: cursor, end: start });
        }
        cursor = Math.max(cursor, end);
    }
    if (contentEnd - cursor + COMPOSITE_BEAT_EPS >= minimumGap) {
        windows.push({ start: cursor, end: contentEnd });
    }
    return { windows, coordinate };
}

function groupFitsWindow(group, windows, coordinate) {
    const start = coordinate(group.startBeat);
    const end = coordinate(group.endBeat);
    return windows.some(window => start >= window.start - COMPOSITE_BEAT_EPS
        && end <= window.end + COMPOSITE_BEAT_EPS);
}

function collisionPairs(primaryEntries, secondaryEntries, beats) {
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
            const reason = collisionReason(primary, secondary, beats);
            if (reason) pairs.push({
                primary,
                secondary,
                reason,
                overlapSeconds: collisionOverlapSeconds(primary, secondary, beats),
            });
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
                overlapSeconds: 0,
            };
            groups.push(group);
        } else {
            group.endBeat = Math.max(group.endBeat, endBeat);
        }
        if (!group.primaryEntries.some(e => e.id === pair.primary.id)) group.primaryEntries.push(pair.primary);
        if (!group.secondaryEntries.some(e => e.id === pair.secondary.id)) group.secondaryEntries.push(pair.secondary);
        if (!group.reasons.includes(pair.reason)) group.reasons.push(pair.reason);
        group.overlapSeconds = Math.max(group.overlapSeconds, finite(pair.overlapSeconds));
    }
    for (const group of groups) {
        group.primaryEntries.sort(compareEntries);
        group.secondaryEntries.sort(compareEntries);
    }
    return groups;
}

export function analyzeCompositeMerge({
    primary, secondary, beats = [], strategy = 'gap-fill', gapFill = {},
} = {}) {
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
        const duplicate = duplicateOf(entry, lookup, beats);
        if (duplicate) {
            mergeEntryProvenance(duplicate, entry);
            duplicates.push({
                secondary: entry,
                primary: duplicate,
                startDeltaSeconds: Math.abs(timeOf(beats, duplicate.startBeat) - timeOf(beats, entry.startBeat)),
                endDeltaSeconds: Math.abs(timeOf(beats, duplicate.endBeat) - timeOf(beats, entry.endBeat)),
            });
        }
        else secondaryEntries.push(entry);
    }

    const skippedEntries = [];
    let candidates = secondaryEntries;
    const gapFillOptions = normalizeCompositeGapFillOptions(gapFill);
    if (strategy === 'gap-fill') {
        const { windows, coordinate } = eligibleGapFillWindows(
            primaryEntries, secondaryEntries, beats, gapFillOptions);
        candidates = [];
        // Coincident entries are one playable event (usually a chord). Never
        // keep only the short child of a chord while dropping a sibling whose
        // trail crosses into primary activity: the complete event fits or the
        // complete event is skipped.
        for (const group of groupPlayableEntries(secondaryEntries)) {
            if (groupFitsWindow(group, windows, coordinate)) candidates.push(...group.entries);
            else skippedEntries.push(...group.entries);
        }
    }

    const pairs = collisionPairs(primaryEntries, candidates, beats);
    const conflicts = groupConflictPairs(pairs);
    const conflictingPrimary = new Set(pairs.map(p => p.primary.id));
    const conflictingSecondary = new Set(pairs.map(p => p.secondary.id));
    const fixedEntries = primaryEntries.filter(e => !conflictingPrimary.has(e.id));
    for (const entry of candidates) if (!conflictingSecondary.has(entry.id)) fixedEntries.push(entry);
    fixedEntries.sort(compareEntries);

    return {
        ok: true,
        strategy,
        gapFill: gapFillOptions,
        compatibility,
        primary,
        secondary,
        beats,
        // Preserve both flattened sources for synchronized resolver context.
        // These entries are immutable plan data; the visual layer must not
        // reconstruct a source track from only accepted merge material.
        sourceEntries: {
            primary: primaryEntries,
            secondary: allSecondary,
        },
        fixedEntries,
        conflicts,
        duplicates,
        timingAdjustments: [...primaryEntries, ...allSecondary]
            .filter(entry => entry.timingAdjustment).map(entry => entry.timingAdjustment),
        skippedEntries,
        stats: {
            primaryNotes: primaryEntries.length,
            secondaryNotes: allSecondary.length,
            duplicatesRemoved: duplicates.length,
            timingAdjustments: [...primaryEntries, ...allSecondary]
                .filter(entry => entry.timingAdjustment).length,
            secondaryAddedCleanly: fixedEntries.filter(e => e.source === 'secondary').length,
            secondarySkippedByStrategy: skippedEntries.length,
            conflictHunks: conflicts.length,
            unresolvedConflicts: conflicts.length,
        },
    };
}

function conflictEntries(group) {
    const unique = new Map();
    for (const entry of [...(group.primaryEntries || []), ...(group.secondaryEntries || [])]) {
        unique.set(entry.id, entry);
    }
    return [...unique.values()];
}

function selectionFor(plan, group, resolution, selectedEntryIds) {
    const available = conflictEntries(group);
    if (resolution === 'primary') return available.filter(entry => entryHasSource(entry, 'primary'));
    if (resolution === 'secondary') return available.filter(entry => entryHasSource(entry, 'secondary'));
    if (resolution === 'compatible') {
        const chosen = available.filter(entry => entryHasSource(entry, 'primary'));
        for (const entry of available.filter(candidate => entryHasSource(candidate, 'secondary'))) {
            if (chosen.some(other => other.id === entry.id)) continue;
            if (!chosen.some(other => !entriesShareSource(other, entry)
                && collisionReason(other, entry, plan.beats))) chosen.push(entry);
        }
        return chosen;
    }
    if (resolution === 'custom') {
        const ids = new Set(selectedEntryIds || []);
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
            if (!entriesShareSource(a, b) && collisionReason(a, b, beats)) {
                const displayString = Math.max(1, Math.trunc(finite(stringCount, 6)) - a.string);
                const overlapMilliseconds = Math.max(1,
                    Math.round(collisionOverlapSeconds(a, b, beats) * 1000));
                return {
                    ok: false,
                    error: `String ${displayString} has source notes overlapping by ${overlapMilliseconds} ms.`,
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
    if (!group) return { ok: false, error: 'Conflict not found.' };
    if (!['primary', 'secondary', 'compatible', 'custom'].includes(resolution)) {
        return { ok: false, error: 'Unknown conflict resolution.' };
    }
    const selected = selectionFor(plan, group, resolution, selectedEntryIds);
    const validation = validateCompositeSelection(
        entriesWithCandidateResolution(plan, group, selected),
        plan.beats,
        plan.compatibility && plan.compatibility.stringCount,
    );
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

export function clearCompositeConflictResolution(plan, conflictId) {
    const group = plan && plan.conflicts && plan.conflicts.find(c => c.id === conflictId);
    if (!group) return { ok: false, error: 'Conflict not found.' };
    group.resolution = null;
    group.selectedEntryIds = [];
    group.validationError = '';
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

export function materializeCompositeArrangement(plan, name) {
    if (!plan || !plan.ok) throw new Error('A valid merge plan is required.');
    const unresolved = plan.conflicts.filter(c => !c.resolution);
    if (unresolved.length) throw new Error(`${unresolved.length} merge conflict(s) remain unresolved.`);
    // Work on plan-entry clones so both imported tracks and the review plan
    // preserve their authored timing. The generated composite alone receives
    // any final cross-source sub-tolerance boundary clamps.
    const resolvedEntries = prepareCompositeEntries(compositeResolvedEntries(plan), plan.beats);
    const validation = validateCompositeSelection(
        resolvedEntries,
        plan.beats,
        plan.compatibility && plan.compatibility.stringCount,
    );
    if (!validation.ok) throw new Error(`The merged arrangement is not playable: ${validation.error}`);
    const primary = plan.primary || {};
    const resultName = String(name || '').trim();
    if (!resultName) throw new Error('The composite arrangement needs a name.');
    const arrangement = {
        name: resultName,
        type: plan.compatibility.kind === 'bass' ? 'bass' : 'guitar',
        tuning: clone(primary.tuning || new Array(plan.compatibility.stringCount).fill(0)),
        capo: finite(primary.capo),
        notes: resolvedEntries.map(entry => materializeNote(entry, plan.beats)),
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
