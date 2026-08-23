/* Development-only Hybrid Track performance telemetry.
 *
 * The normal player path is a cheap disabled branch. Developers can opt in
 * before opening the builder with either:
 *   localStorage.editorHybridPerf = '1'
 *   globalThis.__EDITOR_HYBRID_PERF__ = true
 *
 * Nothing is sent off-device. A bounded in-memory snapshot is exposed through
 * `window.editorHybridPerformance` after installHybridPerformanceTools().
 */

const SAMPLE_LIMIT = 360;

const telemetry = {
    enabled: null,
    samples: new Map(),
    counters: new Map(),
    gauges: new Map(),
    frames: new Map(),
    observer: null,
};

function storedEnabled() {
    if (globalThis.__EDITOR_HYBRID_PERF__ === true) return true;
    try { return globalThis.localStorage?.getItem('editorHybridPerf') === '1'; }
    catch (_) { return false; }
}

export function hybridPerformanceEnabled() {
    if (telemetry.enabled === null) telemetry.enabled = storedEnabled();
    return telemetry.enabled;
}

function boundedPush(map, key, value) {
    if (!Number.isFinite(value)) return;
    let values = map.get(key);
    if (!values) {
        values = [];
        map.set(key, values);
    }
    values.push(value);
    if (values.length > SAMPLE_LIMIT) values.splice(0, values.length - SAMPLE_LIMIT);
}

function clockNow() {
    try {
        if (globalThis.performance?.now) return globalThis.performance.now();
    } catch (_) { /* Date.now remains a safe diagnostic fallback */ }
    return Date.now();
}

export function hybridPerfStart() {
    return hybridPerformanceEnabled() ? clockNow() : null;
}

export function hybridPerfEnd(name, startedAt) {
    if (!hybridPerformanceEnabled() || !Number.isFinite(startedAt)) return 0;
    const duration = Math.max(0, clockNow() - startedAt);
    boundedPush(telemetry.samples, String(name), duration);
    return duration;
}

export function hybridPerfSample(name, value) {
    if (!hybridPerformanceEnabled()) return;
    boundedPush(telemetry.samples, String(name), Number(value));
}

export function hybridPerfCount(name, amount = 1) {
    if (!hybridPerformanceEnabled()) return;
    const key = String(name);
    telemetry.counters.set(key, (telemetry.counters.get(key) || 0) + (Number(amount) || 0));
}

export function hybridPerfGauge(name, value) {
    if (!hybridPerformanceEnabled() || !Number.isFinite(Number(value))) return;
    telemetry.gauges.set(String(name), Number(value));
}

export function hybridPerfFrame(name, timestamp) {
    if (!hybridPerformanceEnabled() || !Number.isFinite(Number(timestamp))) return;
    const key = String(name);
    const previous = telemetry.frames.get(key);
    telemetry.frames.set(key, Number(timestamp));
    if (Number.isFinite(previous)) boundedPush(telemetry.samples, `${key}.frameMs`, Number(timestamp) - previous);
}

function percentile(sorted, ratio) {
    if (!sorted.length) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
}

export function hybridPerfSummaryPure(values) {
    const sorted = (Array.isArray(values) ? values : [])
        .map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return { count: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        count: sorted.length,
        min: sorted[0],
        mean: total / sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted[sorted.length - 1],
    };
}

export function hybridPerformanceSnapshot() {
    const timings = {};
    for (const [name, values] of telemetry.samples) timings[name] = hybridPerfSummaryPure(values);
    return {
        enabled: hybridPerformanceEnabled(),
        timings,
        counters: Object.fromEntries(telemetry.counters),
        gauges: Object.fromEntries(telemetry.gauges),
    };
}

export function resetHybridPerformanceTelemetry() {
    telemetry.samples.clear();
    telemetry.counters.clear();
    telemetry.gauges.clear();
    telemetry.frames.clear();
}

function disconnectLongTaskObserver() {
    try { telemetry.observer?.disconnect(); } catch (_) { /* diagnostic only */ }
    telemetry.observer = null;
}

export function setHybridPerformanceEnabled(enabled) {
    telemetry.enabled = !!enabled;
    globalThis.__EDITOR_HYBRID_PERF__ = !!enabled;
    if (!enabled) disconnectLongTaskObserver();
    else installHybridPerformanceTools();
    return telemetry.enabled;
}

export function installHybridPerformanceTools() {
    if (!hybridPerformanceEnabled()) return false;
    if (!telemetry.observer && typeof globalThis.PerformanceObserver === 'function') {
        try {
            const supported = globalThis.PerformanceObserver.supportedEntryTypes || [];
            if (supported.includes('longtask')) {
                telemetry.observer = new globalThis.PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) hybridPerfSample('main.longTaskMs', entry.duration);
                });
                telemetry.observer.observe({ type: 'longtask', buffered: true });
            }
        } catch (_) { disconnectLongTaskObserver(); }
    }
    if (typeof globalThis.window !== 'undefined') {
        globalThis.window.editorHybridPerformance = Object.freeze({
            snapshot: hybridPerformanceSnapshot,
            reset: resetHybridPerformanceTelemetry,
            enable: setHybridPerformanceEnabled,
        });
    }
    return true;
}

// Test seam: reset the cached opt-in decision without requiring a DOM.
export function _resetHybridPerformanceForTest() {
    disconnectLongTaskObserver();
    telemetry.enabled = null;
    resetHybridPerformanceTelemetry();
}
