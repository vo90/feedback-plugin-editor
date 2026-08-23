/* Feature-owned SoundFont loading for Hybrid Track auditions.
 *
 * This deliberately does not import gm-guide.js. The Hybrid builder gets its
 * own player instance, cloned presets, readiness boundary, and AudioContext.
 * Loading the vendored scripts may populate their documented globals, but the
 * preset objects used here are never the mutable global objects themselves.
 */

export const COMPOSITE_SOUNDFONT_PROGRAMS = Object.freeze([27, 29, 30]);
export const COMPOSITE_SOUNDFONT_ASSET_BASE = '/api/plugins/editor/wafont/';
export const COMPOSITE_SOUNDFONT_PLAYER_FILE = 'WebAudioFontPlayer.js';
export const COMPOSITE_SOUNDFONT_NAME = 'FluidR3_GM_sf2_file';

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function compositeSoundfontFilePure(program) {
    const gm = Number(program);
    if (!Number.isInteger(gm) || !COMPOSITE_SOUNDFONT_PROGRAMS.includes(gm)) return null;
    return `${String(gm * 10).padStart(4, '0')}_${COMPOSITE_SOUNDFONT_NAME}.js`;
}

export function compositeSoundfontGlobalPure(program) {
    const file = compositeSoundfontFilePure(program);
    return file ? `_tone_${file.slice(0, -3)}` : null;
}

export function compositeVoiceDurationPure(sustain) {
    const duration = Number(sustain);
    if (!Number.isFinite(duration) || duration <= 0) return 0.35;
    return Math.min(duration, 1.6);
}

function normalizeAssetBase(raw) {
    const base = typeof raw === 'string' && raw.trim()
        ? raw.trim() : COMPOSITE_SOUNDFONT_ASSET_BASE;
    return base.endsWith('/') ? base : `${base}/`;
}

function clonePreset(raw) {
    if (!raw || !Array.isArray(raw.zones) || !raw.zones.length) {
        throw new Error('Hybrid preview SoundFont preset has no zones');
    }
    return {
        ...raw,
        zones: raw.zones.map(zone => ({ ...(zone || {}) })),
    };
}

function normalizeZone(player, zone) {
    const num = player && typeof player.numValue === 'function'
        ? (value, fallback) => player.numValue(value, fallback)
        : (value, fallback) => finite(value, fallback);
    zone.delay = 0;
    zone.loopStart = num(zone.loopStart, 0);
    zone.loopEnd = num(zone.loopEnd, 0);
    zone.coarseTune = num(zone.coarseTune, 0);
    zone.fineTune = num(zone.fineTune, 0);
    zone.originalPitch = num(zone.originalPitch, 6000);
    zone.sampleRate = num(zone.sampleRate, 44100);
    // Match WebAudioFontPlayer v3's established normalization.
    zone.sustain = num(zone.originalPitch, 0);
}

function base64Bytes(raw, decodeBase64) {
    const decode = typeof decodeBase64 === 'function'
        ? decodeBase64
        : typeof globalThis.atob === 'function' ? globalThis.atob.bind(globalThis) : null;
    if (!decode) throw new Error('Hybrid preview base64 decoder is unavailable');
    const decoded = decode(raw);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) {
        bytes[index] = decoded.charCodeAt(index);
    }
    return bytes.buffer;
}

function decodeAudioData(context, bytes) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const success = (buffer) => {
            if (settled) return;
            settled = true;
            if (buffer) resolve(buffer);
            else reject(new Error('Hybrid preview SoundFont zone decoded without a buffer'));
        };
        const failure = (error) => {
            if (settled) return;
            settled = true;
            reject(error instanceof Error ? error
                : new Error('Hybrid preview SoundFont zone decode failed'));
        };
        try {
            const result = context.decodeAudioData(bytes, success, failure);
            if (result && typeof result.then === 'function') result.then(success, failure);
        } catch (error) {
            failure(error);
        }
    });
}

function defaultLoadScript(documentObject, globalObject, url, expectedGlobal) {
    return new Promise((resolve, reject) => {
        if (!documentObject?.createElement || !documentObject.head) {
            reject(new Error('Hybrid preview SoundFont loading requires a document'));
            return;
        }
        if (globalObject?.[expectedGlobal]) {
            resolve(globalObject[expectedGlobal]);
            return;
        }
        const selector = `script[data-composite-soundfont-src="${url}"]`;
        const existing = documentObject.querySelector?.(selector);
        const complete = () => {
            const loaded = globalObject?.[expectedGlobal];
            if (loaded) resolve(loaded);
            else reject(new Error(`Hybrid preview asset did not define ${expectedGlobal}`));
        };
        if (existing) {
            if (existing.dataset?.compositeSoundfontDone === '1') {
                complete();
                return;
            }
            existing.addEventListener('load', complete, { once: true });
            existing.addEventListener('error', () => reject(
                new Error(`Hybrid preview asset failed to load: ${url}`)), { once: true });
            return;
        }
        const script = documentObject.createElement('script');
        script.src = url;
        script.dataset.compositeSoundfontSrc = url;
        script.onload = () => {
            script.dataset.compositeSoundfontDone = '1';
            complete();
        };
        script.onerror = () => {
            script.remove?.();
            reject(new Error(`Hybrid preview asset failed to load: ${url}`));
        };
        documentObject.head.appendChild(script);
    });
}

