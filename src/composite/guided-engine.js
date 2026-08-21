/* Adaptive Guided Hybrid planner.
 *
 * Song sections are reliable landmarks but usually too large to review as one
 * choice. Imported phrases are often absent. This planner therefore starts
 * with real measure cells, inserts section/shared-phrase boundaries, skips
 * unambiguous material, and coalesces only adjacent divergent cells.
 */

import { beatOf, timeOf } from '../beats.js';
import {
    COMPOSITE_BEAT_EPS,
    clearCompositeConflictResolution,
    compositeCollisionReason,
    compositeEntryHasSource,
    compositeTimingToleranceSeconds,
    prepareCompositeSources,
    resolveCompositeConflict,
} from './merge-engine.js';

export const GUIDED_MAX_REVIEW_BARS = 4;
export const GUIDED_REPEAT_MODE_EVERY = 'every-occurrence';
export const GUIDED_REPEAT_MODE_MATCHING = 'matching-repetitions';

export function normalizeGuidedRepeatMode(value) {
    return value === GUIDED_REPEAT_MODE_MATCHING
        ? GUIDED_REPEAT_MODE_MATCHING : GUIDED_REPEAT_MODE_EVERY;
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

function near(left, right) {
    return Math.abs(left - right) <= COMPOSITE_BEAT_EPS;
}

function sortedUnique(values) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    const result = [];
    for (const value of sorted) {
        if (!result.length || !near(result.at(-1), value)) result.push(value);
    }
    return result;
}

function measureMarkers(beats) {
    const markers = [];
    for (let index = 0; index < (beats || []).length; index++) {
        const measure = Number(beats[index] && beats[index].measure);
        if (Number.isFinite(measure) && measure >= 1) markers.push({ beat: index, measure });
    }
    return markers;
}

function sectionLabel(section) {
    const rawName = String(section && section.name || 'Section').trim() || 'Section';
    const hasAuthoredNumber = /\d\s*$/.test(rawName);
    const name = rawName.replace(/[-_]+/g, ' ').replace(/([A-Za-z])(\d+)\s*$/, '$1 $2')
        .replace(/\b\w/g, letter => letter.toUpperCase());
    const number = Math.trunc(finite(section && section.number));
    return number > 0 && !hasAuthoredNumber ? `${name} ${number}` : name;
}

function sectionMarkers(sections, beats) {
    return (Array.isArray(sections) ? sections : []).map((section, index) => {
        const beat = Number.isFinite(Number(section && section.beat))
            ? Number(section.beat) : beatOf(beats, finite(section && section.start_time, NaN));
        return { beat, label: sectionLabel(section), index };
    }).filter(marker => Number.isFinite(marker.beat))
        .sort((left, right) => left.beat - right.beat || left.index - right.index);
}

function phraseMarkers(arrangement, beats) {
    return (Array.isArray(arrangement && arrangement.phrases) ? arrangement.phrases : [])
        .map(phrase => Number.isFinite(Number(phrase && phrase.beat))
            ? Number(phrase.beat) : beatOf(beats, finite(phrase && phrase.start_time, NaN)))
        .filter(Number.isFinite).sort((left, right) => left - right);
}

function sharedPhraseMarkers(primary, secondary, beats) {
    const left = phraseMarkers(primary, beats);
    const right = phraseMarkers(secondary, beats);
    const used = new Set();
    const shared = [];
    for (const primaryBeat of left) {
        let bestIndex = -1;
        let bestDelta = Infinity;
        for (let index = 0; index < right.length; index++) {
            if (used.has(index)) continue;
            const delta = Math.abs(timeOf(beats, primaryBeat) - timeOf(beats, right[index]));
            if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = index;
            }
        }
        if (bestIndex < 0
            || bestDelta > compositeTimingToleranceSeconds(beats, primaryBeat) + 1e-9) continue;
        used.add(bestIndex);
        shared.push((primaryBeat + right[bestIndex]) / 2);
    }
    return sortedUnique(shared);
}

function entryDecisionBeat(entry) {
    return finite(entry && entry.playableStartBeat, finite(entry && entry.startBeat));
}

