/* Shared whole-song tablature timeline for the Hybrid Track builder.
 *
 * The final preview deliberately owns its geometry instead of borrowing the
 * stateful main Editor canvas. Every helper here is DOM-free: the controller
 * supplies the current scroll/viewport and replaces only the visible SVG
 * contents while the wide timeline surface keeps one shared scrollbar.
 */

import { beatOf } from '../beats.js';
import { compositeTechniqueLabels } from './conflict-view.js';
import {
    HYBRID_PREVIEW_DEFAULTS,
    HYBRID_TIMELINE_LANE_MAX,
    HYBRID_TIMELINE_LANE_MIN,
    HYBRID_TIMELINE_ZOOM_CONTROL_MIN,
    HYBRID_TIMELINE_ZOOM_MAX,
    HYBRID_TIMELINE_ZOOM_MIN,
    HYBRID_TIMELINE_ZOOM_STEP,
} from './preferences.js';

export const COMPOSITE_TIMELINE_GUTTER = 168;
export const COMPOSITE_TIMELINE_RULER_HEIGHT = 34;
// Display-only breathing room around the real musical range. This never adds
// beats or seconds: beat 0 remains beat 0, but its centered note head no longer
// sits underneath the sticky track labels. The same amount protects the final
// note/trail at the right edge.
export const COMPOSITE_TIMELINE_EDGE_PADDING = 28;
export const COMPOSITE_TIMELINE_STRIP_VIEWPORTS = 5;
// Five complete viewports are useful on ordinary displays, but scale to a
// wasteful 19,200 CSS pixels on a 4K window. Keep the renderer below a stable
// CSS-pixel budget while allowing an unusually wide viewport to cover itself.
export const COMPOSITE_TIMELINE_STRIP_MAX_WIDTH = 7680;
const RANGE_BUFFER_PX = 900;
const ENTRY_RANGE_INDEX = new WeakMap();
const OVERVIEW_WIDTH = 1000;

const TIMELINE_DETAIL_LEVELS = Object.freeze({
    density: Object.freeze({
        id: 'density', laneBeatStep: 0, rulerBeatStep: 0,
        staticNoteStyle: 'density',
    }),
    compact: Object.freeze({
        id: 'compact', laneBeatStep: 2, rulerBeatStep: 1,
        staticNoteStyle: 'fret',
    }),
    full: Object.freeze({
        id: 'full', laneBeatStep: 1, rulerBeatStep: 1,
        staticNoteStyle: 'full',
    }),
});

