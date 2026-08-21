/* Composite resolver preview helpers.
 *
 * Convert the merge engine's beat-based entries into the Editor audio
 * scheduler's pitched-event shape.  This stays pure so capo, tuning, trails,
 * and tempo-map conversion can be verified without WebAudio or a DOM.
 */

import { timeOf } from '../beats.js';
import { _openMidiForArr, _soundingPitchPure } from '../lanes.js';

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function entryEndBeat(entry) {
    const start = finite(entry && entry.startBeat);
    return Math.max(start, finite(entry && entry.endBeat, start),
        finite(entry && entry.effectiveEndBeat, start));
}

export function compositePreviewEventsPure(entries, arrangement, beats, stringCount = 6) {
    const count = Math.max(1, Math.trunc(finite(stringCount, 6)));
    const openMidi = _openMidiForArr(arrangement || {}, count);
    const tuning = Array.isArray(arrangement && arrangement.tuning) ? arrangement.tuning : [];
    const capo = finite(arrangement && arrangement.capo);
    const events = [];
    for (const entry of entries || []) {
        const startBeat = finite(entry && entry.startBeat, Number.NaN);
        const string = Math.trunc(finite(entry && entry.string, Number.NaN));
        const fret = finite(entry && entry.fret, Number.NaN);
        if (!Number.isFinite(startBeat) || !Number.isFinite(string) || !Number.isFinite(fret)) continue;
        const midi = _soundingPitchPure(openMidi, tuning, capo, string, fret);
        if (!Number.isFinite(midi) || midi < 0 || midi > 127) continue;
        const startTime = timeOf(beats, startBeat);
        const endTime = timeOf(beats, entryEndBeat(entry));
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
        events.push({
            t: startTime,
            midi,
            sus: Math.max(0, endTime - startTime),
        });
    }
    return events.sort((a, b) => a.t - b.t || a.midi - b.midi || a.sus - b.sus);
}

export function compositePreviewRegionPure(context, beats) {
    const startBeat = finite(context && context.startBeat);
    const startTime = Math.max(0, timeOf(beats, startBeat));
    const rawEnd = timeOf(beats, finite(context && context.endBeat, startBeat + 1));
    const endTime = Math.max(startTime + 0.05, rawEnd);
    return { startTime, endTime, mode: 'bar' };
}