function entryEffectiveEnd(entry) {
    return Math.max(finite(entry && entry.startBeat), finite(entry && entry.endBeat),
        finite(entry && entry.effectiveEndBeat), finite(entry && entry.playableEndBeat));
}

function sourceSetsOverlap(left, right) {
    return (compositeEntryHasSource(left, 'primary') && compositeEntryHasSource(right, 'primary'))
        || (compositeEntryHasSource(left, 'secondary') && compositeEntryHasSource(right, 'secondary'));
}

function contentRange(prepared, beats) {
    const entries = [...prepared.primaryEntries, ...prepared.secondaryEntries];
    const startBeat = Math.min(0, ...entries.map(entryDecisionBeat));
    const endBeat = Math.max(
        Array.isArray(beats) && beats.length > 1 ? beats.length - 1 : startBeat + 1,
        ...entries.map(entryEffectiveEnd),
    );
    return { startBeat, endBeat: Math.max(startBeat + 1, endBeat) };
}

function fallbackMeasureMarkers(startBeat, endBeat, anchor = 0) {
    const first = anchor + Math.floor((startBeat - anchor) / 4) * 4;
    const result = [];
    let measure = 1;
    for (let beat = first; beat <= endBeat + COMPOSITE_BEAT_EPS; beat += 4) {
        result.push({ beat, measure: measure++ });
    }
    return result;
}

function markerAt(markers, beat) {
    return markers.find(marker => near(marker.beat, beat));
}

function snapToMeasure(beat, measures, beats) {
    let nearest = null;
    let delta = Infinity;
    for (const marker of measures) {
        const candidate = Math.abs(timeOf(beats, marker.beat) - timeOf(beats, beat));
        if (candidate < delta) {
            delta = candidate;
            nearest = marker;
        }
    }
    return nearest && delta <= compositeTimingToleranceSeconds(beats, beat) + 1e-9
        ? nearest.beat : beat;
}

function latestMarker(markers, beat) {
    let latest = null;
    for (const marker of markers) {
        if (marker.beat <= beat + COMPOSITE_BEAT_EPS) latest = marker;
        else break;
    }
    return latest;
}

function buildBaseCells({ prepared, beats, sections, primary, secondary }) {
    const range = contentRange(prepared, beats);
    const authoredMeasures = measureMarkers(beats);
    const measures = authoredMeasures.length >= 2
        ? authoredMeasures
        : fallbackMeasureMarkers(range.startBeat, range.endBeat, authoredMeasures[0]?.beat || 0);
    const allSections = sectionMarkers(sections, beats).map(marker => ({
        ...marker,
        beat: snapToMeasure(marker.beat, measures, beats),
    }));
    const sectionPoints = allSections
        .filter(marker => marker.beat > range.startBeat + COMPOSITE_BEAT_EPS
            && marker.beat < range.endBeat - COMPOSITE_BEAT_EPS);
    const phrasePoints = sharedPhraseMarkers(primary, secondary, beats)
        .map(beat => snapToMeasure(beat, measures, beats))
        .filter(beat => beat > range.startBeat + COMPOSITE_BEAT_EPS
            && beat < range.endBeat - COMPOSITE_BEAT_EPS);
    const boundaries = sortedUnique([
        range.startBeat,
        range.endBeat,
        ...measures.map(marker => marker.beat)
            .filter(beat => beat > range.startBeat && beat < range.endBeat),
        ...sectionPoints.map(marker => marker.beat),
        ...phrasePoints,
    ]);
    const cells = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
        const startBeat = boundaries[index];
        const endBeat = boundaries[index + 1];
        if (endBeat <= startBeat + COMPOSITE_BEAT_EPS) continue;
        const measure = latestMarker(measures, startBeat);
        const measureIndex = Math.max(0, measures.findIndex(marker => marker === measure));
        const section = latestMarker(allSections, startBeat);
        cells.push({
            id: `cell:${cells.length + 1}`,
            index: cells.length,
            startBeat,
            endBeat,
            measure: measure ? measure.measure : measureIndex + 1,
            measureIndex,
            sectionName: section ? section.label : 'Song start',
            hardStart: !!markerAt(sectionPoints, startBeat),
            softStart: phrasePoints.some(beat => near(beat, startBeat)),
            barBoundary: !!markerAt(measures, startBeat),
            commonEntries: [],
            primaryEntries: [],
            secondaryEntries: [],
            forcedReview: false,
            transitionReview: false,
            kind: 'empty',
        });
    }
    return { cells, measures, range };
}