export class CompositeSoundfontLoader {
    constructor({
        assetBase = COMPOSITE_SOUNDFONT_ASSET_BASE,
        globalObject = globalThis,
        documentObject = globalThis.document,
        loadScript = null,
        decodeBase64 = null,
        playerFactory = null,
    } = {}) {
        this.assetBase = normalizeAssetBase(assetBase);
        this.globalObject = globalObject;
        this.documentObject = documentObject;
        this.loadScript = loadScript;
        this.decodeBase64 = decodeBase64;
        this.playerFactory = playerFactory;
        this.player = null;
        this.playerLoading = null;
        this.presetsByContext = new WeakMap();
        this.loadingByContext = new WeakMap();
        this.destroyed = false;
        this.generation = 0;
    }

    async _asset(file, expectedGlobal) {
        const present = this.globalObject?.[expectedGlobal];
        if (present) return present;
        const url = `${this.assetBase}${file}`;
        if (typeof this.loadScript === 'function') {
            const loaded = await this.loadScript(url, expectedGlobal);
            return loaded || this.globalObject?.[expectedGlobal] || null;
        }
        return defaultLoadScript(
            this.documentObject, this.globalObject, url, expectedGlobal);
    }

    async _ensurePlayer() {
        if (this.player) return this.player;
        if (this.destroyed) throw new Error('Hybrid preview SoundFont loader was destroyed');
        if (!this.playerLoading) {
            const generation = this.generation;
            this.playerLoading = (async () => {
                if (typeof this.playerFactory === 'function') {
                    return this.playerFactory();
                }
                const Player = await this._asset(
                    COMPOSITE_SOUNDFONT_PLAYER_FILE, 'WebAudioFontPlayer');
                if (typeof Player !== 'function') {
                    throw new Error('Hybrid preview WebAudioFont player is unavailable');
                }
                return new Player();
            })().then(player => {
                if (this.destroyed || generation !== this.generation) {
                    throw new Error('Hybrid preview SoundFont preparation was cancelled');
                }
                this.player = player;
                this.playerLoading = null;
                return player;
            }, error => {
                this.playerLoading = null;
                throw error;
            });
        }
        return this.playerLoading;
    }

    _contextMap(store, context) {
        let map = store.get(context);
        if (!map) {
            map = new Map();
            store.set(context, map);
        }
        return map;
    }

    async _prepareZone(player, context, zone) {
        normalizeZone(player, zone);
        if (zone.buffer) return zone.buffer;
        if (zone.sample) {
            if (typeof player.adjustZone !== 'function') {
                throw new Error('Hybrid preview player cannot decode PCM SoundFont zones');
            }
            player.adjustZone(context, zone);
            if (!zone.buffer) {
                throw new Error('Hybrid preview PCM SoundFont zone did not decode');
            }
            return zone.buffer;
        }
        if (!zone.file) throw new Error('Hybrid preview SoundFont zone has no audio data');
        zone.buffer = await decodeAudioData(
            context, base64Bytes(zone.file, this.decodeBase64));
        return zone.buffer;
    }

    async prepare(context, program) {
        const gm = Number(program);
        const file = compositeSoundfontFilePure(gm);
        const presetGlobal = compositeSoundfontGlobalPure(gm);
        if (!context || !file || !presetGlobal) {
            throw new Error('Hybrid preview supports only GM programs 27, 29, and 30');
        }
        if (this.destroyed) throw new Error('Hybrid preview SoundFont loader was destroyed');
        const ready = this._contextMap(this.presetsByContext, context);
        if (ready.has(gm)) return ready.get(gm);
        const loading = this._contextMap(this.loadingByContext, context);
        if (loading.has(gm)) return loading.get(gm);
        const generation = this.generation;
        const promise = (async () => {
            const player = await this._ensurePlayer();
            const raw = await this._asset(file, presetGlobal);
            if (!raw) throw new Error(`Hybrid preview SoundFont GM ${gm} is unavailable`);
            const preset = clonePreset(raw);
            await Promise.all(preset.zones.map(
                zone => this._prepareZone(player, context, zone)));
            if (preset.zones.some(zone => !zone.buffer)) {
                throw new Error(`Hybrid preview SoundFont GM ${gm} is only partly decoded`);
            }
            if (this.destroyed || generation !== this.generation) {
                throw new Error('Hybrid preview SoundFont preparation was cancelled');
            }
            ready.set(gm, preset);
            return preset;
        })();
        loading.set(gm, promise);
        try {
            return await promise;
        } finally {
            if (loading.get(gm) === promise) loading.delete(gm);
        }
    }

    isReady(context, program) {
        return !!context && this.presetsByContext.get(context)?.has(Number(program));
    }

    voice(context, target, program, when, midi, duration, gain = 0.5) {
        const preset = this.presetsByContext.get(context)?.get(Number(program));
        if (!preset || !this.player || !context || !target) return null;
        const pitch = Number(midi);
        if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return null;
        const voiceGain = Math.max(0, Math.min(1, finite(gain, 0.5)));
        let envelope = null;
        try {
            envelope = this.player.queueWaveTable(
                context, target, preset, Math.max(0, finite(when)), pitch,
                compositeVoiceDurationPure(duration), voiceGain);
        } catch (_) {
            return null;
        }
        if (!envelope) return null;
        let cancelled = false;
        return {
            until: Math.max(0, finite(when)) + compositeVoiceDurationPure(duration),
            cancel() {
                if (cancelled) return;
                cancelled = true;
                try { envelope.cancel?.(); } catch (_) { /* context already closed */ }
            },
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.generation++;
        this.player = null;
        this.playerLoading = null;
        this.presetsByContext = new WeakMap();
        this.loadingByContext = new WeakMap();
    }
}
