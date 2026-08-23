/* Immutable indexes shared by the Hybrid guided-review presentation.
 *
 * Analysis replaces source/beat arrays when their contents change. Review
 * navigation only changes the focused conflict, so those arrays can retain one
 * sorted/range-indexed projection for the lifetime of the plan. Resolution
 * snapshots are likewise immutable and replaced as one array per revision.
 */

const IMMUTABLE_ENTRY_INDEXES = new WeakMap();
const PREPARED_ENTRY_INDEXES = new WeakMap();
const BEAT_BOUNDARY_INDEXES = new WeakMap();
const ENTRY_ID_INDEXES = new WeakMap();

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function entryEndBeat(entry) {
    const start = finite(entry?.startBeat);
    return Math.max(start, finite(entry?.endBeat, start),
        finite(entry?.effectiveEndBeat, start));
}

function compareEntries(left, right) {
    return finite(left?.startBeat) - finite(right?.startBeat)
        || finite(left?.string) - finite(right?.string)
        || finite(left?.fret) - finite(right?.fret)
        || String(left?.id || '').localeCompare(String(right?.id || ''));
}

function uniqueSortedEntries(entries) {
    const unique = new Map();
    for (const entry of entries || []) if (entry?.id) unique.set(entry.id, entry);
    return [...unique.values()].sort(compareEntries);
}

function buildEntryIndex(entries, prepared) {
    const values = prepared && Array.isArray(entries)
        ? entries : uniqueSortedEntries(entries);
    const starts = new Float64Array(values.length);
    const prefixMaxEnd = new Float64Array(values.length);
    let maximumEnd = -Infinity;
    let sorted = true;
    for (let index = 0; index < values.length; index++) {
        const start = finite(values[index]?.startBeat);
        starts[index] = start;
        if (index && start < starts[index - 1]) sorted = false;
        maximumEnd = Math.max(maximumEnd, entryEndBeat(values[index]));
        prefixMaxEnd[index] = maximumEnd;
    }
    return { entries: values, starts, prefixMaxEnd, sorted };
}

function cachedEntryIndex(entries, cache, prepared) {
    if (!Array.isArray(entries)) return buildEntryIndex(entries, prepared);
    const cached = cache.get(entries);
    if (cached) return cached;
    const index = buildEntryIndex(entries, prepared);
    cache.set(entries, index);
    return index;
}

// Source arrays are immutable analysis output, but still require one
// last-id-wins deduplication and canonical sort.
export function compositeImmutableEntryIndex(entries) {
    return cachedEntryIndex(entries, IMMUTABLE_ENTRY_INDEXES, false);
}

// Resolved snapshots are already unique and sorted by the merge engine. Keep
// their exact array identity so downstream timeline range indexes are reused.
export function compositePreparedEntryIndex(entries) {
    return cachedEntryIndex(entries, PREPARED_ENTRY_INDEXES, true);
}

export function compositeIndexedEntriesInRange(index, context, tolerance = 1e-4) {
    const entries = index?.entries || [];
    const start = finite(context?.startBeat) - tolerance;
    const end = finite(context?.endBeat, start) + tolerance;
    if (!index?.sorted) {
        return entries.filter(entry => finite(entry?.startBeat) <= end
            && entryEndBeat(entry) >= start);
    }

    let lower = 0;
    let upper = entries.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (index.prefixMaxEnd[middle] < start) lower = middle + 1;
        else upper = middle;
    }
    const first = lower;

    lower = 0;
    upper = entries.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (index.starts[middle] <= end) lower = middle + 1;
        else upper = middle;
    }
    const pastLast = lower;
    const visible = [];
    for (let entryIndex = first; entryIndex < pastLast; entryIndex++) {
        const entry = entries[entryIndex];
        if (entryEndBeat(entry) >= start) visible.push(entry);
    }
    return visible;
}

export function compositeBeatBoundaryIndex(beats) {
    if (!Array.isArray(beats)) return { beats: [], boundaries: [] };
    const cached = BEAT_BOUNDARY_INDEXES.get(beats);
    if (cached) return cached;
    const boundaries = [];
    for (let index = 0; index < beats.length; index++) {
        const measure = Number(beats[index]?.measure);
        if (Number.isFinite(measure) && measure >= 1) {
            boundaries.push({ beat: index, measure });
        }
    }
    const value = { beats, boundaries };
    BEAT_BOUNDARY_INDEXES.set(beats, value);
    return value;
}