function cellForBeat(cells, beat) {
    let fallback = cells.at(-1) || null;
    for (const cell of cells) {
        if (beat < cell.startBeat - COMPOSITE_BEAT_EPS) return cell;
        if (beat < cell.endBeat - COMPOSITE_BEAT_EPS || near(beat, cell.startBeat)) return cell;
        fallback = cell;
    }
    return fallback;
}

function classifyCell(cell) {
    const common = cell.commonEntries.length;
    const primary = cell.primaryEntries.length;
    const secondary = cell.secondaryEntries.length;
    if (cell.forcedReview) return 'review';
    if (!common && !primary && !secondary) return 'empty';
    if (common && !primary && !secondary) return 'identical';
    if (!common && primary && !secondary) return 'primary-only';
    if (!common && !primary && secondary) return 'secondary-only';
    return 'review';
}

function populateCells(cells, prepared) {
    const cellByEntryId = new Map();
    for (const entry of prepared.primaryEntries) {
        const cell = cellForBeat(cells, entryDecisionBeat(entry));
        if (!cell) continue;
        if (compositeEntryHasSource(entry, 'secondary')) cell.commonEntries.push(entry);
        else cell.primaryEntries.push(entry);
        cellByEntryId.set(entry.id, cell);
    }
    for (const entry of prepared.uniqueSecondaryEntries) {
        const cell = cellForBeat(cells, entryDecisionBeat(entry));
        if (!cell) continue;
        cell.secondaryEntries.push(entry);
        cellByEntryId.set(entry.id, cell);
    }
    for (const cell of cells) cell.kind = classifyCell(cell);

    // Primary-only followed by secondary-only (or the reverse) is normally an
    // automatic handoff. If their complete gestures collide, promote the whole
    // intervening span to review instead of clipping a trail silently.
    const automaticEntries = [];
    for (const cell of cells) {
        automaticEntries.push(...cell.commonEntries);
        if (cell.kind === 'primary-only') automaticEntries.push(...cell.primaryEntries);
        if (cell.kind === 'secondary-only') automaticEntries.push(...cell.secondaryEntries);
    }
    for (let leftIndex = 0; leftIndex < automaticEntries.length; leftIndex++) {
        const left = automaticEntries[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < automaticEntries.length; rightIndex++) {
            const right = automaticEntries[rightIndex];
            if (left.string !== right.string || sourceSetsOverlap(left, right)) continue;
            if (!compositeCollisionReason(left, right, prepared.beats)) continue;
            const leftCell = cellByEntryId.get(left.id);
            const rightCell = cellByEntryId.get(right.id);
            if (!leftCell || !rightCell) continue;
            const from = Math.min(leftCell.index, rightCell.index);
            const to = Math.max(leftCell.index, rightCell.index);
            for (let index = from; index <= to; index++) {
                cells[index].forcedReview = true;
                cells[index].transitionReview = true;
            }
        }
    }
    for (const cell of cells) cell.kind = classifyCell(cell);
}

function measureRangeLabel(cells) {
    const first = cells[0];
    const last = cells.at(-1);
    if (first.measure === last.measure) return `Bar ${first.measure}`;
    return `Bars ${first.measure}–${last.measure}`;
}

