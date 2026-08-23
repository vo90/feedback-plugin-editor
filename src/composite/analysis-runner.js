import { runHybridWorkerTaskPure } from './analysis-worker.js';
import { hybridPerfCount, hybridPerfEnd, hybridPerfStart } from './performance.js';

let nextRequestId = 0;

function abortError() {
    try { return new globalThis.DOMException('Hybrid task cancelled', 'AbortError'); }
    catch (_) {
        const error = new Error('Hybrid task cancelled');
        error.name = 'AbortError';
        return error;
    }
}

function defaultWorkerFactory() {
    if (typeof globalThis.Worker !== 'function') return null;
    return new globalThis.Worker(new URL('./analysis-worker.js', import.meta.url), {
        type: 'module',
        name: 'feedback-hybrid-analysis',
    });
}

async function runLocal(action, payload, signal, onProgress) {
    if (signal?.aborted) throw abortError();
    onProgress?.(action);
    // Preserve asynchronous caller semantics even when a browser cannot create
    // a module worker. Desktop releases are expected to take the Worker path.
    await Promise.resolve();
    if (signal?.aborted) throw abortError();
    hybridPerfCount(`task.${action}.localFallback`);
    return runHybridWorkerTaskPure(action, payload);
}

export function runHybridBackgroundTask(action, payload, options = {}) {
    const signal = options.signal || null;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const factory = options.workerFactory || defaultWorkerFactory;
    if (signal?.aborted) return Promise.reject(abortError());

    let worker = null;
    try { worker = factory(); }
    catch (_) { worker = null; }
    const startedAt = hybridPerfStart();
    if (!worker) {
        return runLocal(action, payload, signal, onProgress)
            .finally(() => hybridPerfEnd(`task.${action}.totalMs`, startedAt));
    }
    hybridPerfCount(`task.${action}.worker`);

    const id = `hybrid:${Date.now()}:${++nextRequestId}`;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener?.('abort', onAbort);
            try { worker.terminate(); } catch (_) { /* already stopped */ }
            hybridPerfEnd(`task.${action}.totalMs`, startedAt);
            callback(value);
        };
        const onAbort = () => finish(reject, abortError());
        signal?.addEventListener?.('abort', onAbort, { once: true });
        worker.onmessage = (event) => {
            const message = event?.data || {};
            if (message.id !== id || settled) return;
            if (message.kind === 'progress') {
                onProgress?.(message.phase);
                return;
            }
            if (message.kind === 'result') {
                finish(resolve, message.result);
                return;
            }
            if (message.kind === 'error') {
                const error = new Error(message.error?.message || 'Hybrid worker failed');
                error.name = message.error?.name || 'Error';
                if (message.error?.stack) error.stack = message.error.stack;
                finish(reject, error);
            }
        };
        worker.onerror = (event) => {
            finish(reject, new Error(event?.message || 'Hybrid worker failed to start'));
        };
        try { worker.postMessage({ id, action, payload }); }
        catch (cause) { finish(reject, cause); }
    });
}

export function runHybridAnalysisTask(payload, options = {}) {
    return runHybridBackgroundTask('analyze', payload, options);
}

export function runHybridMaterializationTask(plan, name, options = {}) {
    return runHybridBackgroundTask('materialize', { plan, name }, options);
}
