import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCompositeTimelineViewModel,
    COMPOSITE_TIMELINE_EDGE_PADDING,
    COMPOSITE_TIMELINE_GUTTER,
    COMPOSITE_TIMELINE_OVERVIEW_INTERVAL_LIMIT,
    COMPOSITE_TIMELINE_PAGE_EDGE_MAX,
    COMPOSITE_TIMELINE_PAGE_EDGE_MIN,
    COMPOSITE_TIMELINE_PAGE_TRANSITION_MS,
    COMPOSITE_TIMELINE_STRIP_MAX_WIDTH,
    COMPOSITE_TIMELINE_STRIP_VIEWPORTS,
    compositeTimelineBeatForXPure,
    compositeTimelineCameraFramePure,
    compositeTimelineCameraOffsetPure,
    compositeTimelineCenteredScrollPure,
    compositeTimelineContentWidthPure,
    compositeTimelineCubicEaseOutPure,
    compositeTimelineDisplayBeatPure,
    compositeTimelineDetailLevelPure,
    compositeTimelineEntriesInRangePure,
    compositeTimelineFitZoomPure,
    compositeTimelineGlobalToLocalXPure,
    compositeTimelineLocalToGlobalXPure,
    compositeTimelineMapViewportPure,
    compositeTimelineMapBeatPure,
    compositeTimelineNoteGlyphMetricsPure,
    compositeTimelineOverviewIntervalAtBeatPure,
    compositeTimelineOverviewIntervalIndexPure,
    compositeTimelinePagedCameraPure,
    compositeTimelinePagedGeometryPure,
    compositeTimelinePageTransitionPure,
    compositeTimelineRenderBufferPure,
    compositeTimelineRenderGuardPure,
    compositeTimelineRenderOriginPure,
    compositeTimelineRenderRangePure,
    compositeTimelineRenderWindowNeedsRefreshPure,
    compositeTimelineSongRangePure,
    compositeTimelineSteppedZoomPure,
    compositeTimelineStripGeometryPure,
    compositeTimelineVisibleRangePure,
    compositeTimelineViewportRangePure,
    compositeTimelineXForBeatPure,
    compositeTimelineZoomAtPure,
    renderCompositeTimelineLaneContents,
    renderCompositeTimelineLaneHeader,
    renderCompositeTimelineMapSvg,
    renderCompositeTimelinePlayhead,
    renderCompositeTimelineRulerContents,
} from '../src/composite/timeline-view.js';

const beats = Array.from({ length: 17 }, (_, index) => ({
    time: index * 0.5,
    measure: index % 4 === 0 ? index / 4 + 1 : -1,
}));

const entry = (id, startBeat, endBeat, string = 0, fret = 3, source = 'primary') => ({
    id, startBeat, endBeat, effectiveEndBeat: endBeat,
    string, fret, source, sources: [source], note: { techniques: {} },
});

function view() {
    return buildCompositeTimelineViewModel({
        plan: {
            beats,
            compatibility: { stringCount: 6 },
            sourceEntries: {
                primary: [entry('p:1', 2, 4, 0, 3)],
                secondary: [entry('s:1', 8, 9, 2, 7, 'secondary')],
            },
        },
        primaryName: 'Lead',
        secondaryName: 'Rhythm',
        resultEntries: [entry('p:1', 2, 4, 0, 3), entry('s:1', 8, 9, 2, 7, 'secondary')],
        durationSeconds: 12,
    });
}

test('whole-song range starts at zero and includes audio beyond the beat grid', () => {
    assert.deepEqual(compositeTimelineSongRangePure({
        beats, durationSeconds: 12, entries: [entry('late', 18, 19)],
    }), { startBeat: 0, endBeat: 24 });
    const model = view();
    assert.equal(model.context.startBeat, 0);
    assert.equal(model.context.endBeat, 24);
    assert.deepEqual(model.lanes.map(lane => lane.label), ['Lead', 'Rhythm', 'Hybrid']);
    assert.deepEqual(model.lanes.map(lane => lane.subtitle),
        ['Base track', 'Fill track', 'Hybrid result']);
    assert.equal(model.hasFillAdditions, true);
});

test('source-lane preprocessing follows immutable analysis-array identity only', () => {
    const primary = [
        entry('late', 4, 4.25, 0, 4),
        entry('duplicate', 6, 6.25, 1, 5),
        entry('duplicate', 2, 2.25, 1, 9),
        entry('early', 1, 1.25, 2, 7),
    ];
    const secondary = [entry('secondary', 3, 3.25, 3, 8, 'secondary')];
    const resultEntries = [entry('result:1', 1, 1.25)];
    const plan = {
        beats,
        compatibility: { stringCount: 6 },
        sourceEntries: { primary, secondary },
    };
    const build = () => buildCompositeTimelineViewModel({ plan, resultEntries });
    const first = build();
    const second = build();
    assert.strictEqual(second.lanes[0].entries, first.lanes[0].entries,
        'the same analysis-owned primary array reuses its prepared projection');
    assert.strictEqual(second.lanes[1].entries, first.lanes[1].entries,
        'the same analysis-owned secondary array reuses its prepared projection');
    assert.deepEqual(first.lanes[0].entries.map(candidate => [candidate.id, candidate.fret]), [
        ['early', 7], ['duplicate', 9], ['late', 4],
    ], 'cached preprocessing preserves last-id-wins deduplication and exact sort order');
    assert.notStrictEqual(second.lanes[2].entries, first.lanes[2].entries,
        'mutable result entries are deliberately prepared for every view build');

    resultEntries.push(entry('result:2', 5, 5.25));
    const afterResultMutation = build();
    assert.deepEqual(afterResultMutation.lanes[2].entries.map(candidate => candidate.id),
        ['result:1', 'result:2'], 'a same-identity result array never returns a stale projection');

    plan.sourceEntries.primary = primary.slice();
    const afterSourceReplacement = build();
    assert.notStrictEqual(afterSourceReplacement.lanes[0].entries,
        afterResultMutation.lanes[0].entries,
        'replacing an analysis source array rebuilds its prepared projection');
    assert.deepEqual(afterSourceReplacement.lanes[0].entries,
        afterResultMutation.lanes[0].entries);
    assert.strictEqual(afterSourceReplacement.lanes[1].entries,
        afterResultMutation.lanes[1].entries,
        'an unchanged source array retains its independently cached projection');

    const resolvedSnapshot = [
        entry('prepared:early', 1, 1.25),
        entry('prepared:late', 8, 8.25),
    ];
    const preparedResult = buildCompositeTimelineViewModel({
        plan,
        resultEntries: resolvedSnapshot,
        resultEntriesPrepared: true,
    });
    assert.strictEqual(preparedResult.lanes[2].entries, resolvedSnapshot,
        'a controller-owned resolved revision skips duplicate sorting and retains identity');
});