function decisionBlock(cells, id, beats = []) {
    const primaryEntries = cells.flatMap(cell => cell.primaryEntries).sort(compareEntries);
    const secondaryEntries = cells.flatMap(cell => cell.secondaryEntries).sort(compareEntries);
    const rangeEndBeat = cells.at(-1).endBeat;
    const endBeat = Math.max(rangeEndBeat,
        ...primaryEntries.map(entryEffectiveEnd), ...secondaryEntries.map(entryEffectiveEnd));
    const hasNoteVariant = primaryEntries.some(primary => secondaryEntries.some(secondary =>
        compositeCollisionReason(primary, secondary, beats) === 'note-variant'));
    const reasons = cells.some(cell => cell.transitionReview)
        ? ['guided-choice', 'transition'] : ['guided-choice'];
    if (hasNoteVariant) reasons.push('note-variant');
    return {
        id,
        kind: 'guided-decision',
        startBeat: cells[0].startBeat,
        endBeat,
        rangeEndBeat,
        sectionName: cells[0].sectionName,
        measureLabel: measureRangeLabel(cells),
        label: `${cells[0].sectionName} · ${measureRangeLabel(cells)}`,
        primaryEntries,
        secondaryEntries,
        commonCount: cells.reduce((sum, cell) => sum + cell.commonEntries.length, 0),
        reasons,
        overlapSeconds: 0,
        resolution: null,
        selectedEntryIds: [],
        validationError: '',
        validationKind: '',
        repeatDetached: false,
        repeatAppliedFromId: '',
        cells,
        splitPoints: cells.slice(1).filter(cell => cell.barBoundary).map(cell => ({
            beat: cell.startBeat,
            label: `Split before bar ${cell.measure}`,
        })),
    };
}

function uniqueEntries(entries) {
    const unique = new Map();
    for (const entry of entries || []) unique.set(entry.id, entry);
    return [...unique.values()].sort(compareEntries);
}

// Repetition identity describes the choice the reviewer must make, not the
// complete material that will be emitted for an occurrence. Common entries
// are fixed regardless of Lead/Rhythm/Custom and deliberately stay out of the
// signature. They remain in plan.fixedEntries and are validated in the
// occurrence-specific result after a grouped choice is applied.
function repeatChoiceEntries(block, lane) {
    const laneEntries = lane === 'secondary'
        ? block.secondaryEntries || [] : block.primaryEntries || [];
    return uniqueEntries(laneEntries);
}

function entrySemanticKey(entry) {
    const target = entry.connectedTarget;
    return stable({
        string: entry.string,
        fret: entry.fret,
        technique: entry.techniqueSignature,
        connectedTarget: target ? {
            string: target.string,
            fret: target.fret,
            technique: target.techniqueSignature,
        } : null,
    });
}

function blockRepeatFingerprint(block) {
    // This is only a conservative bucket before the tempo-aware exact match.
    // Sort semantic keys as a multiset so imported attacks straddling a bar
    // boundary by a few milliseconds cannot change their fingerprint order.
    const semanticKeys = lane => repeatChoiceEntries(block, lane)
        .map(entrySemanticKey).sort();
    return stable({
        cells: (block.cells || []).map(cell => !!cell.barBoundary),
        primary: semanticKeys('primary'),
        secondary: semanticKeys('secondary'),
    });
}

function localBeatTolerance(beats, beat) {
    const seconds = Math.abs(timeOf(beats, beat + 0.5) - timeOf(beats, beat - 0.5));
    if (!Number.isFinite(seconds) || seconds <= 1e-9) return COMPOSITE_BEAT_EPS;
    return Math.max(COMPOSITE_BEAT_EPS,
        compositeTimingToleranceSeconds(beats, beat) / seconds);
}

function relativeTimingNear(leftValue, rightValue, leftBase, rightBase, beats) {
    const leftRelative = finite(leftValue) - leftBase;
    const rightRelative = finite(rightValue) - rightBase;
    const tolerance = Math.max(
        localBeatTolerance(beats, finite(leftValue)),
        localBeatTolerance(beats, finite(rightValue)),
    );
    return Math.abs(leftRelative - rightRelative) <= tolerance + COMPOSITE_BEAT_EPS;
}

function repeatEntriesEquivalent(left, right, leftBase, rightBase, beats) {
    if (!left || !right || entrySemanticKey(left) !== entrySemanticKey(right)) return false;
    for (const field of ['startBeat', 'endBeat', 'effectiveEndBeat', 'playableStartBeat', 'playableEndBeat']) {
        if (!relativeTimingNear(left[field], right[field], leftBase, rightBase, beats)) return false;
    }
    const leftTarget = left.connectedTarget;
    const rightTarget = right.connectedTarget;
    if (!!leftTarget !== !!rightTarget) return false;
    if (leftTarget && (!relativeTimingNear(leftTarget.startBeat, rightTarget.startBeat,
        leftBase, rightBase, beats)
        || !relativeTimingNear(leftTarget.endBeat, rightTarget.endBeat,
            leftBase, rightBase, beats))) return false;
    return true;
}