function firstBoundaryAfter(boundaries, beat) {
    let lower = 0;
    let upper = boundaries.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (boundaries[middle].beat <= beat) lower = middle + 1;
        else upper = middle;
    }
    return lower;
}

function firstBoundaryAtOrAfter(boundaries, beat) {
    let lower = 0;
    let upper = boundaries.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (boundaries[middle].beat < beat) lower = middle + 1;
        else upper = middle;
    }
    return lower;
}

export function compositeConflictContextFromIndex(boundaryIndex, conflict, {
    fallbackPadding = 4,
    epsilon = 1e-4,
} = {}) {
    const start = finite(conflict?.startBeat);
    const end = Math.max(start + epsilon,
        finite(conflict?.endBeat, start + epsilon));
    const boundaries = boundaryIndex?.boundaries || [];
    if (boundaries.length < 2) {
        return {
            startBeat: Math.max(0, start - fallbackPadding),
            endBeat: Math.max(end + fallbackPadding, start + 1),
            measureMarkers: [],
        };
    }

    const containingIndex = firstBoundaryAfter(boundaries, start + epsilon) - 1;
    const contextStartIndex = Math.max(0, containingIndex - 1);
    const contextStart = containingIndex >= 0
        ? boundaries[contextStartIndex].beat : Math.max(0, start - fallbackPadding);
    const firstAfterEnd = firstBoundaryAfter(boundaries, end + epsilon);
    const contextEndBoundary = boundaries[Math.min(
        boundaries.length - 1, firstAfterEnd + 1)];
    const lastBarLength = boundaries.length >= 2
        ? boundaries.at(-1).beat - boundaries.at(-2).beat : fallbackPadding;
    const contextEnd = contextEndBoundary
        ? contextEndBoundary.beat
        : Math.max(end + fallbackPadding,
            boundaries.at(-1).beat + Math.max(1, lastBarLength));
    const finalEnd = Math.max(contextEnd, contextStart + 1);
    const markerStart = firstBoundaryAtOrAfter(boundaries, contextStart - epsilon);
    const markerEnd = firstBoundaryAfter(boundaries, finalEnd + epsilon);
    return {
        startBeat: contextStart,
        endBeat: finalEnd,
        measureMarkers: boundaries.slice(markerStart, markerEnd),
    };
}

export function compositeEntryMapById(entries) {
    if (!Array.isArray(entries)) return new Map();
    const cached = ENTRY_ID_INDEXES.get(entries);
    if (cached) return cached;
    const byId = new Map();
    for (const entry of entries) if (entry?.id) byId.set(entry.id, entry);
    ENTRY_ID_INDEXES.set(entries, byId);
    return byId;
}

// The ordinary navigation path returns the immutable base array exactly. A
// custom draft can introduce an entry absent from the committed result; only
// that exceptional path materializes and sorts a replacement snapshot.
export function compositeReviewResultEntries(baseEntries, localEntries) {
    const base = Array.isArray(baseEntries) ? baseEntries : [];
    const byId = compositeEntryMapById(base);
    let structuralChange = false;
    for (const entry of localEntries || []) {
        const previous = byId.get(entry?.id);
        if (!previous || compareEntries(previous, entry) !== 0) {
            structuralChange = true;
            break;
        }
    }
    if (!structuralChange) return base;
    const merged = new Map(byId);
    for (const entry of localEntries || []) if (entry?.id) merged.set(entry.id, entry);
    return [...merged.values()].sort(compareEntries);
}

function sameSignature(left, right) {
    if (!left || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
        if (!Object.is(left[index], right[index])) return false;
    }
    return true;
}

export function createCompositeBaseTimelineCache() {
    const plans = new WeakMap();
    return {
        get(plan, signature, create) {
            if (!plan || typeof plan !== 'object') return create();
            const cached = plans.get(plan);
            if (cached && sameSignature(cached.signature, signature)) return cached.value;
            const value = create();
            plans.set(plan, { signature: [...signature], value });
            return value;
        },
        invalidate(plan) {
            if (plan && typeof plan === 'object') plans.delete(plan);
        },
    };
}
