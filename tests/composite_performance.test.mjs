import assert from 'node:assert/strict';
import test from 'node:test';

import {
    _resetHybridPerformanceForTest,
    hybridPerfCount,
    hybridPerfGauge,
    hybridPerfSample,
    hybridPerfSummaryPure,
    hybridPerformanceSnapshot,
    setHybridPerformanceEnabled,
} from '../src/composite/performance.js';

test.afterEach(() => {
    setHybridPerformanceEnabled(false);
    _resetHybridPerformanceForTest();
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