function matchRepeatEntryLists(leftEntries, rightEntries, leftBase, rightBase, beats) {
    if (leftEntries.length !== rightEntries.length) return false;
    const candidates = leftEntries.map(left => rightEntries
        .map((right, index) => ({
            index,
            distance: Math.abs((left.startBeat - leftBase) - (right.startBeat - rightBase)),
        }))
        .filter(({ index }) => repeatEntriesEquivalent(left, rightEntries[index],
            leftBase, rightBase, beats))
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .map(candidate => candidate.index));
    if (candidates.some(matches => matches.length === 0)) return false;

    // Tolerant timing can make two repeated attacks eligible for the same
    // target. Use an augmenting one-to-one match instead of relying on the
    // imported sort order, which may flip inside the tolerance window.
    const leftByRight = new Map();
    function assign(leftIndex, visited) {
        for (const rightIndex of candidates[leftIndex]) {
            if (visited.has(rightIndex)) continue;
            visited.add(rightIndex);
            const previousLeft = leftByRight.get(rightIndex);
            if (previousLeft === undefined || assign(previousLeft, visited)) {
                leftByRight.set(rightIndex, leftIndex);
                return true;
            }
        }
        return false;
    }
    for (let leftIndex = 0; leftIndex < leftEntries.length; leftIndex++) {
        if (!assign(leftIndex, new Set())) return false;
    }
    const rightByLeft = new Map();
    for (const [rightIndex, leftIndex] of leftByRight) rightByLeft.set(leftIndex, rightIndex);
    return leftEntries.map((left, leftIndex) => ({
        left,
        right: rightEntries[rightByLeft.get(leftIndex)],
    }));
}

function repeatBlocksEquivalent(left, right, beats) {
    if (!left || !right || left.repeatFingerprint !== right.repeatFingerprint) return false;
    if ((left.cells || []).length !== (right.cells || []).length) return false;
    for (let index = 0; index < left.cells.length; index++) {
        const leftCell = left.cells[index];
        const rightCell = right.cells[index];
        if (!relativeTimingNear(leftCell.startBeat, rightCell.startBeat,
            left.startBeat, right.startBeat, beats)
            || !relativeTimingNear(leftCell.endBeat, rightCell.endBeat,
                left.startBeat, right.startBeat, beats)) return false;
    }
    return !!matchRepeatEntryLists(repeatChoiceEntries(left, 'primary'),
        repeatChoiceEntries(right, 'primary'), left.startBeat, right.startBeat, beats)
        && !!matchRepeatEntryLists(repeatChoiceEntries(left, 'secondary'),
            repeatChoiceEntries(right, 'secondary'), left.startBeat, right.startBeat, beats);
}

export function refreshGuidedRepeatGroups(plan) {
    if (!plan || plan.strategy !== 'guided') return [];
    const matching = normalizeGuidedRepeatMode(plan.repeatMode) === GUIDED_REPEAT_MODE_MATCHING;
    const groups = [];
    for (const block of plan.conflicts || []) {
        block.repeatFingerprint = blockRepeatFingerprint(block);
        let group = null;
        if (matching && !block.repeatDetached) {
            group = groups.find(candidate => !candidate.detached
                && candidate.fingerprint === block.repeatFingerprint
                && repeatBlocksEquivalent(
                    plan.conflicts.find(item => item.id === candidate.representativeId),
                    block,
                    plan.beats,
                ));
        }
        if (!group) {
            group = {
                id: `repeat:${groups.length + 1}`,
                fingerprint: block.repeatFingerprint,
                representativeId: block.id,
                memberIds: [],
                detached: !!block.repeatDetached,
            };
            groups.push(group);
        }
        group.memberIds.push(block.id);
        block.repeatGroupId = group.id;
    }
    plan.repeatGroups = groups;
    const unresolvedGroups = groups.filter(group => group.memberIds.some(id => {
        const block = plan.conflicts.find(candidate => candidate.id === id);
        return block && !block.resolution;
    })).length;
    plan.stats.reviewDecisions = groups.length;
    plan.stats.repeatedOccurrences = Math.max(0, (plan.conflicts || []).length - groups.length);
    plan.stats.unresolvedReviewDecisions = unresolvedGroups;
    plan.stats.unresolvedConflicts = (plan.conflicts || []).filter(block => !block.resolution).length;
    return groups;
}

