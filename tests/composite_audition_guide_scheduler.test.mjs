import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CompositeGuideScheduler,
    compositeChordVoiceGainPure,
    compositeGuideEventsPure,
    compositeGuideGroupsInWindowPure,
    compositeGuideLoopGroupsInWindowPure,
    compositeGuideScheduleWindowPure,
} from '../src/composite/audition-guide-scheduler.js';
import { FakeAudioContext } from './composite_audition_fakes.mjs';

function timeoutHarness() {
    let nextId = 1;
    const jobs = [];
    return {
        jobs,
        cleared: [],
        set(callback, delay) {
            const job = { id: nextId++, callback, delay, fired: false };
            jobs.push(job);
            return job.id;
        },
        clear(id) {
            this.cleared.push(id);
        },
        fire(job) {
            if (job.fired) return;
            job.fired = true;
            job.callback();
        },
    };
}

test('guide event windows include the exact cursor and scale a chord at constant power', () => {
    const events = compositeGuideEventsPure([
        { t: 2, midi: 67, sus: 0.4 },
        { t: 1, midi: 64, sus: 0.3 },
        { t: 1.0004, midi: 60, sus: 0.2 },
        { t: 1.0002, midi: 64, sus: 0.5 },
        { t: Number.NaN, midi: 70, sus: 1 },
    ]);
    const groups = compositeGuideGroupsInWindowPure(events, 1, 2, 6);
    assert.equal(groups.length, 1, 'the half-open window excludes t=2');
    assert.equal(groups[0].t, 1, 'the lower boundary is inclusive');
    assert.deepEqual(groups[0].voices.map(voice => voice.midi), [64, 60],
        'one-millisecond chord buckets dedupe identical pitches');
    assert.equal(compositeChordVoiceGainPure(4, 0.5), 0.25);
});

test('guide loop projection schedules both sides of a boundary on exact sample anchors', () => {
    const events = compositeGuideEventsPure([
        { t: 1, midi: 60, sus: 0.1 },
        { t: 1.15, midi: 62, sus: 0.1 },
    ]);
    const groups = compositeGuideLoopGroupsInWindowPure(events, 0, 0.3, {
        cursorTime: 1.1,
        loopStart: 1,
        loopEnd: 1.2,
    });
    assert.deepEqual(groups.map(group => [group.elapsed, group.voices[0].midi]), [
        [0.05, 62],
        [0.1, 60],
        [0.25, 62],
    ]);

    const context = new FakeAudioContext();
    const scheduled = [];
    const scheduler = new CompositeGuideScheduler({
        context,
        setIntervalFn: () => 8,
        clearIntervalFn: () => {},
        voice: options => {
            scheduled.push(options);
            return { until: options.when + 0.1, cancel() {} };
        },
    });
    scheduler.configure({ events });
    scheduler.start(1.1, {
        endTime: 1.2,
        startContextTime: 10,
        loop: { enabled: true, startTime: 1, endTime: 1.2 },
    });
    assert.deepEqual(scheduled.map(item => item.when), [10.05, 10.1, 10.25]);
    scheduler.destroy();
});

test('cleaned guide pass targets are reused so WebAudioFont envelopes stay bounded', () => {
    const context = new FakeAudioContext();
    const timeouts = timeoutHarness();
    const targets = [];
    const scheduler = new CompositeGuideScheduler({
        context,
        nowChart: () => 0,
        chartToContext: value => value,
        setIntervalFn: () => 10,
        clearIntervalFn: () => {},
        setTimeoutFn: (callback, delay) => timeouts.set(callback, delay),
        clearTimeoutFn: id => timeouts.clear(id),
        voice: options => {
            targets.push(options.target);
            return { until: 1, cancel() {} };
        },
    });
    scheduler.configure({ events: [{ t: 0, midi: 60, sus: 1 }] });
    scheduler.start(0, { endTime: 1 });
    scheduler.stop();
    timeouts.fire(timeouts.jobs[0]);
    scheduler.start(0, { endTime: 1 });
    assert.strictEqual(targets[1], targets[0]);
    assert.equal(context.gains.length, 1,
        'repeated transport passes do not create an unbounded target list');
    scheduler.destroy();
});

