import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CompositePreviewController,
    compositePreviewAudibleContextTimePure,
    compositePreviewLoopTimePure,
    compositePreviewOutputLatencyPure,
    compositePreviewPresentationTimePure,
} from '../src/composite/preview-controller.js';
import { FakeAudioContext, createRafHarness } from './composite_audition_fakes.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));

class FakeSoundfont {
    constructor() {
        this.prepared = [];
        this.destroyed = false;
    }

    async prepare(context, program) {
        this.prepared.push({ context, program });
        return {};
    }

    voice() {
        return { cancel() {} };
    }

    destroy() {
        this.destroyed = true;
    }
}

class FakeGuideScheduler {
    constructor(options) {
        this.options = options;
        this.configurations = [];
        this.starts = [];
        this.stops = 0;
        this.destroyed = false;
        this.destroyOptions = null;
    }

    configure(options) {
        this.configurations.push(options);
    }

    start(time, options) {
        this.starts.push({ time, options });
    }

    stop() {
        this.stops++;
    }

    destroy(options) {
        this.destroyed = true;
        this.destroyOptions = options;
    }
}

class FakeReferenceMixer {
    constructor(options) {
        this.options = options;
        this.prepared = [];
        this.schedules = [];
        this.cancels = 0;
        this.destroyed = false;
    }

    async prepare(snapshot) {
        this.prepared.push(snapshot);
        return { snapshot, failures: [] };
    }

    schedule(time, options) {
        this.schedules.push({ time, options });
        return 1;
    }

    cancel() {
        this.cancels++;
    }

    destroy() {
        this.destroyed = true;
    }
}

function controllerFixture(overrides = {}) {
    const context = new FakeAudioContext({ state: 'suspended' });
    const raf = createRafHarness();
    const soundfont = new FakeSoundfont();
    let guide = null;
    let reference = null;
    const states = [];
    const times = [];
    const controller = new CompositePreviewController({
        audioContextFactory: () => context,
        soundfontLoader: soundfont,
        guideSchedulerFactory: options => (guide = new FakeGuideScheduler(options)),
        referenceMixerFactory: options => (reference = new FakeReferenceMixer(options)),
        requestAnimationFrameFn: callback => raf.request(callback),
        cancelAnimationFrameFn: id => raf.cancel(id),
        modes: {
            song: { kind: 'reference', snapshot: { sources: [] } },
            primary: {
                kind: 'guide',
                events: [{ t: 0, midi: 60, sus: 0.2 }],
                voiceCap: 6,
            },
        },
        mode: 'primary',
        startTime: 0,
        endTime: 10,
        onStateChange: state => states.push(state),
        onTimeUpdate: time => times.push(time),
        ...overrides,
    });
    return {
        controller, context, raf, soundfont, states, times,
        guide: () => guide,
        reference: () => reference,
    };
}

test('controller owns a presentation clock and starts exact guide events after preparation', async () => {
    const fixture = controllerFixture();
    const { controller, context, raf, soundfont, times } = fixture;
    assert.equal(controller.isPlaying(), false);
    assert.equal(controller.currentTime(), 0, 'an idle preview still has a visible marker');
    assert.equal(await controller.start(), true);
    assert.equal(context.state, 'running');
    assert.equal(controller.isPlaying(), true);
    assert.deepEqual(soundfont.prepared.map(item => item.program), [27]);
    assert.equal(fixture.guide().configurations[0].events[0].t, 0);
    assert.equal(fixture.guide().starts[0].time, 0);
    context.currentTime = 2.005;
    assert.equal(controller.currentTime(), 2);
    raf.step();
    assert.equal(times.at(-1), 2);
    assert.equal(raf.size, 1, 'the presentation clock requests exactly one next frame');
    assert.equal(controller.pause(), 2);
    assert.equal(controller.isPlaying(), false);
    assert.equal(controller.currentTime(), 2);
    assert.ok(fixture.guide().stops >= 1);
});

test('presentation time holds output latency per pass while scheduling stays raw', async () => {
    const fixture = controllerFixture();
    fixture.context.outputLatency = 0.08;
    fixture.context.baseLatency = 0.02;
    assert.equal(compositePreviewOutputLatencyPure(fixture.context), 0.1,
        'render and device latency are sequential and therefore additive');
    assert.equal(compositePreviewOutputLatencyPure({ baseLatency: 0.02 }), 0.02);
    assert.equal(compositePreviewPresentationTimePure(5, 10, 10, 0.08), 5,
        'latency never paints behind a new seek anchor');
    await fixture.controller.start();
    fixture.context.currentTime = 1.005;
    assert.ok(Math.abs(fixture.controller.transportTime() - 1) < 1e-9);
    assert.ok(Math.abs(fixture.controller.presentationTime() - 0.9) < 1e-9);
    assert.ok(Math.abs(fixture.guide().options.nowChart() - 1) < 1e-9,
        'the guide scheduler retains the uncompensated sample clock');
    fixture.context.outputLatency = 0.2;
    assert.ok(Math.abs(fixture.controller.presentationTime() - 0.9) < 1e-9,
        'a pass holds its sampled latency instead of shimmering frame to frame');
    fixture.controller.stop();
    await fixture.controller.start();
    fixture.context.currentTime = 2.01;
    assert.ok(Math.abs(fixture.controller.presentationTime() - 1.68) < 1e-9,
        'the next start samples the newly reported output latency');
});

