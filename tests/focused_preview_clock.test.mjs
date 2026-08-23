import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

globalThis.document = globalThis.document || {
    getElementById: () => null,
    addEventListener: () => {},
    activeElement: null,
};
globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null,
    setItem: () => {},
};
globalThis.window = globalThis.window || globalThis;

const {
    _audioTimelineDurationPure,
    _focusedGuideClockOnlyPure,
} = await import('../src/audio.js');
const { _transportChartTimePure } = await import('../src/transport.js');

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

function startHarness(preview, telemetryEnabled = false) {
    const calls = {
        anchor: 0,
        sourceStart: 0,
        stemStop: 0,
        referenceStop: 0,
        scheduler: 0,
        tick: 0,
        icon: 0,
        abGain: 0,
    };
    const telemetry = { starts: 0, counters: {}, timings: [] };
    const S = {
        audioBuffer: { duration: 180 },
        masterAudioDuration: 180,
        duration: 180,
        audioShift: 0,
        audioSource: null,
        audioCtx: { currentTime: 50, state: 'running' },
        beats: [],
        cursorTime: 12,
        cursorDrawTime: 12,
        loopEnabled: false,
        playing: false,
    };
    const start = new Function(
        'S', 'preview', '_focusedGuideClockOnlyPure', '_ensureAudioCtx',
        '_composeSongDuration', 'host', 'editorCountInBars', '_countInPlanPure',
        '_anchorTransportAtCursor', '_abApplyRefGain', '_startAudioSourceAtCursor',
        '_stopStemSources', '_stopRefMedia', '_metroClickVoiceAt', 'updatePlayIcon',
        'playbackTick', '_guideTimerSync', 'hybridPerformanceEnabled',
        'hybridPerfStart', 'hybridPerfCount', 'hybridPerfEnd',
        'let _editorGuidePreview = preview; let _abPhase = "guide";\n'
        + extractFunction('startPlayback')
        + '\nreturn startPlayback;'
    )(
        S,
        preview,
        _focusedGuideClockOnlyPure,
        () => S.audioCtx,
        () => { throw new Error('buffered playback must not compute compose duration'); },
        { selectedLoopRegion: () => null },
        () => 0,
        () => null,
        (preRoll = 0) => {
            calls.anchor++;
            S.playStartWall = S.audioCtx.currentTime + preRoll;
            S.playStartTime = S.cursorTime;
        },
        () => { calls.abGain++; },
        () => { calls.sourceStart++; },
        () => { calls.stemStop++; },
        () => { calls.referenceStop++; },
        () => {},
        () => { calls.icon++; },
        () => {
            calls.tick++;
            S.cursorTime = _transportChartTimePure(
                S.playStartTime, S.playStartWall, S.audioCtx.currentTime);
        },
        () => { calls.scheduler++; },
        () => telemetryEnabled,
        () => { telemetry.starts++; return 10; },
        (name, amount = 1) => {
            telemetry.counters[name] = (telemetry.counters[name] || 0) + amount;
        },
        (name, startedAt) => { telemetry.timings.push([name, startedAt]); },
    );
    return { S, calls, start, telemetry };
}

function stopHarness(preview, telemetryEnabled = false) {
    const calls = {
        sourceStop: 0, stemStop: 0, referenceStop: 0, icon: 0,
        frameCancel: 0, scheduler: 0, voicesCancel: 0, abGain: 0,
    };
    const telemetry = { starts: 0, counters: {}, timings: [] };
    const S = {
        audioSource: { stop() { calls.sourceStop++; } },
        playing: true,
    };
    const stop = new Function(
        'S', 'preview', '_stopStemSources', '_stopRefMedia', 'updatePlayIcon',
        'cancelAnimationFrame', '_guideTimerSync', '_guideCancelVoices',
        '_abApplyRefGain', 'hybridPerformanceEnabled', 'hybridPerfStart',
        'hybridPerfCount', 'hybridPerfEnd',
        'let _editorGuidePreview = preview; let rafId = 7;\n'
        + extractFunction('stopPlayback')
        + '\nreturn stopPlayback;'
    )(
        S,
        preview,
        () => { calls.stemStop++; },
        () => { calls.referenceStop++; },
        () => { calls.icon++; },
        () => { calls.frameCancel++; },
        () => { calls.scheduler++; },
        () => { calls.voicesCancel++; },
        () => { calls.abGain++; },
        () => telemetryEnabled,
        () => { telemetry.starts++; return 20; },
        (name, amount = 1) => {
            telemetry.counters[name] = (telemetry.counters[name] || 0) + amount;
        },
        (name, startedAt) => { telemetry.timings.push([name, startedAt]); },
    );
    return { S, calls, stop, telemetry };
}

