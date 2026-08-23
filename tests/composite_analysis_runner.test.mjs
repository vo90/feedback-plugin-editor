import assert from 'node:assert/strict';
import test from 'node:test';

import { runHybridBackgroundTask } from '../src/composite/analysis-runner.js';

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
    const arrangement = name => ({
        name,
        type: 'guitar',
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: [],
        chords: [],
    });
    const progress = [];
    const result = await runHybridBackgroundTask('analyze', {
        strategy: 'gap-fill',
        sources: {
            primary: arrangement('Lead'),
            secondary: arrangement('Rhythm'),
            beats: [],
            sections: [],
        },
        gapFill: {},
    }, {
        workerFactory: () => null,
        onProgress: phase => progress.push(phase),
    });
    assert.equal(result.ok, true);
    assert.equal(result.strategy, 'gap-fill');
    assert.deepEqual(progress, ['analyze']);
    assert.doesNotThrow(() => structuredClone(result),
        'a plan returned through Worker.postMessage must remain cloneable');
});
