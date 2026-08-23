import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCompositeTimelineViewModel,
    COMPOSITE_TIMELINE_EDGE_PADDING,
    COMPOSITE_TIMELINE_GUTTER,
    COMPOSITE_TIMELINE_OVERVIEW_INTERVAL_LIMIT,
    COMPOSITE_TIMELINE_STRIP_MAX_WIDTH,
    COMPOSITE_TIMELINE_STRIP_VIEWPORTS,
    compositeTimelineBeatForXPure,
    compositeTimelineCameraFramePure,
    compositeTimelineCameraOffsetPure,
    compositeTimelineCenteredScrollPure,
    compositeTimelineContentWidthPure,
    compositeTimelineDisplayBeatPure,
    compositeTimelineDetailLevelPure,
    compositeTimelineEntriesInRangePure,
    compositeTimelineFitZoomPure,
    compositeTimelineGlobalToLocalXPure,
    compositeTimelineLocalToGlobalXPure,
    compositeTimelineMapViewportPure,
    compositeTimelineMapBeatPure,
    compositeTimelineOverviewIntervalAtBeatPure,
    compositeTimelineOverviewIntervalIndexPure,
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

test('render-ahead scales with the real viewport instead of a fixed song window', () => {
    assert.equal(compositeTimelineRenderBufferPure(600), 1800);
    assert.equal(compositeTimelineRenderBufferPure(1600), 3200);
    assert.equal(compositeTimelineRenderGuardPure(600), 900);
    assert.equal(compositeTimelineRenderGuardPure(1600), 2280,
        'the guard follows the capped strip runway rather than an impossible five screens');
    assert.equal(compositeTimelineRenderGuardPure(3840), 1440,
        'a 4K strip begins standby work with three quarters of its runway remaining');
});

