import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CompositeGuideScheduler,
    compositeChordVoiceGainPure,
    compositeGuideEventsPure,
    compositeGuideGroupsInWindowPure,
    compositeGuideScheduleWindowPure,
} from '../src/composite/audition-guide-scheduler.js';

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
