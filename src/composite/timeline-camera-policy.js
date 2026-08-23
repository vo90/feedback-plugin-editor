/* DOM-free coverage policy for the bounded Hybrid timeline cameras.
 *
 * The renderer paints only a finite beat range. Follow may move the visual
 * viewport independently of the browser's native scrollbar, so correctness
 * requires the active (or a ready standby) range to contain that viewport.
 */

const EPSILON_BEATS = 1e-4;

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizedRange(range, fallbackStart = 0, fallbackEnd = fallbackStart) {
    const startBeat = finite(range?.startBeat, fallbackStart);
    const endBeat = Math.max(startBeat, finite(range?.endBeat, fallbackEnd));
    return { startBeat, endBeat };
}

/**
 * Describe how much painted material surrounds the visible viewport.
 * Headroom is expressed in current CSS pixels so the scheduler can compare it
 * with the actual viewport without knowing anything about tempo.
 */
export function compositeTimelineCameraCoveragePure({
    context = {},
    zoom = 1,
    renderedRange = null,
    viewportRange = null,
    direction = 1,
} = {}) {
    const song = normalizedRange(context, 0, 1);
    const rendered = renderedRange
        ? normalizedRange(renderedRange, song.startBeat, song.startBeat)
        : null;
    const viewport = viewportRange
        ? normalizedRange(viewportRange, song.startBeat, song.startBeat)
        : null;
    const pixelsPerBeat = Math.max(0, finite(zoom, 1));
    const valid = Boolean(rendered && viewport && pixelsPerBeat > 0);
    const coversLeft = valid
        && rendered.startBeat <= viewport.startBeat + EPSILON_BEATS;
    const coversRight = valid
        && rendered.endBeat + EPSILON_BEATS >= viewport.endBeat;
    const leftHeadroomPx = valid
        ? (viewport.startBeat - rendered.startBeat) * pixelsPerBeat : -Infinity;
    const rightHeadroomPx = valid
        ? (rendered.endBeat - viewport.endBeat) * pixelsPerBeat : -Infinity;
    const travelHeadroomPx = direction < 0 ? leftHeadroomPx
        : direction > 0 ? rightHeadroomPx
            : Math.min(leftHeadroomPx, rightHeadroomPx);
    return {
        valid,
        coversLeft,
        coversRight,
        coversViewport: coversLeft && coversRight,
        leftHeadroomPx,
        rightHeadroomPx,
        travelHeadroomPx,
        renderedRange: rendered,
        viewportRange: viewport,
    };
}

/**
 * Turn coverage into a deterministic scheduling priority. `critical` means a
 * compositor transform would expose an unpainted viewport and must be repaired
 * before it is applied. Exact-zoom work is urgent even when the scaled camera
 * still covers the viewport.
 */
export function compositeTimelineCameraUrgencyPure({
    coverage,
    viewportWidth = 1200,
    standbyReady = false,
    exactRenderPending = false,
    softGuardPx,
    urgentGuardPx,
} = {}) {
    if (!coverage?.coversViewport) return 'critical';
    if (exactRenderPending) return 'urgent';
    const width = Math.max(1, finite(viewportWidth, 1200));
    const soft = Math.max(0, finite(softGuardPx, width * 1.5));
    const urgent = Math.max(0, Math.min(soft,
        finite(urgentGuardPx, width * 0.75)));
    const headroom = finite(coverage.travelHeadroomPx, -Infinity);
    if (headroom <= urgent && !standbyReady) return 'urgent';
    if (headroom <= soft && !standbyReady) return 'soft';
    return 'none';
}