test('output timestamps override nominal latency without moving ahead of render time', () => {
    const context = new FakeAudioContext({
        outputTimestamp: { contextTime: 2.8, performanceTime: 1_000 },
    });
    context.currentTime = 3;
    assert.ok(Math.abs(compositePreviewAudibleContextTimePure(
        context, 0.5, 1_010) - 2.81) < 1e-9);
    context.outputTimestamp = { contextTime: 4, performanceTime: 1_000 };
    assert.equal(compositePreviewAudibleContextTimePure(context, 0.5, 1_010), 3,
        'a buggy future device timestamp is clamped to the render clock');
});

test('controller seek/restart/mode/tone/mix operations preserve one authoritative cursor', async () => {
    const fixture = controllerFixture();
    const { controller, context, soundfont } = fixture;
    await controller.seek(4);
    assert.equal(controller.currentTime(), 4);
    await controller.start();
    context.currentTime += 1;
    assert.equal(controller.currentTime(), 4.995);
    assert.equal(await controller.setMode('song'), true);
    assert.equal(controller.state().mode, 'song');
    assert.equal(fixture.reference().prepared.length, 1);
    assert.equal(fixture.reference().schedules[0].time, 4.995);
    assert.equal(await controller.setMode('primary'), true);
    assert.equal(await controller.setTone('distortion'), true);
    assert.equal(soundfont.prepared.at(-1).program, 30);
    assert.deepEqual(controller.setMix({
        volume: 40, referenceGain: 0.8, guideGain: 0.6,
    }), { volume: 0.4, referenceGain: 0.8, guideGain: 0.6 });
    assert.equal(controller.masterGain.gain.value, 0.4);
    assert.equal(controller.referenceGain.gain.value, 0.8);
    assert.ok(controller.guideGain.gain.value < 0.6,
        'distortion tone trim is applied after the common guide mix');
    assert.equal(controller.setMix({ volume: 1 }).volume, 0.01,
        'the public 1% volume value cannot become full scale');
    assert.equal(controller.masterGain.gain.value, 0.01);
    controller.stop();
    await controller.seek(8);
    assert.equal(await controller.restart(), true);
    assert.equal(controller.currentTime(), 0);
});

test('controller loops and reaches EOF through its own frame clock', async () => {
    const fixture = controllerFixture({ endTime: 5 });
    const { controller, context, raf } = fixture;
    controller.setLoop({ enabled: true, startTime: 1, endTime: 2 });
    await controller.seek(1.8);
    await controller.start();
    context.currentTime += 0.25;
    raf.step();
    await flush();
    assert.equal(controller.isPlaying(), true);
    assert.ok(Math.abs(controller.currentTime() - 1.045) < 1e-9,
        'loop time wraps continuously without a frame-clock restart');
    assert.equal(fixture.guide().starts.length, 1,
        'crossing a loop boundary keeps the original sample-clock pass');
    const startsBeforeLoopOff = fixture.guide().starts.length;
    controller.setLoop(false);
    await flush();
    assert.equal(fixture.guide().starts.length, startsBeforeLoopOff + 1,
        'changing Loop during playback re-seats the scheduler at the heard cursor');
    await controller.seek(4.9);
    context.currentTime += 0.2;
    raf.step();
    assert.equal(controller.isPlaying(), false);
    assert.equal(controller.currentTime(), 5, 'EOF leaves the marker at the song end');
});

test('latency-delayed EOF remains playing until the final audio reaches the device', async () => {
    const fixture = controllerFixture({ endTime: 1 });
    fixture.context.baseLatency = 0.02;
    fixture.context.outputLatency = 0.08;
    await fixture.controller.start();
    fixture.context.currentTime = 1.005;
    fixture.raf.step();
    assert.equal(fixture.controller.isPlaying(), true,
        'raw scheduling EOF must not stop the audible presentation early');
    assert.ok(Math.abs(fixture.controller.currentTime() - 0.9) < 1e-9);
    fixture.context.currentTime = 1.105;
    fixture.raf.step();
    assert.equal(fixture.controller.isPlaying(), false);
    assert.equal(fixture.controller.currentTime(), 1);
});