test('timeline detail policy keeps 120 full and progressively simplifies 60 and Fit', () => {
    assert.equal(compositeTimelineDetailLevelPure(120).id, 'full');
    assert.equal(compositeTimelineDetailLevelPure(60).id, 'compact');
    assert.equal(compositeTimelineDetailLevelPure(3).id, 'density');
    assert.equal(compositeTimelineDetailLevelPure(89.99).id, 'compact');
    assert.equal(compositeTimelineDetailLevelPure(90).id, 'full');
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

test('Experimental passage outcomes stay linear at twenty thousand review sections', () => {
    const count = 20_000;
    let conflictReads = 0;
    const conflicts = Array.from({ length: count }, (_, index) => ({
        id: `passage:${index}`,
        startBeat: index,
        endBeat: index + 0.5,
        resolution: index % 2 ? 'secondary' : null,
        selectedEntryIds: index % 2 ? [`entry:${index}`] : [],
        primaryEntries: [],
        secondaryEntries: [],
    }));
    const observedConflicts = new Proxy(conflicts, {
        get(target, property, receiver) {
            if (typeof property === 'string' && /^\d+$/.test(property)) conflictReads++;
            return Reflect.get(target, property, receiver);
        },
    });
    const passages = Array.from({ length: count }, (_, index) => ({
        id: `passage:${index}`,
        startBeat: index,
        endBeat: index + 0.5,
        status: 'review',
        noteCount: 1,
        entries: [{ id: `entry:${index}` }],
        reasons: [],
    }));
    const model = buildCompositeTimelineViewModel({
        plan: {
            beats: [], compatibility: { stringCount: 6 },
            sourceEntries: { primary: [], secondary: [] },
            conflicts: observedConflicts, passages,
        },
    });
    assert.equal(model.passages.length, count);
    assert.equal(model.passages[0].state, 'review');
    assert.equal(model.passages.at(-1).state, 'accepted');
    assert.ok(conflictReads < count * 12,
        `indexed construction should be linear, but read ${conflictReads} conflict slots`);
});

test('dense overview groups visual intervals but keeps late focused markers interactive', () => {
    const count = 20_000;
    assert.equal(COMPOSITE_TIMELINE_OVERVIEW_INTERVAL_LIMIT, 512);
    const decisions = Array.from({ length: count }, (_, index) => ({
        id: `decision:${index}`,
        index,
        startBeat: index,
        endBeat: index + 0.5,
        state: index % 3 === 0 ? 'resolved' : index % 3 === 1 ? 'unresolved' : 'invalid',
    }));
    const passages = Array.from({ length: count }, (_, index) => ({
        id: `passage:${index}`,
        startBeat: index,
        endBeat: index + 0.5,
        state: index % 2 ? 'automatic' : 'left-out',
        label: `Passage ${index + 1}`,
        active: index === count - 1,
    }));
    const map = renderCompositeTimelineMapSvg({
        context: { startBeat: 0, endBeat: count },
        lanes: [{ id: 'result', entries: [] }],
        review: { id: decisions.at(-1).id },
        decisions,
        passages,
    });

    assert.equal((map.match(/data-composite-map-decision="/g) || []).length, 1,
        'only the focused decision remains an individual SVG hit target');
    assert.match(map, /data-composite-map-decision="19999"/,
        'a focused decision beyond the aggregation limit remains selectable');
    assert.equal((map.match(/data-composite-map-passage="/g) || []).length, 1,
        'only the inspected passage remains an individual SVG hit target');
    assert.match(map, /data-composite-map-passage="passage:19999"/,
        'a late inspected passage remains selectable');
    assert.match(map, /data-composite-map-decision-density=/);
    assert.match(map, /data-composite-map-passage-density=/);
    assert.match(map, /data-composite-map-density-kind="decision"[^>]*pointer-events="fill"/,
        'a delegated handler can distinguish and hit a grouped decision path');
    assert.match(map, /data-composite-map-density-kind="passage"[^>]*pointer-events="fill"/,
        'a delegated handler can distinguish and hit a grouped passage path');
    assert.match(map, /Dense 20000 decision markers and 20000 passage markers are visually grouped[^<]*clicking a grouped marker opens the exact section/,
        'the accessible description explains that grouped marks still open exact sections');
    assert.match(map, /data-composite-map-density-state="(?:resolved|unresolved|invalid)"[^>]*aria-hidden="true"/,
        'decorative grouped paths defer their name to the containing labelled map button');
    assert.ok((map.match(/data-composite-map-decision-density=/g) || []).length <= 3,
        'decision aggregation emits at most one path per visible state');
    assert.ok((map.match(/data-composite-map-passage-density=/g) || []).length <= 6,
        'passage aggregation emits at most one path per visible state');
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
    const passages = [
        { id: 'passage:left', startBeat: 10, endBeat: 11, state: 'review' },
        { id: 'passage:right', startBeat: 13, endBeat: 14, state: 'review' },
        { id: 'passage:active', startBeat: 10, endBeat: 14, state: 'review', active: true },
    ];
    const view = { review: { id: 'focused' }, decisions, passages };
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
    assert.equal(compositeTimelineOverviewIntervalAtBeatPure(index, 12, {
        kind: 'passage', state: 'review',
    })?.id, 'passage:right', 'active exact markers are excluded from grouped hit testing');
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
            passages: [],
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
    const view = { decisions, passages: [] };
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
    const hitIndex = compositeTimelineOverviewIntervalIndexPure({ decisions, passages: [] });
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

test('ordinary overview counts preserve every decision and passage hit target', () => {
    const decisions = Array.from({ length: 12 }, (_, index) => ({
        id: `decision:${index}`, index, startBeat: index, endBeat: index + 0.5,
        state: 'unresolved',
    }));
    const passages = Array.from({ length: 12 }, (_, index) => ({
        id: `passage:${index}`, startBeat: index, endBeat: index + 0.5,
        state: 'automatic', label: `Passage ${index + 1}`, active: false,
    }));
    const map = renderCompositeTimelineMapSvg({
        context: { startBeat: 0, endBeat: 12 },
        lanes: [{ id: 'result', entries: [] }],
        review: null,
        decisions,
        passages,
    });
    assert.equal((map.match(/data-composite-map-decision="/g) || []).length, 12);
    assert.equal((map.match(/data-composite-map-passage="/g) || []).length, 12);
    assert.doesNotMatch(map, /data-composite-map-(?:decision|passage)-density=/);
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
    assert.match(lane, new RegExp(`x="${firstLeft.toFixed(1)}"`));
    assert.match(lane, new RegExp(`x="${lastLeft.toFixed(1)}"`));
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

test('static timeline markup scales down at 60 and Fit while 120 stays fully labelled', () => {
    const model = view();
    model.lanes[2].entries = Array.from({ length: 96 }, (_, index) =>
        entry(`dense:${index}`, index / 4, index / 4 + 0.25,
            index % 6, index % 24, 'primary'));
    const visible = { startBeat: 0, endBeat: model.context.endBeat };
    const full = renderCompositeTimelineLaneContents(model, 'result', 158, visible, 120);
    const compact = renderCompositeTimelineLaneContents(model, 'result', 158, visible, 60);
    const fitted = renderCompositeTimelineLaneContents(model, 'result', 158, visible, 3);

    assert.equal((full.match(/<g/g) || []).length, 96);
    assert.equal((full.match(/<title>/g) || []).length, 96);
    assert.equal((full.match(/data-composite-compact-note/g) || []).length, 0);
    assert.equal((compact.match(/<g/g) || []).length, 0);
    assert.equal((compact.match(/<title>/g) || []).length, 0);
    assert.equal((compact.match(/data-composite-compact-note/g) || []).length, 96,
        '60 px/beat retains one readable fret label per static attack');
    assert.equal((compact.match(/data-composite-static-trails=/g) || []).length, 1,
        'all ordinary compact trails share one SVG path');
    assert.equal((fitted.match(/data-composite-density-notes=/g) || []).length, 1,
        'Fit collapses all static attacks into one SVG path');
    assert.equal((fitted.match(/data-composite-compact-note|<title>|<g/g) || []).length, 0);
    assert.ok(compact.length < full.length * 0.55,
        'compact markup is less than 55% of full detail for a dense static lane');
    assert.ok(fitted.length < full.length * 0.15,
        'Fit markup is less than 15% of full detail for a dense static lane');
});

test('Fit keeps manual-review notes fully selectable and preserves static trail endpoints', () => {
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
        model, 'primary', 158, visible, 3);

    assert.match(fitted, /data-composite-entry-id="focused"/);
    assert.match(fitted, /role="checkbox"/);
    assert.match(fitted, /<title>String 6, fret 11,/);
    assert.match(fitted, /stroke-dasharray="3 3"/,
        'the focused authored tremolo trail retains complete detail');
    assert.match(fitted, /stroke-dasharray="5 4"/,
        'the focused effective trail boundary remains distinct');
    assert.match(fitted, /data-composite-static-trails="authored"/);
    const expectedTrailEnd = compositeTimelineXForBeatPure(20, model.context, 3);
    assert.match(fitted, new RegExp(`H${expectedTrailEnd.toFixed(1)}`),
        'a simplified background trail still terminates at its exact musical beat');
    assert.equal((fitted.match(/data-composite-density-notes=/g) || []).length, 1,
        'only the non-review attack is density-rendered');
});

test('an inspected Experimental passage remains detailed below compact zoom', () => {
    const model = view();
    model.passageFocus = { id: 'passage:focus', startBeat: 8, endBeat: 9 };
    model.lanes[1].entries = [
        entry('context', 2, 2.25, 0, 3, 'secondary'),
        entry('passage', 8, 9, 2, 7, 'secondary'),
    ];
    const fitted = renderCompositeTimelineLaneContents(model, 'secondary', 158,
        { startBeat: 0, endBeat: model.context.endBeat }, 3);
    assert.match(fitted, /<title>String 4, fret 7,/,
        'the passage under inspection keeps its full note description');
    assert.match(fitted, />7<\/text>/,
        'the passage under inspection keeps its readable fret marker');
    assert.equal((fitted.match(/data-composite-density-notes=/g) || []).length, 1,
        'unfocused song context remains density-rendered');
});
