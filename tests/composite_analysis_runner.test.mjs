import assert from 'node:assert/strict';
import test from 'node:test';

import { runHybridBackgroundTask } from '../src/composite/analysis-runner.js';
import {
    _resetHybridPerformanceForTest,
    hybridPerformanceSnapshot,
    setHybridPerformanceEnabled,
} from '../src/composite/performance.js';

class FakeWorker {
    constructor(result) {
        this.result = result;
        this.terminated = false;
        this.messages = [];
    }
    postMessage(request) {
        this.messages.push(request);
        queueMicrotask(() => {
            if (this.terminated) return;
            this.onmessage?.({
                data: { id: request.id, kind: 'progress', phase: request.action },
            });
            this.onmessage?.({
                data: { id: request.id, kind: 'result', result: this.result },
            });
        });
    }
    terminate() { this.terminated = true; }
}

const arrangement = name => ({
    name,
    type: 'guitar',
    tuning: [0, 0, 0, 0, 0, 0],
    capo: 0,
    notes: [],
    chords: [],
});

const analysisPayload = () => ({
    strategy: 'gap-fill',
    sources: {
        primary: arrangement('Lead'),
        secondary: arrangement('Rhythm'),
        beats: [],
        sections: [],
    },
    gapFill: {},
});

test('Hybrid background tasks accept only their matching worker response and terminate', async () => {
    const worker = new FakeWorker({ ok: true });
    const progress = [];
    const result = await runHybridBackgroundTask('analyze', { song: 1 }, {
        workerFactory: () => worker,
        onProgress: phase => progress.push(phase),
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(progress, ['analyze']);
    assert.equal(worker.messages.length, 1);
    assert.equal(worker.terminated, true);
});

test('Hybrid background tasks terminate immediately when their session aborts', async () => {
    const controller = new AbortController();
    const worker = new FakeWorker({ tooLate: true });
    const pending = runHybridBackgroundTask('materialize', {}, {
        signal: controller.signal,
        workerFactory: () => worker,
    });
    controller.abort();
    await assert.rejects(pending, error => error?.name === 'AbortError');
    assert.equal(worker.terminated, true);
});

test('Hybrid analysis remains functional when module Workers are unavailable', async () => {
    const progress = [];
    const result = await runHybridBackgroundTask('analyze', analysisPayload(), {
        workerFactory: () => null,
        onProgress: phase => progress.push(phase),
    });
    assert.equal(result.ok, true);
    assert.equal(result.strategy, 'gap-fill');
    assert.deepEqual(progress, ['analyze']);
    assert.doesNotThrow(() => structuredClone(result),
        'a plan returned through Worker.postMessage must remain cloneable');
});

test('Hybrid analysis falls back locally when Worker postMessage cannot clone its payload', async () => {
    const worker = new FakeWorker(null);
    worker.postMessage = () => {
        throw new DOMException('The object could not be cloned.', 'DataCloneError');
    };
    const progress = [];
    const result = await runHybridBackgroundTask('analyze', analysisPayload(), {
        workerFactory: () => worker,
        onProgress: phase => progress.push(phase),
    });
    assert.equal(result.ok, true);
    assert.equal(result.strategy, 'gap-fill');
    assert.deepEqual(progress, ['analyze']);
    assert.equal(worker.terminated, true);
});

test('Hybrid analysis falls back locally when a module Worker fails before starting its request', async () => {
    const worker = new FakeWorker(null);
    let prevented = false;
    worker.postMessage = (request) => {
        worker.messages.push(request);
        queueMicrotask(() => worker.onerror?.({
            message: 'module import failed',
            preventDefault: () => { prevented = true; },
        }));
    };
    const progress = [];
    const result = await runHybridBackgroundTask('analyze', analysisPayload(), {
        workerFactory: () => worker,
        onProgress: phase => progress.push(phase),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(progress, ['analyze']);
    assert.equal(prevented, true);
    assert.equal(worker.terminated, true);
});

test('Hybrid local fallback observes cancellation after Worker postMessage fails', async () => {
    const controller = new AbortController();
    const worker = new FakeWorker(null);
    worker.postMessage = () => {
        throw new DOMException('The object could not be cloned.', 'DataCloneError');
    };
    const progress = [];
    const pending = runHybridBackgroundTask('analyze', analysisPayload(), {
        signal: controller.signal,
        workerFactory: () => worker,
        onProgress: phase => progress.push(phase),
    });
    controller.abort();
    await assert.rejects(pending, error => error?.name === 'AbortError');
    assert.deepEqual(progress, []);
    assert.equal(worker.terminated, true);
});

test('Hybrid worker runtime errors surface after work starts instead of recomputing locally', async () => {
    const worker = new FakeWorker(null);
    worker.postMessage = (request) => {
        worker.messages.push(request);
        queueMicrotask(() => {
            worker.onmessage?.({
                data: { id: request.id, kind: 'progress', phase: request.action },
            });
            worker.onerror?.({ message: 'worker runtime exploded' });
        });
    };
    const progress = [];
    await assert.rejects(
        runHybridBackgroundTask('analyze', analysisPayload(), {
            workerFactory: () => worker,
            onProgress: phase => progress.push(phase),
        }),
        /worker runtime exploded/,
    );
    assert.deepEqual(progress, ['analyze']);
    assert.equal(worker.messages.length, 1);
    assert.equal(worker.terminated, true);
});

test('Hybrid Worker fallback records one total duration while retaining path counters', async () => {
    _resetHybridPerformanceForTest();
    setHybridPerformanceEnabled(true);
    try {
        const worker = new FakeWorker(null);
        worker.postMessage = () => {
            throw new DOMException('The object could not be cloned.', 'DataCloneError');
        };
        await runHybridBackgroundTask('analyze', analysisPayload(), {
            workerFactory: () => worker,
        });
        const snapshot = hybridPerformanceSnapshot();
        assert.equal(snapshot.timings['task.analyze.totalMs']?.count, 1);
        assert.equal(snapshot.counters['task.analyze.worker'], 1);
        assert.equal(snapshot.counters['task.analyze.localFallback'], 1);
        assert.equal(snapshot.timings['task.analyze.localComputeMs']?.count, 1);
    } finally {
        setHybridPerformanceEnabled(false);
        _resetHybridPerformanceForTest();
    }
});

test('Hybrid Worker telemetry separates startup from background computation', async () => {
    _resetHybridPerformanceForTest();
    setHybridPerformanceEnabled(true);
    try {
        const worker = new FakeWorker({ ok: true });
        await runHybridBackgroundTask('analyze', analysisPayload(), {
            workerFactory: () => worker,
        });
        const snapshot = hybridPerformanceSnapshot();
        assert.equal(snapshot.timings['task.analyze.workerStartupMs']?.count, 1);
        assert.equal(snapshot.timings['task.analyze.workerComputeMs']?.count, 1);
        assert.equal(snapshot.timings['task.analyze.totalMs']?.count, 1);
        assert.equal(snapshot.timings['task.analyze.localComputeMs'], undefined);
    } finally {
        setHybridPerformanceEnabled(false);
        _resetHybridPerformanceForTest();
    }
});