export function guidedReviewGroups(plan) {
    return plan && plan.strategy === 'guided'
        ? refreshGuidedRepeatGroups(plan) : [];
}

export function guidedRepeatGroupForBlock(plan, blockOrId) {
    if (!plan || plan.strategy !== 'guided') return null;
    const blockId = typeof blockOrId === 'string' ? blockOrId : blockOrId && blockOrId.id;
    refreshGuidedRepeatGroups(plan);
    return plan.repeatGroups.find(group => group.memberIds.includes(blockId)) || null;
}

function blocksForRepeatGroup(plan, group) {
    const ids = new Set(group && group.memberIds || []);
    return (plan.conflicts || []).filter(block => ids.has(block.id));
}

function mapCustomSelection(fromBlock, toBlock, selectedEntryIds, beats) {
    if (fromBlock === toBlock) return [...(selectedEntryIds || [])];
    const selected = new Set(selectedEntryIds || []);
    const mapped = [];
    for (const lane of ['primary', 'secondary']) {
        const pairs = matchRepeatEntryLists(repeatChoiceEntries(fromBlock, lane),
            repeatChoiceEntries(toBlock, lane), fromBlock.startBeat, toBlock.startBeat, beats);
        if (!pairs) return null;
        for (const pair of pairs) {
            if (selected.has(pair.left.id)) mapped.push(pair.right.id);
        }
    }
    return mapped;
}

export function resolveGuidedRepeatGroup(plan, blockId, resolution, selectedEntryIds = []) {
    const sourceBlock = plan && plan.conflicts && plan.conflicts.find(block => block.id === blockId);
    if (!sourceBlock || plan.strategy !== 'guided') {
        return { ok: false, error: 'Guided decision block not found.', applied: [], failed: [] };
    }
    const group = guidedRepeatGroupForBlock(plan, sourceBlock);
    const members = blocksForRepeatGroup(plan, group);
    for (const block of members) {
        clearCompositeConflictResolution(plan, block.id);
        block.repeatAppliedFromId = '';
    }
    const applied = [];
    const failed = [];
    for (const block of members) {
        const mappedIds = resolution === 'custom'
            ? mapCustomSelection(sourceBlock, block, selectedEntryIds, plan.beats)
            : selectedEntryIds;
        if (mappedIds === null) {
            block.validationKind = 'repetition';
            block.validationError = 'This occurrence no longer matches the repeated custom selection.';
            failed.push({ id: block.id, label: block.label, error: block.validationError });
            block.repeatDetached = true;
            continue;
        }
        const result = resolveCompositeConflict(plan, block.id, resolution, mappedIds);
        if (result.ok) {
            block.repeatAppliedFromId = block.id === sourceBlock.id ? '' : sourceBlock.id;
            applied.push({ id: block.id, label: block.label });
        } else {
            failed.push({ id: block.id, label: block.label, error: block.validationError || result.error });
            block.repeatDetached = true;
        }
    }
    plan.repeatNotice = {
        kind: failed.length ? 'partial' : 'applied',
        requested: members.length,
        applied: applied.length,
        failed,
    };
    refreshGuidedRepeatGroups(plan);
    return {
        ok: failed.length === 0,
        partial: applied.length > 0 && failed.length > 0,
        applied,
        failed,
        error: failed.length && !applied.length ? failed[0].error : '',
    };
}

export function clearGuidedRepeatGroup(plan, blockId) {
    const block = plan && plan.conflicts && plan.conflicts.find(candidate => candidate.id === blockId);
    if (!block || plan.strategy !== 'guided') return { ok: false, error: 'Guided decision block not found.' };
    const group = guidedRepeatGroupForBlock(plan, block);
    const members = blocksForRepeatGroup(plan, group);
    for (const member of members) {
        clearCompositeConflictResolution(plan, member.id);
        member.repeatAppliedFromId = '';
    }
    plan.repeatNotice = null;
    refreshGuidedRepeatGroups(plan);
    return { ok: true, cleared: members.map(member => member.id) };
}