test('display playhead beat always remains on a visible song edge', () => {
    const context = { startBeat: 0, endBeat: 24 };
    assert.equal(compositeTimelineDisplayBeatPure(-0.345, context), 0,
        'audio before Majesty\'s first grid beat parks at the padded start edge');
    assert.equal(compositeTimelineDisplayBeatPure(7.25, context), 7.25);
    assert.equal(compositeTimelineDisplayBeatPure(25.5, context), 24,
        'a settling transport beyond the tail parks at the song end');
    assert.equal(compositeTimelineDisplayBeatPure(Number.NaN, context), 0);
});

test('timeline uses one stable beat-to-x map and culls entries outside the buffered view', () => {
    const model = view();
    const x2 = compositeTimelineXForBeatPure(2, model.context, 32);
    const x8 = compositeTimelineXForBeatPure(8, model.context, 32);
    assert.equal(x8 - x2, 6 * 32);
    const range = compositeTimelineVisibleRangePure({
        context: model.context, zoom: 32, scrollLeft: 0, viewportWidth: 340, bufferPx: 0,
    });
    assert.ok(range.endBeat < 8);
    assert.deepEqual(compositeTimelineEntriesInRangePure(model.lanes[2].entries, range)
        .map(candidate => candidate.id), ['p:1']);
});

test('range culling keeps pre-window trails and reaches a dense song tail', () => {
    const entries = [entry('long-trail', 0, 8_500),
        ...Array.from({ length: 10_000 }, (_, index) =>
            entry(`note:${index}`, index + 1, index + 1.25))];
    assert.deepEqual(compositeTimelineEntriesInRangePure(entries, {
        startBeat: 8_000, endBeat: 8_001,
    }).map(candidate => candidate.id), [
        'long-trail', 'note:7999', 'note:8000',
    ], 'binary culling does not discard trails that began before the viewport');
});

test('continuous follow reuses its buffered note window until the viewport nears an edge', () => {
    const context = { startBeat: 0, endBeat: 200 };
    const renderedRange = { startBeat: 20, endBeat: 70 };
    assert.equal(compositeTimelineRenderWindowNeedsRefreshPure({
        context, zoom: 60, renderedRange,
        viewportRange: { startBeat: 38, endBeat: 58 },
    }), false, 'ordinary per-frame follow movement must not rebuild all track SVGs');
    assert.equal(compositeTimelineRenderWindowNeedsRefreshPure({
        context, zoom: 60, renderedRange,
        viewportRange: { startBeat: 48, endBeat: 68 },
    }), true, 'approaching the right guard requests the next buffered note window');
    assert.equal(compositeTimelineRenderWindowNeedsRefreshPure({
        context, zoom: 60, renderedRange: { startBeat: 0, endBeat: 50 },
        viewportRange: { startBeat: 0, endBeat: 20 },
    }), false, 'the real song boundary does not invalidate its own buffer forever');
    assert.equal(compositeTimelineRenderWindowNeedsRefreshPure({
        context, zoom: 120, renderedRange,
        viewportRange: { startBeat: 38, endBeat: 58 }, renderedZoom: 60,
    }), true, 'zoom changes always rebuild geometry');
});

test('the virtual camera glides fractionally without native-scroll catch-up', () => {
    assert.equal(compositeTimelineCameraOffsetPure(200, 212.5), -12.5);
    assert.equal(compositeTimelineCameraOffsetPure(212.5, 200), 12.5);
    const context = { startBeat: 0, endBeat: 24 };
    const start = compositeTimelineCameraFramePure({
        beat: 0, context, zoom: 60, viewportWidth: 1000, follow: true,
    });
    assert.equal(start.visualScrollLeft, 0);
    assert.equal(start.screenX, COMPOSITE_TIMELINE_GUTTER + COMPOSITE_TIMELINE_EDGE_PADDING);
    const middle = compositeTimelineCameraFramePure({
        beat: 8.125, context, zoom: 60, viewportWidth: 1000, follow: true,
    });
    assert.equal(middle.screenX, COMPOSITE_TIMELINE_GUTTER
        + (1000 - COMPOSITE_TIMELINE_GUTTER) / 2);
    assert.ok(!Number.isInteger(middle.contentX), 'sub-beat motion keeps fractional pixels');
    const end = compositeTimelineCameraFramePure({
        beat: 24, context, zoom: 60, viewportWidth: 1000, follow: true,
    });
    assert.equal(end.visualScrollLeft, end.maxScroll);
    assert.equal(end.screenX, 1000 - COMPOSITE_TIMELINE_EDGE_PADDING);
    const settledAtStart = compositeTimelineCameraFramePure({
        beat: 0, context, zoom: 60, viewportWidth: 1000,
        visualScrollLeft: end.maxScroll, follow: true,
    });
    assert.equal(settledAtStart.visualScrollLeft, 0,
        'natural completion can return a long-song camera from the tail to the stopped marker');
    const paused = compositeTimelineCameraFramePure({
        beat: 12, context, zoom: 60, viewportWidth: 1000,
        visualScrollLeft: 321.5, follow: false,
    });
    assert.equal(paused.visualScrollLeft, 321.5,
        'Follow off preserves the user camera exactly');
});

test('paged follow anchors scale with usable track width and remain valid when narrow', () => {
    const narrow = compositeTimelinePagedGeometryPure({ viewportWidth: 200 });
    assert.equal(narrow.gutter, COMPOSITE_TIMELINE_GUTTER);
    assert.equal(narrow.usableWidth, 32);
    assert.equal(narrow.requestedEdgeInset, COMPOSITE_TIMELINE_PAGE_EDGE_MIN);
    assert.equal(narrow.edgeInset, 15.5,
        'a narrow view reduces the inset before its anchors can cross');
    assert.equal(narrow.pageTravelPx, 1);

    const normal = compositeTimelinePagedGeometryPure({ viewportWidth: 1200 });
    assert.equal(normal.usableWidth, 1032);
    assert.equal(normal.edgeInset, 103.2);
    assert.equal(normal.landingScreenX, 271.2);
    assert.equal(normal.triggerScreenX, 1096.8);

    const wide = compositeTimelinePagedGeometryPure({ viewportWidth: 3840 });
    assert.equal(wide.edgeInset, COMPOSITE_TIMELINE_PAGE_EDGE_MAX);
    assert.equal(wide.landingScreenX, COMPOSITE_TIMELINE_GUTTER
        + COMPOSITE_TIMELINE_PAGE_EDGE_MAX);
    assert.equal(wide.triggerScreenX, 3840 - COMPOSITE_TIMELINE_PAGE_EDGE_MAX);
});

test('paged follow holds before its trigger and advances at or beyond it', () => {
    const context = { startBeat: 0, endBeat: 100 };
    const zoom = 60;
    const viewportWidth = 1000;
    const contentX = compositeTimelineXForBeatPure(20, context, zoom);
    const geometry = compositeTimelinePagedGeometryPure({ viewportWidth });
    const frameAt = screenX => compositeTimelinePagedCameraPure({
        beat: 20,
        context,
        zoom,
        viewportWidth,
        visualScrollLeft: contentX - screenX,
    });

    const before = frameAt(geometry.triggerScreenX - 0.01);
    assert.equal(before.advance, false);
    assert.equal(before.reason, 'hold');
    assert.equal(before.targetScrollLeft, before.currentScrollLeft);

    const at = frameAt(geometry.triggerScreenX);
    assert.equal(at.advance, true);
    assert.equal(at.reason, 'right-trigger');
    assert.ok(Math.abs(at.targetScreenX - geometry.landingScreenX) < 1e-9);
    assert.equal(at.prefetchScrollLeft, at.targetScrollLeft);
    assert.ok(at.prefetchViewportRange.startBeat > before.prefetchViewportRange.startBeat);

    const after = frameAt(geometry.triggerScreenX + 0.01);
    assert.equal(after.advance, true);
    assert.ok(Math.abs(after.targetScreenX - geometry.landingScreenX) < 1e-9);
    assert.ok(after.deltaScrollLeft > 0);
});

