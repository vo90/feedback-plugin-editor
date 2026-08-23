/* Experimental automatic Hybrid Track planner.
 *
 * This module deliberately sits beside gap-fill-engine.js. The stable
 * Automatic planner remains the control implementation; this planner starts
 * from its hard timing decision and adds conservative musical context,
 * explainable passage review, sync evidence, and a comparison report.
 */

import { beatOf, timeOf } from '../beats.js';
import { _playabilityLintPure } from '../playability-lint.js';
import { analyzeGapFillComposite, normalizeCompositeGapFillOptions } from './gap-fill-engine.js';
import {
    COMPOSITE_BEAT_EPS,
    COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS,
    compositeEntryHasSource,
    compositeResolvedEntries,
    compositeTimingToleranceSeconds,
    prepareCompositeSources,
} from './merge-engine.js';
import {
    HYBRID_EXPERIMENTAL_PROFILE_BALANCED,
    HYBRID_EXPERIMENTAL_PROFILE_STRICT,
} from './preferences.js';
import {
    EXPERIMENTAL_PROFILE_RULES,
    EXPERIMENTAL_REASON,
    HYBRID_EXPERIMENTAL_ENGINE_VERSION,
    normalizeExperimentalProfile,
} from './experimental-auto-contract.js';

export {
    EXPERIMENTAL_REASON,
    HYBRID_EXPERIMENTAL_ENGINE_VERSION,
    normalizeExperimentalProfile,
} from './experimental-auto-contract.js';

const TEACHING_TECHNIQUES = new Set(['fret_finger', 'scale_degree', 'strum_group']);
const BOOLEAN_TECHNIQUES = new Set([
    'accent', 'hammer_on', 'harmonic', 'harmonic_pinch', 'ignore',
    'link_next', 'mute', 'palm_mute', 'pull_off', 'tap', 'tremolo', 'vibrato',
    'fret_hand_mute', 'pluck', 'slap',
]);
const TARGET_TECHNIQUES = new Set([
    'slide_to', 'slide_unpitch_to', 'right_hand', 'pick_direction', 'bend_intent',
]);
const SEMANTIC_NOTE_FIELDS = new Set([
    'time', 'string', 'fret', 'sustain', 'sus', 'beat', 'beatEnd', 'techniques',
    '_fn', '_fromChord', '_chordId',
]);

const experimentalPlayabilityCache = new WeakMap();

function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function compareEntries(left, right) {
    return left.startBeat - right.startBeat || left.string - right.string
        || left.fret - right.fret || left.id.localeCompare(right.id);
}

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

function normalizedTechniqueValue(key, value) {
    if (BOOLEAN_TECHNIQUES.has(key)) {
        if (value === true || value === 1 || value === '1') return true;
        if (value === false || value === 0 || value === '0'
            || value === undefined || value === null || value === '') return null;
        return value;
    }
    if (TARGET_TECHNIQUES.has(key)) {
        const number = Number(value);
        if (Number.isFinite(number)) return number >= 0 ? number : null;
        return value === undefined || value === null || value === '' ? null : value;
    }
    if (Array.isArray(value)) return value.length ? value : null;
    if (value === undefined || value === null || value === false || value === '') return null;
    return value;
}

function semanticTechniqueSignature(note) {
    const techniques = note && note.techniques && typeof note.techniques === 'object'
        ? note.techniques : {};
    const gameplay = {};
    for (const key of Object.keys(techniques).sort()) {
        if (TEACHING_TECHNIQUES.has(key)) continue;
        const value = normalizedTechniqueValue(key, techniques[key]);
        if (value !== null) gameplay[key] = value;
    }
    return stable(gameplay);
}

function unknownNoteSignature(note) {
    const unknown = {};
    for (const key of Object.keys(note || {}).sort()) {
        if (!SEMANTIC_NOTE_FIELDS.has(key)) unknown[key] = note[key];
    }
    return stable(unknown);
}

function semanticConnectionsMatch(left, right, beats) {
    const a = left && left.connectedTarget;
    const b = right && right.connectedTarget;
    if (!a || !b) return !a && !b;
    return a.string === b.string && a.fret === b.fret
        && Math.abs(timeOf(beats, a.startBeat) - timeOf(beats, b.startBeat))
            <= compositeTimingToleranceSeconds(beats, (a.startBeat + b.startBeat) / 2) + 1e-9
        && Math.abs(timeOf(beats, a.endBeat) - timeOf(beats, b.endBeat))
            <= compositeTimingToleranceSeconds(beats, (a.endBeat + b.endBeat) / 2) + 1e-9
        && semanticTechniqueSignature(a.note) === semanticTechniqueSignature(b.note)
        && unknownNoteSignature(a.note) === unknownNoteSignature(b.note)
        && (a.semanticStrumTopology || null) === (b.semanticStrumTopology || null);
}

function annotateSemanticStrumTopology(entries) {
    const activeByRawId = new Map();
    const instances = [];
    for (const entry of entries.slice().sort(compareEntries)) {
        const raw = Number(entry.note?.techniques?.strum_group);
        if (!Number.isInteger(raw) || raw < 0) continue;
        const prior = activeByRawId.get(raw);
        let instance = prior;
        if (!instance || entry.startBeat - instance.lastBeat > 0.35 + COMPOSITE_BEAT_EPS) {
            instance = { entries: [], lastBeat: entry.startBeat };
            instances.push(instance);
        }
        instance.entries.push(entry);
        instance.lastBeat = entry.startBeat;
        activeByRawId.set(raw, instance);
    }
    for (const instance of instances) {
        const firstBeat = Math.min(...instance.entries.map(entry => entry.startBeat));
        const topology = stable(instance.entries.map(entry => ({
            string: entry.string,
            fret: entry.fret,
            offset: Math.round((entry.startBeat - firstBeat) * 1000) / 1000,
        })).sort((left, right) => left.offset - right.offset
            || left.string - right.string || left.fret - right.fret));
        for (const entry of instance.entries) entry.semanticStrumTopology = topology;
    }
}

function entryTimingDistance(left, right, beats) {
    return Math.abs(timeOf(beats, left.startBeat) - timeOf(beats, right.startBeat))
        + Math.abs(timeOf(beats, left.endBeat) - timeOf(beats, right.endBeat));
}

function semanticDuplicate(left, right, beats) {
    return left.string === right.string && left.fret === right.fret
        && Math.abs(timeOf(beats, left.startBeat) - timeOf(beats, right.startBeat))
            <= compositeTimingToleranceSeconds(beats, (left.startBeat + right.startBeat) / 2) + 1e-9
        && Math.abs(timeOf(beats, left.endBeat) - timeOf(beats, right.endBeat))
            <= compositeTimingToleranceSeconds(beats, (left.endBeat + right.endBeat) / 2) + 1e-9
        && semanticTechniqueSignature(left.note) === semanticTechniqueSignature(right.note)
        && unknownNoteSignature(left.note) === unknownNoteSignature(right.note)
        && (left.semanticStrumTopology || null) === (right.semanticStrumTopology || null)
        && semanticConnectionsMatch(left, right, beats);
}

