import assert from 'node:assert/strict';
import test from 'node:test';

import {
    _resetHybridPerformanceForTest,
    hybridPerfCount,
    hybridPerfGauge,
    hybridPerfSample,
    hybridPerfSummaryPure,
    hybridPerformanceAssessmentPure,
    hybridPerformanceSnapshot,
    setHybridPerformanceEnabled,
} from '../src/composite/performance.js';

test.afterEach(() => {
    setHybridPerformanceEnabled(false);
    _resetHybridPerformanceForTest();
});

test('Hybrid release assessment never turns missing traces into false passes', () => {
    const incomplete = hybridPerformanceAssessmentPure({ timings: {}, counters: {} });
    assert.equal(incomplete.status, 'incomplete');
    assert.equal(incomplete.passed, 0);
    assert.equal(incomplete.notRun, incomplete.gates.length);

    const assessed = hybridPerformanceAssessmentPure({
        timings: {
            'audio.preview.startMs': { count: 3, p95: 7 },
            'audio.preview.stopMs': { count: 3, p95: 3 },
            'audio.preview.muteScheduleMs': { count: 1, max: 2 },
            'timeline.playhead.frameMs': { count: 120, p95: 16.9 },
            'ui.interactionMs': { count: 4, max: 12 },
            'main.longTaskMs': { count: 1, max: 61 },
        },
        counters: {
            'audio.preview.firstSchedule': 3,
        },
    });
    assert.equal(assessed.status, 'fail');
    assert.equal(assessed.failed, 1);
    assert.equal(assessed.notRun, 0);
    assert.equal(assessed.gates.find(gate => gate.id === 'main-long-task').measured, 61);
    assert.equal(assessed.gates.find(gate => gate.id === 'dropped-guide-events').state, 'pass');
});

test('Hybrid performance summaries expose bounded release-relevant percentiles', () => {
    const summary = hybridPerfSummaryPure([1, 2, 3, 4, 100, NaN]);
    assert.equal(summary.count, 5);
    assert.equal(summary.min, 1);
    assert.equal(summary.p50, 3);
    assert.equal(summary.p95, 100);
    assert.equal(summary.p99, 100);
    assert.equal(summary.max, 100);
    assert.equal(summary.mean, 22);
});

test('Hybrid telemetry remains inert until a developer explicitly enables it', () => {
    setHybridPerformanceEnabled(false);
    hybridPerfSample('timeline.renderMs', 40);
    hybridPerfCount('guide.dropped');
    hybridPerfGauge('timeline.nodes', 900);
    assert.deepEqual(hybridPerformanceSnapshot(), {
        enabled: false,
        timings: {},
        counters: {},
        gauges: {},
    });
});

test('Hybrid telemetry records timings, counters, and gauges in memory only', () => {
    setHybridPerformanceEnabled(true);
    hybridPerfSample('timeline.renderMs', 12);
    hybridPerfSample('timeline.renderMs', 18);
    hybridPerfCount('guide.dropped');
    hybridPerfCount('guide.dropped', 2);
    hybridPerfGauge('timeline.nodes', 975);
    const snapshot = hybridPerformanceSnapshot();
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.timings['timeline.renderMs'].p95, 18);
    assert.equal(snapshot.counters['guide.dropped'], 3);
    assert.equal(snapshot.gauges['timeline.nodes'], 975);
});