test('guide scheduling retains the exact seek onset and cancels its voice generation', () => {
    const context = { currentTime: 10, destination: {} };
    let chartNow = 5.05; // deliberately beyond the normal 40 ms late bound
    const scheduled = [];
    let cancelled = 0;
    const scheduler = new CompositeGuideScheduler({
        context,
        target: {},
        nowChart: () => chartNow,
        chartToContext: chartTime => 10 + (chartTime - 5),
        setIntervalFn: () => 77,
        clearIntervalFn: id => assert.equal(id, 77),
        voice: options => {
            scheduled.push(options);
            return { until: options.when + 1, cancel() { cancelled++; } };
        },
    });
    scheduler.configure({
        program: 29,
        voiceCap: 6,
        baseGain: 0.5,
        events: [
            { t: 5, midi: 60, sus: 0.2 },
            { t: 5, midi: 64, sus: 0.3 },
            { t: 5.2, midi: 67, sus: 0.4 },
        ],
    });
    scheduler.start(5, { endTime: 6 });
    assert.equal(scheduled.length, 3);
    assert.equal(scheduled[0].when, 10,
        'an exact cursor onset is scheduled at the transport anchor');
    assert.equal(scheduled[0].gain, 0.5 / Math.sqrt(2));
    assert.equal(scheduled[0].program, 29);
    chartNow = 5.1;
    scheduler.tick();
    assert.equal(scheduled.length, 3, 'adjacent half-open windows do not replay voices');
    scheduler.stop();
    assert.equal(cancelled, 3, 'stop retires every queued voice in the generation');
});

test('a late guide tick recovers only the bounded recent window', () => {
    const context = { currentTime: 0, destination: {} };
    let chartNow = 0;
    const scheduled = [];
    const scheduler = new CompositeGuideScheduler({
        context,
        nowChart: () => chartNow,
        chartToContext: chartTime => chartTime,
        setIntervalFn: () => 1,
        clearIntervalFn: () => {},
        voice: options => {
            scheduled.push(options);
            return { until: options.when + 1, cancel() {} };
        },
    });
    scheduler.configure({ events: [
        { t: 0.5, midi: 60, sus: 0 },
        { t: 0.98, midi: 62, sus: 0 },
    ] });
    scheduler.start(0, { endTime: 2 });
    assert.equal(scheduled.length, 0, 'first 300 ms lookahead excludes later notes');
    context.currentTime = 1;
    chartNow = 1;
    scheduler.tick();
    assert.deepEqual(scheduled.map(item => item.midi), [62],
        'the 40 ms recovery catches the recent attack without machine-gunning backlog');
    assert.equal(scheduled[0].when, 1, 'a recovered late voice starts immediately');
    const window = compositeGuideScheduleWindowPure(1, 0.3);
    assert.deepEqual(window, { from: 0.96, to: 1.3 });
    scheduler.destroy();
});

test('dense guide stop retires 1000 voices in O(1) and cleans only its old pass', () => {
    const context = new FakeAudioContext();
    const timeouts = timeoutHarness();
    const voices = [];
    const events = [];
    for (let bucket = 0; bucket < 250; bucket++) {
        for (let pitch = 0; pitch < 4; pitch++) {
            events.push({ t: bucket / 1000, midi: 60 + pitch, sus: 1 });
        }
    }
    const scheduler = new CompositeGuideScheduler({
        context,
        target: context.destination,
        nowChart: () => 0,
        chartToContext: chartTime => chartTime,
        setIntervalFn: () => 91,
        clearIntervalFn: () => {},
        setTimeoutFn: (callback, delay) => timeouts.set(callback, delay),
        clearTimeoutFn: id => timeouts.clear(id),
        voice: options => {
            const item = {
                generation: options.generation,
                target: options.target,
                until: options.when + 1,
                cancelled: 0,
                cancel() { this.cancelled++; },
            };
            voices.push(item);
            return item;
        },
    });
    scheduler.configure({ events, voiceCap: 6 });
    scheduler.start(0, { endTime: 1 });
    assert.equal(voices.length, 1000);
    const firstPassTarget = voices[0].target;
    assert.ok(voices.every(voice => voice.target === firstPassTarget));

    scheduler.configure({ events: [{ t: 0, midi: 72, sus: 1 }] });
    assert.equal(voices.reduce((sum, voice) => sum + voice.cancelled, 0), 0,
        'a mode switch does not walk or cancel any individual voice synchronously');
    assert.equal(timeouts.jobs.length, 1);
    assert.equal(timeouts.jobs[0].delay, 8);
    assert.equal(firstPassTarget.gain.events.at(-1).type, 'ramp');
    assert.equal(firstPassTarget.gain.events.at(-1).value, 0);
    assert.equal(firstPassTarget.gain.events.at(-1).time, 0.004);

    scheduler.start(0, { endTime: 1 });
    const nextVoice = voices.at(-1);
    const nextPassTarget = nextVoice.target;
    assert.notStrictEqual(nextPassTarget, firstPassTarget,
        'every playback generation gets a separate pass gain');
    timeouts.fire(timeouts.jobs[0]);
    assert.equal(voices.slice(0, 1000).every(voice => voice.cancelled === 1), true);
    assert.equal(nextVoice.cancelled, 0,
        'an old deferred cleanup cannot cancel the new generation');
    assert.equal(firstPassTarget.disconnected, true);
    assert.equal(nextPassTarget.disconnected, false);

    scheduler.stop();
    assert.equal(nextVoice.cancelled, 0,
        'explicit Stop also leaves envelope cancellation to deferred cleanup');
    assert.equal(timeouts.jobs.length, 2);
    scheduler.start(0, { endTime: 1 });
    const thirdVoice = voices.at(-1);
    timeouts.fire(timeouts.jobs[1]);
    assert.equal(nextVoice.cancelled, 1);
    assert.equal(thirdVoice.cancelled, 0,
        'a Stop cleanup is likewise isolated from the restarted pass');
    scheduler.destroy();
});

