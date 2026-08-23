import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';

import {
    CompositeSoundfontLoader,
    COMPOSITE_SOUNDFONT_PROGRAMS,
    compositeSoundfontFilePure,
    compositeSoundfontGlobalPure,
    compositeVoiceDurationPure,
} from '../src/composite/audition-soundfont.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('Hybrid SoundFont names only its three bundled audition programs', () => {
    assert.equal(compositeSoundfontFilePure(27), '0270_FluidR3_GM_sf2_file.js');
    assert.equal(compositeSoundfontFilePure(29), '0290_FluidR3_GM_sf2_file.js');
    assert.equal(compositeSoundfontFilePure(30), '0300_FluidR3_GM_sf2_file.js');
    assert.equal(compositeSoundfontGlobalPure(29), '_tone_0290_FluidR3_GM_sf2_file');
    for (const unsupported of [0, 26, 28, 31, 127, null, 'bad']) {
        assert.equal(compositeSoundfontFilePure(unsupported), null);
    }
    assert.equal(compositeVoiceDurationPure(0), 0.35);
    assert.equal(compositeVoiceDurationPure(4), 1.6);
});

test('all three Hybrid audition tones are bundled for offline comparison', () => {
    const assets = new URL('../assets/wafonts/', import.meta.url);
    for (const program of COMPOSITE_SOUNDFONT_PROGRAMS) {
        const file = compositeSoundfontFilePure(program);
        const asset = new URL(file, assets);
        assert.equal(existsSync(asset), true, `GM ${program}: ${file} is bundled`);
        assert.ok(statSync(asset).size > 50_000, `GM ${program}: ${file} is a real render`);
    }
});

test('Hybrid SoundFont readiness waits for every cloned compressed zone', async () => {
    const rawPreset = {
        zones: [
            { file: 'AA==', keyRangeLow: 0, keyRangeHigh: 63 },
            { file: 'AQ==', keyRangeLow: 64, keyRangeHigh: 127 },
        ],
    };
    const decodes = [];
    const context = {
        decodeAudioData(bytes, success, failure) {
            decodes.push({ bytes, success, failure });
            return undefined;
        },
    };
    class FakePlayer {
        numValue(value, fallback) {
            return Number.isFinite(Number(value)) ? Number(value) : fallback;
        }
    }
    const loader = new CompositeSoundfontLoader({
        playerFactory: () => new FakePlayer(),
        loadScript: async (_url, expected) => expected.startsWith('_tone_')
            ? rawPreset : null,
        decodeBase64: raw => raw,
    });
    let settled = false;
    const preparing = loader.prepare(context, 27).then(value => {
        settled = true;
        return value;
    });
    await flush();
    assert.equal(decodes.length, 2, 'all zones begin decoding in parallel');
    assert.equal(loader.isReady(context, 27), false);
    decodes[0].success({ id: 'zone-a' });
    await flush();
    assert.equal(settled, false, 'one decoded zone is not a readiness boundary');
    decodes[1].success({ id: 'zone-b' });
    const preset = await preparing;
    assert.equal(loader.isReady(context, 27), true);
    assert.deepEqual(preset.zones.map(zone => zone.buffer.id), ['zone-a', 'zone-b']);
    assert.equal(rawPreset.zones[0].buffer, undefined,
        'feature preparation never mutates the shared preset global');
});

test('Hybrid SoundFont passes the requested per-voice gain and cancels once', async () => {
    const queued = [];
    let envelopeCancels = 0;
    const player = {
        numValue(value, fallback) {
            return Number.isFinite(Number(value)) ? Number(value) : fallback;
        },
        queueWaveTable(...args) {
            queued.push(args);
            return { cancel() { envelopeCancels++; } };
        },
    };
    const context = {};
    const rawPreset = { zones: [{ buffer: { id: 'decoded' } }] };
    const loader = new CompositeSoundfontLoader({
        playerFactory: () => player,
        loadScript: async () => rawPreset,
    });
    await loader.prepare(context, 30);
    const target = {};
    const voice = loader.voice(context, target, 30, 12, 64, 0.8, 0.23);
    assert.ok(voice);
    assert.equal(queued.length, 1);
    assert.equal(queued[0][0], context);
    assert.equal(queued[0][1], target);
    assert.equal(queued[0][3], 12);
    assert.notEqual(queued[0][2], rawPreset, 'the player receives the feature-owned clone');
    assert.equal(queued[0][4], 64);
    assert.equal(queued[0][5], 0.8);
    assert.equal(queued[0][6], 0.23);
    voice.cancel();
    voice.cancel();
    assert.equal(envelopeCancels, 1);
    await assert.rejects(loader.prepare(context, 33), /only GM programs 27, 29, and 30/);
});