const COLORS = Object.freeze({
    primary: Object.freeze({ main: '#38bdf8', soft: '#082f49', text: '#bae6fd' }),
    secondary: Object.freeze({ main: '#a78bfa', soft: '#2e1065', text: '#ddd6fe' }),
    result: Object.freeze({ main: '#34d399', soft: '#022c22', text: '#a7f3d0' }),
});

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function escapeMarkup(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function entryEndBeat(entry) {
    const start = finite(entry && entry.startBeat);
    return Math.max(start, finite(entry && entry.endBeat, start),
        finite(entry && entry.effectiveEndBeat, start));
}

function uniqueSortedEntries(entries) {
    const unique = new Map();
    for (const entry of entries || []) if (entry && entry.id) unique.set(entry.id, entry);
    return [...unique.values()].sort((a, b) => finite(a.startBeat) - finite(b.startBeat)
        || finite(a.string) - finite(b.string) || finite(a.fret) - finite(b.fret)
        || String(a.id).localeCompare(String(b.id)));
}

function measureMarkers(beats, endBeat) {
    const markers = [];
    for (let index = 0; index < (beats || []).length && index <= endBeat + 1e-6; index++) {
        const measure = Number(beats[index] && beats[index].measure);
        if (Number.isFinite(measure) && measure >= 1) markers.push({ beat: index, measure });
    }
    return markers;
}

export function compositeTimelineZoomPure(value) {
    return Math.max(HYBRID_TIMELINE_ZOOM_MIN,
        Math.min(HYBRID_TIMELINE_ZOOM_MAX,
            finite(value, HYBRID_PREVIEW_DEFAULTS.timelineZoom)));
}

// Manual zoom controls live on a five-pixel grid. Fit-song is deliberately
// exempt so a long song can still shrink below the slider's useful floor.
export function compositeTimelineSteppedZoomPure(value, direction = 0) {
    const current = compositeTimelineZoomPure(value);
    if (direction > 0) {
        if (current < HYBRID_TIMELINE_ZOOM_CONTROL_MIN) {
            return HYBRID_TIMELINE_ZOOM_CONTROL_MIN;
        }
        return Math.min(HYBRID_TIMELINE_ZOOM_MAX,
            (Math.floor((current + 1e-6) / HYBRID_TIMELINE_ZOOM_STEP) + 1)
                * HYBRID_TIMELINE_ZOOM_STEP);
    }
    if (direction < 0) {
        if (current <= HYBRID_TIMELINE_ZOOM_CONTROL_MIN) return current;
        return Math.max(HYBRID_TIMELINE_ZOOM_CONTROL_MIN,
            (Math.ceil((current - 1e-6) / HYBRID_TIMELINE_ZOOM_STEP) - 1)
                * HYBRID_TIMELINE_ZOOM_STEP);
    }
    return Math.max(HYBRID_TIMELINE_ZOOM_CONTROL_MIN,
        Math.min(HYBRID_TIMELINE_ZOOM_MAX,
            Math.round(current / HYBRID_TIMELINE_ZOOM_STEP)
                * HYBRID_TIMELINE_ZOOM_STEP));
}

export function compositeTimelineLaneHeightPure(value) {
    return Math.max(HYBRID_TIMELINE_LANE_MIN,
        Math.min(HYBRID_TIMELINE_LANE_MAX, Math.round(finite(value, 158))));
}

// Rendering policy is intentionally based only on zoom, so the ruler and all
// three lanes always choose the same level. The normal 120 px/beat view keeps
// the existing complete notation; 60 px/beat removes decorative per-note SVG
// nodes, and very small whole-song views collapse static attacks into paths.
export function compositeTimelineDetailLevelPure(zoom) {
    const value = compositeTimelineZoomPure(zoom);
    if (value >= 90) return TIMELINE_DETAIL_LEVELS.full;
    if (value >= 24) return TIMELINE_DETAIL_LEVELS.compact;
    return TIMELINE_DETAIL_LEVELS.density;
}

export function compositeTimelineSongRangePure({ beats = [], durationSeconds = 0, entries = [] } = {}) {
    const lastGridBeat = Math.max(0, beats.length - 1);
    const durationBeat = Math.max(0, beatOf(beats, Math.max(0, finite(durationSeconds))));
    let endBeat = Math.max(1, lastGridBeat, durationBeat);
    for (const entry of entries || []) endBeat = Math.max(endBeat, entryEndBeat(entry));
    return { startBeat: 0, endBeat };
}

// The transport may legitimately sit before the first authored grid beat
// (Majesty starts beat zero a little after t=0) or just beyond the last beat
// while playback settles. The timeline still needs a visible marker in those
// states, so display geometry parks it on the nearest song edge.
export function compositeTimelineDisplayBeatPure(beat, context = {}) {
    const start = finite(context.startBeat);
    const end = Math.max(start, finite(context.endBeat, start));
    return Math.max(start, Math.min(end, finite(beat, start)));
}

export function buildCompositeTimelineViewModel({
    plan,
    primaryName = 'Base track',
    secondaryName = 'Fill track',
    resultEntries = [],
    durationSeconds = 0,
    review = null,
    passageFocusId = '',
} = {}) {
    if (!plan) return null;
    const primary = uniqueSortedEntries(plan.sourceEntries?.primary || []);
    const secondary = uniqueSortedEntries(plan.sourceEntries?.secondary || []);
    const result = uniqueSortedEntries(resultEntries);
    const hasFillAdditions = result.some(entry => entry.source === 'secondary'
        && !(entry.sources || []).includes('primary'));
    const all = [...primary, ...secondary, ...result];
    const context = compositeTimelineSongRangePure({
        beats: plan.beats || [], durationSeconds, entries: all,
    });
    context.measureMarkers = measureMarkers(plan.beats || [], context.endBeat);
    const stringCount = Math.max(1,
        Math.trunc(finite(plan.compatibility && plan.compatibility.stringCount, 6)));
    const decisions = (plan.conflicts || []).map((conflict, index) => ({
        id: conflict.id,
        index,
        startBeat: finite(conflict.startBeat),
        endBeat: Math.max(finite(conflict.startBeat), finite(conflict.endBeat)),
        state: conflict.validationError ? 'invalid' : conflict.resolution ? 'resolved' : 'unresolved',
        label: conflict.label || `Decision ${index + 1}`,
    }));
    const passages = (plan.passages || []).map((passage, index) => {
        const conflict = (plan.conflicts || []).find(candidate => candidate.id === passage.id);
        const selected = new Set(conflict?.selectedEntryIds || []);
        const selectedNotes = (passage.entries || []).filter(entry => selected.has(entry.id)).length;
        let state = passage.status;
        if (passage.status === 'review' && conflict?.resolution) {
            state = selectedNotes === 0 ? 'declined'
                : selectedNotes === passage.noteCount ? 'accepted' : 'accepted-partial';
        }
        return {
            id: passage.id,
            index,
            startBeat: finite(passage.startBeat),
            endBeat: Math.max(finite(passage.startBeat), finite(passage.endBeat)),
            state,
            label: passage.label || `Passage ${index + 1}`,
            explanation: passage.explanation || '',
            score: finite(passage.handoffScore),
            reasons: (passage.reasons || []).slice(),
            active: passage.id === passageFocusId,
        };
    });
    return {
        wholeSong: true,
        names: { primary: primaryName || 'Base track', secondary: secondaryName || 'Fill track' },
        context,
        conflict: { resolution: 'ready' },
        stringCount,
        beats: plan.beats || [],
        review,
        decisions,
        passages,
        passageFocus: passages.find(passage => passage.active) || null,
        hasFillAdditions,
        lanes: [
            { id: 'primary', label: primaryName || 'Base track', subtitle: 'Base track', entries: primary },
            { id: 'secondary', label: secondaryName || 'Fill track', subtitle: 'Fill track', entries: secondary },
            { id: 'result', label: 'Hybrid', subtitle: 'Hybrid result', entries: result },
        ],
    };
}

function timelineRenderSurface(context, zoom, {
    renderOriginX = 0,
    surfaceWidth,
} = {}) {
    const contentWidth = compositeTimelineContentWidthPure(context, zoom);
    const origin = Math.max(0, Math.min(Math.max(0, contentWidth - 1),
        finite(renderOriginX)));
    const remaining = Math.max(1, contentWidth - origin);
    const width = surfaceWidth == null
        ? remaining : Math.max(1, Math.min(remaining, finite(surfaceWidth, remaining)));
    return {
        contentWidth,
        renderOriginX: origin,
        surfaceWidth: width,
        localX(globalX) {
            return compositeTimelineGlobalToLocalXPure(globalX, origin);
        },
        xForBeat(beat) {
            return compositeTimelineGlobalToLocalXPure(
                compositeTimelineXForBeatPure(beat, context, zoom), origin);
        },
    };
}

function reviewBandMarkup(view, height, zoom, includeContextDimming = true,
    renderOptions = {}) {
    const review = view && view.review;
    if (!review) return '';
    const surface = timelineRenderSurface(view.context, zoom, renderOptions);
    const width = surface.surfaceWidth;
    const focusStart = surface.xForBeat(review.contextStartBeat);
    const focusEnd = surface.xForBeat(review.contextEndBeat);
    const decisionStart = surface.xForBeat(review.startBeat);
    const decisionEnd = surface.xForBeat(review.endBeat);
    const clippedDecisionStart = Math.max(0, Math.min(width, decisionStart));
    const clippedDecisionEnd = Math.max(0, Math.min(width,
        Math.max(decisionStart + 4, decisionEnd)));
    const dim = includeContextDimming
        ? `<rect x="0" y="0" width="${Math.max(0, Math.min(width, focusStart)).toFixed(1)}" height="${height}" fill="#020617" opacity="0.52" pointer-events="none"/>`
            + `<rect x="${Math.max(0, Math.min(width, focusEnd)).toFixed(1)}" y="0" width="${Math.max(0, width - Math.max(0, focusEnd)).toFixed(1)}" height="${height}" fill="#020617" opacity="0.52" pointer-events="none"/>`
        : '';
    const color = review.state === 'invalid' ? '#f87171'
        : review.state === 'resolved' ? '#34d399' : '#fbbf24';
    const decision = clippedDecisionEnd > clippedDecisionStart
        ? `<rect x="${clippedDecisionStart.toFixed(1)}" y="1" width="${(clippedDecisionEnd - clippedDecisionStart).toFixed(1)}" height="${Math.max(1, height - 2)}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>`
        : '';
    return dim + decision;
}

export function compositeTimelineXForBeatPure(beat, context, zoom) {
    return COMPOSITE_TIMELINE_GUTTER + COMPOSITE_TIMELINE_EDGE_PADDING
        + (finite(beat) - finite(context && context.startBeat)) * compositeTimelineZoomPure(zoom);
}

export function compositeTimelineMapBeatPure({
    clientX = 0, mapLeft = 0, mapWidth = 1, context = {},
} = {}) {
    const start = finite(context.startBeat);
    const end = Math.max(start, finite(context.endBeat, start));
    const ratio = Math.max(0, Math.min(1,
        (finite(clientX) - finite(mapLeft)) / Math.max(1, finite(mapWidth, 1))));
    return start + ratio * (end - start);
}

export function compositeTimelineCenteredScrollPure({
    beat = 0, context = {}, zoom = HYBRID_PREVIEW_DEFAULTS.timelineZoom,
    viewportWidth = 1200, gutter = COMPOSITE_TIMELINE_GUTTER,
} = {}) {
    const width = Math.max(1, finite(viewportWidth, 1200));
    const stickyGutter = Math.max(0, Math.min(width, finite(gutter)));
    const tablatureCenter = stickyGutter + (width - stickyGutter) / 2;
    return compositeTimelineXForBeatPure(beat, context, zoom) - tablatureCenter;
}

export function compositeTimelineBeatForXPure(x, context, zoom) {
    return finite(context && context.startBeat)
        + (finite(x) - COMPOSITE_TIMELINE_GUTTER
            - COMPOSITE_TIMELINE_EDGE_PADDING) / compositeTimelineZoomPure(zoom);
}

export function compositeTimelineContentWidthPure(context, zoom) {
    const span = Math.max(1, finite(context && context.endBeat, 1)
        - finite(context && context.startBeat));
    return Math.ceil(COMPOSITE_TIMELINE_GUTTER
        + COMPOSITE_TIMELINE_EDGE_PADDING * 2
        + span * compositeTimelineZoomPure(zoom));
}

// A bounded renderer still uses the song-wide x coordinates for scrolling and
// seeking, but paints into a small local SVG surface. Keeping these conversions
// explicit prevents camera code from accidentally mixing the two spaces.
export function compositeTimelineGlobalToLocalXPure(globalX, renderOriginX = 0) {
    return finite(globalX) - finite(renderOriginX);
}

export function compositeTimelineLocalToGlobalXPure(localX, renderOriginX = 0) {
    return finite(localX) + finite(renderOriginX);
}

export function compositeTimelineRenderOriginPure({
    visualScrollLeft = 0,
    viewportWidth = 1200,
    contentWidth = viewportWidth,
    surfaceWidth = viewportWidth,
} = {}) {
    const viewport = Math.max(1, finite(viewportWidth, 1200));
    const content = Math.max(viewport, finite(contentWidth, viewport));
    const surface = Math.max(viewport, Math.min(content,
        finite(surfaceWidth, viewport)));
    const maxScroll = Math.max(0, content - viewport);
    const scroll = Math.max(0, Math.min(maxScroll, finite(visualScrollLeft)));
    const maxOrigin = Math.max(0, content - surface);
    // Split the off-screen capacity evenly so playback can travel in either
    // direction before a standby strip is needed. Song edges clamp naturally.
    return Math.max(0, Math.min(maxOrigin,
        scroll - (surface - viewport) / 2));
}

export function compositeTimelineRenderRangePure({
    context = {},
    zoom = HYBRID_PREVIEW_DEFAULTS.timelineZoom,
    renderOriginX = 0,
    surfaceWidth = 1200,
} = {}) {
    const start = finite(context.startBeat);
    const end = Math.max(start, finite(context.endBeat, start));
    const origin = Math.max(0, finite(renderOriginX));
    const width = Math.max(1, finite(surfaceWidth, 1200));
    const startBeat = Math.max(start, Math.min(end,
        compositeTimelineBeatForXPure(origin, context, zoom)));
    const endBeat = Math.max(startBeat, Math.min(end,
        compositeTimelineBeatForXPure(origin + width, context, zoom)));
    return { startBeat, endBeat };
}

export function compositeTimelineStripGeometryPure({
    context = {},
    zoom = HYBRID_PREVIEW_DEFAULTS.timelineZoom,
    visualScrollLeft = 0,
    viewportWidth = 1200,
    stripViewports = COMPOSITE_TIMELINE_STRIP_VIEWPORTS,
    surfaceWidth: requestedSurfaceWidth,
} = {}) {
    const viewport = Math.max(1, finite(viewportWidth, 1200));
    const contentWidth = compositeTimelineContentWidthPure(context, zoom);
    const defaultSurfaceWidth = viewport
        * Math.max(1, finite(stripViewports, COMPOSITE_TIMELINE_STRIP_VIEWPORTS));
    const cappedSurfaceWidth = Math.min(COMPOSITE_TIMELINE_STRIP_MAX_WIDTH,
        finite(requestedSurfaceWidth, defaultSurfaceWidth));
    const surfaceWidth = Math.min(contentWidth, Math.max(viewport,
        cappedSurfaceWidth));
    const maxScroll = Math.max(0, contentWidth - viewport);
    const scrollLeft = Math.max(0, Math.min(maxScroll, finite(visualScrollLeft)));
    const renderOriginX = compositeTimelineRenderOriginPure({
        visualScrollLeft: scrollLeft,
        viewportWidth: viewport,
        contentWidth,
        surfaceWidth,
    });
    const renderRange = compositeTimelineRenderRangePure({
        context, zoom, renderOriginX, surfaceWidth,
    });
    return {
        contentWidth,
        maxScroll,
        visualScrollLeft: scrollLeft,
        renderOriginX,
        surfaceWidth,
        viewportLocalX: compositeTimelineGlobalToLocalXPure(scrollLeft, renderOriginX),
        globalEndX: renderOriginX + surfaceWidth,
        renderRange,
    };
}

export function compositeTimelineFitZoomPure(context, viewportWidth) {
    const span = Math.max(1, finite(context && context.endBeat, 1)
        - finite(context && context.startBeat));
    const usable = Math.max(1, finite(viewportWidth) - COMPOSITE_TIMELINE_GUTTER
        - COMPOSITE_TIMELINE_EDGE_PADDING * 2);
    return compositeTimelineZoomPure(usable / span);
}

export function compositeTimelineVisibleRangePure({
    context,
    zoom,
    scrollLeft = 0,
    viewportWidth = 1200,
    bufferPx = RANGE_BUFFER_PX,
} = {}) {
    const z = compositeTimelineZoomPure(zoom);
    const start = finite(context && context.startBeat);
    const end = Math.max(start + 1, finite(context && context.endBeat, start + 1));
    const loX = finite(scrollLeft) - Math.max(0, finite(bufferPx));
    const hiX = finite(scrollLeft) + Math.max(1, finite(viewportWidth)) + Math.max(0, finite(bufferPx));
    return {
        startBeat: Math.max(start, start + (loX - COMPOSITE_TIMELINE_GUTTER
            - COMPOSITE_TIMELINE_EDGE_PADDING) / z),
        endBeat: Math.min(end, start + (hiX - COMPOSITE_TIMELINE_GUTTER
            - COMPOSITE_TIMELINE_EDGE_PADDING) / z),
    };
}

export function compositeTimelineViewportRangePure({
    context,
    zoom,
    scrollLeft = 0,
    viewportWidth = 1200,
    gutter = COMPOSITE_TIMELINE_GUTTER,
} = {}) {
    const z = compositeTimelineZoomPure(zoom);
    const start = finite(context && context.startBeat);
    const end = Math.max(start + 1, finite(context && context.endBeat, start + 1));
    const width = Math.max(1, finite(viewportWidth, 1200));
    const stickyGutter = Math.max(0, Math.min(width, finite(gutter)));
    const visibleLeftX = finite(scrollLeft) + stickyGutter;
    const visibleRightX = finite(scrollLeft) + width;
    return {
        startBeat: Math.max(start, Math.min(end,
            start + (visibleLeftX - COMPOSITE_TIMELINE_GUTTER
                - COMPOSITE_TIMELINE_EDGE_PADDING) / z)),
        endBeat: Math.max(start, Math.min(end,
            start + (visibleRightX - COMPOSITE_TIMELINE_GUTTER
                - COMPOSITE_TIMELINE_EDGE_PADDING) / z)),
    };
}

// Follow keeps a floating visual camera on the compositor and only commits the
// browser's native scrollbar periodically. This offset moves each time-bearing
// SVG by the exact amount needed to make `visualScrollLeft` look like the real
// scroll position: screenX = contentX - native + (native - visual).
export function compositeTimelineCameraOffsetPure(nativeScrollLeft = 0,
    visualScrollLeft = nativeScrollLeft) {
    const native = finite(nativeScrollLeft);
    return native - finite(visualScrollLeft, native);
}

export function compositeTimelineCameraFramePure({
    beat = 0,
    context = {},
    zoom = HYBRID_PREVIEW_DEFAULTS.timelineZoom,
    viewportWidth = 1200,
    visualScrollLeft = 0,
    follow = false,
} = {}) {
    const width = Math.max(1, finite(viewportWidth, 1200));
    const contentX = compositeTimelineXForBeatPure(beat, context, zoom);
    const maxScroll = Math.max(0,
        compositeTimelineContentWidthPure(context, zoom) - width);
    const wantedScroll = follow
        ? compositeTimelineCenteredScrollPure({ beat, context, zoom, viewportWidth: width })
        : finite(visualScrollLeft);
    const scrollLeft = Math.max(0, Math.min(maxScroll, wantedScroll));
    return {
        contentX,
        visualScrollLeft: scrollLeft,
        screenX: contentX - scrollLeft,
        maxScroll,
    };
}

export function compositeTimelineRenderBufferPure(viewportWidth = 1200) {
    return Math.max(1800, Math.max(1, finite(viewportWidth, 1200)) * 2);
}

export function compositeTimelineRenderGuardPure(viewportWidth = 1200) {
    const viewport = Math.max(1, finite(viewportWidth, 1200));
    const surface = Math.max(viewport, Math.min(COMPOSITE_TIMELINE_STRIP_MAX_WIDTH,
        viewport * COMPOSITE_TIMELINE_STRIP_VIEWPORTS));
    const offscreenPerSide = Math.max(0, (surface - viewport) / 2);
    // Begin standby preparation after one quarter of the off-screen runway is
    // consumed. Clamp the historical 600 px minimum to the runway available on
    // tiny or capped surfaces so a guard can never be physically impossible.
    return Math.min(offscreenPerSide, Math.max(600, offscreenPerSide * 0.75));
}

// The notes are rendered with a generous buffer on either side. Reuse that
// markup until the visual viewport approaches an inner guard; rebuilding three
// dense SVG lanes for every pixel of movement stalls both paint and the shared
// audio scheduler. Song boundaries count as permanently protected edges so a
// viewport at beat zero does not invalidate its own cache forever.
export function compositeTimelineRenderWindowNeedsRefreshPure({
    context,
    zoom,
    renderedZoom,
    renderedRange,
    viewportRange,
    guardPx = 300,
    force = false,
} = {}) {
    if (force || !renderedRange || !viewportRange) return true;
    const z = compositeTimelineZoomPure(zoom);
    const previousZoom = Number(renderedZoom);
    if (Number.isFinite(previousZoom) && Math.abs(previousZoom - z) > 1e-6) return true;
    const start = finite(context && context.startBeat);
    const end = Math.max(start + 1, finite(context && context.endBeat, start + 1));
    const renderedStart = finite(renderedRange.startBeat, Number.NaN);
    const renderedEnd = finite(renderedRange.endBeat, Number.NaN);
    const visibleStart = finite(viewportRange.startBeat, Number.NaN);
    const visibleEnd = finite(viewportRange.endBeat, Number.NaN);
    if (![renderedStart, renderedEnd, visibleStart, visibleEnd].every(Number.isFinite)
            || renderedEnd < renderedStart || visibleEnd < visibleStart) return true;
    const guardBeats = Math.max(0, finite(guardPx)) / z;
    const leftProtected = renderedStart <= start + 1e-6
        || visibleStart >= renderedStart + guardBeats;
    const rightProtected = renderedEnd >= end - 1e-6
        || visibleEnd <= renderedEnd - guardBeats;
    return !leftProtected || !rightProtected;
}

export function compositeTimelineZoomAtPure({
    context,
    oldZoom,
    newZoom,
    scrollLeft = 0,
    anchorX = 0,
    viewportWidth = 1200,
} = {}) {
    const from = compositeTimelineZoomPure(oldZoom);
    const to = compositeTimelineZoomPure(newZoom);
    const start = finite(context && context.startBeat);
    const beat = start + (finite(scrollLeft) + finite(anchorX)
        - COMPOSITE_TIMELINE_GUTTER - COMPOSITE_TIMELINE_EDGE_PADDING) / from;
    const wanted = COMPOSITE_TIMELINE_GUTTER + COMPOSITE_TIMELINE_EDGE_PADDING
        + (beat - start) * to - finite(anchorX);
    const maxScroll = Math.max(0, compositeTimelineContentWidthPure(context, to)
        - Math.max(1, finite(viewportWidth)));
    return { zoom: to, scrollLeft: Math.max(0, Math.min(maxScroll, wanted)), anchorBeat: beat };
}

export function compositeTimelineEntriesInRangePure(entries, range) {
    const start = finite(range && range.startBeat);
    const end = Math.max(start, finite(range && range.endBeat, start));
    if (!Array.isArray(entries) || !entries.length) return [];
    let index = ENTRY_RANGE_INDEX.get(entries);
    if (!index || index.length !== entries.length
            || index.first !== entries[0] || index.last !== entries[entries.length - 1]) {
        const starts = new Float64Array(entries.length);
        const prefixMaxEnd = new Float64Array(entries.length);
        let maximumEnd = -Infinity;
        let sorted = true;
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
            const entryStart = finite(entries[entryIndex]?.startBeat);
            starts[entryIndex] = entryStart;
            if (entryIndex && entryStart < starts[entryIndex - 1]) sorted = false;
            maximumEnd = Math.max(maximumEnd, entryEndBeat(entries[entryIndex]));
            prefixMaxEnd[entryIndex] = maximumEnd;
        }
        index = {
            length: entries.length,
            first: entries[0],
            last: entries[entries.length - 1],
            starts,
            prefixMaxEnd,
            sorted,
        };
        ENTRY_RANGE_INDEX.set(entries, index);
    }
    const startWithTolerance = start - 1e-4;
    const endWithTolerance = end + 1e-4;
    if (!index.sorted) {
        return entries.filter(entry => finite(entry?.startBeat) <= endWithTolerance
            && entryEndBeat(entry) >= startWithTolerance);
    }
    // Entries are sorted by start beat. The monotonic prefix maximum keeps
    // long trails that began before the viewport without scanning every note
    // from the start of the song on each camera render.
    let lower = 0;
    let upper = entries.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (index.prefixMaxEnd[middle] < startWithTolerance) lower = middle + 1;
        else upper = middle;
    }
    const firstCandidate = lower;
    lower = 0;
    upper = entries.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (index.starts[middle] <= endWithTolerance) lower = middle + 1;
        else upper = middle;
    }
    const pastLastCandidate = lower;
    const visible = [];
    for (let entryIndex = firstCandidate; entryIndex < pastLastCandidate; entryIndex++) {
        const entry = entries[entryIndex];
        if (entryEndBeat(entry) >= startWithTolerance) visible.push(entry);
    }
    return visible;
}