test('guide destroy flushes every deferred pass cleanup and disarms its timers', () => {
    const context = new FakeAudioContext();
    const timeouts = timeoutHarness();
    const voices = [];
    const scheduler = new CompositeGuideScheduler({
        context,
        setIntervalFn: () => 92,
        clearIntervalFn: () => {},
        setTimeoutFn: (callback, delay) => timeouts.set(callback, delay),
        clearTimeoutFn: id => timeouts.clear(id),
        nowChart: () => 0,
        chartToContext: chartTime => chartTime,
        voice: options => {
            const item = {
                target: options.target,
                until: 1,
                cancelled: 0,
                cancel() { this.cancelled++; },
            };
            voices.push(item);
            return item;
        },
    });
    scheduler.configure({ events: [{ t: 0, midi: 60, sus: 1 }] });
    scheduler.start(0, { endTime: 1 });
    scheduler.stop();
    scheduler.configure({ events: [{ t: 0, midi: 62, sus: 1 }] });
    scheduler.start(0, { endTime: 1 });
    assert.equal(timeouts.jobs.length, 1);

    scheduler.destroy();
    assert.equal(timeouts.jobs.length, 2,
        'destroy first retires the currently audible pass');
    assert.deepEqual(timeouts.cleared.sort((a, b) => a - b), [1, 2]);
    assert.deepEqual(voices.map(voice => voice.cancelled), [1, 1]);
    assert.equal(context.gains.every(node => node.disconnected), true);
    for (const job of timeouts.jobs) timeouts.fire(job);
    assert.deepEqual(voices.map(voice => voice.cancelled), [1, 1],
        'a cleared callback is also idempotent if a host invokes it late');
});

test('guide destroy drops dense passes in O(1) when its owning context will close', () => {
    const context = new FakeAudioContext();
    const timeouts = timeoutHarness();
    const voices = [];
    const events = [];
    for (let bucket = 0; bucket < 250; bucket++) {
        for (let pitch = 0; pitch < 4; pitch++) {
            events.push({ t: bucket / 1000, midi: 60 + pitch, sus: 1 });
        }
    }
    const scheduler = new CompositeGuideScheduler({
        context,
        setIntervalFn: () => 94,
        clearIntervalFn: () => {},
        setTimeoutFn: (callback, delay) => timeouts.set(callback, delay),
        clearTimeoutFn: id => timeouts.clear(id),
        nowChart: () => 0,
        chartToContext: chartTime => chartTime,
        voice: options => {
            const item = {
                target: options.target,
                until: 1,
                cancelled: 0,
                cancel() { this.cancelled++; },
            };
            voices.push(item);
            return item;
        },
    });
    scheduler.configure({ events, voiceCap: 6 });
    scheduler.start(0, { endTime: 1 });
    assert.equal(voices.length, 1000);
    const retiredPassGain = voices[0].target;
    scheduler.stop();
    assert.equal(timeouts.jobs.length, 1);
    scheduler.start(0, { endTime: 1 });
    assert.equal(voices.length, 2000);
    const activePassGain = voices.at(-1).target;

    scheduler.destroy({ contextWillClose: true });
    assert.equal(voices.every(voice => voice.cancelled === 0), true,
        'context shutdown does not synchronously walk active or retired envelopes');
    assert.equal(retiredPassGain.disconnected, true);
    assert.equal(activePassGain.disconnected, true,
        'each entire dense pass is made inaudible with one disconnection');
    assert.equal(timeouts.cleared.length, 1);
    assert.equal(scheduler.retiredCleanups.size, 0);
    assert.equal(scheduler.voices.length, 0);
    timeouts.fire(timeouts.jobs[0]);
    assert.equal(voices.every(voice => voice.cancelled === 0), true,
        'the discarded timer cannot later traverse released voices');
});

test('guide stop cancels synchronously when deferred cleanup is unavailable', () => {
    const context = new FakeAudioContext();
    let cancelled = 0;
    const scheduler = new CompositeGuideScheduler({
        context,
        setIntervalFn: () => 93,
        clearIntervalFn: () => {},
        setTimeoutFn: null,
        nowChart: () => 0,
        chartToContext: chartTime => chartTime,
        voice: options => ({
            target: options.target,
            until: 1,
            cancel() { cancelled++; },
        }),
    });
    scheduler.configure({ events: [{ t: 0, midi: 60, sus: 1 }] });
    scheduler.start(0, { endTime: 1 });
    scheduler.stop();
    assert.equal(cancelled, 1);
    assert.equal(context.gains[0].disconnected, true);
    scheduler.destroy();
});
