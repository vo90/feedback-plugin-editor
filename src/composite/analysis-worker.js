import { analyzeExperimentalAutoComposite } from './experimental-auto-engine.js';
import { analyzeGapFillComposite } from './gap-fill-engine.js';
import { analyzeGuidedComposite } from './guided-engine.js';
import { materializeCompositeArrangement } from './merge-engine.js';

export function runHybridWorkerTaskPure(action, payload = {}) {
    if (action === 'analyze') {
        const sources = payload.sources || {};
        if (payload.strategy === 'guided') {
            return analyzeGuidedComposite({
                ...sources,
                sections: sources.sections,
                repeatMode: payload.repeatMode,
            });
        }
        if (payload.experimentalEnabled) {
            return analyzeExperimentalAutoComposite({
                ...sources,
                gapFill: payload.gapFill,
                profile: payload.experimentalProfile || 'balanced',
            });
        }
        return analyzeGapFillComposite({ ...sources, gapFill: payload.gapFill });
    }
    if (action === 'materialize') {
        return materializeCompositeArrangement(payload.plan, payload.name);
    }
    throw new Error(`Unsupported Hybrid worker action: ${action}`);
}

function workerError(cause) {
    return {
        name: String(cause?.name || 'Error'),
        message: String(cause?.message || cause || 'Hybrid worker failed'),
        stack: typeof cause?.stack === 'string' ? cause.stack : '',
    };
}

// Guarded so importing the pure dispatcher on Window (analysis-runner's local
// fallback) never replaces the application's global message handler.
const hybridWorkerType = globalThis.WorkerGlobalScope;
const hybridWorkerScope = typeof hybridWorkerType === 'function'
    && globalThis instanceof hybridWorkerType;
if (hybridWorkerScope) {
    globalThis.onmessage = async (event) => {
        const request = event?.data || {};
        if (!request.id) return;
        try {
            globalThis.postMessage({ id: request.id, kind: 'progress', phase: request.action });
            const result = await runHybridWorkerTaskPure(request.action, request.payload);
            globalThis.postMessage({ id: request.id, kind: 'result', result });
        } catch (cause) {
            globalThis.postMessage({ id: request.id, kind: 'error', error: workerError(cause) });
        }
    };
}