export function detachGuidedRepeatOccurrence(plan, blockId) {
    const block = plan && plan.conflicts && plan.conflicts.find(candidate => candidate.id === blockId);
    if (!block || plan.strategy !== 'guided') return { ok: false, error: 'Guided decision block not found.' };
    const group = guidedRepeatGroupForBlock(plan, block);
    if (!group || group.memberIds.length < 2) {
        return { ok: false, error: 'This occurrence is already reviewed separately.' };
    }
    clearCompositeConflictResolution(plan, block.id);
    block.repeatDetached = true;
    block.repeatAppliedFromId = '';
    plan.repeatNotice = {
        kind: 'detached',
        requested: group.memberIds.length,
        applied: 0,
        failed: [],
        label: block.label,
    };
    refreshGuidedRepeatGroups(plan);
    return { ok: true, blockId: block.id };
}

function automaticRegions(cells) {
    const regions = [];
    for (const cell of cells.filter(candidate => candidate.kind !== 'review')) {
        const tail = regions.at(-1);
        if (tail && tail.kind === cell.kind && tail.sectionName === cell.sectionName
            && near(tail.endBeat, cell.startBeat)) {
            tail.endBeat = cell.endBeat;
            tail.cells.push(cell);
            tail.measureLabel = measureRangeLabel(tail.cells);
        } else {
            regions.push({
                id: `automatic:${regions.length + 1}`,
                kind: cell.kind,
                sectionName: cell.sectionName,
                startBeat: cell.startBeat,
                endBeat: cell.endBeat,
                cells: [cell],
                measureLabel: measureRangeLabel([cell]),
            });
        }
    }
    return regions;
}

function buildDecisionBlocks(cells, beats = []) {
    const blocks = [];
    let run = [];
    const flush = () => {
        if (!run.length) return;
        blocks.push(decisionBlock(run, `guided:${blocks.length + 1}`, beats));
        run = [];
    };
    for (const cell of cells) {
        if (cell.kind !== 'review') {
            flush();
            continue;
        }
        const first = run[0];
        const crossesLandmark = run.length && (cell.hardStart || cell.softStart);
        const exceedsFourBars = first
            && cell.measureIndex - first.measureIndex >= GUIDED_MAX_REVIEW_BARS;
        if (crossesLandmark || exceedsFourBars) flush();
        run.push(cell);
    }
    flush();
    return blocks;
}

function fixedEntriesForCells(cells) {
    const entries = [];
    for (const cell of cells) {
        entries.push(...cell.commonEntries);
        if (cell.kind === 'primary-only') entries.push(...cell.primaryEntries);
        if (cell.kind === 'secondary-only') entries.push(...cell.secondaryEntries);
    }
    return entries.sort(compareEntries);
}

export function analyzeGuidedComposite({
    primary, secondary, beats = [], sections = [], repeatMode = GUIDED_REPEAT_MODE_EVERY,
} = {}) {
    const prepared = prepareCompositeSources({ primary, secondary, beats });
    if (!prepared.ok) {
        return {
            ok: false,
            strategy: 'guided',
            compatibility: prepared.compatibility,
            fixedEntries: [],
            conflicts: [],
            stats: {},
        };
    }
    prepared.beats = beats;
    const { cells, range } = buildBaseCells({ prepared, beats, sections, primary, secondary });
    populateCells(cells, prepared);
    const conflicts = buildDecisionBlocks(cells, beats);
    const fixedEntries = fixedEntriesForCells(cells);
    const automatic = automaticRegions(cells);
    const plan = {
        ok: true,
        strategy: 'guided',
        repeatMode: normalizeGuidedRepeatMode(repeatMode),
        compatibility: prepared.compatibility,
        primary,
        secondary,
        beats,
        sections,
        sourceEntries: {
            primary: prepared.primaryEntries,
            secondary: prepared.secondaryEntries,
        },
        fixedEntries,
        conflicts,
        automaticRegions: automatic,
        guidedCells: cells,
        duplicates: prepared.duplicates,
        timingAdjustments: prepared.timingAdjustments,
        skippedEntries: [],
        timelineStartBeat: range.startBeat,
        timelineEndBeat: range.endBeat,
        nextGuidedBlockId: conflicts.length + 1,
        stats: {
            primaryNotes: prepared.primaryEntries.length,
            secondaryNotes: prepared.secondaryEntries.length,
            duplicatesRemoved: prepared.duplicates.length,
            timingAdjustments: prepared.timingAdjustments.length,
            secondaryAddedCleanly: fixedEntries.filter(entry => entry.source === 'secondary').length,
            secondarySkippedByStrategy: 0,
            conflictHunks: conflicts.length,
            decisionBlocks: conflicts.length,
            automaticRegions: automatic.length,
            automaticCells: cells.filter(cell => cell.kind !== 'review').length,
            unresolvedConflicts: conflicts.length,
        },
    };
    refreshGuidedRepeatGroups(plan);
    return plan;
}