function mergeProvenance(canonical, duplicate) {
    canonical.sources = [...new Set([
        ...(canonical.sources || [canonical.source]),
        ...(duplicate.sources || [duplicate.source]),
    ].filter(Boolean))];
    canonical.duplicateEntryIds = [...new Set([
        ...(canonical.duplicateEntryIds || []), duplicate.id,
        ...(duplicate.duplicateEntryIds || []),
    ])];
}

export function classifyExperimentalDuplicates(prepared, beats = []) {
    const primaryEntries = prepared.primaryEntries.map(clone);
    const secondaryEntries = prepared.secondaryEntries.map(clone);
    annotateSemanticStrumTopology(primaryEntries);
    annotateSemanticStrumTopology(secondaryEntries);
    const primaryById = new Map(primaryEntries.map(entry => [entry.id, entry]));
    const secondaryById = new Map(secondaryEntries.map(entry => [entry.id, entry]));
    const strictSecondaryIds = new Set();
    const usedPrimaryIds = new Set();
    const duplicates = [];
    for (const pair of prepared.duplicates || []) {
        const primary = primaryById.get(pair.primary.id);
        const secondary = secondaryById.get(pair.secondary.id);
        if (!primary || !secondary) continue;
        strictSecondaryIds.add(secondary.id);
        usedPrimaryIds.add(primary.id);
        duplicates.push({ ...clone(pair), primary, secondary, kind: 'strict' });
    }
    const byPosition = new Map();
    for (const entry of primaryEntries) {
        const key = `${entry.string}:${entry.fret}`;
        if (!byPosition.has(key)) byPosition.set(key, []);
        byPosition.get(key).push({
            entry,
            startTime: timeOf(beats, entry.startBeat),
        });
    }
    for (const list of byPosition.values()) {
        list.sort((left, right) => left.startTime - right.startTime
            || compareEntries(left.entry, right.entry));
    }
    const semanticSecondaryIds = new Set();
    for (const secondary of secondaryEntries) {
        if (strictSecondaryIds.has(secondary.id)) continue;
        const positionEntries = byPosition.get(`${secondary.string}:${secondary.fret}`) || [];
        const secondaryStartTime = timeOf(beats, secondary.startBeat);
        const from = Number.isFinite(secondaryStartTime)
            ? lowerBound(positionEntries,
                secondaryStartTime - COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS - 1e-9,
                candidate => candidate.startTime)
            : 0;
        let primary = null;
        let primaryDistance = Infinity;
        for (let index = from; index < positionEntries.length; index++) {
            const candidateRecord = positionEntries[index];
            if (Number.isFinite(secondaryStartTime) && Number.isFinite(candidateRecord.startTime)
                && candidateRecord.startTime
                    > secondaryStartTime + COMPOSITE_TIMING_TOLERANCE_MAX_SECONDS + 1e-9) break;
            const candidate = candidateRecord.entry;
            if (usedPrimaryIds.has(candidate.id)
                || !semanticDuplicate(candidate, secondary, beats)) continue;
            const distance = entryTimingDistance(candidate, secondary, beats);
            if (!primary || distance < primaryDistance
                || distance === primaryDistance && compareEntries(candidate, primary) < 0) {
                primary = candidate;
                primaryDistance = distance;
            }
        }
        if (!primary) continue;
        usedPrimaryIds.add(primary.id);
        semanticSecondaryIds.add(secondary.id);
        mergeProvenance(primary, secondary);
        duplicates.push({
            primary, secondary, kind: 'play-equivalent',
            startDeltaSeconds: Math.abs(timeOf(beats, primary.startBeat)
                - timeOf(beats, secondary.startBeat)),
            endDeltaSeconds: Math.abs(timeOf(beats, primary.endBeat)
                - timeOf(beats, secondary.endBeat)),
        });
    }
    return {
        primaryEntries,
        secondaryEntries,
        candidateEntries: secondaryEntries.filter(entry => !strictSecondaryIds.has(entry.id)
            && !semanticSecondaryIds.has(entry.id)),
        duplicates,
        strictCount: strictSecondaryIds.size,
        semanticCount: semanticSecondaryIds.size,
    };
}

function unionFind(length) {
    const parent = Array.from({ length }, (_, index) => index);
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
    return { find, join };
}

