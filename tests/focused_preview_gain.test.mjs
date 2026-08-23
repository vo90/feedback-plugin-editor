import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');

function extractFunction(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `${name} exists`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced source for ' + name);
}

function harness() {
    const timers = [];
    const S = { audioCtx: { currentTime: 20 } };
    const api = new Function('S', 'defer',
        'const PREVIEW_GENERATION_FADE = 0.004;\n'
        + 'let _previewVoiceGeneration = null;\n'
        + extractFunction('_cancelGuideVoiceList') + '\n'
        + extractFunction('_retirePreviewVoiceGeneration') + '\n'
        + 'return {'
        + ' setGeneration(value) { _previewVoiceGeneration = value; },'
        + ' current() { return _previewVoiceGeneration; },'
        + ' retire: _retirePreviewVoiceGeneration'
        + ' };'
    )(S, (fn) => { timers.push(fn); });
    // The extracted implementation resolves the global binding by name.
    const previous = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
    return {
        api,
        timers,
        restore() { globalThis.setTimeout = previous; },
    };
}

function generation(voiceCount) {
    let stopped = 0, disconnected = 0, gainDisconnected = 0;
    const calls = [];
    const voices = Array.from({ length: voiceCount }, () => ({
        osc: { stop() { stopped++; } },
        gain: { disconnect() { disconnected++; } },
    }));
    const gain = {
        gain: {
            value: 1,
            cancelScheduledValues(t) { calls.push(['cancel', t]); },
            setValueAtTime(v, t) { calls.push(['set', v, t]); },
            linearRampToValueAtTime(v, t) { calls.push(['ramp', v, t]); },
        },
        disconnect() { gainDisconnected++; },
    };
    return {
        value: { id: 1, gain, voices }, calls,
        counts: () => ({ stopped, disconnected, gainDisconnected }),
    };
}

test('retiring a focused pass schedules one four-millisecond mute before deferred cleanup', () => {
    const h = harness();
    try {
        const old = generation(1000);
        h.api.setGeneration(old.value);
        assert.equal(h.api.retire(), true);
        assert.equal(h.api.current(), null, 'the retired generation cannot receive new voices');
        assert.deepEqual(old.calls, [
            ['cancel', 20],
            ['set', 1, 20],
            ['ramp', 0, 20.004],
        ]);
        assert.deepEqual(old.counts(), { stopped: 0, disconnected: 0, gainDisconnected: 0 },
            'the input-critical path does not walk the voice list');
        assert.equal(h.timers.length, 1);

        // A newer pass can start before the old envelopes are disposed. The
        // deferred closure owns only the retired generation.
        const next = generation(2);
        h.api.setGeneration(next.value);
        h.timers.shift()();
        assert.deepEqual(old.counts(), {
            stopped: 1000, disconnected: 1000, gainDisconnected: 1,
        });
        assert.strictEqual(h.api.current(), next.value);
        assert.deepEqual(next.counts(), { stopped: 0, disconnected: 0, gainDisconnected: 0 });
    } finally { h.restore(); }
});