function restartHarness(preview) {
    const calls = { staleStop: 0, stemStop: 0, sourceStart: 0, referenceStop: 0, anchor: 0 };
    const S = {
        audioBuffer: { duration: 180 },
        audioSource: { stop() { calls.staleStop++; } },
        cursorTime: 12,
    };
    const restart = new Function(
        'S', 'preview', '_audioTimelineDuration', '_stopStemSources',
        '_focusedGuideClockOnlyPure', '_startAudioSourceAtCursor', '_stopRefMedia',
        '_anchorTransportAtCursor',
        'let _editorGuidePreview = preview;\n'
        + extractFunction('_restartPlaybackAt')
        + '\nreturn _restartPlaybackAt;'
    )(
        S,
        preview,
        () => 180,
        () => { calls.stemStop++; },
        _focusedGuideClockOnlyPure,
        () => { calls.sourceStart++; },
        () => { calls.referenceStop++; },
        () => { calls.anchor++; },
    );
    return { S, calls, restart };
}

test('clock-only policy is exclusive to a muted focused preview with a recording', () => {
    assert.equal(_focusedGuideClockOnlyPure({ referenceAudio: 'muted' }, true), true);
    assert.equal(_focusedGuideClockOnlyPure({ referenceAudio: 'audible' }, true), false,
        'Original Song retains the recording path');
    assert.equal(_focusedGuideClockOnlyPure(null, true), false,
        'ordinary Editor playback retains the recording path');
    assert.equal(_focusedGuideClockOnlyPure({ referenceAudio: 'muted' }, false), false,
        'compose mode remains governed by its existing no-buffer branch');
});

test('muted focused playback skips recording/stem creation but keeps the real-song clock', () => {
    const { S, calls, start } = startHarness({
        referenceAudio: 'muted',
        events: [{ t: 12, midi: 64 }],
    });
    start();
    assert.equal(calls.sourceStart, 0,
        '_startAudioSourceAtCursor — the sole recording/region/stem constructor — is skipped');
    assert.equal(calls.stemStop, 1, 'stale stems are silenced, never recreated');
    assert.equal(calls.referenceStop, 1, 'a stale reference MediaElement is silenced');
    assert.equal(calls.anchor, 1, 'the AudioContext clock is anchored without a source');
    assert.equal(calls.scheduler, 1, 'the guide scheduler still starts');
    assert.equal(S.playing, true);
    assert.equal(S.duration, 180, 'the decoded song duration is not replaced by a compose duration');
    assert.equal(_audioTimelineDurationPure(
        S.duration, S.audioShift, S.masterAudioDuration), 180);

    S.audioCtx.currentTime += 1.25;
    S.cursorTime = _transportChartTimePure(
        S.playStartTime, S.playStartWall, S.audioCtx.currentTime);
    assert.equal(S.cursorTime, 13.25, 'the source-free transport advances on the AudioContext clock');
});

test('Original Song and ordinary Editor playback retain the existing source path', () => {
    for (const preview of [{ referenceAudio: 'audible', events: [] }, null]) {
        const { calls, start } = startHarness(preview);
        start();
        assert.equal(calls.sourceStart, 1);
        assert.equal(calls.anchor, 0,
            'the unchanged source path owns its own transport anchor');
        assert.equal(calls.stemStop, 0);
        assert.equal(calls.referenceStop, 0);
        assert.equal(calls.scheduler, 1);
    }
});

test('focused seeks and loop restarts remain source-free', () => {
    const muted = restartHarness({ referenceAudio: 'muted' });
    muted.restart(48);
    assert.deepEqual(muted.calls, {
        staleStop: 1,
        stemStop: 1,
        sourceStart: 0,
        referenceStop: 1,
        anchor: 1,
    });
    assert.equal(muted.S.cursorTime, 48);

    const original = restartHarness({ referenceAudio: 'audible' });
    original.restart(48);
    assert.equal(original.calls.sourceStart, 1,
        'Original Song restart still rebuilds its recording/stem source path');
    assert.equal(original.calls.anchor, 0);
});

test('opt-in telemetry times focused preview start and stop without touching ordinary playback', () => {
    const focusedStart = startHarness({ referenceAudio: 'muted', events: [] }, true);
    focusedStart.start();
    assert.equal(focusedStart.telemetry.starts, 1);
    assert.equal(focusedStart.telemetry.counters['audio.preview.start'], 1);
    assert.deepEqual(focusedStart.telemetry.timings, [['audio.preview.startMs', 10]]);

    const focusedStop = stopHarness({ referenceAudio: 'muted', events: [] }, true);
    focusedStop.stop();
    assert.equal(focusedStop.telemetry.starts, 1);
    assert.equal(focusedStop.telemetry.counters['audio.preview.stop'], 1);
    assert.deepEqual(focusedStop.telemetry.timings, [['audio.preview.stopMs', 20]]);

    const ordinaryStart = startHarness(null, true);
    ordinaryStart.start();
    assert.equal(ordinaryStart.telemetry.starts, 0,
        'ordinary Editor playback bypasses focused-preview telemetry entirely');
    const ordinaryStop = stopHarness(null, true);
    ordinaryStop.stop();
    assert.equal(ordinaryStop.telemetry.starts, 0);
});
