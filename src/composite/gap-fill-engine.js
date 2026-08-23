/* Automatic Hybrid Track planner.
 *
 * Keeps every base-track entry and adds complete fill-track playable gestures
 * only inside sufficiently large base-track gaps. Shared preparation and final
 * playability validation live in merge-engine.js because Guided review uses
 * those rules too.
 */

import { timeOf } from '../beats.js';
import {
    COMPOSITE_BEAT_EPS,
    compositePlayableGroups,
    prepareCompositeSources,
} from './merge-engine.js';

export const COMPOSITE_GAP_FILL_DEFAULTS = Object.freeze({
    unit: 'beats', minimumGap: 1, transitionMargin: 0.25,
});

const UNIT_DEFAULTS = Object.freeze({
    beats: Object.freeze({ minimumGap: 1, transitionMargin: 0.25 }),
    seconds: Object.freeze({ minimumGap: 0.5, transitionMargin: 0.125 }),
});

const UNIT_LIMITS = Object.freeze({
    beats: Object.freeze({ minimumGap: 16, transitionMargin: 8 }),
    seconds: Object.freeze({ minimumGap: 30, transitionMargin: 10 }),
});

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function compareEntries(left, right) {
    return left.startBeat - right.startBeat || left.string - right.string
        || left.fret - right.fret || left.id.localeCompare(right.id);
}

export function compositeGapFillDefaultsForUnit(unit) {
    const normalizedUnit = unit === 'seconds' ? 'seconds' : 'beats';
    return { unit: normalizedUnit, ...UNIT_DEFAULTS[normalizedUnit] };
}

export function normalizeCompositeGapFillOptions(options = {}) {
    const unit = options.unit === 'seconds' ? 'seconds' : 'beats';
    const defaults = UNIT_DEFAULTS[unit];
    const limits = UNIT_LIMITS[unit];
    const legacyMinimum = unit === 'beats' ? options.minimumGapBeats : options.minimumGapSeconds;
    const legacyMargin = unit === 'beats' ? options.transitionMarginBeats : options.transitionMarginSeconds;
    const minimumGap = Math.max(0, Math.min(limits.minimumGap,
        finite(options.minimumGap, finite(legacyMinimum, defaults.minimumGap))));
    const transitionMargin = Math.max(0, Math.min(limits.transitionMargin,
        finite(options.transitionMargin, finite(legacyMargin, defaults.transitionMargin))));
    return { unit, minimumGap, transitionMargin };
}

function mergeIntervals(entries, padding, coordinate) {
    const pad = Math.max(0, finite(padding));
    const spans = entries.map(entry => ({
        start: coordinate(entry.startBeat) - pad,
        end: coordinate(entry.effectiveEndBeat) + pad,
    })).sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];
    for (const span of spans) {
        const tail = merged.at(-1);
        if (tail && span.start <= tail.end + COMPOSITE_BEAT_EPS) {
            tail.end = Math.max(tail.end, span.end);
        } else {
            merged.push({ ...span });
        }
    }
    return merged;
}

function eligibleWindows(primaryEntries, secondaryEntries, beats, options) {
    const { unit, minimumGap, transitionMargin } = options;
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
        if (start - cursor + COMPOSITE_BEAT_EPS >= minimumGap) windows.push({ start: cursor, end: start });
        cursor = Math.max(cursor, end);
    }
    if (contentEnd - cursor + COMPOSITE_BEAT_EPS >= minimumGap) {
        windows.push({ start: cursor, end: contentEnd });
    }
    return { windows, coordinate };
}

export function compositeGroupFitsWindowPure(group, windows, coordinate = value => value) {
    const start = coordinate(group.startBeat);
    const end = coordinate(group.endBeat);
    // Windows are emitted in ascending, non-overlapping order. Find the first
    // one whose end reaches the group start instead of rescanning every earlier
    // gap for every secondary gesture (quadratic on alternating arrangements).
    let low = 0;
    let high = windows.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (windows[middle].end < start - COMPOSITE_BEAT_EPS) low = middle + 1;
        else high = middle;
    }
    const window = windows[low];
    return !!window && start >= window.start - COMPOSITE_BEAT_EPS
        && end <= window.end + COMPOSITE_BEAT_EPS;
}

export function analyzeGapFillComposite({ primary, secondary, beats = [], gapFill = {} } = {}) {
    const prepared = prepareCompositeSources({ primary, secondary, beats });
    const compatibility = prepared.compatibility;
    if (!prepared.ok) {
        return { ok: false, compatibility, strategy: 'gap-fill', fixedEntries: [], conflicts: [], stats: {} };
    }
    const primaryEntries = prepared.primaryEntries;
    const secondaryEntries = prepared.uniqueSecondaryEntries;
    const options = normalizeCompositeGapFillOptions(gapFill);
    const { windows, coordinate } = eligibleWindows(primaryEntries, secondaryEntries, beats, options);
    const accepted = [];
    const skippedEntries = [];
    // A chord or connected gesture fits as a whole or is skipped as a whole.
    for (const group of compositePlayableGroups(secondaryEntries)) {
        const target = compositeGroupFitsWindowPure(group, windows, coordinate)
            ? accepted : skippedEntries;
        target.push(...group.entries);
    }
    const fixedEntries = [...primaryEntries, ...accepted].sort(compareEntries);
    return {
        ok: true,
        strategy: 'gap-fill',
        gapFill: options,
        compatibility,
        primary,
        secondary,
        beats,
        sourceEntries: { primary: primaryEntries, secondary: prepared.secondaryEntries },
        fixedEntries,
        conflicts: [],
        duplicates: prepared.duplicates,
        timingAdjustments: prepared.timingAdjustments,
        skippedEntries,
        stats: {
            primaryNotes: primaryEntries.length,
            secondaryNotes: prepared.secondaryEntries.length,
            duplicatesRemoved: prepared.duplicates.length,
            timingAdjustments: prepared.timingAdjustments.length,
            secondaryAddedCleanly: accepted.length,
            secondarySkippedByStrategy: skippedEntries.length,
            conflictHunks: 0,
            unresolvedConflicts: 0,
        },
    };
}
