/* Composite conflict visualization.
 *
 * Converts a DOM-free merge plan into the three synchronized tab lanes used by
 * the resolver.  Keeping the view model and SVG generation pure makes the
 * musical alignment testable without alphaTab or a browser.
 */

const EPS = 1e-4;
const FALLBACK_CONTEXT_BEATS = 4;

const TECHNIQUE_LABELS = Object.freeze({
    hammer_on: 'Hammer-on',
    pull_off: 'Pull-off',
    palm_mute: 'Palm mute',
    fret_hand_mute: 'Fret-hand mute',
    mute: 'String mute',
    harmonic: 'Harmonic',
    harmonic_pinch: 'Pinch harmonic',
    accent: 'Accent',
    vibrato: 'Vibrato',
    tremolo: 'Tremolo',
    tap: 'Tap',
    slap: 'Slap',
    pluck: 'Pop',
    link_next: 'Linked note',
    ignore: 'Ignored',
    slide_to: 'Slide',
    slide_unpitch_to: 'Unpitched slide',
    bend: 'Bend',
    bend_values: 'Bend curve',
    bend_intent: 'Bend intent',
    pick_direction: 'Pick direction',
    fret_finger: 'Finger',
    scale_degree: 'Scale degree',
    strum_group: 'Strum group',
    hand: 'Hand',
});

const LANE_COLORS = Object.freeze({
    primary: Object.freeze({ main: '#38bdf8', soft: '#082f49', text: '#bae6fd' }),
    secondary: Object.freeze({ main: '#a78bfa', soft: '#2e1065', text: '#ddd6fe' }),
    result: Object.freeze({ main: '#34d399', soft: '#022c22', text: '#a7f3d0' }),
});

