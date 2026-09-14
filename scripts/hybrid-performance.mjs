import { performance } from 'node:perf_hooks';

import { analyzeGapFillComposite } from '../src/composite/gap-fill-engine.js';
import { analyzeGuidedComposite } from '../src/composite/guided-engine.js';
import { compositeResolvedEntries } from '../src/composite/merge-engine.js';
import { compositePreviewEventsPure } from '../src/composite/preview.js';
import {
    buildCompositeTimelineViewModel,
    compositeTimelineContentWidthPure,
    compositeTimelineXForBeatPure,
    renderCompositeTimelineLaneContents,
    renderCompositeTimelineMapSvg,
} from '../src/composite/timeline-view.js';

function numericArg(name, fallback) {
    const prefix = `--${name}=`;
    const raw = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const noteCount = numericArg('notes', 1000);
const iterations = numericArg('iterations', 3);
const secondsPerBeat = 0.5;
const beatCount = noteCount * 2 + 32;
const beats = Array.from({ length: beatCount }, (_, index) => ({
    time: index * secondsPerBeat,
    measure: index % 4 === 0 ? index / 4 + 1 : -1,
}));

function note(index, sourceOffset) {
    const beat = index * 2 + sourceOffset;
    return {
        beat,
        beatEnd: beat + 0.2,
        time: beat * secondsPerBeat,
        sustain: secondsPerBeat * 0.2,
        string: index % 6,
        fret: (index * 5 + sourceOffset) % 19,
        techniques: index % 17 === 0 ? { palm_mute: true } : {},
    };
}

function arrangement(name, sourceOffset) {
    return {
        name,
        type: 'guitar',
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: Array.from({ length: noteCount }, (_, index) => note(index, sourceOffset)),
        chords: [],
        chord_templates: [],
        anchors: [],
        anchors_user: [],
        handshapes: [],
        phrases: [],
    };
}

const sources = {
    primary: arrangement('Benchmark Lead', 0),
    secondary: arrangement('Benchmark Rhythm', 1),
    beats,
    sections: [],
};
const gapFill = { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 };

function summary(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = ratio => sorted[Math.min(sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
    return {
        medianMs: Number(percentile(0.5).toFixed(2)),
        p95Ms: Number(percentile(0.95).toFixed(2)),
        maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    };
}

function measure(name, callback, describe = () => ({})) {
    const samples = [];
    let lastResult = null;
    for (let iteration = 0; iteration < iterations; iteration++) {
        const start = performance.now();
        lastResult = callback();
        samples.push(performance.now() - start);
    }
    const warmSamples = samples.slice(1);
    return {
        name,
        coldMs: Number(samples[0].toFixed(2)),
        ...summary(samples),
        warm: warmSamples.length ? summary(warmSamples) : null,
        ...describe(lastResult),
    };
}

const plans = new Map();
const results = [
    measure('standard', () => {
        const plan = analyzeGapFillComposite({ ...sources, gapFill });
        plans.set('standard', plan);
        return plan;
    }, plan => ({ ok: plan?.ok === true, decisions: plan?.conflicts?.length || 0 })),
    measure('guided', () => {
        const plan = analyzeGuidedComposite({ ...sources, repeatMode: 'matching-riffs' });
        plans.set('guided', plan);
        return plan;
    }, plan => ({ ok: plan?.ok === true, decisions: plan?.conflicts?.length || 0 })),
];

// The planner is only one part of perceived latency. Exercise the synchronous
// renderer work that follows a completed Worker response as well, using the
// exact same dense plans. These phases intentionally avoid DOM APIs so this
// script remains stable in CI and on developer machines.
const views = new Map();
const phases = [];
for (const [strategy, plan] of plans) {
    if (!plan?.ok) continue;
    let resolved = [];
    phases.push(measure(`${strategy}:resolved-entries`, () => {
        resolved = compositeResolvedEntries(plan);
        return resolved;
    }, value => ({ entries: value.length })));
    phases.push(measure(`${strategy}:timeline-model`, () => {
        const view = buildCompositeTimelineViewModel({
            plan,
            primaryName: plan.primary?.name,
            secondaryName: plan.secondary?.name,
            resultEntries: resolved,
            resultEntriesPrepared: true,
            durationSeconds: beats.at(-1)?.time || 0,
        });
        views.set(strategy, view);
        return view;
    }, view => ({
        sourceEntries: (view?.lanes || []).slice(0, 2)
            .reduce((sum, lane) => sum + lane.entries.length, 0),
        decisions: view?.decisions?.length || 0,
    })));
    const view = views.get(strategy);
    phases.push(measure(`${strategy}:overview-svg`, () =>
        renderCompositeTimelineMapSvg(view, null, 0), markup => ({ bytes: markup.length })));
    const zoom = 120;
    const centerBeat = (view.context.startBeat + view.context.endBeat) / 2;
    const visibleRange = { startBeat: centerBeat - 8, endBeat: centerBeat + 8 };
    const centerX = compositeTimelineXForBeatPure(centerBeat, view.context, zoom);
    const contentWidth = compositeTimelineContentWidthPure(view.context, zoom);
    const renderOriginX = Math.max(0, Math.min(contentWidth - 1920, centerX - 960));
    phases.push(measure(`${strategy}:visible-lanes-svg`, () =>
        view.lanes.map(lane => renderCompositeTimelineLaneContents(
            view, lane.id, 180, visibleRange, zoom, { renderOriginX, surfaceWidth: 1920 }))
            .join(''), markup => ({ bytes: markup.length })));
}

// Overview has a different performance contract from readable note view: its
// ordinary attacks must be bounded by display pixels, not source-note count.
// Keep the musical span fixed so `--notes=20000` is a genuinely dense stress
// case and report both the output size and the number of emitted path commands.
const overviewSourceView = views.get('standard');
if (overviewSourceView) {
    const overviewSpanBeats = 500;
    const denseEntries = Array.from({ length: noteCount }, (_, index) => {
        const tail = index === noteCount - 1;
        const startBeat = tail
            ? 499.5 : index / Math.max(1, noteCount - 1) * 490;
        return {
            id: `benchmark:overview:${index}`,
            startBeat,
            endBeat: Math.min(overviewSpanBeats, startBeat + 1.5),
            effectiveEndBeat: Math.min(overviewSpanBeats, startBeat + 2),
            string: tail ? 5 : index % 5,
            fret: index % 24,
            source: tail ? 'secondary' : 'primary',
            sources: [tail ? 'secondary' : 'primary'],
            note: { techniques: { bend: true, tremolo: true } },
        };
    });
    const denseView = {
        ...overviewSourceView,
        context: {
            ...overviewSourceView.context,
            startBeat: 0,
            endBeat: overviewSpanBeats,
            measureMarkers: (overviewSourceView.context.measureMarkers || [])
                .filter(marker => marker.beat <= overviewSpanBeats),
        },
        review: null,
        lanes: [{
            ...overviewSourceView.lanes.find(lane => lane.id === 'result'),
            entries: denseEntries,
        }],
    };
    const overviewZoom = 1;
    const overviewSurfaceWidth = compositeTimelineContentWidthPure(
        denseView.context, overviewZoom);
    phases.push(measure('overview:dense-lane-svg', () =>
        renderCompositeTimelineLaneContents(denseView, 'result', 180,
            { startBeat: 0, endBeat: overviewSpanBeats }, overviewZoom,
            { overviewDensity: true }), markup => {
        const densityPath = markup.match(
            /data-composite-density-bin-count="(\d+)"[^>]* d="([^"]+)"/);
        return {
            entries: denseEntries.length,
            surfaceWidth: overviewSurfaceWidth,
            bytes: markup.length,
            densityBins: Number(densityPath?.[1] || 0),
            pathCommands: (densityPath?.[2].match(/M/g) || []).length,
            staticNoteLabels: (markup.match(/data-composite-static-note=/g) || []).length,
            ordinaryTrailPaths: (markup.match(/data-composite-static-trails=/g) || []).length,
        };
    }));
}

const standardPlan = plans.get('standard');
if (standardPlan?.ok) {
    const previewEntries = standardPlan.sourceEntries?.primary || [];
    phases.push(measure('preview:source-events', () => compositePreviewEventsPure(
        previewEntries, standardPlan.primary, standardPlan.beats,
        standardPlan.compatibility?.stringCount), events => ({ events: events.length })));
}

process.stdout.write(`${JSON.stringify({
    noteCountPerSource: noteCount,
    iterations,
    results,
    phases,
}, null, 2)}\n`);
