import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCompositeTimelineViewModel,
    COMPOSITE_TIMELINE_EDGE_PADDING,
    COMPOSITE_TIMELINE_GUTTER,
    COMPOSITE_TIMELINE_STRIP_VIEWPORTS,
    compositeTimelineBeatForXPure,
    compositeTimelineCameraFramePure,
    compositeTimelineCameraOffsetPure,
    compositeTimelineCenteredScrollPure,
    compositeTimelineContentWidthPure,
    compositeTimelineDisplayBeatPure,
    compositeTimelineEntriesInRangePure,
    compositeTimelineFitZoomPure,
    compositeTimelineGlobalToLocalXPure,
    compositeTimelineLocalToGlobalXPure,
    compositeTimelineMapViewportPure,
    compositeTimelineMapBeatPure,
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
            passages: [{
                id: 'experimental:passage:1', startBeat: 8, endBeat: 9,
                status: 'automatic', label: 'Bar 3', handoffScore: 92,
                noteCount: 1, entries: [entry('s:1', 8, 9, 2, 7, 'secondary')],
                reasons: [], explanation: 'Added automatically.',
            }],
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

test('render-ahead scales with the real viewport instead of a fixed song window', () => {
    assert.equal(compositeTimelineRenderBufferPure(600), 1800);
    assert.equal(compositeTimelineRenderBufferPure(1600), 3200);
    assert.equal(compositeTimelineRenderGuardPure(600), 900);
    assert.equal(compositeTimelineRenderGuardPure(1600), 2400);
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
    assert.match(map, /data-composite-map-passage="experimental:passage:1"/);
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
    assert.match(lane, new RegExp(`x="${firstLeft.toFixed(1)}"`));
    assert.match(lane, new RegExp(`x="${lastLeft.toFixed(1)}"`));
    assert.ok(firstLeft > COMPOSITE_TIMELINE_GUTTER);
    assert.ok(compositeTimelineContentWidthPure(model.context, 120)
        - (lastLeft + noteHalfWidth * 2) > 0);

    model.lanes[2].entries = [zero];
    const map = renderCompositeTimelineMapSvg(model, visible, 0);
    assert.match(map, /<rect x="0\.0" y="17"/,
        'the overview remains mapped to real time rather than fake visual pre-roll');
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