function finite(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function escapeMarkup(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function humanizeTechniqueKey(key) {
    return String(key || '').replace(/^_+/, '').replaceAll('_', ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function techniqueValueIsActive(value) {
    if (value === false || value === null || value === undefined || value === '') return false;
    if (typeof value === 'number') return value >= 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

export function compositeTechniqueLabels(note) {
    const techniques = note && note.techniques && typeof note.techniques === 'object'
        ? note.techniques : {};
    return Object.keys(techniques).sort().filter(key => techniqueValueIsActive(techniques[key]))
        .map(key => TECHNIQUE_LABELS[key] || humanizeTechniqueKey(key));
}

function uniqueEntries(entries) {
    const unique = new Map();
    for (const entry of entries || []) if (entry && entry.id) unique.set(entry.id, entry);
    return [...unique.values()].sort((a, b) => a.startBeat - b.startBeat
        || a.string - b.string || a.fret - b.fret || a.id.localeCompare(b.id));
}

function fallbackSourceEntries(plan, source) {
    const entries = (plan.fixedEntries || []).filter(entry => entry.source === source);
    for (const conflict of plan.conflicts || []) {
        entries.push(...(source === 'primary' ? conflict.primaryEntries : conflict.secondaryEntries));
    }
    if (source === 'primary') {
        for (const duplicate of plan.duplicates || []) if (duplicate.primary) entries.push(duplicate.primary);
    } else {
        for (const duplicate of plan.duplicates || []) if (duplicate.secondary) entries.push(duplicate.secondary);
        entries.push(...(plan.skippedEntries || []));
    }
    return uniqueEntries(entries);
}

function sourceEntries(plan, source) {
    const explicit = plan && plan.sourceEntries && plan.sourceEntries[source];
    return uniqueEntries(Array.isArray(explicit) ? explicit : fallbackSourceEntries(plan || {}, source));
}

function measureBoundaries(beats) {
    const boundaries = [];
    for (let index = 0; index < (beats || []).length; index++) {
        const measure = Number(beats[index] && beats[index].measure);
        if (Number.isFinite(measure) && measure >= 1) boundaries.push({ beat: index, measure });
    }
    return boundaries;
}

export function compositeConflictContextPure(beats, conflict, fallbackPadding = FALLBACK_CONTEXT_BEATS) {
    const start = finite(conflict && conflict.startBeat);
    const end = Math.max(start + EPS, finite(conflict && conflict.endBeat, start + EPS));
    const boundaries = measureBoundaries(beats);
    if (boundaries.length < 2) {
        return {
            startBeat: Math.max(0, start - fallbackPadding),
            endBeat: Math.max(end + fallbackPadding, start + 1),
            measureMarkers: [],
        };
    }

    let containingIndex = -1;
    for (let index = 0; index < boundaries.length; index++) {
        if (boundaries[index].beat <= start + EPS) containingIndex = index;
        else break;
    }
    const contextStartIndex = Math.max(0, containingIndex - 1);
    const contextStart = containingIndex >= 0
        ? boundaries[contextStartIndex].beat : Math.max(0, start - fallbackPadding);
    let firstAfterEnd = boundaries.findIndex(boundary => boundary.beat > end + EPS);
    if (firstAfterEnd < 0) firstAfterEnd = boundaries.length;
    const contextEndBoundary = boundaries[Math.min(boundaries.length - 1, firstAfterEnd + 1)];
    const lastBarLength = boundaries.length >= 2
        ? boundaries[boundaries.length - 1].beat - boundaries[boundaries.length - 2].beat
        : fallbackPadding;
    const contextEnd = contextEndBoundary
        ? contextEndBoundary.beat
        : Math.max(end + fallbackPadding, boundaries.at(-1).beat + Math.max(1, lastBarLength));
    return {
        startBeat: contextStart,
        endBeat: Math.max(contextEnd, contextStart + 1),
        measureMarkers: boundaries.filter(boundary => boundary.beat >= contextStart - EPS
            && boundary.beat <= contextEnd + EPS),
    };
}

function entryEnd(entry) {
    return Math.max(finite(entry && entry.startBeat), finite(entry && entry.endBeat),
        finite(entry && entry.effectiveEndBeat));
}

function entriesInContext(entries, context) {
    return (entries || []).filter(entry => entry.startBeat <= context.endBeat + EPS
        && entryEnd(entry) >= context.startBeat - EPS);
}

function resolvedResultEntries(plan, currentConflict, currentSelectionIds) {
    const entries = [...(plan.fixedEntries || [])];
    for (const conflict of plan.conflicts || []) {
        const selected = conflict === currentConflict && currentSelectionIds
            ? currentSelectionIds : conflict.selectedEntryIds;
        const ids = new Set(selected || []);
        entries.push(...[...(conflict.primaryEntries || []), ...(conflict.secondaryEntries || [])]
            .filter(entry => ids.has(entry.id)));
    }
    return uniqueEntries(entries);
}

function overlappingPair(conflict) {
    for (const primary of conflict.primaryEntries || []) {
        for (const secondary of conflict.secondaryEntries || []) {
            if (primary.string !== secondary.string) continue;
            if (Math.abs(primary.startBeat - secondary.startBeat) <= EPS
                || (primary.startBeat < entryEnd(secondary) - EPS
                    && secondary.startBeat < entryEnd(primary) - EPS)) {
                return { primary, secondary };
            }
        }
    }
    return { primary: conflict.primaryEntries && conflict.primaryEntries[0],
        secondary: conflict.secondaryEntries && conflict.secondaryEntries[0] };
}

function harmonyLabel(note) {
    if (!note || note._fn === undefined || note._fn === null) return 'None';
    if (typeof note._fn === 'string') return note._fn || 'None';
    try { return JSON.stringify(note._fn); } catch (_) { return 'Authored harmony'; }
}

function entryDuration(entry) {
    return Math.max(0, finite(entry && entry.endBeat) - finite(entry && entry.startBeat));
}

function propertyDifferences(conflict) {
    if (!(conflict.reasons || []).includes('note-variant')) return [];
    const pair = overlappingPair(conflict);
    if (!pair.primary || !pair.secondary) return [];
    const candidates = [
        ['Start beat', pair.primary.startBeat.toFixed(3), pair.secondary.startBeat.toFixed(3)],
        ['Sustain', `${entryDuration(pair.primary).toFixed(3)} beats`, `${entryDuration(pair.secondary).toFixed(3)} beats`],
        ['Techniques', compositeTechniqueLabels(pair.primary.note).join(', ') || 'None',
            compositeTechniqueLabels(pair.secondary.note).join(', ') || 'None'],
        ['Harmony', harmonyLabel(pair.primary.note), harmonyLabel(pair.secondary.note)],
    ];
    return candidates.filter(([, primary, secondary]) => primary !== secondary)
        .map(([property, primary, secondary]) => ({ property, primary, secondary }));
}

function conflictExplanation(conflict, names, stringCount) {
    const pair = overlappingPair(conflict);
    if (!pair.primary || !pair.secondary) return 'These source notes require a choice.';
    const displayString = Math.max(1, stringCount - pair.primary.string);
    if ((conflict.reasons || []).includes('same-string-overlap')) {
        return `String ${displayString} cannot play fret ${pair.primary.fret} from ${names.primary}`
            + ` and fret ${pair.secondary.fret} from ${names.secondary} at the same time, including their trails.`;
    }
    return `String ${displayString}, fret ${pair.primary.fret} starts in both tracks, but its sustain, technique, or harmony data differs.`;
}

function laneEntry(entry, conflictIds, selectedIds, selectable, invalid = false) {
    return {
        ...entry,
        techniques: compositeTechniqueLabels(entry.note),
        inConflict: conflictIds.has(entry.id),
        selected: selectedIds.has(entry.id),
        selectable: selectable && conflictIds.has(entry.id),
        invalid: invalid && conflictIds.has(entry.id),
    };
}

export function buildCompositeConflictViewModel({
    plan, conflictIndex = 0, primaryName = 'Primary', secondaryName = 'Secondary',
    customEntryIds = null,
} = {}) {
    if (!plan || !Array.isArray(plan.conflicts) || !plan.conflicts.length) return null;
    const index = Math.max(0, Math.min(Math.trunc(finite(conflictIndex)), plan.conflicts.length - 1));
    const conflict = plan.conflicts[index];
    const names = { primary: primaryName || 'Primary', secondary: secondaryName || 'Secondary' };
    const context = compositeConflictContextPure(plan.beats, conflict);
    const conflictEntries = [...(conflict.primaryEntries || []), ...(conflict.secondaryEntries || [])];
    const conflictIds = new Set(conflictEntries.map(entry => entry.id));
    const currentSelection = Array.isArray(customEntryIds) ? customEntryIds : conflict.selectedEntryIds;
    const selectedIds = new Set(currentSelection || []);
    const custom = Array.isArray(customEntryIds);
    const invalid = Boolean(conflict.validationError);
    const primary = entriesInContext(sourceEntries(plan, 'primary'), context)
        .map(entry => laneEntry(entry, conflictIds, selectedIds, custom));
    const secondary = entriesInContext(sourceEntries(plan, 'secondary'), context)
        .map(entry => laneEntry(entry, conflictIds, selectedIds, custom));
    const result = entriesInContext(resolvedResultEntries(plan, conflict,
        custom ? currentSelection : null), context)
        .map(entry => laneEntry(entry, conflictIds, selectedIds, false, invalid));
    const stringCount = Math.max(1, Math.trunc(finite(plan.compatibility && plan.compatibility.stringCount, 6)));
    return {
        conflict,
        conflictIndex: index,
        conflictCount: plan.conflicts.length,
        context,
        stringCount,
        names,
        custom,
        invalid,
        explanation: conflictExplanation(conflict, names, stringCount),
        differences: propertyDifferences(conflict),
        lanes: [
            { id: 'primary', label: names.primary, subtitle: 'Lead / primary source', entries: primary },
            { id: 'secondary', label: names.secondary, subtitle: 'Rhythm / secondary source', entries: secondary },
            { id: 'result', label: 'Merged result', subtitle: conflict.resolution || custom ? 'Current choice' : 'Choose a resolution', entries: result },
        ],
    };
}

function xForBeat(beat, context, plotLeft, plotWidth) {
    const span = Math.max(1, context.endBeat - context.startBeat);
    const ratio = Math.max(0, Math.min(1, (beat - context.startBeat) / span));
    return plotLeft + ratio * plotWidth;
}

function techniqueSummary(entry) {
    return entry.techniques.length ? entry.techniques.join(', ') : 'No techniques';
}

function techniqueBadgeSummary(entry) {
    if (!entry.inConflict || !entry.techniques.length) return '';
    const aliases = {
        'Hammer-on': 'HO', 'Pull-off': 'PO', 'Palm mute': 'PM',
        'Fret-hand mute': 'FM', 'String mute': 'X', Harmonic: 'H',
        'Pinch harmonic': 'PH', Accent: '>', Vibrato: 'VIB', Tremolo: 'TR',
        Tap: 'T', Slap: 'SL', Pop: 'POP', 'Linked note': 'LINK',
        Slide: 'GL', 'Unpitched slide': 'UG', Bend: 'B',
        'Bend curve': 'B', 'Bend intent': 'B',
    };
    const badges = [];
    for (const technique of entry.techniques) {
        const badge = aliases[technique] || technique.slice(0, 4).toUpperCase();
        if (!badges.includes(badge)) badges.push(badge);
    }
    const visible = badges.slice(0, 3);
    if (badges.length > visible.length) visible.push(`+${badges.length - visible.length}`);
    return visible.join(' · ');
}

function entryTitle(entry, stringCount) {
    const string = Math.max(1, stringCount - entry.string);
    const duration = Math.max(0, entry.endBeat - entry.startBeat).toFixed(3);
    return `String ${string}, fret ${entry.fret}, beat ${entry.startBeat.toFixed(3)}, ${duration} beat trail. ${techniqueSummary(entry)}.`;
}

function trailMarkup(entry, y, context, plotLeft, plotWidth, color) {
    const startX = xForBeat(entry.startBeat, context, plotLeft, plotWidth);
    const authoredEndX = xForBeat(Math.max(entry.startBeat, entry.endBeat), context, plotLeft, plotWidth);
    const effectiveEndX = xForBeat(entryEnd(entry), context, plotLeft, plotWidth);
    let markup = '';
    if (authoredEndX > startX + 2) {
        const dashed = entry.techniques.includes('Tremolo') ? ' stroke-dasharray="3 3"' : '';
        markup += `<line x1="${startX.toFixed(1)}" y1="${y}" x2="${authoredEndX.toFixed(1)}" y2="${y}" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity="0.68"${dashed}/>`;
    }
    if (effectiveEndX > authoredEndX + 2) {
        markup += `<line x1="${Math.max(startX, authoredEndX).toFixed(1)}" y1="${y}" x2="${effectiveEndX.toFixed(1)}" y2="${y}" stroke="${color}" stroke-width="3" stroke-dasharray="5 4" opacity="0.8"/>`;
    }
    return markup;
}

function noteMarkup(entry, lane, y, context, stringCount, plotLeft, plotWidth) {
    const colors = LANE_COLORS[lane.id];
    const x = xForBeat(entry.startBeat, context, plotLeft, plotWidth);
    const fret = String(entry.fret);
    const width = Math.max(20, 10 + fret.length * 8);
    const outline = entry.invalid ? '#f87171' : entry.selected && entry.inConflict ? '#f8fafc' : colors.main;
    const fill = entry.invalid ? '#7f1d1d' : colors.soft;
    const cursor = entry.selectable ? ' cursor="pointer"' : '';
    const interaction = entry.selectable
        ? ` data-composite-entry-id="${escapeMarkup(entry.id)}" tabindex="0" role="checkbox" aria-checked="${entry.selected}"` : '';
    const badge = techniqueBadgeSummary(entry);
    const tech = badge
        ? `<text x="${x.toFixed(1)}" y="${y - 12}" text-anchor="middle" fill="#fcd34d" font-size="8" font-weight="700">${escapeMarkup(badge)}</text>` : '';
    return `<g${interaction}${cursor}><title>${escapeMarkup(entryTitle(entry, stringCount))}</title>`
        + trailMarkup(entry, y, context, plotLeft, plotWidth, colors.main)
        + `<rect x="${(x - width / 2).toFixed(1)}" y="${y - 9}" width="${width}" height="18" rx="7" fill="${fill}" stroke="${outline}" stroke-width="${entry.selected && entry.inConflict ? 2.5 : 1.5}"/>`
        + `<text x="${x.toFixed(1)}" y="${y + 4}" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="700">${escapeMarkup(fret)}</text>`
        + (entry.selected && entry.inConflict ? `<circle cx="${(x + width / 2 - 1).toFixed(1)}" cy="${y - 8}" r="4" fill="#f8fafc"/><path d="M${(x + width / 2 - 3).toFixed(1)} ${y - 8}l1.5 1.5 3-3" fill="none" stroke="#065f46" stroke-width="1.5"/>` : '')
        + tech + '</g>';
}

export function renderCompositeConflictTabSvg(view) {
    if (!view) return '';
    const width = 1120;
    const plotLeft = 174;
    const plotWidth = width - plotLeft - 22;
    const stringGap = 20;
    const laneHeight = 58 + (view.stringCount - 1) * stringGap;
    const laneGap = 14;
    const top = 42;
    const height = top + view.lanes.length * laneHeight + (view.lanes.length - 1) * laneGap + 18;
    const conflictX = xForBeat(view.conflict.startBeat, view.context, plotLeft, plotWidth);
    const conflictEndX = xForBeat(view.conflict.endBeat, view.context, plotLeft, plotWidth);
    const conflictWidth = Math.max(8, conflictEndX - conflictX);
    const beatLines = [];
    for (let beat = Math.ceil(view.context.startBeat); beat <= Math.floor(view.context.endBeat); beat++) {
        const x = xForBeat(beat, view.context, plotLeft, plotWidth);
        beatLines.push(`<line x1="${x.toFixed(1)}" y1="24" x2="${x.toFixed(1)}" y2="${height - 8}" stroke="#334155" stroke-width="0.7" opacity="0.55"/>`);
    }
    const measureLines = (view.context.measureMarkers || []).map(marker => {
        const x = xForBeat(marker.beat, view.context, plotLeft, plotWidth);
        return `<line x1="${x.toFixed(1)}" y1="18" x2="${x.toFixed(1)}" y2="${height - 8}" stroke="#64748b" stroke-width="1.5" opacity="0.8"/>`
            + `<text x="${(x + 4).toFixed(1)}" y="15" fill="#94a3b8" font-size="10">Bar ${escapeMarkup(marker.measure)}</text>`;
    }).join('');
    const lanes = view.lanes.map((lane, laneIndex) => {
        const laneY = top + laneIndex * (laneHeight + laneGap);
        const colors = LANE_COLORS[lane.id];
        const strings = [];
        for (let row = 0; row < view.stringCount; row++) {
            const y = laneY + 34 + row * stringGap;
            strings.push(`<text x="${plotLeft - 12}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="9">${row + 1}</text>`
                + `<line x1="${plotLeft}" y1="${y}" x2="${plotLeft + plotWidth}" y2="${y}" stroke="#64748b" stroke-width="1" opacity="0.72"/>`);
        }
        const notes = lane.entries.map(entry => {
            const row = Math.max(0, Math.min(view.stringCount - 1, view.stringCount - 1 - entry.string));
            return noteMarkup(entry, lane, laneY + 34 + row * stringGap,
                view.context, view.stringCount, plotLeft, plotWidth);
        }).join('');
        const noChoice = lane.id === 'result' && !view.conflict.resolution && !view.custom
            ? `<text x="${(conflictX + conflictWidth / 2).toFixed(1)}" y="${laneY + 22}" text-anchor="middle" fill="#fca5a5" font-size="10">Choose a resolution</text>` : '';
        return `<g><rect x="8" y="${laneY}" width="${width - 16}" height="${laneHeight}" rx="10" fill="${colors.soft}" opacity="0.38" stroke="${colors.main}" stroke-opacity="0.38"/>`
            + `<rect x="${conflictX.toFixed(1)}" y="${laneY + 3}" width="${conflictWidth.toFixed(1)}" height="${laneHeight - 6}" rx="4" fill="#ef4444" opacity="0.14" stroke="#f87171" stroke-dasharray="4 3"/>`
            + `<text x="20" y="${laneY + 27}" fill="${colors.text}" font-size="13" font-weight="700">${escapeMarkup(lane.label)}</text>`
            + `<text x="20" y="${laneY + 44}" fill="#94a3b8" font-size="9">${escapeMarkup(lane.subtitle)}</text>`
            + strings.join('') + notes + noChoice + '</g>';
    }).join('');
    const aria = `Three aligned tablature lanes for conflict ${view.conflictIndex + 1} of ${view.conflictCount}. ${view.explanation}`;
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeMarkup(aria)}" style="min-width:46rem">`
        + `<rect width="${width}" height="${height}" rx="12" fill="#0f172a"/>`
        + beatLines.join('') + measureLines + lanes
        + `<path d="M${conflictX.toFixed(1)} 28v8M${conflictEndX.toFixed(1)} 28v8M${conflictX.toFixed(1)} 32H${conflictEndX.toFixed(1)}" stroke="#f87171" stroke-width="2"/>`
        + `<text x="${(conflictX + conflictWidth / 2).toFixed(1)}" y="27" text-anchor="middle" fill="#fca5a5" font-size="10" font-weight="700">CONFLICT</text>`
        + '</svg>';
}

export function renderCompositeDifferenceTable(view) {
    if (!view || !view.differences.length) return '';
    const rows = view.differences.map(difference => `<tr class="border-t border-gray-700/70">`
        + `<th class="text-left font-normal text-gray-400 py-1.5 pr-3">${escapeMarkup(difference.property)}</th>`
        + `<td class="text-sky-200 py-1.5 pr-3">${escapeMarkup(difference.primary)}</td>`
        + `<td class="text-violet-200 py-1.5">${escapeMarkup(difference.secondary)}</td></tr>`).join('');
    return `<div class="mt-3 overflow-x-auto"><table class="w-full text-[11px]"><thead><tr>`
        + `<th class="text-left text-gray-500 font-normal pb-1">Different property</th>`
        + `<th class="text-left text-sky-400 font-medium pb-1">${escapeMarkup(view.names.primary)}</th>`
        + `<th class="text-left text-violet-400 font-medium pb-1">${escapeMarkup(view.names.secondary)}</th>`
        + `</tr></thead><tbody>${rows}</tbody></table></div>`;
}
