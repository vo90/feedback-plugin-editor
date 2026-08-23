import { runHybridWorkerTaskPure } from './analysis-worker.js';
import { hybridPerfCount, hybridPerfEnd, hybridPerfStart } from './performance.js';

let nextRequestId = 0;
const LOCAL_FALLBACK = Symbol('hybrid-local-fallback');

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
    const computeStartedAt = hybridPerfStart();
    try {
        return runHybridWorkerTaskPure(action, payload);
    } finally {
        hybridPerfEnd(`task.${action}.localComputeMs`, computeStartedAt);
    }
}

function runWorker(worker, id, action, payload, signal, onProgress) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let requestStarted = false;
        let postedAt = null;
        let computeStartedAt = null;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener?.('abort', onAbort);
            try { worker.terminate(); } catch (_) { /* already stopped */ }
            callback(value);
        };
        const fallBackLocally = () => finish(resolve, LOCAL_FALLBACK);
        const onAbort = () => finish(reject, abortError());
        signal?.addEventListener?.('abort', onAbort, { once: true });
        worker.onmessage = (event) => {
            const message = event?.data || {};
            if (message.id !== id || settled) return;
            if (message.kind === 'progress') {
                if (!requestStarted) {
                    requestStarted = true;
                    hybridPerfEnd(`task.${action}.workerStartupMs`, postedAt);
                    computeStartedAt = hybridPerfStart();
                }
                onProgress?.(message.phase);
                return;
            }
            if (message.kind === 'result') {
                hybridPerfEnd(`task.${action}.workerComputeMs`, computeStartedAt);
                finish(resolve, message.result);
                return;
            }
            if (message.kind === 'error') {
                hybridPerfEnd(`task.${action}.workerComputeMs`, computeStartedAt);
                const error = new Error(message.error?.message || 'Hybrid worker failed');
                error.name = message.error?.name || 'Error';
                if (message.error?.stack) error.stack = message.error.stack;
                finish(reject, error);
            }
        };
        worker.onerror = (event) => {
            if (!requestStarted) {
                event?.preventDefault?.();
                fallBackLocally();
                return;
            }
            hybridPerfEnd(`task.${action}.workerComputeMs`, computeStartedAt);
            finish(reject, new Error(event?.message || 'Hybrid worker failed'));
        };
        try {
            postedAt = hybridPerfStart();
            worker.postMessage({ id, action, payload });
        }
        catch (_) { fallBackLocally(); }
    });
}

export function runHybridBackgroundTask(action, payload, options = {}) {
    const signal = options.signal || null;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const factory = options.workerFactory || defaultWorkerFactory;
    if (signal?.aborted) return Promise.reject(abortError());

    const startedAt = hybridPerfStart();
    const execute = async () => {
        let worker = null;
        try { worker = factory(); }
        catch (_) { worker = null; }
        if (!worker) return runLocal(action, payload, signal, onProgress);

        hybridPerfCount(`task.${action}.worker`);
        const id = `hybrid:${Date.now()}:${++nextRequestId}`;
        const result = await runWorker(worker, id, action, payload, signal, onProgress);
        if (result === LOCAL_FALLBACK) return runLocal(action, payload, signal, onProgress);
        return result;
    };
    return execute().finally(() => hybridPerfEnd(`task.${action}.totalMs`, startedAt));
}

export function runHybridAnalysisTask(payload, options = {}) {
    return runHybridBackgroundTask('analyze', payload, options);
}

export function runHybridMaterializationTask(plan, name, options = {}) {
    return runHybridBackgroundTask('materialize', { plan, name }, options);
}
