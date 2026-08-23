import assert from 'node:assert/strict';
import test from 'node:test';

const scripts = new Map();
const presetByFile = new Map();

globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
};
globalThis.window = globalThis;

class FakePlayer {
    numValue(value, fallback) {
        return Number.isFinite(Number(value)) ? Number(value) : fallback;
    }
    adjustZone(ctx, zone) {
        if (zone.sample) zone.buffer = ctx.createBuffer();
    }
    queueWaveTable() { return { cancel() {} }; }
}

globalThis.document = {
    getElementById: () => null,
    addEventListener: () => {},
    activeElement: null,
    querySelectorAll: () => [],
    querySelector(selector) {
        const match = selector.match(/^script\[data-gm-src="(.+)"\]$/);
        return match ? scripts.get(match[1]) || null : null;
    },
    createElement() {
        return {
            dataset: {},
            style: {},
            classList: { add() {}, remove() {} },
            addEventListener() {},
            remove() { scripts.delete(this.src); },
        };
    },
    head: {
        appendChild(script) {
            scripts.set(script.src, script);
            queueMicrotask(() => {
                if (script.src.endsWith('WebAudioFontPlayer.js')) {
                    globalThis.WebAudioFontPlayer = FakePlayer;
                } else {
                    const file = script.src.split('/').at(-1);
                    const variable = '_tone_' + file.slice(0, -3);
                    globalThis[variable] = presetByFile.get(file);
                }
                script.onload();
            });
        },
    },
};

const {
    _gmFilePure,
    _resetGmGuideForTest,
    ensureGmPreset,
    gmPresetReady,
} = await import('../src/gm-guide.js');
const { editorPrepareGuidePreview } = await import('../src/audio.js');
const { S } = await import('../src/state.js');
const {
    _resetHybridPerformanceForTest,
    hybridPerformanceSnapshot,
    setHybridPerformanceEnabled,
} = await import('../src/composite/performance.js');

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fileZone() {
    return { file: btoa('fake compressed audio'), originalPitch: 6000, sampleRate: 44100 };
}

function decodeContext() {
    const decodes = [];
    return {
        decodes,
        decodeAudioData(_bytes, success, failure) {
            const d = deferred();
            decodes.push(d);
            d.promise.then(success, failure);
            return d.promise;
        },
        createBuffer() { return { pcm: true }; },
    };
}

async function waitFor(predicate) {
    for (let i = 0; i < 20 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(predicate(), 'async loader did not reach the expected state');
}

test('a preset is ready only after every compressed zone finishes decoding', async () => {
    _resetGmGuideForTest();
    scripts.clear();
    const gm = 27;
    presetByFile.set(_gmFilePure(gm), { zones: [fileZone(), fileZone()] });
    const ctx = decodeContext();

    const first = ensureGmPreset(gm, ctx);
    const concurrent = ensureGmPreset(gm, ctx);
    assert.strictEqual(concurrent, first, 'concurrent callers share one preset preparation');
    await waitFor(() => ctx.decodes.length === 2);
    assert.equal(gmPresetReady(gm), false, 'starting decodes is not readiness');

    ctx.decodes[0].resolve({ zone: 0 });
    await Promise.resolve();
    assert.equal(gmPresetReady(gm), false, 'one unfinished pitch zone keeps the preset unavailable');
    ctx.decodes[1].resolve({ zone: 1 });
    await first;
    assert.equal(gmPresetReady(gm), true);
    assert.equal(ctx.decodes.length, 2, 'each zone decoded exactly once');
});

test('a failed zone is retryable while successfully decoded zones are reused', async () => {
    _resetGmGuideForTest();
    scripts.clear();
    const gm = 28;
    presetByFile.set(_gmFilePure(gm), { zones: [fileZone(), fileZone()] });
    const ctx = decodeContext();

    const failed = ensureGmPreset(gm, ctx);
    await waitFor(() => ctx.decodes.length === 2);
    ctx.decodes[0].resolve({ zone: 0 });
    ctx.decodes[1].reject(new Error('decode failed'));
    await failed;
    assert.equal(gmPresetReady(gm), false);

    const retried = ensureGmPreset(gm, ctx);
    await waitFor(() => ctx.decodes.length === 3);
    assert.equal(ctx.decodes.length, 3,
        'retry decodes only the failed zone, not the already-complete zone');
    ctx.decodes[2].resolve({ zone: 1, retry: true });
    await retried;
    assert.equal(gmPresetReady(gm), true);
});

test('focused preparation waits for a genuinely running AudioContext', async () => {
    _resetGmGuideForTest();
    scripts.clear();
    const gm = 29;
    presetByFile.set(_gmFilePure(gm), { zones: [fileZone()] });
    const ctx = decodeContext();
    ctx.state = 'suspended';
    let resumes = 0;
    ctx.resume = async () => { resumes++; ctx.state = 'running'; };
    const saved = S.audioCtx;
    _resetHybridPerformanceForTest();
    setHybridPerformanceEnabled(true);
    S.audioCtx = ctx;
    try {
        const preparing = editorPrepareGuidePreview('guitar', { gm });
        await waitFor(() => ctx.decodes.length === 1);
        assert.equal(resumes, 1);
        ctx.decodes[0].resolve({ ready: true });
        assert.equal(await preparing, true);
        assert.equal(ctx.state, 'running');

        ctx.state = 'suspended';
        ctx.resume = async () => { throw new Error('autoplay blocked'); };
        assert.equal(await editorPrepareGuidePreview('guitar', { gm }), false,
            'a decoded preset is not reported playable through a suspended context');
        const telemetry = hybridPerformanceSnapshot();
        assert.equal(telemetry.counters['audio.preview.gmPrepare'], 2);
        assert.equal(telemetry.counters['audio.preview.gmReady'], 1);
        assert.equal(telemetry.counters['audio.preview.gmNotReady'], 1);
        assert.equal(telemetry.timings['audio.preview.gmPrepareMs'].count, 2);
        assert.equal(telemetry.gauges['audio.preview.lastGmReady'], 0);
        assert.equal(telemetry.gauges['audio.preview.lastGmProgram'], gm);
    } finally {
        S.audioCtx = saved;
        setHybridPerformanceEnabled(false);
        _resetHybridPerformanceForTest();
    }
});