function badgeSummary(techniqueLabels) {
    const aliases = {
        'Hammer-on': 'HO', 'Pull-off': 'PO', 'Palm mute': 'PM',
        'Fret-hand mute': 'FM', 'String mute': 'X', Harmonic: 'H',
        'Pinch harmonic': 'PH', Accent: '>', Vibrato: 'VIB', Tremolo: 'TR',
        Tap: 'T', Slap: 'SL', Pop: 'POP', 'Linked note': 'LINK',
        Slide: 'GL', 'Unpitched slide': 'UG', Bend: 'B',
        'Bend curve': 'B', 'Bend intent': 'B',
    };
    const badges = [];
    for (const technique of techniqueLabels || []) {
        const badge = aliases[technique] || technique.slice(0, 4).toUpperCase();
        if (!badges.includes(badge)) badges.push(badge);
    }
    const visible = badges.slice(0, 2);
    if (badges.length > visible.length) visible.push(`+${badges.length - visible.length}`);
    return visible.join(' · ');
}

function entryDisplayMetadata(entry, stringCount, {
    detailed = true,
    includeTechniques = true,
} = {}) {
    // Technique extraction walks nested authored data. Compute it once for all
    // title, badge, and trail decisions made while rendering this note.
    const techniqueLabels = includeTechniques
        ? compositeTechniqueLabels(entry && entry.note) : [];
    if (!detailed) {
        return {
            tremolo: techniqueLabels.includes('Tremolo'),
            badge: '',
            title: '',
        };
    }
    const string = Math.max(1, stringCount - Math.trunc(finite(entry && entry.string)));
    const trail = Math.max(0, finite(entry && entry.endBeat) - finite(entry && entry.startBeat));
    const techniques = techniqueLabels.join(', ') || 'No techniques';
    return {
        tremolo: techniqueLabels.includes('Tremolo'),
        badge: badgeSummary(techniqueLabels),
        title: `String ${string}, fret ${finite(entry && entry.fret)}, beat ${finite(entry && entry.startBeat).toFixed(3)}, ${trail.toFixed(3)} beat trail. ${techniques}.`,
    };
}

