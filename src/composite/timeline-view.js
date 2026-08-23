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
const SOURCE_ENTRY_PREPROCESSING = new WeakMap();
const ENTRY_TECHNIQUE_METADATA = new WeakMap();
const OVERVIEW_WIDTH = 1000;
export const COMPOSITE_TIMELINE_OVERVIEW_INTERVAL_LIMIT = 512;
const OVERVIEW_INTERVAL_INDEX_TYPE = 'composite-timeline-overview-interval-index';

const OVERVIEW_MARKER_STATES = Object.freeze({
    decision: new Set(['invalid', 'resolved', 'unresolved']),
});

const TIMELINE_DETAIL_LEVELS = Object.freeze({
    density: Object.freeze({
        id: 'density', laneBeatStep: 0, rulerBeatStep: 0,
    }),
    compact: Object.freeze({
        id: 'compact', laneBeatStep: 2, rulerBeatStep: 1,
    }),
    full: Object.freeze({
        id: 'full', laneBeatStep: 1, rulerBeatStep: 1,
    }),
});

const TIMELINE_NOTE_GLYPH = Object.freeze({
    minWidth: 20,
    digitWidth: 8,
    horizontalPadding: 10,
    height: 18,
    radius: 7,
    fretFontSize: 11,
    badgeFontSize: 8,
    outlineWidth: 1.5,
    selectedOutlineWidth: 2.5,
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

function immutableSourceEntries(entries) {
    if (!Array.isArray(entries)) return uniqueSortedEntries(entries);
    const cached = SOURCE_ENTRY_PREPROCESSING.get(entries);
    if (cached) return cached;
    // Analysis owns sourceEntries and replaces an entire array when source
    // material changes; resolution changes never mutate these arrays. Retain
    // their deduplicated/sorted projection by identity so repeated review-view
    // builds can also reuse downstream range indexes. Callers treat the cached
    // projection as read-only. Mutable resultEntries deliberately stay on the
    // uncached uniqueSortedEntries path below.
    const prepared = uniqueSortedEntries(entries);
    SOURCE_ENTRY_PREPROCESSING.set(entries, prepared);
    return prepared;
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

// Zoom changes the amount of ruler/grid chrome, never the appearance of a
// musical note. Static note heads use a batched renderer below, so the same
// fixed-size notation remains affordable at compact zooms.
export function compositeTimelineDetailLevelPure(zoom) {
    const value = compositeTimelineZoomPure(zoom);
    if (value >= 90) return TIMELINE_DETAIL_LEVELS.full;
    if (value >= 24) return TIMELINE_DETAIL_LEVELS.compact;
    return TIMELINE_DETAIL_LEVELS.density;
}

export function compositeTimelineNoteGlyphMetricsPure(fret) {
    const label = String(finite(fret));
    return {
        label,
        width: Math.max(TIMELINE_NOTE_GLYPH.minWidth,
            TIMELINE_NOTE_GLYPH.horizontalPadding
                + label.length * TIMELINE_NOTE_GLYPH.digitWidth),
        height: TIMELINE_NOTE_GLYPH.height,
        radius: TIMELINE_NOTE_GLYPH.radius,
        fretFontSize: TIMELINE_NOTE_GLYPH.fretFontSize,
        badgeFontSize: TIMELINE_NOTE_GLYPH.badgeFontSize,
        outlineWidth: TIMELINE_NOTE_GLYPH.outlineWidth,
        selectedOutlineWidth: TIMELINE_NOTE_GLYPH.selectedOutlineWidth,
    };
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
    resultEntriesPrepared = false,
    durationSeconds = 0,
    review = null,
} = {}) {
    if (!plan) return null;
    const primary = immutableSourceEntries(plan.sourceEntries?.primary);
    const secondary = immutableSourceEntries(plan.sourceEntries?.secondary);
    // `compositeResolvedEntries()` already returns a unique, sorted immutable
    // revision snapshot. Renderer controllers can pass that fact through and
    // retain its identity; ad-hoc/mutable callers keep the defensive default.
    const result = resultEntriesPrepared && Array.isArray(resultEntries)
        ? resultEntries : uniqueSortedEntries(resultEntries);
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
    return {
        wholeSong: true,
        names: { primary: primaryName || 'Base track', secondary: secondaryName || 'Fill track' },
        context,
        conflict: { resolution: 'ready' },
        stringCount,
        beats: plan.beats || [],
        review,
        decisions,
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

function entryTechniqueMetadata(entry) {
    const note = entry && entry.note;
    if (note && typeof note === 'object') {
        const cached = ENTRY_TECHNIQUE_METADATA.get(note);
        if (cached) return cached;
        const techniqueLabels = compositeTechniqueLabels(note);
        const metadata = {
            techniqueLabels,
            tremolo: techniqueLabels.includes('Tremolo'),
            badge: badgeSummary(techniqueLabels),
        };
        ENTRY_TECHNIQUE_METADATA.set(note, metadata);
        return metadata;
    }
    const techniqueLabels = compositeTechniqueLabels(note);
    return {
        techniqueLabels,
        tremolo: techniqueLabels.includes('Tremolo'),
        badge: badgeSummary(techniqueLabels),
    };
}

function entryDisplayMetadata(entry, stringCount, {
    detailed = true,
    includeTechniques = true,
} = {}) {
    // Technique extraction walks nested authored data. Compute it once for all
    // title, badge, and trail decisions made while rendering this note.
    const technique = includeTechniques
        ? entryTechniqueMetadata(entry)
        : { techniqueLabels: [], tremolo: false, badge: '' };
    const { techniqueLabels, tremolo, badge } = technique;
    if (!detailed) return { tremolo, badge, title: '' };
    const string = Math.max(1, stringCount - Math.trunc(finite(entry && entry.string)));
    const trail = Math.max(0, finite(entry && entry.endBeat) - finite(entry && entry.startBeat));
    const techniques = techniqueLabels.join(', ') || 'No techniques';
    return {
        tremolo,
        badge,
        title: `String ${string}, fret ${finite(entry && entry.fret)}, beat ${finite(entry && entry.startBeat).toFixed(3)}, ${trail.toFixed(3)} beat trail. ${techniques}.`,
    };
}

function entryNeedsDetailedTimelineMarkup(view, entry) {
    if (entry?.selectable || entry?.inConflict
            || entry?.selected || entry?.invalid) return true;
    const focus = view?.review;
    if (!focus) return false;
    const start = finite(focus.startBeat);
    const end = Math.max(start, finite(focus.endBeat, start));
    return finite(entry?.startBeat) <= end + 1e-4
        && entryEndBeat(entry) >= start - 1e-4;
}

function roundedTimelineNoteHeadPath(x, y, metrics) {
    const halfWidth = metrics.width / 2;
    const halfHeight = metrics.height / 2;
    const left = x - halfWidth;
    const right = x + halfWidth;
    const top = y - halfHeight;
    const bottom = y + halfHeight;
    const radius = Math.min(metrics.radius, halfWidth, halfHeight);
    return `M${(left + radius).toFixed(1)} ${top.toFixed(1)}`
        + `H${(right - radius).toFixed(1)}`
        + `A${radius} ${radius} 0 0 1 ${right.toFixed(1)} ${(top + radius).toFixed(1)}`
        + `V${(bottom - radius).toFixed(1)}`
        + `A${radius} ${radius} 0 0 1 ${(right - radius).toFixed(1)} ${bottom.toFixed(1)}`
        + `H${(left + radius).toFixed(1)}`
        + `A${radius} ${radius} 0 0 1 ${left.toFixed(1)} ${(bottom - radius).toFixed(1)}`
        + `V${(top + radius).toFixed(1)}`
        + `A${radius} ${radius} 0 0 1 ${(left + radius).toFixed(1)} ${top.toFixed(1)}Z`;
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
    const overviewDensity = renderOptions.overviewDensity === true;
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
    const staticHeadPaths = [];
    const staticFretLabels = [];
    const staticTechniqueLabels = [];
    // Full-song Overview is a visual density summary, not miniature notation.
    // Collapse ordinary attacks into at most one mark per display pixel and
    // string. A Set keeps memory proportional to occupied bins (rather than a
    // potentially huge song surface), while the emitted path remains bounded
    // by surfaceWidth * stringCount regardless of source-note count.
    const densityPixelCount = Math.max(1, Math.ceil(contentWidth));
    const densityAttackBins = overviewDensity
        ? Array.from({ length: view.stringCount }, () => new Set()) : [];
    const authoredTrails = [];
    const tremoloTrails = [];
    const effectiveTrails = [];
    for (const entry of compositeTimelineEntriesInRangePure(lane.entries, visibleRange)) {
        const row = Math.max(0, Math.min(view.stringCount - 1,
            view.stringCount - 1 - Math.trunc(finite(entry.string))));
        const y = top + row * stringGap;
        const x = surface.xForBeat(entry.startBeat);
        const detailed = entryNeedsDetailedTimelineMarkup(view, entry);
        if (overviewDensity && !detailed) {
            // A trail-only range hit may begin outside this SVG surface. Do
            // not pin that off-screen attack to an edge: Overview deliberately
            // omits ordinary trails and represents only attacks actually on
            // this surface.
            if (x >= 0 && x <= contentWidth) {
                const pixel = Math.max(0, Math.min(densityPixelCount - 1,
                    Math.floor(x)));
                densityAttackBins[row].add(pixel);
            }
            continue;
        }
        const authoredEndX = surface.xForBeat(
            Math.max(finite(entry.startBeat), finite(entry.endBeat)));
        const effectiveEndX = surface.xForBeat(entryEndBeat(entry));
        const glyph = compositeTimelineNoteGlyphMetricsPure(entry.fret);
        const fret = glyph.label;
        const metadata = entryDisplayMetadata(entry, view.stringCount, {
            detailed,
            includeTechniques: true,
        });
        if (!detailed) {
            if (authoredEndX > x + 2) {
                (metadata.tremolo ? tremoloTrails : authoredTrails)
                    .push(`M${x.toFixed(1)} ${y.toFixed(1)}H${authoredEndX.toFixed(1)}`);
            }
            if (effectiveEndX > authoredEndX + 2) {
                effectiveTrails.push(`M${Math.max(x, authoredEndX).toFixed(1)} ${y.toFixed(1)}H${effectiveEndX.toFixed(1)}`);
            }
            staticHeadPaths.push(roundedTimelineNoteHeadPath(x, y, glyph));
            staticFretLabels.push(`<text x="${x.toFixed(1)}" data-composite-static-note="true" aria-hidden="true" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#f8fafc" font-size="${glyph.fretFontSize}" font-weight="700">${escapeMarkup(fret)}</text>`);
            if (metadata.badge) {
                staticTechniqueLabels.push(`<text x="${x.toFixed(1)}" data-composite-static-technique="true" aria-hidden="true" y="${(y - 12).toFixed(1)}" text-anchor="middle" fill="#fcd34d" font-size="${glyph.badgeFontSize}" font-weight="700">${escapeMarkup(metadata.badge)}</text>`);
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
            + `<rect x="${(x - glyph.width / 2).toFixed(1)}" y="${(y - glyph.height / 2).toFixed(1)}" width="${glyph.width}" height="${glyph.height}" rx="${glyph.radius}" fill="${colorsForEntry.soft}" stroke="${outline}" stroke-width="${entry.selected && entry.inConflict ? glyph.selectedOutlineWidth : glyph.outlineWidth}"/>`
            + `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#f8fafc" font-size="${glyph.fretFontSize}" font-weight="700">${escapeMarkup(fret)}</text>`
            + (entry.selected && entry.inConflict ? `<circle cx="${(x + glyph.width / 2 - 1).toFixed(1)}" cy="${(y - 8).toFixed(1)}" r="4" fill="#f8fafc"/><path d="M${(x + glyph.width / 2 - 3).toFixed(1)} ${(y - 8).toFixed(1)}l1.5 1.5 3-3" fill="none" stroke="#065f46" stroke-width="1.5"/>` : '')
            + (badge ? `<text x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" text-anchor="middle" fill="#fcd34d" font-size="${glyph.badgeFontSize}" font-weight="700">${escapeMarkup(badge)}</text>` : '')
            + '</g>');
    }
    const staticTrails = (authoredTrails.length
        ? `<path data-composite-static-trails="authored" d="${authoredTrails.join('')}" fill="none" stroke="${colors.main}" stroke-width="5" stroke-linecap="round" opacity="0.68"/>` : '')
        + (tremoloTrails.length
            ? `<path data-composite-static-trails="tremolo" d="${tremoloTrails.join('')}" fill="none" stroke="${colors.main}" stroke-width="5" stroke-linecap="round" stroke-dasharray="3 3" opacity="0.68"/>` : '')
        + (effectiveTrails.length
            ? `<path data-composite-static-trails="effective" d="${effectiveTrails.join('')}" fill="none" stroke="${colors.main}" stroke-width="3" stroke-dasharray="5 4" opacity="0.8"/>` : '');
    const densityHeads = [];
    if (overviewDensity) {
        for (let row = 0; row < densityAttackBins.length; row++) {
            const y = top + row * stringGap;
            const pixels = [...densityAttackBins[row]].sort((a, b) => a - b);
            for (const pixel of pixels) {
                const x = Math.min(contentWidth, pixel + 0.5);
                densityHeads.push(`M${x.toFixed(1)} ${y.toFixed(1)}h0.1`);
            }
        }
    }
    const density = densityHeads.length
        ? `<path data-composite-density-notes="true" data-composite-density-bin-count="${densityHeads.length}" aria-hidden="true" d="${densityHeads.join('')}" fill="none" stroke="${colors.main}" stroke-width="5" stroke-linecap="round"/>` : '';
    const staticHeads = staticHeadPaths.length
        ? `<path data-composite-static-note-heads="true" aria-hidden="true" d="${staticHeadPaths.join('')}" fill="${colors.soft}" stroke="${colors.main}" stroke-width="${TIMELINE_NOTE_GLYPH.outlineWidth}"/>` : '';
    return `<rect width="${contentWidth}" height="${laneHeight}" fill="#0f172a"/>`
        + `<rect x="0" y="0" width="${contentWidth}" height="${laneHeight}" fill="${colors.soft}" opacity="0.18"/>`
        + lineMarkup(view, laneHeight, visibleRange, z, renderOptions) + strings.join('')
        + staticTrails + density + staticHeads + staticTechniqueLabels.join('')
        + staticFretLabels.join('') + detailedNotes.join('')
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

function compositeTimelineOverviewMarkerState(kind, state) {
    const value = String(state ?? '');
    return OVERVIEW_MARKER_STATES[kind]?.has(value) ? value : 'other';
}

function compositeTimelineOverviewQueryState(kind, state) {
    const value = String(state ?? '');
    if (value === 'other') return value;
    return OVERVIEW_MARKER_STATES[kind]?.has(value) ? value : null;
}

function overviewHeapPush(heap, value) {
    let index = heap.length;
    heap.push(value);
    while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent] >= value) break;
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = value;
}

function overviewHeapTop(heap, active) {
    while (heap.length && !active[heap[0]]) {
        const tail = heap.pop();
        if (!heap.length) break;
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            if (left >= heap.length) break;
            const right = left + 1;
            const child = right < heap.length && heap[right] > heap[left] ? right : left;
            if (heap[child] <= tail) break;
            heap[index] = heap[child];
            index = child;
        }
        heap[index] = tail;
    }
    return heap.length ? heap[0] : -1;
}

function overviewLowerBound(values, value) {
    let lower = 0;
    let upper = values.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (values[middle] < value) lower = middle + 1;
        else upper = middle;
    }
    return lower;
}

function overviewUpperBound(values, value) {
    let lower = 0;
    let upper = values.length;
    while (lower < upper) {
        const middle = (lower + upper) >> 1;
        if (values[middle] <= value) lower = middle + 1;
        else upper = middle;
    }
    return lower;
}

function compositeTimelineOverviewIntervalGroupIndex(records) {
    if (!records.length) return null;
    // Decisions are normally authored in song order and do not overlap. Keep
    // that overwhelmingly common case as compact
    // typed arrays: it builds linearly and an upper-bound lookup is exact. A
    // strict overlap (shared boundaries are okay) or out-of-order source falls
    // through to the general sweep index below.
    let orderedDisjoint = true;
    let previousStart = -Infinity;
    let maximumEnd = -Infinity;
    for (const record of records) {
        if (record.startBeat < previousStart || record.startBeat < maximumEnd) {
            orderedDisjoint = false;
            break;
        }
        previousStart = record.startBeat;
        maximumEnd = Math.max(maximumEnd, record.endBeat);
    }
    if (orderedDisjoint) {
        const starts = new Float64Array(records.length);
        const ends = new Float64Array(records.length);
        const sourceIndices = new Int32Array(records.length);
        for (let index = 0; index < records.length; index++) {
            starts[index] = records[index].startBeat;
            ends[index] = records[index].endBeat;
            sourceIndices[index] = records[index].sourceIndex;
        }
        return { orderedDisjoint: true, starts, ends, sourceIndices };
    }
    // General overlap path: merge two compact sorted endpoint streams. This
    // avoids allocating Map/Set buckets for every interval and still creates
    // the exact top-painted coverage segments required for logarithmic hits.
    const byStart = records.slice().sort((a, b) => a.startBeat - b.startBeat
        || a.sourceIndex - b.sourceIndex);
    const byEnd = records.slice().sort((a, b) => a.endBeat - b.endBeat
        || a.sourceIndex - b.sourceIndex);
    const coordinates = [];
    const pointWinners = [];
    const spanWinners = [];
    const startValues = [];
    const startWinners = [];
    const endValues = [];
    const endWinners = [];
    const active = new Uint8Array(records.at(-1).sourceIndex + 1);
    const heap = [];
    let startIndex = 0;
    let endIndex = 0;
    while (startIndex < byStart.length || endIndex < byEnd.length) {
        const nextStart = startIndex < byStart.length
            ? byStart[startIndex].startBeat : Infinity;
        const nextEnd = endIndex < byEnd.length ? byEnd[endIndex].endBeat : Infinity;
        const coordinate = Math.min(nextStart, nextEnd);
        let startWinner = -1;
        while (startIndex < byStart.length
                && byStart[startIndex].startBeat === coordinate) {
            const sourceIndex = byStart[startIndex++].sourceIndex;
            active[sourceIndex] = 1;
            overviewHeapPush(heap, sourceIndex);
            startWinner = Math.max(startWinner, sourceIndex);
        }
        if (startWinner >= 0) {
            startValues.push(coordinate);
            startWinners.push(startWinner);
        }
        coordinates.push(coordinate);
        pointWinners.push(overviewHeapTop(heap, active));
        let endWinner = -1;
        while (endIndex < byEnd.length && byEnd[endIndex].endBeat === coordinate) {
            const sourceIndex = byEnd[endIndex++].sourceIndex;
            active[sourceIndex] = 0;
            endWinner = Math.max(endWinner, sourceIndex);
        }
        if (endWinner >= 0) {
            endValues.push(coordinate);
            endWinners.push(endWinner);
        }
        spanWinners.push(overviewHeapTop(heap, active));
    }
    return {
        coordinates: Float64Array.from(coordinates),
        pointWinners: Int32Array.from(pointWinners),
        spanWinners: Int32Array.from(spanWinners),
        starts: {
            values: Float64Array.from(startValues),
            winners: Int32Array.from(startWinners),
        },
        ends: {
            values: Float64Array.from(endValues),
            winners: Int32Array.from(endWinners),
        },
    };
}

function compositeTimelineOverviewKindIndex(items, kind, excluded) {
    const records = [];
    const groups = new Map();
    for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex++) {
        const item = items[sourceIndex];
        if (!item || excluded(item)) continue;
        const startBeat = finite(item.startBeat);
        const record = {
            sourceIndex,
            startBeat,
            endBeat: Math.max(startBeat, finite(item.endBeat, startBeat)),
        };
        records.push(record);
        const state = compositeTimelineOverviewMarkerState(kind, item.state);
        if (!groups.has(state)) groups.set(state, []);
        groups.get(state).push(record);
    }
    return {
        items,
        all: compositeTimelineOverviewIntervalGroupIndex(records),
        states: new Map([...groups].map(([state, stateRecords]) => [
            state, compositeTimelineOverviewIntervalGroupIndex(stateRecords),
        ])),
    };
}

/**
 * Build one hit-test snapshot for the dense overview. The controller can
 * retain this next to the rendered map and perform every pointer lookup in
 * logarithmic time, provided it rebuilds the cache when the view changes.
 * Focused markers are deliberately excluded because they keep their ordinary
 * individual SVG hit targets above the density paths.
 */
export function compositeTimelineOverviewIntervalIndexPure(view = {}) {
    const review = view.review;
    return {
        type: OVERVIEW_INTERVAL_INDEX_TYPE,
        decision: compositeTimelineOverviewKindIndex(view.decisions || [], 'decision',
            item => Boolean(review) && item.id === review.id),
    };
}

function compositeTimelineOverviewGroupHitPure(kindIndex, group, beat) {
    if (!group) return null;
    const value = finite(beat);
    if (group.orderedDisjoint) {
        const previous = overviewUpperBound(group.starts, value) - 1;
        if (previous >= 0 && group.ends[previous] >= value) {
            return kindIndex.items[group.sourceIndices[previous]] || null;
        }
        const next = previous + 1;
        const previousWinner = previous >= 0 ? group.sourceIndices[previous] : -1;
        const nextWinner = next < group.starts.length ? group.sourceIndices[next] : -1;
        if (nextWinner < 0) return kindIndex.items[previousWinner] || null;
        if (previousWinner < 0) return kindIndex.items[nextWinner] || null;
        const nextDistance = group.starts[next] - value;
        const previousDistance = value - group.ends[previous];
        const winner = nextDistance < previousDistance ? nextWinner
            : previousDistance < nextDistance ? previousWinner
                : Math.max(nextWinner, previousWinner);
        return kindIndex.items[winner] || null;
    }
    const at = overviewLowerBound(group.coordinates, value);
    let winner = -1;
    if (at < group.coordinates.length && group.coordinates[at] === value) {
        winner = group.pointWinners[at];
    } else if (at > 0) {
        winner = group.spanWinners[at - 1];
    }
    if (winner >= 0) return kindIndex.items[winner] || null;

    // A density path is quantised to overview pixels, so its painted run can
    // include a tiny visual gap between exact intervals. In that gap choose
    // the nearest edge. Equal-distance ties select the later source item,
    // matching SVG paint order for ordinary overlapping markers.
    const nextStart = overviewLowerBound(group.starts.values, value);
    const previousEnd = overviewUpperBound(group.ends.values, value) - 1;
    const nextWinner = nextStart < group.starts.values.length
        ? group.starts.winners[nextStart] : -1;
    const previousWinner = previousEnd >= 0 ? group.ends.winners[previousEnd] : -1;
    if (nextWinner < 0) return kindIndex.items[previousWinner] || null;
    if (previousWinner < 0) return kindIndex.items[nextWinner] || null;
    const nextDistance = group.starts.values[nextStart] - value;
    const previousDistance = value - group.ends.values[previousEnd];
    winner = nextDistance < previousDistance ? nextWinner
        : previousDistance < nextDistance ? previousWinner
            : Math.max(nextWinner, previousWinner);
    return kindIndex.items[winner] || null;
}

/**
 * Resolve a click on a grouped decision marker to one exact interval.
 * Pass an index returned by `compositeTimelineOverviewIntervalIndexPure` on a
 * hot pointer path; passing a view directly is a convenient one-off fallback.
 */
export function compositeTimelineOverviewIntervalAtBeatPure(viewOrIndex, beat, {
    kind = 'decision',
    state,
} = {}) {
    if (kind !== 'decision') return null;
    const index = viewOrIndex?.type === OVERVIEW_INTERVAL_INDEX_TYPE
        ? viewOrIndex : compositeTimelineOverviewIntervalIndexPure(viewOrIndex);
    const kindIndex = index[kind];
    let group = kindIndex.all;
    if (state != null && state !== '') {
        const queryState = compositeTimelineOverviewQueryState(kind, state);
        if (!queryState) return null;
        group = kindIndex.states.get(queryState);
    }
    return compositeTimelineOverviewGroupHitPure(kindIndex, group, beat);
}

function compositeTimelineOverviewDensityMarkup(entries, toX, {
    width = OVERVIEW_WIDTH,
    y = 17,
    height = 9,
    fill = '#34d399',
    include = () => true,
    attribute = 'data-composite-map-density="true"',
    fixedOpacity = null,
    combineRuns = false,
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
    const combinedCommands = [];
    const flush = end => {
        if (runStart < 0) return;
        const runWidth = Math.max(1, end - runStart);
        if (combineRuns) {
            combinedCommands.push(`M${runStart.toFixed(1)} ${y}h${runWidth.toFixed(1)}v${height}h-${runWidth.toFixed(1)}Z`);
        } else {
            runs.push(`<rect ${attribute} x="${runStart.toFixed(1)}" y="${y}" width="${runWidth.toFixed(1)}" height="${height}" rx="1" fill="${fill}" opacity="${runOpacity.toFixed(2)}"/>`);
        }
        runStart = -1;
    };
    for (let bin = 0; bin < width; bin++) {
        active += difference[bin];
        // Quantising density lets adjacent pixels collapse into bounded runs
        // while still making stacked chords visibly stronger.
        const opacity = active > 0
            ? fixedOpacity ?? Math.min(0.88,
                0.52 + Math.floor(Math.log2(active + 1)) * 0.09)
            : 0;
        if (opacity !== runOpacity) {
            flush(bin);
            runOpacity = opacity;
            if (opacity) runStart = bin;
        } else if (opacity && runStart < 0) runStart = bin;
    }
    flush(width);
    if (combinedCommands.length) {
        runs.push(`<path ${attribute} d="${combinedCommands.join('')}" fill="${fill}" opacity="${finite(fixedOpacity, 0.72).toFixed(2)}"/>`);
    }
    return runs.join('');
}

function compositeTimelineOverviewGroupedIntervals(items, toX, {
    kind,
    y,
    height,
    colors,
    active = () => false,
} = {}) {
    const grouped = new Map();
    for (const item of items || []) {
        if (active(item)) continue;
        const state = Object.hasOwn(colors, item.state) ? item.state : 'other';
        if (!grouped.has(state)) grouped.set(state, []);
        grouped.get(state).push(item);
    }
    return [...grouped].map(([state, intervals]) =>
        compositeTimelineOverviewDensityMarkup(intervals, toX, {
            y,
            height,
            fill: colors[state] || colors.other || '#64748b',
            attribute: `data-composite-map-${kind}-density="${escapeMarkup(state)}" data-composite-map-density-kind="${kind}" data-composite-map-density-state="${escapeMarkup(state)}" pointer-events="fill" style="cursor:pointer" aria-hidden="true"`,
            fixedOpacity: 0.72,
            combineRuns: true,
        })).join('');
}

function compositeTimelineOverviewDecisionMarkup(decision, toX, width, active) {
    const x1 = Math.max(0, Math.min(width, toX(decision.startBeat)));
    const x2 = Math.max(x1 + 2, Math.min(width, toX(decision.endBeat)));
    const color = decision.state === 'invalid' ? '#f87171'
        : decision.state === 'resolved' ? '#34d399' : '#fbbf24';
    return `<rect data-composite-map-decision="${decision.index}" x="${x1.toFixed(1)}" y="5" width="${Math.max(2, x2 - x1).toFixed(1)}" height="8" rx="2" fill="${color}" opacity="${active ? 1 : 0.72}"/>`;
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
    const decisionItems = view.decisions || [];
    const activeDecision = decision => view.review && view.review.id === decision.id;
    const denseDecisions = decisionItems.length > COMPOSITE_TIMELINE_OVERVIEW_INTERVAL_LIMIT;
    const decisions = denseDecisions
        ? compositeTimelineOverviewGroupedIntervals(decisionItems, x, {
            kind: 'decision', y: 5, height: 8,
            colors: { invalid: '#f87171', resolved: '#34d399', unresolved: '#fbbf24' },
            active: activeDecision,
        }) + decisionItems.filter(activeDecision).map(decision =>
            compositeTimelineOverviewDecisionMarkup(decision, x, width, true)).join('')
        : decisionItems.map(decision => compositeTimelineOverviewDecisionMarkup(
            decision, x, width, activeDecision(decision))).join('');
    const groupedDescription = denseDecisions
        ? `. Dense ${decisionItems.length} decision markers are visually grouped by position and status; clicking a grouped marker opens the exact section at that position, and the focused marker remains individually selectable`
        : '';
    const accessibleLabel = `Whole-song Hybrid overview${groupedDescription}`;
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" width="100%" height="42" role="img" aria-label="${escapeMarkup(accessibleLabel)}" style="display:block">`
        + `<title>${escapeMarkup(accessibleLabel)}</title><rect width="${width}" height="${height}" rx="7" fill="#0f172a"/>${entries}${decisions}`
        + '</svg>';
}
