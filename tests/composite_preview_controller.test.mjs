import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CompositePreviewController,
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
    assert.equal(compositePreviewOutputLatencyPure(fixture.context), 0.08);
    assert.equal(compositePreviewOutputLatencyPure({ baseLatency: 0.02 }), 0.02);
    assert.equal(compositePreviewPresentationTimePure(5, 10, 10, 0.08), 5,
        'latency never paints behind a new seek anchor');
    await fixture.controller.start();
    fixture.context.currentTime = 1.005;
    assert.ok(Math.abs(fixture.controller.transportTime() - 1) < 1e-9);
    assert.ok(Math.abs(fixture.controller.presentationTime() - 0.92) < 1e-9);
    assert.ok(Math.abs(fixture.guide().options.nowChart() - 1) < 1e-9,
        'the guide scheduler retains the uncompensated sample clock');
    fixture.context.outputLatency = 0.2;
    assert.ok(Math.abs(fixture.controller.presentationTime() - 0.92) < 1e-9,
        'a pass holds its sampled latency instead of shimmering frame to frame');
    fixture.controller.stop();
    await fixture.controller.start();
    fixture.context.currentTime = 2.01;
    assert.ok(Math.abs(fixture.controller.presentationTime() - 1.72) < 1e-9,
        'the next start samples the newly reported output latency');
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
    assert.equal(controller.currentTime(), 1,
        'loop wrap establishes a fresh private transport anchor');
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

test('destroy cancels feature-owned engines and closes only its private context', async () => {
    const fixture = controllerFixture();
    await fixture.controller.start();
    const guide = fixture.guide();
    const reference = fixture.reference();
    await fixture.controller.destroy();
    assert.equal(fixture.context.closed, true);
    assert.equal(fixture.soundfont.destroyed, true);
    assert.equal(guide.destroyed, true);
    assert.deepEqual(guide.destroyOptions, { contextWillClose: true });
    assert.equal(reference.destroyed, true);
    assert.equal(fixture.controller.isPlaying(), false);
    assert.equal(await fixture.controller.start(), false);
});
