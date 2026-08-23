import assert from 'node:assert/strict';
import test from 'node:test';

import {
    _resetHybridPerformanceForTest,
    hybridPerfCount,
    hybridPerfFrame,
    hybridPerfGauge,
    hybridPerfResetFrame,
    hybridPerfSample,
    hybridPerfSummaryPure,
    hybridPerformanceAssessmentPure,
    hybridPerformanceEnabled,
    hybridPerformanceSnapshot,
    installHybridPerformanceTools,
    setHybridPerformanceEnabled,
    uninstallHybridPerformanceTools,
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
            'ui.preview.requestMs': { count: 3, p95: 18 },
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

test('Hybrid diagnostic teardown detaches its observer and API without forgetting opt-in', () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const observerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'PerformanceObserver');
    const instances = [];
    class FakePerformanceObserver {
        static supportedEntryTypes = ['longtask'];
        constructor(callback) {
            this.callback = callback;
            this.disconnected = 0;
            this.observed = [];
            instances.push(this);
        }
        observe(options) { this.observed.push(options); }
        disconnect() { this.disconnected++; }
    }
    const fakeWindow = {};
    Object.defineProperty(globalThis, 'window', {
        configurable: true, writable: true, value: fakeWindow,
    });
    Object.defineProperty(globalThis, 'PerformanceObserver', {
        configurable: true, writable: true, value: FakePerformanceObserver,
    });
    try {
        setHybridPerformanceEnabled(true);
        assert.equal(instances.length, 1);
        assert.deepEqual(instances[0].observed, [{ type: 'longtask', buffered: true }]);
        assert.equal(typeof fakeWindow.editorHybridPerformance?.snapshot, 'function');

        uninstallHybridPerformanceTools();
        assert.equal(instances[0].disconnected, 1);
        assert.equal('editorHybridPerformance' in fakeWindow, false);
        assert.equal(hybridPerformanceEnabled(), true,
            'screen teardown must not clear the developer opt-in');

        assert.equal(installHybridPerformanceTools(), true);
        assert.equal(instances.length, 2, 'a later workspace installs a fresh observer');
        assert.equal(typeof fakeWindow.editorHybridPerformance?.snapshot, 'function');
    } finally {
        uninstallHybridPerformanceTools();
        if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
        else delete globalThis.window;
        if (observerDescriptor) {
            Object.defineProperty(globalThis, 'PerformanceObserver', observerDescriptor);
        } else {
            delete globalThis.PerformanceObserver;
        }
    }
});

test('Hybrid frame traces reset between stopped preview sessions', () => {
    setHybridPerformanceEnabled(true);
    hybridPerfFrame('timeline.playhead', 100);
    hybridPerfFrame('timeline.playhead', 116);
    hybridPerfResetFrame('timeline.playhead');
    hybridPerfFrame('timeline.playhead', 5_000);
    hybridPerfFrame('timeline.playhead', 5_017);
    const summary = hybridPerformanceSnapshot().timings['timeline.playhead.frameMs'];
    assert.equal(summary.count, 2);
    assert.equal(summary.max, 17,
        'time spent stopped is not misreported as a dropped display frame');
});