export function buildExperimentalGestureGraph(secondaryEntries, candidateEntries) {
    const entries = secondaryEntries.slice().sort(compareEntries);
    const indexById = new Map(entries.map((entry, index) => [entry.id, index]));
    const graph = unionFind(entries.length);
    const byPlayableGroup = new Map();
    const byStrumGroup = new Map();
    const previousByString = new Map();
    const brokenById = new Map();
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry.playableGroupId) {
            const prior = byPlayableGroup.get(entry.playableGroupId);
            if (prior !== undefined) graph.join(prior, index);
            else byPlayableGroup.set(entry.playableGroupId, index);
        }
        const connected = indexById.get(entry.connectedToId);
        if (connected !== undefined) graph.join(index, connected);
        const techniques = entry.note && entry.note.techniques || {};
        if ((techniques.hammer_on || techniques.pull_off)) {
            const prior = previousByString.get(entry.string);
            if (prior !== undefined
                && entry.startBeat - entries[prior].startBeat <= 2 + COMPOSITE_BEAT_EPS) {
                graph.join(prior, index);
            } else {
                brokenById.set(entry.id, ['legato has no nearby preceding note on this string']);
            }
        }
        if (techniques.link_next && connected === undefined) {
            const reasons = brokenById.get(entry.id) || [];
            reasons.push('connected technique has no destination note');
            brokenById.set(entry.id, reasons);
        }
        const slideTarget = Number(techniques.slide_to);
        if (Number.isFinite(slideTarget) && slideTarget >= 0 && connected === undefined) {
            const reasons = brokenById.get(entry.id) || [];
            reasons.push(`pitched slide has no destination at fret ${slideTarget}`);
            brokenById.set(entry.id, reasons);
        }
        const strumGroup = techniques.strum_group;
        if (Number.isFinite(Number(strumGroup)) && Number(strumGroup) >= 0) {
            const key = String(strumGroup);
            const prior = byStrumGroup.get(key);
            // Some importers reuse a raw group number later in the song. A
            // strum relationship is local topology, not a licence to connect
            // every future note carrying the same integer into one mega-riff.
            if (prior && entry.startBeat - prior.lastBeat <= 0.35 + COMPOSITE_BEAT_EPS) {
                graph.join(prior.index, index);
            }
            byStrumGroup.set(key, { index, lastBeat: entry.startBeat });
        }
        previousByString.set(entry.string, index);
    }
    const components = new Map();
    for (let index = 0; index < entries.length; index++) {
        const root = graph.find(index);
        if (!components.has(root)) components.set(root, []);
        components.get(root).push(entries[index]);
    }
    const candidateIds = new Set(candidateEntries.map(entry => entry.id));
    const gestures = [];
    for (const componentEntries of components.values()) {
        const candidates = componentEntries.filter(entry => candidateIds.has(entry.id));
        if (!candidates.length) continue;
        const id = `experimental:gesture:${gestures.length + 1}`;
        const startBeat = Math.min(...componentEntries.map(entry => entry.startBeat));
        const endBeat = Math.max(...componentEntries.map(entry => entry.effectiveEndBeat));
        for (const entry of candidates) {
            entry.playableGroupId = id;
            entry.playableStartBeat = startBeat;
            entry.playableEndBeat = endBeat;
        }
        gestures.push({
            id, entries: candidates, allEntries: componentEntries, startBeat, endBeat,
            dependencyEntryIds: componentEntries.filter(entry => !candidateIds.has(entry.id))
                .map(entry => entry.id),
            brokenReasons: [...new Set(componentEntries.flatMap(entry => brokenById.get(entry.id) || []))],
            brokenReasonCodes: componentEntries.some(entry => (brokenById.get(entry.id) || []).length)
                ? [EXPERIMENTAL_REASON.BROKEN_CONNECTION] : [],
        });
    }
    return gestures.sort((left, right) => left.startBeat - right.startBeat
        || left.id.localeCompare(right.id));
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function lowerBound(list, value, getter = item => item) {
    let lo = 0, hi = list.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (getter(list[mid]) < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function entrySourceTime(entry, beats) {
    const authored = Number(entry?.note?.time);
    return Number.isFinite(authored) ? authored : timeOf(beats, entry?.startBeat);
}

function sourceSpanSeconds(entries, beats) {
    if (!entries.length) return 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const entry of entries) {
        const time = entrySourceTime(entry, beats);
        if (!Number.isFinite(time)) continue;
        minimum = Math.min(minimum, time);
        maximum = Math.max(maximum, time);
    }
    return Number.isFinite(minimum) && Number.isFinite(maximum) ? maximum - minimum : 0;
}

function gridResidualStats(entries, beats) {
    const residuals = entries.map(entry => Math.abs(entrySourceTime(entry, beats)
        - timeOf(beats, entry.startBeat))).filter(Number.isFinite);
    return { median: median(residuals), p95: percentile(residuals, 0.95) };
}

export function experimentalSyncPreflight(primaryEntries, secondaryEntries, beats = []) {
    const primaryByPosition = new Map();
    for (const entry of primaryEntries) {
        const key = `${entry.string}:${entry.fret}`;
        if (!primaryByPosition.has(key)) primaryByPosition.set(key, []);
        primaryByPosition.get(key).push({ entry, time: entrySourceTime(entry, beats) });
    }
    for (const list of primaryByPosition.values()) list.sort((left, right) => left.time - right.time);

    // First find a dominant global offset. Repeated riffs create many possible
    // same-fret pairs; a 10 ms histogram finds the coherent diagonal before
    // the ordered one-to-one pass chooses individual matches.
    const offsetBins = new Map();
    for (const secondary of secondaryEntries) {
        const time = entrySourceTime(secondary, beats);
        const list = primaryByPosition.get(`${secondary.string}:${secondary.fret}`) || [];
        const from = lowerBound(list, time - 0.75, item => item.time);
        for (let index = from; index < list.length && list[index].time <= time + 0.75; index++) {
            const delta = time - list[index].time;
            const bin = Math.round(delta / 0.01);
            const bucket = offsetBins.get(bin) || [];
            if (bucket.length < 10000) bucket.push(delta);
            offsetBins.set(bin, bucket);
        }
    }
    const dominant = [...offsetBins.entries()].sort((left, right) =>
        right[1].length - left[1].length || Math.abs(left[0]) - Math.abs(right[0]))[0];
    const expectedOffset = dominant ? median(dominant[1]) : 0;

    const used = new Set();
    const matches = [];
    let lastPrimaryTime = -Infinity;
    for (const secondary of secondaryEntries.slice().sort(compareEntries)) {
        const secondaryTime = entrySourceTime(secondary, beats);
        const list = primaryByPosition.get(`${secondary.string}:${secondary.fret}`) || [];
        const expectedPrimaryTime = secondaryTime - expectedOffset;
        const from = lowerBound(list, expectedPrimaryTime - 0.08, item => item.time);
        const candidates = [];
        for (let index = from; index < list.length && list[index].time <= expectedPrimaryTime + 0.08; index++) {
            const candidate = list[index];
            if (used.has(candidate.entry.id) || candidate.time < lastPrimaryTime - 0.02) continue;
            candidates.push({
                primary: candidate.entry,
                primaryTime: candidate.time,
                delta: secondaryTime - candidate.time,
            });
        }
        candidates.sort((left, right) => Math.abs(left.delta - expectedOffset)
            - Math.abs(right.delta - expectedOffset) || compareEntries(left.primary, right.primary));
        if (!candidates.length) continue;
        used.add(candidates[0].primary.id);
        lastPrimaryTime = Math.max(lastPrimaryTime, candidates[0].primaryTime);
        matches.push({
            sourceTime: candidates[0].primaryTime,
            sourceBeat: candidates[0].primary.startBeat,
            delta: candidates[0].delta,
        });
    }
    const coverage = matches.length / Math.max(1,
        Math.min(primaryEntries.length, secondaryEntries.length));
    const offset = median(matches.map(match => match.delta));
    const residuals = matches.map(match => Math.abs(match.delta - offset));
    const p95Residual = percentile(residuals, 0.95);
    const first = matches[0];
    const last = matches.at(-1);
    const duration = first && last ? last.sourceTime - first.sourceTime : 0;
    const early = matches.filter(match => !duration || match.sourceTime <= first.sourceTime + duration / 3);
    const late = matches.filter(match => !duration || match.sourceTime >= first.sourceTime + duration * 2 / 3);
    const driftSeconds = early.length && late.length
        ? median(late.map(match => match.delta)) - median(early.map(match => match.delta)) : 0;
    const primarySpan = sourceSpanSeconds(primaryEntries, beats);
    const secondarySpan = sourceSpanSeconds(secondaryEntries, beats);
    const lengthDifferenceSeconds = Math.abs(primarySpan - secondarySpan);
    const primaryGrid = gridResidualStats(primaryEntries, beats);
    const secondaryGrid = gridResidualStats(secondaryEntries, beats);
    const sufficient = matches.length >= 12 && coverage >= 0.15;
    const coherent = p95Residual <= 0.025;
    const offsetProblem = sufficient && coherent && Math.abs(offset) > 0.05;
    const driftProblem = sufficient && p95Residual <= 0.06 && Math.abs(driftSeconds) > 0.06;
    const blocked = offsetProblem || driftProblem;
    const warnings = [];
    if (lengthDifferenceSeconds > Math.max(8, Math.min(primarySpan, secondarySpan) * 0.1)) {
        warnings.push({ code: 'length-difference', value: lengthDifferenceSeconds,
            message: `The source lengths differ by ${lengthDifferenceSeconds.toFixed(1)} seconds.` });
    }
    if (Math.max(primaryGrid.p95, secondaryGrid.p95) > 0.04) {
        warnings.push({ code: 'grid-displacement',
            value: Math.max(primaryGrid.p95, secondaryGrid.p95),
            message: 'Many notes sit noticeably away from their authored shared-grid positions.' });
    }
    let status = 'inconclusive';
    let message = 'The tracks do not share enough matching notes to verify their timing automatically.';
    if (blocked) {
        status = 'blocked';
        message = `The tracks appear out of sync (${Math.round(offset * 1000)} ms offset`
            + `${driftProblem ? `, ${Math.round(driftSeconds * 1000)} ms drift` : ''}). Align them before using experimental smart fill.`;
    } else if (sufficient && p95Residual <= 0.03) {
        status = 'verified';
        message = `Timing looks aligned across ${matches.length} matching notes.`;
    }
    if (!blocked && warnings.length) message += ` ${warnings.map(warning => warning.message).join(' ')}`;
    return {
        status, blocked, message, matches: matches.length, coverage,
        offsetSeconds: offset, expectedOffsetSeconds: expectedOffset,
        p95ResidualSeconds: p95Residual, driftSeconds,
        primarySpanSeconds: primarySpan, secondarySpanSeconds: secondarySpan,
        lengthDifferenceSeconds, primaryGridResidual: primaryGrid,
        secondaryGridResidual: secondaryGrid, warnings,
    };
}

function markerBeat(item, beats) {
    if (Number.isFinite(Number(item && item.beat))) return Number(item.beat);
    return beatOf(beats, finite(item && (item.start_time ?? item.time), Number.NaN));
}

function structuralMarkers({ sections, primary, secondary, beats }) {
    const sectionMarkers = (sections || []).map(section => ({
        beat: markerBeat(section, beats),
        strength: 'section',
        label: String(section && section.name || 'Section').replace(/[-_]+/g, ' '),
    })).filter(marker => Number.isFinite(marker.beat));
    // A source `phrases` list can be a difficulty ladder rather than a
    // free-standing musical form map. Only a boundary independently present
    // in both arrangements is strong enough to influence segmentation.
    const primaryPhrases = (primary && primary.phrases || []).map(phrase => markerBeat(phrase, beats))
        .filter(Number.isFinite).sort((left, right) => left - right);
    const secondaryPhrases = (secondary && secondary.phrases || []).map(phrase => markerBeat(phrase, beats))
        .filter(Number.isFinite).sort((left, right) => left - right);
    const usedSecondary = new Set();
    const phraseMarkers = [];
    for (const primaryBeat of primaryPhrases) {
        let match = -1;
        let distance = Infinity;
        for (let index = 0; index < secondaryPhrases.length; index++) {
            if (usedSecondary.has(index)) continue;
            const candidate = Math.abs(timeOf(beats, primaryBeat)
                - timeOf(beats, secondaryPhrases[index]));
            if (candidate < distance) { match = index; distance = candidate; }
        }
        if (match < 0 || distance > compositeTimingToleranceSeconds(beats, primaryBeat) + 1e-9) continue;
        usedSecondary.add(match);
        phraseMarkers.push({
            beat: (primaryBeat + secondaryPhrases[match]) / 2,
            strength: 'phrase', label: 'Shared phrase',
        });
    }
    const measures = [];
    for (let index = 0; index < (beats || []).length; index++) {
        if (Number(beats[index] && beats[index].measure) >= 1) {
            measures.push({ beat: index, strength: 'bar', label: `Bar ${beats[index].measure}` });
        }
    }
    const strongBeats = [];
    for (let index = 0; index < measures.length - 1; index++) {
        const span = measures[index + 1].beat - measures[index].beat;
        if (span >= 2) strongBeats.push({
            beat: measures[index].beat + span / 2,
            strength: 'strong-beat', label: `Middle of ${measures[index].label}`,
        });
    }
    const priority = { section: 4, phrase: 3, bar: 2, 'strong-beat': 1 };
    const deduped = new Map();
    for (const marker of [...sectionMarkers, ...phraseMarkers, ...measures, ...strongBeats]) {
        const key = Math.round(marker.beat * 1000);
        const prior = deduped.get(key);
        if (!prior || priority[marker.strength] > priority[prior.strength]) deduped.set(key, marker);
    }
    return [...deduped.values()].sort((left, right) => left.beat - right.beat);
}

function frettedCenter(entries) {
    const frets = entries.map(entry => entry.fret).filter(fret => fret > 0);
    return frets.length ? median(frets) : null;
}

function rounded(value, places = 3) {
    if (!Number.isFinite(value)) return value;
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
}

function reasonDetail(code, message, {
    severity = 'review', side = '', value = null, limit = null,
    penalty = 0, automaticBlock = true,
} = {}) {
    return { code, message, severity, side, value, limit, penalty, automaticBlock };
}

function markerPriority(marker) {
    return ({ section: 4, phrase: 3, bar: 2, 'strong-beat': 1 })[marker?.strength] || 0;
}

function markersBetween(markers, startBeat, endBeat) {
    const from = lowerBound(markers, startBeat - COMPOSITE_BEAT_EPS,
        marker => marker.beat);
    const to = lowerBound(markers, endBeat + COMPOSITE_BEAT_EPS,
        marker => marker.beat);
    return markers.slice(from, to);
}

function strongestMarkerBetween(markers, startBeat, endBeat) {
    let strongest = null;
    for (const marker of markersBetween(markers || [], startBeat, endBeat)) {
        if (!strongest || markerPriority(marker) > markerPriority(strongest)
            || markerPriority(marker) === markerPriority(strongest)
                && Math.abs(marker.beat - endBeat) < Math.abs(strongest.beat - endBeat)) {
            strongest = marker;
        }
    }
    return strongest;
}

function attackDensity(entries, startBeat, endBeat) {
    const span = Math.max(0.25, endBeat - startBeat);
    const sorted = entries || [];
    const from = lowerBound(sorted, startBeat - COMPOSITE_BEAT_EPS,
        entry => entry.startBeat);
    const to = lowerBound(sorted, endBeat + COMPOSITE_BEAT_EPS,
        entry => entry.startBeat);
    return Math.max(0, to - from) / span;
}

function transitionMetrics(passage, context, rules) {
    const { beats, markers, primaryByStart, primaryByEnd } = context;
    const start = passage.startBeat;
    const end = passage.endBeat;
    const beforeAt = lowerBound(primaryByEnd, start + COMPOSITE_BEAT_EPS,
        entry => entry.effectiveEndBeat);
    const before = primaryByEnd.slice(Math.max(0, beforeAt - 6), beforeAt);
    const afterAt = lowerBound(primaryByStart, end - COMPOSITE_BEAT_EPS,
        entry => entry.startBeat);
    const after = primaryByStart.slice(afterAt, afterAt + 6);
    const previousEnd = before.length
        ? Math.max(...before.map(entry => entry.effectiveEndBeat)) : Number.NEGATIVE_INFINITY;
    const nextStart = after.length
        ? Math.min(...after.map(entry => entry.startBeat)) : Number.POSITIVE_INFINITY;
    const entryGapBeats = Number.isFinite(previousEnd) ? Math.max(0, start - previousEnd) : Infinity;
    const exitGapBeats = Number.isFinite(nextStart) ? Math.max(0, nextStart - end) : Infinity;
    const entryGapSeconds = Number.isFinite(previousEnd)
        ? Math.max(0, timeOf(beats, start) - timeOf(beats, previousEnd)) : Infinity;
    const exitGapSeconds = Number.isFinite(nextStart)
        ? Math.max(0, timeOf(beats, nextStart) - timeOf(beats, end)) : Infinity;
    const entryMarker = strongestMarkerBetween(markers,
        Number.isFinite(previousEnd) ? previousEnd : start, start);
    const exitMarker = strongestMarkerBetween(markers, end,
        Number.isFinite(nextStart) ? nextStart : end);
    const entryBoundaryStrong = !Number.isFinite(previousEnd)
        || entryGapBeats >= rules.restBoundaryBeats
        || markerPriority(entryMarker) >= 2
        || markerPriority(entryMarker) === 1 && entryGapBeats >= rules.restBoundaryBeats / 2;
    const exitBoundaryStrong = !Number.isFinite(nextStart)
        || exitGapBeats >= rules.restBoundaryBeats
        || markerPriority(exitMarker) >= 2
        || markerPriority(exitMarker) === 1 && exitGapBeats >= rules.restBoundaryBeats / 2;
    const passageCenter = frettedCenter(passage.entries);
    const beforeCenter = frettedCenter(before);
    const afterCenter = frettedCenter(after);
    const entryFretShift = passageCenter !== null && beforeCenter !== null
        ? Math.abs(passageCenter - beforeCenter) : 0;
    const exitFretShift = passageCenter !== null && afterCenter !== null
        ? Math.abs(passageCenter - afterCenter) : 0;
    const edgeWindow = 1;
    const fillEntryDensity = attackDensity(passage.entries, start, Math.min(end, start + edgeWindow));
    const fillExitDensity = attackDensity(passage.entries, Math.max(start, end - edgeWindow), end);
    const baseEntryDensity = attackDensity(primaryByStart, start - edgeWindow, start);
    const baseExitDensity = attackDensity(primaryByStart, end, end + edgeWindow);
    const contrast = (left, right) => left > 0 && right > 0
        ? Math.max(left, right) / Math.min(left, right) : 1;
    return {
        previousBaseBeat: Number.isFinite(previousEnd) ? previousEnd : null,
        nextBaseBeat: Number.isFinite(nextStart) ? nextStart : null,
        entryGapBeats: rounded(entryGapBeats), exitGapBeats: rounded(exitGapBeats),
        entryGapSeconds: rounded(entryGapSeconds), exitGapSeconds: rounded(exitGapSeconds),
        entryMarker, exitMarker, entryBoundaryStrong, exitBoundaryStrong,
        entryFretShift: rounded(entryFretShift, 1), exitFretShift: rounded(exitFretShift, 1),
        baseEntryDensity: rounded(baseEntryDensity, 2), fillEntryDensity: rounded(fillEntryDensity, 2),
        fillExitDensity: rounded(fillExitDensity, 2), baseExitDensity: rounded(baseExitDensity, 2),
        entryDensityRatio: rounded(contrast(baseEntryDensity, fillEntryDensity), 2),
        exitDensityRatio: rounded(contrast(fillExitDensity, baseExitDensity), 2),
    };
}

function markerAtOrBefore(markers, beat) {
    const at = lowerBound(markers, beat + COMPOSITE_BEAT_EPS, marker => marker.beat);
    return at > 0 ? markers[at - 1] : null;
}

function passageLabel(passage, markersByStrength) {
    const section = markerAtOrBefore(markersByStrength.section, passage.startBeat);
    const bar = markerAtOrBefore(markersByStrength.bar, passage.startBeat);
    return [section && section.label, bar && bar.label].filter(Boolean).join(' · ')
        || `Around beat ${Math.max(0, passage.startBeat).toFixed(1)}`;
}

function sourcePassageMustSplit(tail, gesture, markers, rules) {
    if (!tail) return true;
    const gap = gesture.startBeat - tail.endBeat;
    if (gap >= rules.restBoundaryBeats) return true;
    const between = markersBetween(markers,
        Math.min(tail.endBeat + COMPOSITE_BEAT_EPS * 2,
            gesture.startBeat - COMPOSITE_BEAT_EPS), gesture.startBeat);
    if (between.some(marker => marker.strength === 'section' || marker.strength === 'phrase')) return true;
    if (gap >= rules.restBoundaryBeats / 2
        && between.some(marker => marker.strength === 'bar' || marker.strength === 'strong-beat')) return true;
    const barsCrossed = markersBetween(markers,
        tail.startBeat + COMPOSITE_BEAT_EPS * 2, gesture.startBeat)
        .filter(marker => marker.strength === 'bar').length;
    return barsCrossed >= rules.maximumBars;
}

function passageReasonDetails(passage, scoringContext, rules, profile) {
    const details = [];
    if (passage.timingState === 'mixed') {
        details.push(reasonDetail(EXPERIMENTAL_REASON.PARTIAL_GESTURE,
            'part of a connected gesture does not fit the required timing gap',
            { severity: 'hard', penalty: 100 }));
    } else if (passage.timingState === 'blocked') {
        details.push(reasonDetail(EXPERIMENTAL_REASON.TIMING_BLOCKED,
            'the complete notes and trails do not fit the required timing gap',
            { severity: 'hard', penalty: 100 }));
    }
    const broken = [...new Set(passage.gestures.flatMap(gesture => gesture.brokenReasons || []))];
    for (const message of broken) details.push(reasonDetail(EXPERIMENTAL_REASON.BROKEN_CONNECTION,
        message, { severity: 'hard', penalty: 100 }));
    const dependencyCount = passage.gestures.reduce((sum, gesture) =>
        sum + (gesture.dependencyEntryIds || []).length, 0);
    if (dependencyCount) details.push(reasonDetail(EXPERIMENTAL_REASON.SHARED_DEPENDENCY,
        'a connected gesture also depends on a note shared by both tracks', { penalty: 12 }));
    if (passage.partialSourcePassage) details.push(reasonDetail(EXPERIMENTAL_REASON.PARTIAL_PASSAGE,
        'the timing window keeps only part of the detected musical passage', { penalty: 28 }));

    const metrics = transitionMetrics(passage, scoringContext, rules);
    passage.handoff = metrics;
    if (!metrics.entryBoundaryStrong) details.push(reasonDetail(EXPERIMENTAL_REASON.WEAK_ENTRY,
        'the passage begins away from a clear rest, bar, section, or phrase boundary', {
            side: 'entry', penalty: 12,
            severity: rules.weakBoundaryAction === 'left-out' ? 'left-out' : 'review',
            automaticBlock: rules.weakBoundaryAction !== 'automatic',
        }));
    if (!metrics.exitBoundaryStrong) details.push(reasonDetail(EXPERIMENTAL_REASON.WEAK_EXIT,
        'the base track returns away from a clear rest, bar, section, or phrase boundary', {
            side: 'exit', penalty: 12,
            severity: rules.weakBoundaryAction === 'left-out' ? 'left-out' : 'review',
            automaticBlock: rules.weakBoundaryAction !== 'automatic',
        }));
    const isolated = passage.gestureCount === 1
        && (passage.noteCount <= 1 || passage.endBeat - passage.startBeat < 0.25);
    if (isolated) details.push(reasonDetail(EXPERIMENTAL_REASON.ISOLATED,
        'this is a single isolated fill note rather than a complete playable idea', {
            penalty: 24,
            severity: rules.isolatedAction === 'left-out' ? 'left-out' : 'review',
            // Even Fill more asks before inserting an awkward isolated attack.
            automaticBlock: true,
        }));
    for (const [side, value, code] of [
        ['entry', metrics.entryFretShift, EXPERIMENTAL_REASON.POSITION_ENTRY],
        ['exit', metrics.exitFretShift, EXPERIMENTAL_REASON.POSITION_EXIT],
    ]) {
        if (value > rules.handoffFrets) details.push(reasonDetail(code,
            `${side === 'entry' ? 'entering' : 'leaving'} the passage needs a ${Math.round(value)}-fret position shift`, {
                side, value, limit: rules.handoffFrets,
                penalty: Math.min(24, 8 + (value - rules.handoffFrets) * 2),
            }));
    }
    for (const [side, value, code] of [
        ['entry', metrics.entryDensityRatio, EXPERIMENTAL_REASON.DENSITY_ENTRY],
        ['exit', metrics.exitDensityRatio, EXPERIMENTAL_REASON.DENSITY_EXIT],
    ]) {
        if (value > rules.densityRatio) details.push(reasonDetail(code,
            `${side === 'entry' ? 'the opening' : 'the ending'} changes attack density abruptly`, {
                side, value, limit: rules.densityRatio, penalty: 10,
            }));
    }
    const score = Math.max(0, Math.round(100
        - details.reduce((sum, detail) => sum + (detail.penalty || 0), 0)));
    const hard = details.some(detail => detail.severity === 'hard');
    const forceLeftOut = details.some(detail => detail.severity === 'left-out');
    const automaticBlocked = details.some(detail => detail.automaticBlock);
    let status = 'left-out';
    if (!hard && passage.noteCount >= rules.minimumAutoNotes) {
        if (!automaticBlocked && score >= rules.autoScore) status = 'automatic';
        else if (!forceLeftOut && profile !== HYBRID_EXPERIMENTAL_PROFILE_STRICT
            && score >= rules.reviewScore) status = 'review';
    }
    return { details, score, status };
}

function makePassages(gestures, standardAcceptedIds, context) {
    const { profile, primaryEntries, beats } = context;
    const rules = EXPERIMENTAL_PROFILE_RULES[profile];
    const markers = structuralMarkers(context);
    const markersByStrength = {
        section: markers.filter(marker => marker.strength === 'section'),
        bar: markers.filter(marker => marker.strength === 'bar'),
    };
    const scoringContext = {
        beats, markers,
        primaryByStart: primaryEntries.slice().sort(compareEntries),
        primaryByEnd: primaryEntries.slice().sort((left, right) =>
            left.effectiveEndBeat - right.effectiveEndBeat || compareEntries(left, right)),
    };
    for (const gesture of gestures) {
        const accepted = gesture.entries.filter(entry => standardAcceptedIds.has(entry.id)).length;
        gesture.timingState = accepted === gesture.entries.length ? 'safe'
            : accepted === 0 ? 'blocked' : 'mixed';
    }
    const sourcePassages = [];
    for (const gesture of gestures) {
        const tail = sourcePassages.at(-1);
        if (sourcePassageMustSplit(tail, gesture, markers, rules)) {
            sourcePassages.push({ gestures: [gesture], startBeat: gesture.startBeat, endBeat: gesture.endBeat });
        } else {
            tail.gestures.push(gesture);
            tail.endBeat = Math.max(tail.endBeat, gesture.endBeat);
        }
    }
    const passages = [];
    for (const sourcePassage of sourcePassages) {
        let run = null;
        for (const gesture of sourcePassage.gestures) {
            if (!run || run.timingState !== gesture.timingState) {
                run = {
                    timingState: gesture.timingState, gestures: [],
                    startBeat: gesture.startBeat, endBeat: gesture.endBeat,
                    sourceStartBeat: sourcePassage.startBeat, sourceEndBeat: sourcePassage.endBeat,
                    sourceGestureCount: sourcePassage.gestures.length,
                };
                passages.push(run);
            }
            run.gestures.push(gesture);
            run.endBeat = Math.max(run.endBeat, gesture.endBeat);
        }
    }
    for (let index = 0; index < passages.length; index++) {
        const passage = passages[index];
        passage.id = `experimental:passage:${index + 1}`;
        passage.entries = passage.gestures.flatMap(gesture => gesture.entries).sort(compareEntries);
        passage.noteCount = passage.entries.length;
        passage.gestureCount = passage.gestures.length;
        passage.partialSourcePassage = passage.gestureCount !== passage.sourceGestureCount
            || Math.abs(passage.startBeat - passage.sourceStartBeat) > COMPOSITE_BEAT_EPS
            || Math.abs(passage.endBeat - passage.sourceEndBeat) > COMPOSITE_BEAT_EPS;
        const scored = passageReasonDetails(passage, scoringContext, rules, profile);
        passage.reasonDetails = scored.details;
        passage.reasonCodes = [...new Set(scored.details.map(detail => detail.code))];
        passage.reasons = scored.details.map(detail => detail.message);
        passage.handoffScore = scored.score;
        passage.status = scored.status;
        passage.label = passageLabel(passage, markersByStrength);
        passage.explanation = passage.status === 'automatic'
            ? `Added automatically: the complete passage fits and its handoff score is ${passage.handoffScore}/100.`
            : passage.status === 'review'
                ? `Needs your choice (${passage.handoffScore}/100): ${passage.reasons.join('; ')}.`
                : `Left out${passage.handoffScore ? ` (${passage.handoffScore}/100)` : ''}: ${passage.reasons.join('; ')}.`;
    }
    return passages;
}

function entriesToNotes(entries, beats) {
    return entries.map(entry => {
        const note = clone(entry.note) || {};
        note.time = timeOf(beats, entry.startBeat);
        note.sustain = Math.max(0, timeOf(beats, entry.endBeat) - note.time);
        note.string = entry.string;
        note.fret = entry.fret;
        return note;
    });
}

function issueSignature(issue) {
    return `${issue.rule}|${finite(issue.time).toFixed(3)}|${issue.detail}`;
}

function passageForTime(passages, beat) {
    return (passages || []).find(passage => beat >= passage.startBeat - COMPOSITE_BEAT_EPS
        && beat <= passage.endBeat + COMPOSITE_BEAT_EPS) || null;
}

function differentialPlayability(primaryEntries, hybridEntries, beats, passages = [], anchors = [],
    inheritedIssues = null) {
    const hybridNotes = entriesToNotes(hybridEntries, beats);
    const inherited = inheritedIssues || _playabilityLintPure(
        entriesToNotes(primaryEntries, beats), anchors);
    const inheritedSignatures = new Set(inherited.map(issueSignature));
    const all = _playabilityLintPure(hybridNotes, anchors);
    const selectedIds = new Set(hybridEntries.map(entry => entry.id));
    const lintWarnings = all.filter(issue => !inheritedSignatures.has(issueSignature(issue)))
        .map(issue => {
            const beat = beatOf(beats, issue.time);
            const passage = passageForTime(passages, beat);
            return {
                ...issue,
                passageId: passage?.id || '',
                entryIds: (issue.indices || []).map(index => hybridEntries[index]?.id).filter(Boolean),
            };
        });
    const transitionWarnings = [];
    for (const passage of passages || []) {
        if (!(passage.entries || []).some(entry => selectedIds.has(entry.id))) continue;
        for (const detail of passage.reasonDetails || []) {
            if (![EXPERIMENTAL_REASON.POSITION_ENTRY, EXPERIMENTAL_REASON.POSITION_EXIT,
                EXPERIMENTAL_REASON.DENSITY_ENTRY, EXPERIMENTAL_REASON.DENSITY_EXIT].includes(detail.code)) continue;
            transitionWarnings.push({
                rule: detail.code.startsWith('position') ? 'handoff-position' : 'handoff-density',
                time: timeOf(beats, passage.startBeat),
                detail: detail.message,
                passageId: passage.id,
                entryIds: passage.entries.map(entry => entry.id),
            });
        }
    }
    return {
        inheritedWarnings: inherited.length,
        totalWarnings: all.length,
        lintWarnings,
        transitionWarnings,
        newWarnings: [...lintWarnings, ...transitionWarnings],
    };
}

function conflictForPassage(passage) {
    return {
        id: passage.id,
        startBeat: passage.startBeat,
        endBeat: passage.endBeat,
        label: passage.label,
        measureLabel: passage.label,
        reason: 'experimental-handoff-review',
        reasons: passage.reasons.slice(),
        explanation: passage.explanation,
        primaryEntries: [],
        secondaryEntries: passage.entries,
        resolution: null,
        selectedEntryIds: [],
        validationError: '',
        validationKind: '',
        splitPoints: [],
    };
}

export function experimentalPassageOutcome(plan, passageOrId) {
    const passage = typeof passageOrId === 'string'
        ? (plan?.passages || []).find(candidate => candidate.id === passageOrId)
        : passageOrId;
    if (!passage) return null;
    if (passage.status === 'automatic') {
        return { state: 'automatic', selectedNotes: passage.noteCount, offeredNotes: passage.noteCount };
    }
    if (passage.status === 'left-out') {
        return { state: 'left-out', selectedNotes: 0, offeredNotes: passage.noteCount };
    }
    const conflict = (plan?.conflicts || []).find(candidate => candidate.id === passage.id);
    if (!conflict?.resolution) {
        return { state: 'review', selectedNotes: 0, offeredNotes: passage.noteCount };
    }
    const selected = new Set(conflict.selectedEntryIds || []);
    const selectedNotes = (passage.entries || []).filter(entry => selected.has(entry.id)).length;
    return {
        state: selectedNotes > 0
            ? selectedNotes === passage.noteCount ? 'accepted' : 'accepted-partial'
            : 'declined',
        selectedNotes,
        offeredNotes: passage.noteCount,
    };
}

// Formatting is deliberately pure. Call refreshExperimentalPlayability after
// a resolution change, then reuse that result for UI and report rendering.
export function experimentalComparisonReport(plan) {
    const standard = plan && plan.standardComparison;
    if (!plan || !standard) return '';
    const sync = plan.sync || {};
    const outcome = plan.reviewOutcome || {};
    const playability = plan.playability || { newWarnings: [] };
    const passageLines = (plan.passages || []).map((passage, index) => {
        const outcome = experimentalPassageOutcome(plan, passage);
        const reasons = passage.reasons?.length ? passage.reasons.join('; ') : 'clean handoffs';
        return `  ${index + 1}. ${passage.label} — ${outcome.state}, ${passage.handoffScore}/100: ${reasons}`;
    });
    return [
        'Hybrid Track automatic comparison',
        `Experimental engine: v${plan.engineVersion || HYBRID_EXPERIMENTAL_ENGINE_VERSION}`,
        `Profile: ${plan.profile}`,
        `Timing check: ${sync.status} — ${sync.message}`,
        `Shared duplicates: ${plan.stats.duplicatesRemoved} (${plan.stats.semanticDuplicates} play-equivalent)`,
        `Standard Automatic: ${standard.secondaryAddedCleanly} fill notes added; ${standard.secondarySkippedByStrategy} left out`,
        `Experimental: ${plan.stats.secondaryAddedCleanly} fill notes added automatically; ${outcome.acceptedNotes || 0} added after review; ${(plan.stats.secondarySkippedByStrategy || 0) + (outcome.leftOutNotes || 0)} left out`,
        `Passages: ${plan.stats.addedPassages} automatic, ${plan.stats.reviewPassages} review, ${plan.stats.leftOutPassages} left out`,
        `New playability warnings versus the base track: ${playability.newWarnings.length}`,
        ...(passageLines.length ? ['Passage details:', ...passageLines] : []),
    ].join('\n');
}

function experimentalResolutionSignature(plan) {
    return (plan.conflicts || []).map(conflict => [
        conflict.id,
        conflict.resolution || '',
        ...(conflict.selectedEntryIds || []).slice().sort(),
    ].join(':')).join('|');
}

function experimentalReviewOutcome(plan) {
    const acceptedIds = new Set();
    for (const conflict of plan.conflicts || []) {
        const secondaryIds = new Set((conflict.secondaryEntries || []).map(entry => entry.id));
        for (const id of conflict.selectedEntryIds || []) {
            if (secondaryIds.has(id)) acceptedIds.add(id);
        }
    }
    return {
        offeredNotes: Number(plan.stats?.secondaryReviewable) || 0,
        acceptedNotes: acceptedIds.size,
        leftOutNotes: Math.max(0,
            (Number(plan.stats?.secondaryReviewable) || 0) - acceptedIds.size),
    };
}

export function refreshExperimentalPlayability(plan) {
    if (!plan || !plan.ok || plan.strategy !== 'experimental') return null;
    const resolutionSignature = experimentalResolutionSignature(plan);
    const cached = experimentalPlayabilityCache.get(plan);
    if (cached?.resolutionSignature === resolutionSignature) {
        plan.playability = cached.playability;
        plan.reviewOutcome = cached.reviewOutcome;
        return cached.playability;
    }
    const anchors = plan.primary?.anchors_user?.length
        ? plan.primary.anchors_user : plan.primary?.anchors || [];
    const inherited = cached?.inherited || _playabilityLintPure(
        entriesToNotes(plan.sourceEntries?.primary || [], plan.beats || []), anchors);
    plan.playability = differentialPlayability(
        plan.sourceEntries?.primary || [], compositeResolvedEntries(plan), plan.beats || [],
        plan.passages || [], anchors, inherited,
    );
    plan.reviewOutcome = experimentalReviewOutcome(plan);
    experimentalPlayabilityCache.set(plan, {
        resolutionSignature,
        inherited,
        playability: plan.playability,
        reviewOutcome: plan.reviewOutcome,
    });
    return plan.playability;
}

export function analyzeExperimentalAutoComposite({
    primary, secondary, beats = [], sections = [], gapFill = {},
    profile = HYBRID_EXPERIMENTAL_PROFILE_BALANCED,
} = {}) {
    const normalizedProfile = normalizeExperimentalProfile(profile);
    const options = normalizeCompositeGapFillOptions(gapFill);
    const standardPlan = analyzeGapFillComposite({ primary, secondary, beats, gapFill: options });
    if (!standardPlan.ok) return {
        ...standardPlan, strategy: 'experimental',
        engineVersion: HYBRID_EXPERIMENTAL_ENGINE_VERSION,
        profile: normalizedProfile,
    };
    const prepared = prepareCompositeSources({ primary, secondary, beats });
    const classified = classifyExperimentalDuplicates(prepared, beats);
    const sync = experimentalSyncPreflight(classified.primaryEntries, classified.secondaryEntries, beats);
    if (sync.blocked) {
        return {
            ok: false,
            strategy: 'experimental',
            engineVersion: HYBRID_EXPERIMENTAL_ENGINE_VERSION,
            profile: normalizedProfile,
            sync,
            compatibility: {
                ...standardPlan.compatibility,
                ok: false,
                errors: [sync.message],
            },
            standardPlan,
            fixedEntries: [], conflicts: [], stats: {},
        };
    }
    const standardAcceptedIds = new Set(standardPlan.fixedEntries
        .filter(entry => compositeEntryHasSource(entry, 'secondary'))
        .flatMap(entry => [entry.id, ...(entry.duplicateEntryIds || [])]));
    const gestures = buildExperimentalGestureGraph(
        classified.secondaryEntries, classified.candidateEntries,
    );
    const passages = makePassages(gestures, standardAcceptedIds, {
        profile: normalizedProfile,
        primaryEntries: classified.primaryEntries,
        secondaryEntries: classified.secondaryEntries,
        primary, secondary, beats, sections,
    });
    const automaticEntries = passages.filter(passage => passage.status === 'automatic')
        .flatMap(passage => passage.entries);
    const reviewPassages = passages.filter(passage => passage.status === 'review');
    const leftOutPassages = passages.filter(passage => passage.status === 'left-out');
    const fixedEntries = [...classified.primaryEntries, ...automaticEntries].sort(compareEntries);
    const conflicts = reviewPassages.map(conflictForPassage);
    const stats = {
        primaryNotes: classified.primaryEntries.length,
        secondaryNotes: classified.secondaryEntries.length,
        duplicatesRemoved: classified.duplicates.length,
        strictDuplicates: classified.strictCount,
        semanticDuplicates: classified.semanticCount,
        timingAdjustments: prepared.timingAdjustments.length,
        secondaryAddedCleanly: automaticEntries.length,
        secondaryReviewable: reviewPassages.reduce((sum, passage) => sum + passage.noteCount, 0),
        secondarySkippedByStrategy: leftOutPassages.reduce((sum, passage) => sum + passage.noteCount, 0),
        addedPassages: passages.filter(passage => passage.status === 'automatic').length,
        reviewPassages: reviewPassages.length,
        leftOutPassages: leftOutPassages.length,
        conflictHunks: conflicts.length,
        unresolvedConflicts: conflicts.length,
    };
    const plan = {
        ok: true,
        strategy: 'experimental',
        experimental: true,
        engineVersion: HYBRID_EXPERIMENTAL_ENGINE_VERSION,
        profile: normalizedProfile,
        gapFill: options,
        compatibility: standardPlan.compatibility,
        primary, secondary, beats, sections,
        sourceEntries: {
            primary: classified.primaryEntries,
            secondary: classified.secondaryEntries,
        },
        fixedEntries,
        conflicts,
        duplicates: classified.duplicates,
        timingAdjustments: prepared.timingAdjustments,
        skippedEntries: leftOutPassages.flatMap(passage => passage.entries),
        gestures,
        passages,
        sync,
        playability: null,
        reviewOutcome: null,
        standardPlan,
        standardComparison: clone(standardPlan.stats),
        stats,
    };
    refreshExperimentalPlayability(plan);
    plan.comparisonReport = experimentalComparisonReport(plan);
    return plan;
}