test('paged follow recovers backward seeks and clamps both song edges', () => {
    const context = { startBeat: 0, endBeat: 100 };
    const backward = compositeTimelinePagedCameraPure({
        beat: 5,
        context,
        zoom: 60,
        viewportWidth: 1000,
        visualScrollLeft: 1000,
    });
    assert.equal(backward.reason, 'playhead-before-view');
    assert.equal(backward.advance, true);
    assert.equal(backward.direction, -1);
    assert.ok(Math.abs(backward.targetScreenX - backward.landingScreenX) < 1e-9);

    const start = compositeTimelinePagedCameraPure({
        beat: 0,
        context,
        zoom: 60,
        viewportWidth: 1000,
        visualScrollLeft: 1000,
    });
    assert.equal(start.targetScrollLeft, 0);
    assert.equal(start.advance, true);

    const end = compositeTimelinePagedCameraPure({
        beat: 100,
        context,
        zoom: 60,
        viewportWidth: 1000,
        visualScrollLeft: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(end.currentScrollLeft, end.maxScroll);
    assert.equal(end.targetScrollLeft, end.maxScroll);
    assert.equal(end.advance, false);
    assert.equal(end.reason, 'end-clamp');

    const fits = compositeTimelinePagedCameraPure({
        beat: 2,
        context: { startBeat: 0, endBeat: 4 },
        zoom: 60,
        viewportWidth: 1000,
        visualScrollLeft: 500,
    });
    assert.equal(fits.songFits, true);
    assert.equal(fits.maxScroll, 0);
    assert.equal(fits.targetScrollLeft, 0);
    assert.equal(fits.advance, false);
    assert.equal(fits.reason, 'song-fits');
});

test('page transitions use a 120ms cubic ease-out with immediate motion fallbacks', () => {
    assert.equal(COMPOSITE_TIMELINE_PAGE_TRANSITION_MS, 120);
    assert.equal(compositeTimelineCubicEaseOutPure(-1), 0);
    assert.equal(compositeTimelineCubicEaseOutPure(0), 0);
    assert.equal(compositeTimelineCubicEaseOutPure(0.5), 0.875);
    assert.equal(compositeTimelineCubicEaseOutPure(1), 1);
    assert.equal(compositeTimelineCubicEaseOutPure(2), 1);

    const start = compositeTimelinePageTransitionPure({
        fromScrollLeft: 100, targetScrollLeft: 500, elapsedMs: 0,
    });
    assert.equal(start.visualScrollLeft, 100);
    assert.equal(start.done, false);
    const middle = compositeTimelinePageTransitionPure({
        fromScrollLeft: 100, targetScrollLeft: 500, elapsedMs: 60,
    });
    assert.equal(middle.progress, 0.5);
    assert.equal(middle.easedProgress, 0.875);
    assert.equal(middle.visualScrollLeft, 450);
    assert.equal(middle.done, false);
    const end = compositeTimelinePageTransitionPure({
        fromScrollLeft: 100, targetScrollLeft: 500, elapsedMs: 120,
    });
    assert.equal(end.visualScrollLeft, 500);
    assert.equal(end.done, true);

    for (const option of [{ reducedMotion: true }, { immediate: true }]) {
        const settled = compositeTimelinePageTransitionPure({
            fromScrollLeft: 100,
            targetScrollLeft: 500,
            elapsedMs: 0,
            ...option,
        });
        assert.equal(settled.visualScrollLeft, 500);
        assert.equal(settled.progress, 1);
        assert.equal(settled.done, true);
        assert.equal(settled.immediate, true);
    }
});

test('render-ahead scales with the real viewport instead of a fixed song window', () => {
    assert.equal(compositeTimelineRenderBufferPure(600), 1800);
    assert.equal(compositeTimelineRenderBufferPure(1600), 3200);
    assert.equal(compositeTimelineRenderGuardPure(600), 900);
    assert.equal(compositeTimelineRenderGuardPure(1600), 2280,
        'the guard follows the capped strip runway rather than an impossible five screens');
    assert.equal(compositeTimelineRenderGuardPure(3840), 1440,
        'a 4K strip begins standby work with three quarters of its runway remaining');
});

test('timeline detail policy changes only ruler and grid density', () => {
    assert.equal(compositeTimelineDetailLevelPure(120).id, 'full');
    assert.equal(compositeTimelineDetailLevelPure(60).id, 'compact');
    assert.equal(compositeTimelineDetailLevelPure(3).id, 'density');
    assert.equal(compositeTimelineDetailLevelPure(89.99).id, 'compact');
    assert.equal(compositeTimelineDetailLevelPure(90).id, 'full');
});

test('timeline note glyph metrics are fixed CSS-pixel dimensions', () => {
    assert.deepEqual(compositeTimelineNoteGlyphMetricsPure(7), {
        label: '7', width: 20, height: 18, radius: 7,
        fretFontSize: 11, badgeFontSize: 8,
        outlineWidth: 1.5, selectedOutlineWidth: 2.5,
    });
    assert.equal(compositeTimelineNoteGlyphMetricsPure(12).width, 26,
        'the existing two-digit fret width rule is preserved');
    assert.equal(compositeTimelineNoteGlyphMetricsPure(120).width, 34);
});

test('bounded strip geometry keeps a viewport-centered local surface and clamps at song edges', () => {
    const context = { startBeat: 0, endBeat: 100 };
    const zoom = 120;
    const viewportWidth = 1000;
    const middle = compositeTimelineStripGeometryPure({
        context, zoom, visualScrollLeft: 4000, viewportWidth,
    });
    assert.equal(COMPOSITE_TIMELINE_STRIP_VIEWPORTS, 5);
    assert.equal(middle.surfaceWidth, 5000);
    assert.equal(middle.renderOriginX, 2000);
    assert.equal(middle.viewportLocalX, 2000);
    assert.equal(middle.globalEndX, 7000);
    assert.ok(middle.surfaceWidth < middle.contentWidth,
        'the painted SVG is bounded instead of spanning the whole song');
    assert.deepEqual(middle.renderRange, compositeTimelineRenderRangePure({
        context, zoom, renderOriginX: 2000, surfaceWidth: 5000,
    }));

    const start = compositeTimelineStripGeometryPure({
        context, zoom, visualScrollLeft: 0, viewportWidth,
    });
    assert.equal(start.renderOriginX, 0);
    assert.equal(start.renderRange.startBeat, 0);
    const end = compositeTimelineStripGeometryPure({
        context, zoom, visualScrollLeft: 1_000_000, viewportWidth,
    });
    assert.equal(end.renderOriginX, end.contentWidth - end.surfaceWidth);
    assert.equal(end.renderRange.endBeat, 100);

    assert.equal(compositeTimelineRenderOriginPure({
        visualScrollLeft: 4000, viewportWidth, contentWidth: middle.contentWidth,
        surfaceWidth: middle.surfaceWidth,
    }), middle.renderOriginX);
});

test('4K strip surfaces obey a CSS-pixel cap without changing song coordinates', () => {
    const context = { startBeat: 0, endBeat: 1_000 };
    const viewportWidth = 3840;
    const geometry = compositeTimelineStripGeometryPure({
        context, zoom: 120, visualScrollLeft: 50_000, viewportWidth,
    });
    assert.equal(COMPOSITE_TIMELINE_STRIP_MAX_WIDTH, 7680);
    assert.equal(geometry.surfaceWidth, COMPOSITE_TIMELINE_STRIP_MAX_WIDTH,
        'the old five-viewport surface would have been 19,200 CSS pixels');
    assert.ok(geometry.surfaceWidth >= viewportWidth);
    assert.equal(geometry.viewportLocalX, (geometry.surfaceWidth - viewportWidth) / 2);
    assert.equal(geometry.globalEndX,
        geometry.renderOriginX + COMPOSITE_TIMELINE_STRIP_MAX_WIDTH);
    assert.deepEqual(geometry.renderRange, compositeTimelineRenderRangePure({
        context, zoom: 120,
        renderOriginX: geometry.renderOriginX,
        surfaceWidth: geometry.surfaceWidth,
    }));

    const widerThanCap = compositeTimelineStripGeometryPure({
        context, zoom: 120, viewportWidth: 8_000,
    });
    assert.equal(widerThanCap.surfaceWidth, 8_000,
        'an unusually wide viewport still receives one complete viewport');
});

test('global and strip-local x coordinates round trip without changing musical time', () => {
    const context = { startBeat: 0, endBeat: 100 };
    const globalX = compositeTimelineXForBeatPure(37.125, context, 120);
    const localX = compositeTimelineGlobalToLocalXPure(globalX, 2000.5);
    assert.equal(compositeTimelineLocalToGlobalXPure(localX, 2000.5), globalX);
    assert.ok(Math.abs(compositeTimelineBeatForXPure(
        compositeTimelineLocalToGlobalXPure(localX, 2000.5), context, 120) - 37.125) < 1e-9);
});

test('lane and ruler renderers can paint the same global beats into a bounded local strip', () => {
    const model = view();
    const geometry = compositeTimelineStripGeometryPure({
        context: model.context,
        zoom: 32,
        visualScrollLeft: 700,
        viewportWidth: 400,
        stripViewports: 3,
    });
    assert.equal(geometry.renderOriginX, 0,
        'this short fixture fits inside its requested strip');

    const forcedOrigin = 300;
    const surfaceWidth = 400;
    const visibleRange = compositeTimelineRenderRangePure({
        context: model.context, zoom: 32,
        renderOriginX: forcedOrigin, surfaceWidth,
    });
    const options = { renderOriginX: forcedOrigin, surfaceWidth };
    const lane = renderCompositeTimelineLaneContents(
        model, 'secondary', 158, visibleRange, 32, options);
    const ruler = renderCompositeTimelineRulerContents(model, visibleRange, 32, options);
    const expectedLocalX = compositeTimelineGlobalToLocalXPure(
        compositeTimelineXForBeatPure(8, model.context, 32), forcedOrigin);
    assert.equal(expectedLocalX, 152);
    assert.match(lane, /<rect width="400" height="158" fill="#0f172a"/);
    assert.match(lane, /<text x="152\.0"[^>]*>7<\/text>/);
    assert.match(ruler, /<rect width="400" height="34"/);
    assert.match(ruler, /x1="152\.0"/,
        'bar and note geometry share the same local coordinate map');

    const fullWidth = compositeTimelineContentWidthPure(model.context, 32);
    assert.equal(renderCompositeTimelineLaneContents(
        model, 'secondary', 158, visibleRange, 32),
    renderCompositeTimelineLaneContents(model, 'secondary', 158, visibleRange, 32, {
        renderOriginX: 0, surfaceWidth: fullWidth,
    }), 'omitting strip options preserves the previous full-song markup');
});

test('cursor-anchored zoom preserves the beat beneath the pointer and clamps scrolling', () => {
    const model = view();
    const before = { context: model.context, oldZoom: 20, newZoom: 40,
        scrollLeft: 100, anchorX: 300, viewportWidth: 700 };
    const result = compositeTimelineZoomAtPure(before);
    const oldBeat = (before.scrollLeft + before.anchorX - COMPOSITE_TIMELINE_GUTTER
        - COMPOSITE_TIMELINE_EDGE_PADDING) / before.oldZoom;
    const newBeat = (result.scrollLeft + before.anchorX - COMPOSITE_TIMELINE_GUTTER
        - COMPOSITE_TIMELINE_EDGE_PADDING) / result.zoom;
    assert.ok(Math.abs(oldBeat - newBeat) < 1e-9);
    assert.ok(result.scrollLeft <= compositeTimelineContentWidthPure(model.context, result.zoom) - 700);
});

test('fine timeline zoom moves on an exact five-pixel grid', () => {
    assert.equal(compositeTimelineSteppedZoomPure(120, 1), 125);
    assert.equal(compositeTimelineSteppedZoomPure(120, -1), 115);
    assert.equal(compositeTimelineSteppedZoomPure(122, 1), 125);
    assert.equal(compositeTimelineSteppedZoomPure(122, -1), 120);
    assert.equal(compositeTimelineSteppedZoomPure(123), 125,
        'the slider reflects the nearest five-pixel stop');
    assert.equal(compositeTimelineSteppedZoomPure(480, 1), 480);
    assert.equal(compositeTimelineSteppedZoomPure(1, -1), 1,
        'fit-song may stay below the manual slider floor');
    assert.equal(compositeTimelineSteppedZoomPure(1, 1), 5,
        'manual zoom returns from fit-song at the first useful stop');
});

test('fit-song zoom uses the available timeline width', () => {
    const model = view();
    const zoom = compositeTimelineFitZoomPure(model.context, 960);
    assert.ok(zoom > 2 && zoom < 40);
    assert.ok(compositeTimelineContentWidthPure(model.context, zoom) <= 962);
    assert.equal(compositeTimelineXForBeatPure(model.context.startBeat,
        model.context, zoom) - COMPOSITE_TIMELINE_GUTTER,
    COMPOSITE_TIMELINE_EDGE_PADDING);
    assert.ok(960 - compositeTimelineXForBeatPure(model.context.endBeat,
        model.context, zoom) >= COMPOSITE_TIMELINE_EDGE_PADDING - 1,
    'fit-song retains matching visual space at the final beat');
});

test('fit-song still fits a long song instead of stopping at an editor-style zoom floor', () => {
    const model = view();
    const longContext = { ...model.context, endBeat: 560 };
    const zoom = compositeTimelineFitZoomPure(longContext, 1200);
    assert.ok(zoom >= 1 && zoom < 2);
    assert.ok(compositeTimelineContentWidthPure(longContext, zoom) <= 1202);
    const veryLongContext = { ...model.context, endBeat: 2000 };
    const subPixelZoom = compositeTimelineFitZoomPure(veryLongContext, 1200);
    assert.ok(subPixelZoom > 0 && subPixelZoom < 1,
        'explicit Overview may use sub-pixel beat spacing');
    assert.ok(compositeTimelineContentWidthPure(veryLongContext, subPixelZoom) <= 1202,
        'even an unusually long song still fits the Overview viewport');
});

test('lane and overview markup contain full-song notes without review controls', () => {
    const model = view();
    const visible = { startBeat: 0, endBeat: model.context.endBeat };
    const lane = renderCompositeTimelineLaneContents(model, 'result', 158, visible, 32);
    assert.match(lane, />3</);
    assert.match(lane, />7</);
    assert.doesNotMatch(lane, /data-composite-entry-id|>REVIEW</);
    const map = renderCompositeTimelineMapSvg(model, { startBeat: 2, endBeat: 8 });
    assert.match(map, /Whole-song Hybrid overview/);
    assert.match(map, /fill="#c084fc"/, 'fill-track additions share the main song map');
    assert.doesNotMatch(map, /editor-composite-map-(viewport|playhead)/,
        'the dense overview SVG stays static while HTML overlays move above it');
});

test('dense overview groups decisions but keeps a late focused marker interactive', () => {
    const count = 20_000;
    assert.equal(COMPOSITE_TIMELINE_OVERVIEW_INTERVAL_LIMIT, 512);
    const decisions = Array.from({ length: count }, (_, index) => ({
        id: `decision:${index}`,
        index,
        startBeat: index,
        endBeat: index + 0.5,
        state: index % 3 === 0 ? 'resolved' : index % 3 === 1 ? 'unresolved' : 'invalid',
    }));
    const map = renderCompositeTimelineMapSvg({
        context: { startBeat: 0, endBeat: count },
        lanes: [{ id: 'result', entries: [] }],
        review: { id: decisions.at(-1).id },
        decisions,
    });

    assert.equal((map.match(/data-composite-map-decision="/g) || []).length, 1,
        'only the focused decision remains an individual SVG hit target');
    assert.match(map, /data-composite-map-decision="19999"/,
        'a focused decision beyond the aggregation limit remains selectable');
    assert.match(map, /data-composite-map-decision-density=/);
    assert.match(map, /data-composite-map-density-kind="decision"[^>]*pointer-events="fill"/,
        'a delegated handler can distinguish and hit a grouped decision path');
    assert.match(map, /Dense 20000 decision markers are visually grouped[^<]*clicking a grouped marker opens the exact section/,
        'the accessible description explains that grouped marks still open exact sections');
    assert.match(map, /data-composite-map-density-state="(?:resolved|unresolved|invalid)"[^>]*aria-hidden="true"/,
        'decorative grouped paths defer their name to the containing labelled map button');
    assert.ok((map.match(/data-composite-map-decision-density=/g) || []).length <= 3,
        'decision aggregation emits at most one path per visible state');
    assert.ok(map.length < 250_000,
        `twenty thousand intervals should not produce unbounded markup (${map.length} chars)`);
});

test('dense overview hit index resolves overlaps, visual gaps, states, and focus deterministically', () => {
    const decisions = [
        { id: 'early', index: 0, startBeat: 1, endBeat: 3, state: 'unresolved' },
        { id: 'top', index: 1, startBeat: 2, endBeat: 4, state: 'unresolved' },
        { id: 'right', index: 2, startBeat: 6, endBeat: 7, state: 'unresolved' },
        { id: 'resolved', index: 3, startBeat: 2, endBeat: 5, state: 'resolved' },
        { id: 'focused', index: 4, startBeat: 2, endBeat: 5, state: 'unresolved' },
        { id: 'other-state', index: 5, startBeat: 8, endBeat: 9, state: 'imported-new-state' },
    ];
    const view = { review: { id: 'focused' }, decisions };
    const index = compositeTimelineOverviewIntervalIndexPure(view);

    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 2.5, {
        kind: 'decision', state: 'unresolved',
    })?.id, 'top', 'later ordinary paint order wins an overlap');
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 5, {
        kind: 'decision', state: 'unresolved',
    })?.id, 'right', 'an equal visual-gap distance selects the later painted interval');
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 2.5, {
        kind: 'decision', state: 'resolved',
    })?.id, 'resolved', 'the density marker state filters the exact target');
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 2.5, {
        kind: 'decision', state: 'missing-custom-state',
    }), null, 'an absent grouped state cannot select an unrelated marker');
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 8.5, {
        kind: 'decision', state: 'other',
    })?.id, 'other-state', 'the literal visual fallback state remains queryable');
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(view, 2.5, {
        kind: 'decision', state: 'unresolved',
    })?.id, 'top', 'a view remains a correct one-off input without retaining an index');
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 2, { kind: 'unknown' }),
        null, 'unknown marker kinds fail closed');
});

