/* Complete temporal occupancy shared by Hybrid planning strategies.
 *
 * Physical same-string validation lives in merge-engine.js.  These helpers
 * answer the stricter arrangement-level question used while deciding whether
 * material may be included automatically: is either source still sounding,
 * on any string?
 */

import { COMPOSITE_BEAT_EPS } from './merge-engine.js';

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function compositeEntryOccupancyStart(entry) {
    const startBeat = finite(entry && entry.startBeat);
    return Math.min(startBeat, finite(entry && entry.playableStartBeat, startBeat));
}

export function compositeEntryOccupancyEnd(entry) {
    const startBeat = compositeEntryOccupancyStart(entry);
    return Math.max(
        startBeat + COMPOSITE_BEAT_EPS,
        finite(entry && entry.endBeat, startBeat),
        finite(entry && entry.effectiveEndBeat, startBeat),
        finite(entry && entry.playableEndBeat, startBeat),
    );
}