test('reference loops pre-schedule exact adjacent anchors without rAF restarts', async () => {
    const fixture = controllerFixture({ mode: 'song', endTime: 5 });
    fixture.controller.setLoop({ enabled: true, startTime: 1, endTime: 2 });
    await fixture.controller.seek(1.8);
    assert.equal(await fixture.controller.start(), true);
    const schedules = fixture.reference().schedules;
    assert.deepEqual(schedules.slice(0, 3).map(item => ({
        time: item.time,
        when: Math.round(item.options.when * 1000) / 1000,
        append: item.options.append || false,
    })), [
        { time: 1.8, when: 0.005, append: false },
        { time: 1, when: 0.205, append: true },
        { time: 1, when: 1.205, append: true },
    ]);
    fixture.context.currentTime = 0.255;
    fixture.raf.step();
    assert.equal(fixture.controller.isPlaying(), true);
    assert.ok(Math.abs(fixture.controller.currentTime() - 1.05) < 1e-9);
});

test('a total reference preparation failure never enters playing state', async () => {
    const failure = new Error('all reference sources failed');
    failure.failures = [{ sourceId: 'master', error: new Error('decode failed') }];
    let schedules = 0;
    const fixture = controllerFixture({
        mode: 'song',
        referenceMixerFactory: () => ({
            async prepare() { throw failure; },
            schedule() { schedules++; },
            cancel() {},
            destroy() {},
        }),
    });
    assert.equal(await fixture.controller.start(), false);
    assert.equal(fixture.controller.isPlaying(), false);
    assert.equal(fixture.controller.state().error, failure);
    assert.equal(fixture.controller.state().warnings[0].sourceId, 'master');
    assert.equal(schedules, 0);
});

test('an audio-device interruption stops the private pass and reports an error', async () => {
    const fixture = controllerFixture();
    await fixture.controller.start();
    fixture.context.currentTime = 0.505;
    fixture.context.state = 'interrupted';
    fixture.context.emit('statechange');
    assert.equal(fixture.controller.isPlaying(), false);
    assert.ok(fixture.controller.state().error.message.includes('audio device'));
    assert.equal(fixture.controller.currentTime(), 0.5);
    await fixture.controller.destroy();
    assert.equal(fixture.context.listeners.get('statechange').size, 0);
    assert.equal(fixture.context.listeners.get('sinkchange').size, 0);
});

test('a later start replaces a closed AudioContext and its context-bound graph', async () => {
    const contexts = [
        new FakeAudioContext({ state: 'suspended' }),
        new FakeAudioContext({ state: 'suspended' }),
    ];
    const soundfont = new FakeSoundfont();
    const guides = [];
    const references = [];
    let contextFactoryCalls = 0;
    const controller = new CompositePreviewController({
        audioContextFactory: () => contexts[contextFactoryCalls++],
        soundfontLoader: soundfont,
        guideSchedulerFactory: options => {
            const scheduler = new FakeGuideScheduler(options);
            guides.push(scheduler);
            return scheduler;
        },
        referenceMixerFactory: options => {
            const mixer = new FakeReferenceMixer(options);
            references.push(mixer);
            return mixer;
        },
        requestAnimationFrameFn: null,
        cancelAnimationFrameFn: null,
        modes: {
            primary: {
                kind: 'guide',
                events: [{ t: 0, midi: 60, sus: 0.2 }],
                voiceCap: 6,
            },
        },
        mode: 'primary',
        startTime: 0,
        endTime: 10,
    });

    assert.equal(await controller.start(), true);
    const firstContext = contexts[0];
    const firstGraph = [
        controller.referenceGain, controller.guideGain,
        controller.masterGain, controller.limiter,
    ];
    firstContext.currentTime = 0.505;
    firstContext.state = 'closed';
    firstContext.emit('statechange');
    assert.equal(controller.isPlaying(), false);

    assert.equal(await controller.start(), true);
    assert.equal(contextFactoryCalls, 2);
    assert.strictEqual(controller.context, contexts[1]);
    assert.equal(controller.isPlaying(), true);
    assert.deepEqual(soundfont.prepared.map(item => item.context), contexts);
    assert.equal(guides.length, 2);
    assert.equal(references.length, 2);
    assert.equal(guides[0].destroyed, true);
    assert.deepEqual(guides[0].destroyOptions, { contextWillClose: true });
    assert.equal(references[0].destroyed, true);
    assert.ok(firstGraph.every(node => node.disconnected));
    assert.equal(firstContext.listeners.get('statechange').size, 0);
    assert.equal(firstContext.listeners.get('sinkchange').size, 0);
    assert.equal(soundfont.destroyed, false,
        'context recovery retains the controller-owned per-context loader');

    const completion = controller.destroy();
    assert.strictEqual(controller.destroy(), completion);
    await completion;
    assert.equal(contexts[1].closed, true);
    assert.equal(soundfont.destroyed, true);
});