test('overview interval focus exclusion mirrors rendering for falsy decision ids', () => {
    for (const focusedId of [0, '']) {
        const decisions = [
            { id: focusedId, index: 0, startBeat: 1, endBeat: 3, state: 'unresolved' },
            { id: 'ordinary', index: 1, startBeat: 5, endBeat: 6, state: 'unresolved' },
        ];
        const index = compositeTimelineOverviewIntervalIndexPure({
            review: { id: focusedId },
            decisions,
        });
        assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 2, {
            kind: 'decision', state: 'unresolved',
        })?.id, 'ordinary', `focused id ${JSON.stringify(focusedId)} stays out of density hits`);
    }
});

test('overview interval index matches brute-force marker intent on randomized overlaps', () => {
    let seed = 0x2f6e2b1;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    const states = ['unresolved', 'resolved', 'invalid'];
    const decisions = Array.from({ length: 600 }, (_, sourceIndex) => {
        const startBeat = Math.floor(random() * 1200) / 8;
        return {
            id: `random:${sourceIndex}`,
            index: sourceIndex,
            startBeat,
            endBeat: startBeat + Math.floor(random() * 96) / 8,
            state: states[Math.floor(random() * states.length)],
        };
    });
    const view = { decisions };
    const index = compositeTimelineOverviewIntervalIndexPure(view);
    const brute = (beat, state) => {
        const candidates = decisions.filter(item => item.state === state);
        const containing = candidates.filter(item => item.startBeat <= beat
            && item.endBeat >= beat);
        if (containing.length) return containing.at(-1);
        let best = null;
        let bestDistance = Infinity;
        for (const item of candidates) {
            const distance = beat < item.startBeat ? item.startBeat - beat
                : beat > item.endBeat ? beat - item.endBeat : 0;
            if (distance < bestDistance || (distance === bestDistance
                    && item.index > best.index)) {
                best = item;
                bestDistance = distance;
            }
        }
        return best;
    };
    for (let query = 0; query < 2_000; query++) {
        const beat = Math.floor(random() * 1400) / 8 - 10;
        const state = states[Math.floor(random() * states.length)];
        assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, beat, {
            kind: 'decision', state,
        })?.id, brute(beat, state)?.id, `beat ${beat}, state ${state}`);
    }
});