function entryNeedsFullTimelineDetail(view, entry, detail) {
    if (detail.id === 'full' || entry?.selectable || entry?.inConflict
            || entry?.selected || entry?.invalid) return true;
    const focus = view?.review || view?.passageFocus;
    if (!focus) return false;
    const start = finite(focus.startBeat);
    const end = Math.max(start, finite(focus.endBeat, start));
    return finite(entry?.startBeat) <= end + 1e-4
        && entryEndBeat(entry) >= start - 1e-4;
}

function lineMarkup(view, height, visibleRange, zoom, renderOptions = {}) {
    const lines = [];
    const surface = timelineRenderSurface(view.context, zoom, renderOptions);
    const detail = compositeTimelineDetailLevelPure(zoom);
    const markerBeats = new Set((view.context.measureMarkers || [])
        .map(marker => finite(marker.beat)));
    const firstBeat = Math.ceil(visibleRange.startBeat);
    const lastBeat = Math.floor(visibleRange.endBeat);
    for (let beat = firstBeat; beat <= lastBeat; beat++) {
        if (!detail.laneBeatStep || beat % detail.laneBeatStep
                || (detail.id !== 'full' && markerBeats.has(beat))) continue;
        const x = surface.xForBeat(beat);
        lines.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}" stroke="#334155" stroke-width="0.7" opacity="0.5"/>`);
    }
    for (const marker of view.context.measureMarkers || []) {
        if (marker.beat < visibleRange.startBeat - 1e-4 || marker.beat > visibleRange.endBeat + 1e-4) continue;
        const x = surface.xForBeat(marker.beat);
        lines.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}" stroke="#64748b" stroke-width="1.4" opacity="0.85"/>`);
    }
    return lines.join('');
}