test('loop time projection keeps the initial tail and every later cycle contiguous', () => {
    const loop = { enabled: true, startTime: 1, endTime: 2 };
    assert.equal(compositePreviewLoopTimePure(1.8, 0.199, loop), 1.999);
    assert.equal(compositePreviewLoopTimePure(1.8, 0.2, loop), 1);
    assert.equal(compositePreviewLoopTimePure(1.8, 1.2, loop), 1);
});

test('mode generation replaces stale loading audio with the newly selected mode', async () => {
    let release;
    const deferred = new Promise(resolve => { release = resolve; });
    const soundfont = new FakeSoundfont();
    soundfont.prepare = async function prepare(context, program) {
        this.prepared.push({ context, program });
        await deferred;
        return {};
    };
    const fixture = controllerFixture({ soundfontLoader: soundfont });
    const starting = fixture.controller.start();
    await flush();
    assert.equal(fixture.controller.state().loading, true);
    await fixture.controller.setMode('song');
    release();
    assert.equal(await starting, false);
    assert.equal(fixture.controller.isPlaying(), true);
    assert.equal(fixture.controller.state().mode, 'song');
    assert.equal(fixture.guide().starts.length, 0);
    assert.equal(fixture.reference().schedules.length, 1);
});

test('tone and seek changes during loading restart the pending guide at the latest cursor', async () => {
    const releases = [];
    const soundfont = new FakeSoundfont();
    soundfont.prepare = function prepare(context, program) {
        this.prepared.push({ context, program });
        return new Promise(resolve => releases.push(resolve));
    };
    const fixture = controllerFixture({ soundfontLoader: soundfont });
    const starting = fixture.controller.start();
    await flush();
    const changingTone = fixture.controller.setTone('distortion');
    await flush();
    const seeking = fixture.controller.seek(3);
    await flush();
    assert.deepEqual(soundfont.prepared.map(item => item.program), [27, 30, 30]);

    releases[0]({});
    releases[1]({});
    assert.equal(await starting, false);
    assert.equal(await changingTone, false);
    releases[2]({});
    assert.equal(await seeking, true);
    assert.equal(fixture.controller.isPlaying(), true);
    assert.equal(fixture.controller.currentTime(), 3);
    assert.equal(fixture.guide().configurations.at(-1).program, 30);
    assert.equal(fixture.guide().starts.at(-1).time, 3);
});

test('selecting a new mode clears a previous preview failure before configuration emits', async () => {
    const fixture = controllerFixture();
    fixture.controller.lastError = new Error('old decode failed');
    assert.equal(await fixture.controller.setMode('song'), true);
    assert.equal(fixture.controller.state().error, null);
    assert.equal(fixture.states.at(-1).error, null);
});

test('concurrent destroy callers share the pending AudioContext close', async () => {
    const fixture = controllerFixture();
    await fixture.controller.start();
    let closeCalls = 0;
    let releaseClose;
    fixture.context.close = () => {
        closeCalls++;
        return new Promise(resolve => {
            releaseClose = () => {
                fixture.context.state = 'closed';
                fixture.context.closed = true;
                resolve();
            };
        });
    };

    const first = fixture.controller.destroy();
    const concurrent = fixture.controller.destroy();
    assert.strictEqual(concurrent, first,
        'every caller must observe the same pending teardown barrier');
    assert.equal(closeCalls, 1);

    let settled = false;
    void first.then(() => { settled = true; });
    await flush();
    assert.equal(settled, false, 'destroy must remain pending until AudioContext.close settles');

    releaseClose();
    await concurrent;
    assert.equal(settled, true);
    assert.equal(fixture.context.closed, true);
});

test('destroy cancels feature-owned engines and closes only its private context', async () => {
    const fixture = controllerFixture();
    await fixture.controller.start();
    const guide = fixture.guide();
    const reference = fixture.reference();
    const close = fixture.context.close.bind(fixture.context);
    let closeCalls = 0;
    fixture.context.close = async () => {
        closeCalls++;
        await close();
    };
    const completion = fixture.controller.destroy();
    await completion;
    assert.equal(fixture.context.closed, true);
    assert.equal(closeCalls, 1);
    assert.equal(fixture.soundfont.destroyed, true);
    assert.equal(guide.destroyed, true);
    assert.deepEqual(guide.destroyOptions, { contextWillClose: true });
    assert.equal(reference.destroyed, true);
    assert.equal(fixture.controller.isPlaying(), false);
    assert.equal(await fixture.controller.start(), false);
    assert.strictEqual(fixture.controller.destroy(), completion,
        'a completed destroy call keeps returning the original completion');
    assert.equal(closeCalls, 1, 'repeated destroy must not close the context twice');
});