test('twenty-thousand-marker overview index stays below the renderer long-task regression', () => {
    const count = 20_000;
    const decisions = Array.from({ length: count }, (_, index) => ({
        id: `decision:${index}`,
        index,
        startBeat: index * 0.75,
        endBeat: index * 0.75 + 0.5,
        state: index % 2 ? 'resolved' : 'unresolved',
    }));
    const started = performance.now();
    const hitIndex = compositeTimelineOverviewIntervalIndexPure({ decisions });
    const elapsed = performance.now() - started;
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(hitIndex, 14_999, {
        kind: 'decision', state: 'resolved',
    })?.id, 'decision:19999');
    assert.ok(hitIndex.decision.all.starts.length <= count,
        'the exact index stores endpoints, not a song-duration-sized lookup table');
    // Local cold builds are about 15–45 ms and warm builds about 2–14 ms. Keep
    // enough headroom for shared/coverage CI while still guarding against the
    // previous 200–380 ms renderer-blocking implementation.
    assert.ok(elapsed < 100,
        `twenty thousand intervals should index below a long-task budget (${elapsed.toFixed(1)} ms)`);
});

test('ordinary overview counts preserve every decision hit target', () => {
    const decisions = Array.from({ length: 12 }, (_, index) => ({
        id: `decision:${index}`, index, startBeat: index, endBeat: index + 0.5,
        state: 'unresolved',
    }));
    const map = renderCompositeTimelineMapSvg({
        context: { startBeat: 0, endBeat: 12 },
        lanes: [{ id: 'result', entries: [] }],
        review: null,
        decisions,
    });
    assert.equal((map.match(/data-composite-map-decision="/g) || []).length, 12);
    assert.doesNotMatch(map, /data-composite-map-decision-density=/);
    assert.match(map, /aria-label="Whole-song Hybrid overview"/,
        'normal songs keep the previous concise accessible name');
});

test('overview viewport geometry can update without rebuilding the whole map', () => {
    const model = view();
    assert.deepEqual(compositeTimelineMapViewportPure(model, {
        startBeat: 6, endBeat: 12,
    }), { x: 250, width: 250 });
});

test('overview viewport excludes the sticky track-label gutter', () => {
    const context = { startBeat: 0, endBeat: 100 };
    const range = compositeTimelineViewportRangePure({
        context, zoom: 20, scrollLeft: 100, viewportWidth: 700,
    });
    assert.equal(range.startBeat, (100 - COMPOSITE_TIMELINE_EDGE_PADDING) / 20);
    assert.equal(range.endBeat, (100 + 700 - COMPOSITE_TIMELINE_GUTTER
        - COMPOSITE_TIMELINE_EDGE_PADDING) / 20);
    assert.equal((range.endBeat - range.startBeat) * 20,
        700 - COMPOSITE_TIMELINE_GUTTER,
    'the overview box represents only the note surface visible beside the labels');
});

test('display edge padding protects beat-zero and endpoint notes without changing time', () => {
    const context = { startBeat: 0, endBeat: 24 };
    const zoom = 120;
    const firstX = compositeTimelineXForBeatPure(0, context, zoom);
    const lastX = compositeTimelineXForBeatPure(24, context, zoom);
    assert.equal(firstX, COMPOSITE_TIMELINE_GUTTER
        + COMPOSITE_TIMELINE_EDGE_PADDING);
    assert.equal(compositeTimelineBeatForXPure(firstX, context, zoom), 0,
        'visual headroom must not invent musical time before beat zero');
    assert.equal(compositeTimelineContentWidthPure(context, zoom) - lastX,
        COMPOSITE_TIMELINE_EDGE_PADDING,
    'the final note/trail gets the same visual breathing room');

    const initial = compositeTimelineViewportRangePure({
        context, zoom, scrollLeft: 0, viewportWidth: 1000,
    });
    assert.equal(initial.startBeat, 0);
    assert.equal(initial.endBeat,
        (1000 - COMPOSITE_TIMELINE_GUTTER
            - COMPOSITE_TIMELINE_EDGE_PADDING) / zoom,
    'the overview range excludes the non-musical leading pixels');

    for (const candidateZoom of [1, 60, 120, 480]) {
        for (const beat of [0, 0.125, 12, 23.999, 24]) {
            const x = compositeTimelineXForBeatPure(beat, context, candidateZoom);
            assert.ok(Math.abs(compositeTimelineBeatForXPure(
                x, context, candidateZoom) - beat) < 1e-9,
            'the display margin must not alter coordinate round trips');
        }
    }
});

test('a fret marker on either song boundary stays wholly inside the tablature', () => {
    const model = view();
    const zero = entry('zero', 0, 0, 0, 24);
    const ending = entry('ending', model.context.endBeat,
        model.context.endBeat, 0, 24);
    model.lanes[0].entries = [zero, ending];
    const visible = { startBeat: 0, endBeat: model.context.endBeat };
    const lane = renderCompositeTimelineLaneContents(model, 'primary', 158, visible, 120);
    const noteHalfWidth = 13; // two-digit fret marker: (10 + 2 * 8) / 2
    const firstLeft = COMPOSITE_TIMELINE_GUTTER
        + COMPOSITE_TIMELINE_EDGE_PADDING - noteHalfWidth;
    const lastLeft = compositeTimelineXForBeatPure(model.context.endBeat,
        model.context, 120) - noteHalfWidth;
    const radius = compositeTimelineNoteGlyphMetricsPure(24).radius;
    assert.match(lane, new RegExp(`M${(firstLeft + radius).toFixed(1)} `));
    assert.match(lane, new RegExp(`M${(lastLeft + radius).toFixed(1)} `));
    assert.ok(firstLeft > COMPOSITE_TIMELINE_GUTTER);
    assert.ok(compositeTimelineContentWidthPure(model.context, 120)
        - (lastLeft + noteHalfWidth * 2) > 0);

    model.lanes[2].entries = [zero];
    const map = renderCompositeTimelineMapSvg(model, visible, 0);
    assert.match(map, /<rect data-composite-map-density="true" x="0\.0" y="17"/,
        'the overview remains mapped to real time rather than fake visual pre-roll');
});

test('overview aggregation includes every note without unbounded SVG nodes', () => {
    const model = view();
    model.lanes[2].entries = Array.from({ length: 5_200 }, (_, index) =>
        entry(`dense:${index}`, index / 10, index / 10 + 0.04, 0, 3,
            index === 5_199 ? 'secondary' : 'primary'));
    model.context.endBeat = 520;
    const map = renderCompositeTimelineMapSvg(model, {
        startBeat: 0, endBeat: model.context.endBeat,
    });
    assert.match(map, /fill="#c084fc"/,
        'a fill note beyond the former 4,000-note cutoff remains represented');
    assert.ok((map.match(/data-composite-map-density=/g) || []).length <= 2_000,
        'the static overview is bounded by its 1,000 horizontal bins per source');
    assert.doesNotMatch(map, /slice\(0, 4000\)/);
});

test('overview pointer coordinates map exactly to the song and center the tablature area', () => {
    const model = view();
    const beat = compositeTimelineMapBeatPure({
        clientX: 600, mapLeft: 100, mapWidth: 1000, context: model.context,
    });
    assert.equal(beat, 12, 'the middle of the overview is the middle of the 24-beat song');
    assert.equal(compositeTimelineMapBeatPure({
        clientX: 50, mapLeft: 100, mapWidth: 1000, context: model.context,
    }), 0, 'dragging left of the map clamps to the song start');
    assert.equal(compositeTimelineMapBeatPure({
        clientX: 1200, mapLeft: 100, mapWidth: 1000, context: model.context,
    }), 24, 'dragging right of the map clamps to the song end');

    const scrollLeft = compositeTimelineCenteredScrollPure({
        beat, context: model.context, zoom: 60, viewportWidth: 1000,
    });
    const x = compositeTimelineXForBeatPure(beat, model.context, 60);
    assert.equal(x - scrollLeft, COMPOSITE_TIMELINE_GUTTER
        + (1000 - COMPOSITE_TIMELINE_GUTTER) / 2,
    'the chosen beat is centered in the visible tablature, excluding the sticky labels');
});

test('review timeline uses the shared lanes with selectable notes and one focus band', () => {
    const model = view();
    model.review = {
        id: 'decision:1', index: 0, startBeat: 2, endBeat: 4,
        contextStartBeat: 0, contextEndBeat: 8, state: 'unresolved',
    };
    model.decisions = [{ id: 'decision:1', index: 0, startBeat: 2, endBeat: 4,
        state: 'unresolved' }];
    model.lanes[0].entries[0] = {
        ...model.lanes[0].entries[0], selectable: true, selected: true, inConflict: true,
    };
    const visible = { startBeat: 0, endBeat: 12 };
    const lane = renderCompositeTimelineLaneContents(model, 'primary', 158, visible, 120);
    const ruler = renderCompositeTimelineRulerContents(model, visible, 120);
    const map = renderCompositeTimelineMapSvg(model, visible, 3);
    assert.match(map, /preserveAspectRatio="none"/,
        'the overview drawing fills its clickable width without invisible letterboxing');
    assert.match(lane, /data-composite-entry-id="p:1"/);
    assert.match(lane, /role="checkbox"/);
    assert.match(lane, /aria-label="String 6, fret 3,/);
    assert.match(lane, /stroke="#fbbf24"/);
    assert.match(ruler, />REVIEW</);
    assert.match(map, /data-composite-map-decision="0"/);
    assert.doesNotMatch(map, /id="editor-composite-map-playhead"/);
});

test('review choice highlights only the matching fixed track header', () => {
    const model = view();
    model.review = { id: 'decision:1' };
    model.selectedLaneId = 'secondary';
    const primary = renderCompositeTimelineLaneHeader(model, 'primary', 158);
    const secondary = renderCompositeTimelineLaneHeader(model, 'secondary', 158);
    const result = renderCompositeTimelineLaneHeader(model, 'result', 158);
    assert.match(secondary, /data-composite-choice-active="true"/);
    assert.match(secondary, /selected for this decision/);
    assert.match(secondary, />Selected</);
    assert.match(primary, /data-composite-choice-active="false"/);
    assert.doesNotMatch(primary, />Selected</);
    assert.doesNotMatch(result, />Selected</);
});

test('the main playhead keeps essential packaged-runtime styling inline', () => {
    const markup = renderCompositeTimelinePlayhead(222.5);
    assert.match(markup, /id="editor-composite-timeline-playhead"/);
    assert.match(markup, /left:0;transform:translate3d\(222\.5px,0,0\);will-change:transform/);
    assert.match(markup, /width:2px;background:#fb7185/);
    assert.match(markup, /border-top:8px solid #fb7185/);
    assert.match(renderCompositeTimelinePlayhead(),
        new RegExp(`translate3d\\(${COMPOSITE_TIMELINE_GUTTER + COMPOSITE_TIMELINE_EDGE_PADDING}px,0,0\\)`));
});

test('the ruler thins labels and beat ticks at whole-song fit zoom', () => {
    const model = view();
    const visible = { startBeat: 0, endBeat: model.context.endBeat };
    const fitted = renderCompositeTimelineRulerContents(model, visible, 3);
    const detailed = renderCompositeTimelineRulerContents(model, visible, 32);
    assert.ok((fitted.match(/>Bar /g) || []).length < (detailed.match(/>Bar /g) || []).length);
    assert.ok((fitted.match(/<line /g) || []).length < (detailed.match(/<line /g) || []).length);
});

test('static timeline notation stays canonical at every normal zoom and batches its heads', () => {
    const model = view();
    model.lanes[2].entries = Array.from({ length: 96 }, (_, index) =>
        ({
            ...entry(`dense:${index}`, index / 4, index / 4 + 0.25,
                index % 6, index % 24, 'primary'),
            note: { techniques: index % 7 === 0 ? { bend: true } : {} },
        }));
    const visible = { startBeat: 0, endBeat: model.context.endBeat };
    for (const zoom of [5, 60, 89.99, 90, 120, 240, 480]) {
        const markup = renderCompositeTimelineLaneContents(
            model, 'result', 158, visible, zoom);
        assert.equal((markup.match(/data-composite-static-note-heads=/g) || []).length, 1,
            `${zoom} px/beat batches every ordinary rounded head into one path`);
        assert.equal((markup.match(/data-composite-static-note="true"/g) || []).length, 96,
            `${zoom} px/beat retains one readable fret label per attack`);
        assert.equal((markup.match(/<g/g) || []).length, 0,
            `${zoom} px/beat does not restore a full group/title subtree per static note`);
        assert.equal((markup.match(/<title>/g) || []).length, 0);
        assert.match(markup,
            /data-composite-static-note-heads="true"[^>]*stroke-width="1\.5"/);
        assert.match(markup,
            /data-composite-static-note="true"[^>]*fill="#f8fafc"[^>]*font-size="11"/);
        assert.match(markup,
            /data-composite-static-technique="true"[^>]*font-size="8"[^>]*>B<\/text>/,
        'visible technique notation is not removed by zoom');
        assert.match(markup,
            /data-composite-static-note="true" aria-hidden="true"/,
        'decorative static labels do not flood the accessibility tree');
        assert.ok(markup.indexOf('data-composite-static-technique="true"')
            < markup.indexOf('data-composite-static-note="true"'),
        'fret labels paint after technique badges and remain visually dominant');
        assert.equal((markup.match(/data-composite-density-notes=/g) || []).length, 0,
            'density rendering is never selected by an implicit zoom threshold');
    }

    const overview = renderCompositeTimelineLaneContents(
        model, 'result', 158, visible, 3, { overviewDensity: true });
    assert.equal((overview.match(/data-composite-density-notes=/g) || []).length, 1,
        'an explicit overview may collapse static attacks into one SVG path');
    assert.equal((overview.match(/data-composite-static-note(?:-heads)?=/g) || []).length, 0);
});

test('20k-note Overview is pixel-bounded, omits ordinary notation, and represents the tail', () => {
    const model = view();
    const ordinaryCount = 19_999;
    const entries = Array.from({ length: ordinaryCount }, (_, index) => {
        const startBeat = index / ordinaryCount * 490;
        return {
            ...entry(`overview:${index}`, startBeat, startBeat + 1.5,
                index % 5, index % 24, 'primary'),
            effectiveEndBeat: startBeat + 2,
            note: { techniques: { bend: true, tremolo: true } },
        };
    });
    entries.push({
        ...entry('overview:tail', 499.5, 500, 5, 22, 'secondary'),
        note: { techniques: { palm_mute: true } },
    });
    model.context.endBeat = 500;
    model.lanes[2].entries = entries;

    const zoom = 1;
    const markup = renderCompositeTimelineLaneContents(model, 'result', 158,
        { startBeat: 0, endBeat: 500 }, zoom, { overviewDensity: true });
    const densityPath = markup.match(
        /<path data-composite-density-notes="true" data-composite-density-bin-count="(\d+)"[^>]* d="([^"]+)"/);
    assert.ok(densityPath, 'Overview emits one aggregated attack path');
    const binCount = Number(densityPath[1]);
    const commands = (densityPath[2].match(/M/g) || []).length;
    const surfaceWidth = compositeTimelineContentWidthPure(model.context, zoom);
    assert.equal(commands, binCount);
    assert.ok(commands <= Math.ceil(surfaceWidth) * model.stringCount,
        'ordinary path commands are bounded by surface pixels times strings');
    assert.ok(commands < entries.length / 2,
        'the dense fixture collapses substantially instead of scaling by note count');
    assert.doesNotMatch(markup, /data-composite-static-note/);
    assert.doesNotMatch(markup, /data-composite-static-technique/);
    assert.doesNotMatch(markup, /data-composite-static-trails/);
    assert.doesNotMatch(markup, /<title>/);
    assert.doesNotMatch(markup, /<g(?:\s|>)/);

    const tailX = compositeTimelineXForBeatPure(499.5, model.context, zoom);
    const tailBinCenter = Math.floor(tailX) + 0.5;
    assert.match(densityPath[2], new RegExp(
        `M${tailBinCenter.toFixed(1)} 28\\.0h0\\.1`),
    'the final note remains represented in its own string/pixel bin');
});

test('canonical head geometry is zoom-invariant for static, focused, and interactive notes', () => {
    const model = view();
    const authored = {
        ...entry('canonical', 2, 3, 0, 12),
        note: { techniques: { bend: true } },
    };
    model.lanes[0].entries = [authored];
    const visible = { startBeat: 0, endBeat: model.context.endBeat };
    const y = 136;
    const metrics = compositeTimelineNoteGlyphMetricsPure(12);

    for (const zoom of [5, 60, 89.99, 90, 120, 240, 480]) {
        const x = compositeTimelineXForBeatPure(2, model.context, zoom);
        const staticMarkup = renderCompositeTimelineLaneContents(
            model, 'primary', 158, visible, zoom);
        assert.match(staticMarkup, new RegExp(
            `M${(x - metrics.width / 2 + metrics.radius).toFixed(1)} ${(y - 9).toFixed(1)}`
            + `H${(x + metrics.width / 2 - metrics.radius).toFixed(1)}`),
        `the ${zoom} px/beat batched path keeps a 26 by 18 rounded head`);
        assert.match(staticMarkup, new RegExp(
            `<text x="${x.toFixed(1)}" data-composite-static-note="true"[^>]*font-size="11"[^>]*>12<\\/text>`));
        assert.match(staticMarkup,
            /data-composite-static-technique="true"[^>]*font-size="8"[^>]*>B<\/text>/);

        model.review = {
            id: 'focus', startBeat: 2, endBeat: 3,
            contextStartBeat: 0, contextEndBeat: 4, state: 'unresolved',
        };
        const focusedMarkup = renderCompositeTimelineLaneContents(
            model, 'primary', 158, visible, zoom);
        assert.match(focusedMarkup, new RegExp(
            `<rect x="${(x - 13).toFixed(1)}" y="127\\.0" width="26" height="18" rx="7"[^>]*stroke-width="1\\.5"`));
        assert.match(focusedMarkup,
            /fill="#f8fafc" font-size="11" font-weight="700">12<\/text>/);
        assert.match(focusedMarkup,
            /fill="#fcd34d" font-size="8" font-weight="700">B<\/text>/);

        model.review = null;
        model.lanes[0].entries = [{ ...authored, selectable: true }];
        const interactiveMarkup = renderCompositeTimelineLaneContents(
            model, 'primary', 158, visible, zoom);
        assert.match(interactiveMarkup, /data-composite-entry-id="canonical"/);
        assert.match(interactiveMarkup, new RegExp(
            `<rect x="${(x - 13).toFixed(1)}" y="127\\.0" width="26" height="18" rx="7"[^>]*stroke-width="1\\.5"`));
        model.lanes[0].entries = [authored];
    }
});

test('explicit density overview keeps manual-review detail and omits ordinary trails', () => {
    const model = view();
    model.review = {
        id: 'decision:fit', startBeat: 2, endBeat: 4,
        contextStartBeat: 0, contextEndBeat: 8, state: 'unresolved',
    };
    const focused = {
        ...entry('focused', 2, 4, 0, 11),
        effectiveEndBeat: 6,
        selectable: true,
        selected: true,
        inConflict: true,
        note: { techniques: { tremolo: true } },
    };
    const longTrail = entry('background-trail', 8, 20, 1, 5);
    model.lanes[0].entries = [focused, longTrail];
    const visible = { startBeat: 0, endBeat: model.context.endBeat };
    const fitted = renderCompositeTimelineLaneContents(
        model, 'primary', 158, visible, 3, { overviewDensity: true });

    assert.match(fitted, /data-composite-entry-id="focused"/);
    assert.match(fitted, /role="checkbox"/);
    assert.match(fitted, /<title>String 6, fret 11,/);
    assert.match(fitted, /stroke-dasharray="3 3"/,
        'the focused authored tremolo trail retains complete detail');
    assert.match(fitted, /stroke-dasharray="5 4"/,
        'the focused effective trail boundary remains distinct');
    assert.doesNotMatch(fitted, /data-composite-static-trails=/,
        'ordinary background trails are not miniature notation in Overview');
    const expectedTrailEnd = compositeTimelineXForBeatPure(20, model.context, 3);
    assert.doesNotMatch(fitted, new RegExp(`H${expectedTrailEnd.toFixed(1)}`),
        'the ordinary background trail is omitted even when it crosses the view');
    assert.equal((fitted.match(/data-composite-density-notes=/g) || []).length, 1,
        'only the non-review attack is density-rendered');
});
