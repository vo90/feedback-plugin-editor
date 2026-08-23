import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CompositeReferenceMixer,
    compositeReferencePlacementsPure,
    compositeReferenceSnapshotPure,
} from '../src/composite/audition-reference.js';
import { FakeAudioContext } from './composite_audition_fakes.mjs';

const buffer = duration => ({ duration });

test('reference snapshots resolve master/stems, removals, active buffer, and whole-map solo', () => {
    const active = buffer(12);
    const snapshot = compositeReferenceSnapshotPure({
        masterUrl: '/master.ogg',
        stems: [
            { id: 'guitar', url: '/guitar.ogg', offset: 0.2 },
            { id: 'removed', url: '/removed.ogg' },
        ],
        removedSourceIds: ['removed'],
        activeSourceId: 'master',
        activeUrl: '/master.ogg',
        activeBuffer: active,
        partStripState: key => key === 'audio:guitar'
            ? { audible: true, vol: 0.6, solo: true }
            : { audible: true, vol: 0.8, solo: false },
    });
    assert.deepEqual(snapshot.sources.map(source => source.id), ['master', 'guitar']);
    assert.equal(snapshot.sources[0].buffer, active, 'the public active buffer is reused');
    assert.equal(snapshot.sources[0].gain, 0, 'a soloed stem gates the unsoloed master');
    assert.equal(snapshot.sources[1].gain, 0.6);
});

test('reference placements align shifted master/stem regions and cap them at preview end', () => {
    const master = buffer(10);
    const stem = buffer(8);
    const input = {
        audioShift: 0.25,
        beatToTime: beat => beat * 0.5,
        sources: [
            { id: 'master', buffer: master, gain: 1 },
            { id: 'rhythm', buffer: stem, offset: 0.5, gain: 0.7 },
        ],
        tracks: [{
            type: 'audio', sourceId: 'rhythm', regions: [
                { id: 'riff', startBeat: 4, srcIn: 2, srcOut: 5 },
            ],
        }],
    };
    const snapshot = compositeReferenceSnapshotPure(input);
    const placements = compositeReferencePlacementsPure(snapshot, 1, { endTime: 4 });
    assert.equal(placements.length, 2);
    assert.deepEqual({
        sourceId: placements[0].sourceId,
        offset: placements[0].offset,
        delay: placements[0].delay,
        duration: placements[0].duration,
        trimmed: placements[0].trimmed,
        chartStartTime: placements[0].chartStartTime,
    }, {
        sourceId: 'master', offset: 0.75, delay: 0, duration: 3,
        trimmed: false, chartStartTime: 0.25,
    });
    assert.deepEqual({
        sourceId: placements[1].sourceId,
        offset: placements[1].offset,
        delay: placements[1].delay,
        duration: placements[1].duration,
        trimmed: placements[1].trimmed,
        chartStartTime: placements[1].chartStartTime,
    }, {
        sourceId: 'rhythm', offset: 2, delay: 1.75, duration: 1.25,
        trimmed: true, chartStartTime: 2.75,
    });
});

test('reference mixer schedules every source on one anchor and cancels all nodes', async () => {
    const context = new FakeAudioContext();
    const target = context.createGain();
    const mixer = new CompositeReferenceMixer({ context, target });
    await mixer.prepare({
        audioShift: 0.25,
        beatToTime: beat => beat * 0.5,
        sources: [
            { id: 'master', buffer: buffer(10), gain: 1 },
            { id: 'rhythm', buffer: buffer(8), offset: 0.5, gain: 0.7,
                regions: [{ id: 'riff', startBeat: 4, srcIn: 2, srcOut: 5 }] },
        ],
    });
    assert.equal(mixer.schedule(1, { when: 5, endTime: 4 }), 2);
    assert.deepEqual(context.sources[0].starts[0], [5, 0.75, 3]);
    assert.deepEqual(context.sources[1].starts[0], [6.75, 2, 1.25]);
    const trimmedGain = context.gains.find(gain => gain.gain.events.some(
        event => event.type === 'ramp'));
    assert.ok(trimmedGain, 'a trimmed region receives a feature-owned declick envelope');
    mixer.cancel();
    assert.ok(context.sources.every(source => source.stopped));
    mixer.destroy();
});

test('reference mixer decodes missing URLs once and reports an isolated source failure', async () => {
    const decoded = buffer(6);
    let fetches = 0;
    const context = new FakeAudioContext({
        decode(_bytes, success) {
            queueMicrotask(() => success(decoded));
            return undefined;
        },
    });
    const mixer = new CompositeReferenceMixer({
        context,
        fetchFn: async url => {
            fetches++;
            if (url.includes('bad')) return { ok: false };
            return { ok: true, async arrayBuffer() { return new ArrayBuffer(2); } };
        },
    });
    const result = await mixer.prepare({ sources: [
        { id: 'a', url: '/same.ogg' },
        { id: 'b', url: '/same.ogg' },
        { id: 'bad', url: '/bad.ogg' },
    ] });
    assert.equal(fetches, 2, 'same-URL sources share one decode promise');
    assert.equal(result.snapshot.sources[0].buffer, decoded);
    assert.equal(result.snapshot.sources[1].buffer, decoded);
    assert.deepEqual(result.failures.map(item => item.sourceId), ['bad']);
});