function splitGuidedBlocks(plan, blocks, splitPoints, activeBlockId) {
    const replacements = new Map();
    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const point = splitPoints[index];
        const leftCells = block.cells.filter(cell => cell.startBeat < point.beat - COMPOSITE_BEAT_EPS);
        const rightCells = block.cells.filter(cell => cell.startBeat >= point.beat - COMPOSITE_BEAT_EPS);
        if (!leftCells.length || !rightCells.length) {
            return { ok: false, error: 'The split would create an empty block.' };
        }
        const left = decisionBlock(leftCells, `guided:${plan.nextGuidedBlockId++}`);
        const right = decisionBlock(rightCells, `guided:${plan.nextGuidedBlockId++}`);
        left.repeatDetached = !!block.repeatDetached;
        right.repeatDetached = !!block.repeatDetached;
        replacements.set(block.id, [left, right]);
    }
    plan.conflicts = plan.conflicts.flatMap(block => replacements.get(block.id) || [block]);
    plan.stats.decisionBlocks = plan.conflicts.length;
    plan.stats.conflictHunks = plan.conflicts.length;
    plan.stats.unresolvedConflicts = plan.conflicts.filter(candidate => !candidate.resolution).length;
    plan.repeatNotice = null;
    refreshGuidedRepeatGroups(plan);
    const activeBlocks = replacements.get(activeBlockId);
    const activeIndex = activeBlocks ? plan.conflicts.findIndex(block => block.id === activeBlocks[0].id) : 0;
    return {
        ok: true,
        index: activeIndex,
        blocks: activeBlocks || [],
        allBlocks: [...replacements.values()].flat(),
        replacedBlockIds: [...replacements.keys()],
    };
}

export function splitGuidedDecisionBlock(plan, blockId, splitBeat) {
    if (!plan || plan.strategy !== 'guided') return { ok: false, error: 'A Guided Hybrid plan is required.' };
    const block = plan.conflicts.find(candidate => candidate.id === blockId);
    if (!block) return { ok: false, error: 'Decision block not found.' };
    const point = (block.splitPoints || []).find(candidate => near(candidate.beat, finite(splitBeat, NaN)));
    if (!point) return { ok: false, error: 'That bar is not a valid split point.' };
    return splitGuidedBlocks(plan, [block], [point], block.id);
}

export function splitGuidedRepeatGroup(plan, blockId, splitBeat) {
    if (!plan || plan.strategy !== 'guided') return { ok: false, error: 'A Guided Hybrid plan is required.' };
    const block = plan.conflicts.find(candidate => candidate.id === blockId);
    if (!block) return { ok: false, error: 'Decision block not found.' };
    const activePoint = (block.splitPoints || []).find(candidate => near(candidate.beat, finite(splitBeat, NaN)));
    if (!activePoint) return { ok: false, error: 'That bar is not a valid split point.' };
    const relativeBeat = activePoint.beat - block.startBeat;
    const group = guidedRepeatGroupForBlock(plan, block);
    const members = blocksForRepeatGroup(plan, group);
    const points = members.map(member => (member.splitPoints || []).find(candidate => near(
        candidate.beat - member.startBeat,
        relativeBeat,
    )));
    if (points.some(point => !point)) {
        return { ok: false, error: 'Not every matching occurrence has that bar boundary.' };
    }
    return splitGuidedBlocks(plan, members, points, block.id);
}
