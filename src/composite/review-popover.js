/* Pure geometry for the Review "Section details" popover. */

export const COMPOSITE_REVIEW_POPOVER_GAP = 8;
export const COMPOSITE_REVIEW_POPOVER_INSET = 8;
export const COMPOSITE_REVIEW_POPOVER_MAX_WIDTH = 672;
export const COMPOSITE_REVIEW_POPOVER_MAX_HEIGHT = 480;

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizedRect(raw, fallback = {}) {
    const left = finite(raw?.left, finite(fallback.left));
    const top = finite(raw?.top, finite(fallback.top));
    const fallbackRight = finite(fallback.right,
        left + Math.max(0, finite(fallback.width)));
    const fallbackBottom = finite(fallback.bottom,
        top + Math.max(0, finite(fallback.height)));
    const right = Math.max(left, finite(raw?.right, raw?.width == null
        ? fallbackRight : left + Math.max(0, finite(raw.width))));
    const bottom = Math.max(top, finite(raw?.bottom, raw?.height == null
        ? fallbackBottom : top + Math.max(0, finite(raw.height))));
    return { left, top, right, bottom };
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export function compositeReviewPopoverPlacementPure({
    anchorRect,
    boundaryRect,
    viewportRect,
    contentWidth = COMPOSITE_REVIEW_POPOVER_MAX_WIDTH,
    contentHeight = COMPOSITE_REVIEW_POPOVER_MAX_HEIGHT,
    gap = COMPOSITE_REVIEW_POPOVER_GAP,
    inset = COMPOSITE_REVIEW_POPOVER_INSET,
    maxWidth = COMPOSITE_REVIEW_POPOVER_MAX_WIDTH,
    maxHeight = COMPOSITE_REVIEW_POPOVER_MAX_HEIGHT,
} = {}) {
    const viewport = normalizedRect(viewportRect);
    const boundary = normalizedRect(boundaryRect, viewport);
    const anchor = normalizedRect(anchorRect);
    const intersection = {
        left: Math.max(viewport.left, boundary.left),
        top: Math.max(viewport.top, boundary.top),
        right: Math.min(viewport.right, boundary.right),
        bottom: Math.min(viewport.bottom, boundary.bottom),
    };
    intersection.right = Math.max(intersection.left, intersection.right);
    intersection.bottom = Math.max(intersection.top, intersection.bottom);

    const horizontalInset = Math.min(Math.max(0, finite(inset)),
        (intersection.right - intersection.left) / 2);
    const verticalInset = Math.min(Math.max(0, finite(inset)),
        (intersection.bottom - intersection.top) / 2);
    const safe = {
        left: intersection.left + horizontalInset,
        right: intersection.right - horizontalInset,
        top: intersection.top + verticalInset,
        bottom: intersection.bottom - verticalInset,
    };
    const safeWidth = Math.max(0, safe.right - safe.left);
    const safeHeight = Math.max(0, safe.bottom - safe.top);
    const wantedWidth = Math.max(0, Math.min(
        finite(contentWidth, maxWidth), finite(maxWidth, safeWidth)));
    const width = Math.min(safeWidth, wantedWidth);
    const left = clamp(anchor.right - width, safe.left, safe.right - width);

    const spacing = Math.max(0, finite(gap));
    const below = Math.max(0, safe.bottom - anchor.bottom - spacing);
    const above = Math.max(0, anchor.top - safe.top - spacing);
    const wantedHeight = Math.max(0, Math.min(
        finite(contentHeight, maxHeight), finite(maxHeight, safeHeight)));
    const openUp = wantedHeight > below && above > below;
    const availableHeight = openUp ? above : below;
    const height = Math.min(safeHeight, wantedHeight, availableHeight);
    const naturalTop = openUp
        ? anchor.top - spacing - height : anchor.bottom + spacing;
    const top = clamp(naturalTop, safe.top, safe.bottom - height);

    return {
        left,
        top,
        width,
        maxHeight: height,
        openUp,
        availableAbove: above,
        availableBelow: below,
    };
}