export function renderCompositeTimelineLaneContents(view, laneId, height, visibleRange, zoom,
    renderOptions = {}) {
    const lane = view && view.lanes && view.lanes.find(candidate => candidate.id === laneId);
    if (!lane) return '';
    const laneHeight = compositeTimelineLaneHeightPure(height);
    const z = compositeTimelineZoomPure(zoom);
    const surface = timelineRenderSurface(view.context, z, renderOptions);
    const contentWidth = surface.surfaceWidth;
    const detail = compositeTimelineDetailLevelPure(z);
    const colors = COLORS[lane.id] || COLORS.result;
    const top = 28;
    const bottom = 22;
    const stringGap = view.stringCount > 1
        ? (laneHeight - top - bottom) / (view.stringCount - 1) : 0;
    const strings = [];
    for (let row = 0; row < view.stringCount; row++) {
        const y = top + row * stringGap;
        const startX = Math.max(0, Math.min(contentWidth,
            surface.localX(COMPOSITE_TIMELINE_GUTTER)));
        strings.push(`<line x1="${startX}" y1="${y.toFixed(1)}" x2="${contentWidth}" y2="${y.toFixed(1)}" stroke="#64748b" stroke-width="1" opacity="0.75"/>`);
    }
    const detailedNotes = [];
    const compactNotes = [];
    const densityHeads = [];
    const authoredTrails = [];
    const tremoloTrails = [];
    const effectiveTrails = [];
    for (const entry of compositeTimelineEntriesInRangePure(lane.entries, visibleRange)) {
        const row = Math.max(0, Math.min(view.stringCount - 1,
            view.stringCount - 1 - Math.trunc(finite(entry.string))));
        const y = top + row * stringGap;
        const x = surface.xForBeat(entry.startBeat);
        const authoredEndX = surface.xForBeat(
            Math.max(finite(entry.startBeat), finite(entry.endBeat)));
        const effectiveEndX = surface.xForBeat(entryEndBeat(entry));
        const fret = String(finite(entry.fret));
        const width = Math.max(20, 10 + fret.length * 8);
        const detailed = entryNeedsFullTimelineDetail(view, entry, detail);
        const metadata = entryDisplayMetadata(entry, view.stringCount, {
            detailed,
            includeTechniques: detailed || detail.id === 'compact',
        });
        if (!detailed) {
            if (authoredEndX > x + 2) {
                (metadata.tremolo ? tremoloTrails : authoredTrails)
                    .push(`M${x.toFixed(1)} ${y.toFixed(1)}H${authoredEndX.toFixed(1)}`);
            }
            if (effectiveEndX > authoredEndX + 2) {
                effectiveTrails.push(`M${Math.max(x, authoredEndX).toFixed(1)} ${y.toFixed(1)}H${effectiveEndX.toFixed(1)}`);
            }
            if (detail.staticNoteStyle === 'fret') {
                compactNotes.push(`<text x="${x.toFixed(1)}" data-composite-compact-note="true" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="${colors.main}" stroke="#0f172a" stroke-width="3" paint-order="stroke" font-size="10" font-weight="700">${escapeMarkup(fret)}</text>`);
            } else {
                densityHeads.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0.1`);
            }
            continue;
        }
        const badge = metadata.badge;
        const colorsForEntry = entry.invalid
            ? { main: '#f87171', soft: '#7f1d1d' } : colors;
        const outline = entry.selected && entry.inConflict ? '#f8fafc' : colorsForEntry.main;
        const interaction = entry.selectable
            ? ` data-composite-entry-id="${escapeMarkup(entry.id)}" tabindex="0" role="checkbox" aria-label="${escapeMarkup(metadata.title)}" aria-checked="${!!entry.selected}" style="cursor:pointer"`
            : '';
        let trails = '';
        if (authoredEndX > x + 2) {
            const tremolo = metadata.tremolo
                ? ' stroke-dasharray="3 3"' : '';
            trails += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${authoredEndX.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${colors.main}" stroke-width="5" stroke-linecap="round" opacity="0.68"${tremolo}/>`;
        }
        if (effectiveEndX > authoredEndX + 2) {
            trails += `<line x1="${Math.max(x, authoredEndX).toFixed(1)}" y1="${y.toFixed(1)}" x2="${effectiveEndX.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${colors.main}" stroke-width="3" stroke-dasharray="5 4" opacity="0.8"/>`;
        }
        detailedNotes.push(`<g${interaction}><title>${escapeMarkup(metadata.title)}</title>${trails}`
            + `<rect x="${(x - width / 2).toFixed(1)}" y="${(y - 9).toFixed(1)}" width="${width}" height="18" rx="7" fill="${colorsForEntry.soft}" stroke="${outline}" stroke-width="${entry.selected && entry.inConflict ? 2.5 : 1.5}"/>`
            + `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#f8fafc" font-size="11" font-weight="700">${escapeMarkup(fret)}</text>`
            + (entry.selected && entry.inConflict ? `<circle cx="${(x + width / 2 - 1).toFixed(1)}" cy="${(y - 8).toFixed(1)}" r="4" fill="#f8fafc"/><path d="M${(x + width / 2 - 3).toFixed(1)} ${(y - 8).toFixed(1)}l1.5 1.5 3-3" fill="none" stroke="#065f46" stroke-width="1.5"/>` : '')
            + (badge ? `<text x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" text-anchor="middle" fill="#fcd34d" font-size="8" font-weight="700">${escapeMarkup(badge)}</text>` : '')
            + '</g>');
    }
    const staticTrails = (authoredTrails.length
        ? `<path data-composite-static-trails="authored" d="${authoredTrails.join('')}" fill="none" stroke="${colors.main}" stroke-width="5" stroke-linecap="round" opacity="0.68"/>` : '')
        + (tremoloTrails.length
            ? `<path data-composite-static-trails="tremolo" d="${tremoloTrails.join('')}" fill="none" stroke="${colors.main}" stroke-width="5" stroke-linecap="round" stroke-dasharray="3 3" opacity="0.68"/>` : '')
        + (effectiveTrails.length
            ? `<path data-composite-static-trails="effective" d="${effectiveTrails.join('')}" fill="none" stroke="${colors.main}" stroke-width="3" stroke-dasharray="5 4" opacity="0.8"/>` : '');
    const density = densityHeads.length
        ? `<path data-composite-density-notes="true" d="${densityHeads.join('')}" fill="none" stroke="${colors.main}" stroke-width="5" stroke-linecap="round"/>` : '';
    return `<rect width="${contentWidth}" height="${laneHeight}" fill="#0f172a"/>`
        + `<rect x="0" y="0" width="${contentWidth}" height="${laneHeight}" fill="${colors.soft}" opacity="0.18"/>`
        + lineMarkup(view, laneHeight, visibleRange, z, renderOptions) + strings.join('')
        + staticTrails + density + compactNotes.join('') + detailedNotes.join('')
        + reviewBandMarkup(view, laneHeight, z, true, renderOptions);
}

export function renderCompositeTimelineRulerContents(view, visibleRange, zoom,
    renderOptions = {}) {
    const z = compositeTimelineZoomPure(zoom);
    const surface = timelineRenderSurface(view.context, z, renderOptions);
    const width = surface.surfaceWidth;
    const detail = compositeTimelineDetailLevelPure(z);
    const ticks = [];
    const markerByBeat = new Map((view.context.measureMarkers || [])
        .map(marker => [marker.beat, marker]));
    let lastBarLabelX = -Infinity;
    for (let beat = Math.ceil(visibleRange.startBeat); beat <= Math.floor(visibleRange.endBeat); beat++) {
        const x = surface.xForBeat(beat);
        const marker = markerByBeat.get(beat);
        // At whole-song fit zoom, individual beat ticks and every bar label
        // become a dark picket fence. Keep all bar boundaries, then restore
        // beat ticks and denser labels progressively as the user zooms in.
        const showBeatTick = detail.rulerBeatStep
            && beat % detail.rulerBeatStep === 0;
        if (marker || showBeatTick) ticks.push(`<line x1="${x.toFixed(1)}" y1="${marker ? 12 : 22}" x2="${x.toFixed(1)}" y2="34" stroke="${marker ? '#94a3b8' : '#475569'}" stroke-width="${marker ? 1.5 : 1}"/>`);
        if (marker && x - lastBarLabelX >= (z >= 18 ? 0 : 44)) {
            ticks.push(`<text x="${(x + 4).toFixed(1)}" y="11" fill="#cbd5e1" font-size="10">Bar ${escapeMarkup(marker.measure)}</text>`);
            lastBarLabelX = x;
        }
        else if (detail.id === 'full') ticks.push(`<text x="${(x + 3).toFixed(1)}" y="20" fill="#64748b" font-size="8">${beat + 1}</text>`);
    }
    return `<rect width="${width}" height="34" fill="#111827"/>${ticks.join('')}`
        + reviewBandMarkup(view, 34, z, false, renderOptions)
        + (view.review ? `<text x="${(surface.xForBeat(view.review.startBeat) + 5).toFixed(1)}" y="29" fill="#fef3c7" font-size="9" font-weight="700">REVIEW</text>` : '');
}

export function renderCompositeTimelineLaneHeader(view, laneId, height, { fixed = false } = {}) {
    const lane = view.lanes.find(candidate => candidate.id === laneId);
    const laneHeight = compositeTimelineLaneHeightPure(height);
    const colors = COLORS[laneId] || COLORS.result;
    const selected = Boolean(view.review && view.selectedLaneId === laneId);
    const top = 28;
    const bottom = 22;
    const gap = view.stringCount > 1 ? (laneHeight - top - bottom) / (view.stringCount - 1) : 0;
    const strings = Array.from({ length: view.stringCount }, (_, row) => {
        const y = top + row * gap;
        return `<span class="absolute right-2 text-[10px] text-slate-400" style="top:${(y - 7).toFixed(1)}px">${row + 1}</span>`;
    }).join('');
    const selectedStyle = selected
        ? `;box-shadow:inset 4px 0 0 ${colors.main},0 0 0 1px ${colors.main};background:${colors.soft}` : '';
    const selectedLabel = selected ? ', selected for this decision' : '';
    const positionClass = fixed ? 'relative' : 'sticky left-0';
    return `<div data-composite-timeline-header="${laneId}" data-composite-choice-active="${selected}" aria-label="${escapeMarkup(`${lane.label}${selectedLabel}`)}" class="${positionClass} z-50 border-r border-slate-600/80 px-3 py-2 shadow-lg" style="width:${COMPOSITE_TIMELINE_GUTTER}px;height:${laneHeight}px;background:#111827${selectedStyle}">`
        + `<b class="block truncate text-sm" style="color:${colors.text}" title="${escapeMarkup(lane.label)}">${escapeMarkup(lane.label)}</b>`
        + `<span class="block pr-5 text-xs leading-snug text-slate-400" title="${escapeMarkup(lane.subtitle)}">${escapeMarkup(lane.subtitle)}</span>`
        + (selected ? `<span class="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold" style="color:${colors.text};background:${colors.soft};border:1px solid ${colors.main}">Selected</span>` : '')
        + strings + '</div>';
}

export function renderCompositeTimelinePlayhead(left = COMPOSITE_TIMELINE_GUTTER
    + COMPOSITE_TIMELINE_EDGE_PADDING) {
    const x = finite(left, COMPOSITE_TIMELINE_GUTTER
        + COMPOSITE_TIMELINE_EDGE_PADDING);
    // Keep all essential geometry and color inline. The Editor consumes the
    // Nightly precompiled Tailwind sheet, which may not contain newly added
    // utility classes until a later core build.
    return `<div id="editor-composite-timeline-playhead" aria-hidden="true" class="pointer-events-none absolute top-0 z-40" style="left:0;transform:translate3d(${x}px,0,0);will-change:transform;height:100%;width:2px;background:#fb7185;box-shadow:0 0 6px #fb7185"><span style="position:absolute;left:-5px;top:0;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #fb7185"></span></div>`;
}

export function compositeTimelineMapViewportPure(view, viewportRange) {
    const width = 1000;
    const start = finite(view?.context?.startBeat);
    const end = Math.max(start + 1, finite(view?.context?.endBeat, start + 1));
    const span = end - start;
    const toX = beat => ((finite(beat) - start) / span) * width;
    const lo = Math.max(0, Math.min(width, toX(viewportRange?.startBeat ?? start)));
    const hi = Math.max(lo + 4, Math.min(width, toX(viewportRange?.endBeat ?? end)));
    return { x: lo, width: Math.max(4, hi - lo) };
}

function compositeTimelineOverviewDensityMarkup(entries, toX, {
    width = OVERVIEW_WIDTH,
    y = 17,
    height = 9,
    fill = '#34d399',
    include = () => true,
} = {}) {
    // One difference-array update per note and at most `width` output bins.
    // The overview therefore represents every note in arbitrarily large songs
    // without creating one SVG node per note or silently truncating the tail.
    const difference = new Int32Array(width + 1);
    for (const entry of entries || []) {
        if (!include(entry)) continue;
        const rawStart = Math.max(0, Math.min(width, toX(entry.startBeat)));
        const rawEnd = Math.max(rawStart, Math.min(width, toX(entryEndBeat(entry))));
        const first = Math.max(0, Math.min(width - 1, Math.floor(rawStart)));
        const last = Math.max(first, Math.min(width - 1,
            Math.max(Math.floor(rawStart), Math.ceil(rawEnd) - 1)));
        difference[first] += 1;
        difference[last + 1] -= 1;
    }
    const runs = [];
    let active = 0;
    let runStart = -1;
    let runOpacity = 0;
    const flush = end => {
        if (runStart < 0) return;
        runs.push(`<rect data-composite-map-density="true" x="${runStart.toFixed(1)}" y="${y}" width="${Math.max(1, end - runStart).toFixed(1)}" height="${height}" rx="1" fill="${fill}" opacity="${runOpacity.toFixed(2)}"/>`);
        runStart = -1;
    };
    for (let bin = 0; bin < width; bin++) {
        active += difference[bin];
        // Quantising density lets adjacent pixels collapse into bounded runs
        // while still making stacked chords/passages visibly stronger.
        const opacity = active > 0
            ? Math.min(0.88, 0.52 + Math.floor(Math.log2(active + 1)) * 0.09) : 0;
        if (opacity !== runOpacity) {
            flush(bin);
            runOpacity = opacity;
            if (opacity) runStart = bin;
        } else if (opacity && runStart < 0) runStart = bin;
    }
    flush(width);
    return runs.join('');
}

export function renderCompositeTimelineMapSvg(view, _viewportRange, _playheadBeat = 0) {
    const width = OVERVIEW_WIDTH;
    const height = 42;
    const span = Math.max(1, view.context.endBeat - view.context.startBeat);
    const x = beat => ((finite(beat) - view.context.startBeat) / span) * width;
    const result = view.lanes.find(lane => lane.id === 'result');
    const resultEntries = result?.entries || [];
    const fillAddition = entry => entry.source === 'secondary'
        && !(entry.sources || []).includes('primary');
    const entries = compositeTimelineOverviewDensityMarkup(resultEntries, x, {
        width, fill: '#34d399', include: entry => !fillAddition(entry),
    }) + compositeTimelineOverviewDensityMarkup(resultEntries, x, {
        width, fill: '#c084fc', include: fillAddition,
    });
    const decisions = (view.decisions || []).map(decision => {
        const x1 = Math.max(0, Math.min(width, x(decision.startBeat)));
        const x2 = Math.max(x1 + 2, Math.min(width, x(decision.endBeat)));
        const color = decision.state === 'invalid' ? '#f87171'
            : decision.state === 'resolved' ? '#34d399' : '#fbbf24';
        const active = view.review && view.review.id === decision.id;
        return `<rect data-composite-map-decision="${decision.index}" x="${x1.toFixed(1)}" y="5" width="${Math.max(2, x2 - x1).toFixed(1)}" height="8" rx="2" fill="${color}" opacity="${active ? 1 : 0.72}"/>`;
    }).join('');
    const passageColors = {
        automatic: '#c084fc', review: '#fbbf24', accepted: '#34d399',
        'accepted-partial': '#2dd4bf', declined: '#64748b', 'left-out': '#475569',
    };
    const passages = (view.passages || []).map(passage => {
        const x1 = Math.max(0, Math.min(width, x(passage.startBeat)));
        const x2 = Math.max(x1 + 2, Math.min(width, x(passage.endBeat)));
        return `<rect data-composite-map-passage="${escapeMarkup(passage.id)}" x="${x1.toFixed(1)}" y="31" width="${Math.max(2, x2 - x1).toFixed(1)}" height="7" rx="2" fill="${passageColors[passage.state] || '#64748b'}" opacity="${passage.active ? 1 : 0.76}"${passage.active ? ' stroke="#f8fafc" stroke-width="1.5"' : ''}><title>${escapeMarkup(`${passage.label}: ${passage.state}`)}</title></rect>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" width="100%" height="42" role="img" aria-label="Whole-song Hybrid overview" style="display:block">`
        + `<rect width="${width}" height="${height}" rx="7" fill="#0f172a"/>${entries}${decisions}${passages}`
        + '</svg>';
}
