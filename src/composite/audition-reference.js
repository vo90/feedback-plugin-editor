/* Feature-owned reference-audio snapshot and mixer.
 *
 * Integration supplies plain public metadata. This module never reads S,
 * host, the Editor transport, or mixer globals. Stable pure region helpers are
 * reused one-way from audio.js; no Hybrid state enters the core audio module.
 */

import {
    _audioRegionPlacementsPure,
    _declickEnvelopePure,
    _regionStartPure,
} from '../audio.js';

export const COMPOSITE_REFERENCE_DECLICK_SECONDS = 0.005;

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function sourceId(raw, fallback = '') {
    return typeof raw === 'string' && raw ? raw : fallback;
}

function trackRegionsFor(source, tracks) {
    if (Array.isArray(source?.regions)) return source.regions;
    const track = Array.isArray(tracks) ? tracks.find(candidate => candidate
        && candidate.type === 'audio' && candidate.sourceId === source.id) : null;
    return track && Array.isArray(track.regions) ? track.regions : null;
}

function sourceMix(raw, strip) {
    const mix = raw?.mix && typeof raw.mix === 'object' ? raw.mix : {};
    const state = strip && typeof strip === 'object' ? strip : {};
    const gain = Math.max(0, Math.min(4, finite(
        mix.gain ?? mix.vol ?? state.vol ?? raw?.gain ?? raw?.vol, 1)));
    return {
        gain,
        audible: raw?.muted !== true && mix.audible !== false && state.audible !== false,
        solo: mix.solo === true || state.solo === true,
    };
}

function rawSources(input) {
    if (Array.isArray(input?.sources)) return input.sources;
    const out = [];
    if (input?.master && typeof input.master === 'object') {
        out.push({ id: 'master', offset: 0, ...input.master });
    } else if (input?.masterUrl || input?.masterBuffer) {
        out.push({
            id: 'master',
            url: input.masterUrl || '',
            buffer: input.masterBuffer || null,
            offset: 0,
        });
    }
    if (Array.isArray(input?.stems)) out.push(...input.stems);
    return out;
}

// Normalize the integration snapshot without touching Editor state. The
// active source's already-decoded buffer can be supplied once and is adopted
// by identity; every other source may carry a buffer or URL for local decode.
export function compositeReferenceSnapshotPure(input = {}) {
    const removed = new Set(Array.isArray(input.removedSourceIds)
        ? input.removedSourceIds.map(String) : []);
    const activeId = sourceId(input.activeSourceId, 'master');
    const tracks = Array.isArray(input.tracks) ? input.tracks : [];
    const partStripState = typeof input.partStripState === 'function'
        ? input.partStripState : null;
    const seen = new Set();
    const sources = [];
    for (const candidate of rawSources(input)) {
        if (!candidate || typeof candidate !== 'object') continue;
        const id = sourceId(candidate.id,
            sources.length === 0 ? 'master' : '');
        if (!id || removed.has(id) || seen.has(id)) continue;
        const url = typeof candidate.url === 'string' ? candidate.url : '';
        let buffer = candidate.buffer || null;
        if (!buffer && id === activeId && input.activeBuffer
                && (!input.activeUrl || input.activeUrl === url)) {
            buffer = input.activeBuffer;
        }
        if (!buffer && !url) continue;
        const strip = partStripState ? partStripState(`audio:${id}`) : null;
        sources.push({
            id,
            url,
            buffer,
            offset: finite(candidate.offset),
            regions: trackRegionsFor({ ...candidate, id }, tracks),
            ...sourceMix(candidate, strip),
        });
        seen.add(id);
    }
    const soloed = sources.some(source => source.solo);
    for (const source of sources) {
        source.gain = source.audible && (!soloed || source.solo) ? source.gain : 0;
    }
    return {
        audioShift: finite(input.audioShift),
        duration: Math.max(0, finite(input.duration)),
        beatToTime: typeof input.beatToTime === 'function'
            ? input.beatToTime : beat => finite(beat),
        sources,
    };
}

// Concrete BufferSource placement data, independent of Web Audio nodes. This
// is also the parity seam for master/stem offsets and authored audio regions.
export function compositeReferencePlacementsPure(snapshot, cursorTime, {
    endTime = Number.POSITIVE_INFINITY,
} = {}) {
    const cursor = Math.max(0, finite(cursorTime));
    const ending = Number.isFinite(Number(endTime))
        ? Math.max(cursor, Number(endTime)) : Number.POSITIVE_INFINITY;
    const audioShift = finite(snapshot?.audioShift);
    const beatToTime = typeof snapshot?.beatToTime === 'function'
        ? snapshot.beatToTime : beat => finite(beat);
    const out = [];
    for (const source of snapshot?.sources || []) {
        const bufferDuration = Math.max(0, finite(source?.buffer?.duration));
        if (!source?.buffer || !(bufferDuration > 0) || !(source.gain > 0)) continue;
        const regions = _audioRegionPlacementsPure(
            source.regions, bufferDuration, beatToTime);
        for (const region of regions) {
            if (region.muted) continue;
            const regionStart = audioShift + finite(source.offset) + region.startBeatTime;
            const placement = _regionStartPure(
                cursor, regionStart, region.srcIn, region.srcOut);
            if (!placement.play) continue;
            const naturalRemaining = Math.max(0, bufferDuration - placement.offset);
            const regionRemaining = placement.duration == null
                ? naturalRemaining : Math.min(naturalRemaining, placement.duration);
            const previewRemaining = ending === Number.POSITIVE_INFINITY
                ? regionRemaining : Math.max(0, ending - cursor - placement.delay);
            const duration = Math.min(regionRemaining, previewRemaining);
            if (!(duration > 0)) continue;
            out.push({
                sourceId: source.id,
                buffer: source.buffer,
                gain: source.gain,
                regionId: region.id,
                offset: placement.offset,
                delay: placement.delay,
                duration,
                trimmed: region.srcIn > 0 || region.srcOut < bufferDuration,
                chartStartTime: regionStart,
            });
        }
    }
    return out;
}

function decodeAudioData(context, bytes) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const success = (buffer) => {
            if (settled) return;
            settled = true;
            if (buffer) resolve(buffer);
            else reject(new Error('Hybrid preview reference decoded without a buffer'));
        };
        const failure = (error) => {
            if (settled) return;
            settled = true;
            reject(error instanceof Error ? error
                : new Error('Hybrid preview reference decode failed'));
        };
        try {
            const result = context.decodeAudioData(bytes, success, failure);
            if (result && typeof result.then === 'function') result.then(success, failure);
        } catch (error) {
            failure(error);
        }
    });
}

function stopNode(node) {
    try { node?.stop?.(); } catch (_) { /* already ended */ }
    try { node?.disconnect?.(); } catch (_) { /* already disconnected */ }
}

export class CompositeReferenceMixer {
    constructor({ context, target, fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
        if (!context) throw new Error('Hybrid reference mixer requires an AudioContext');
        this.context = context;
        this.target = target || context.destination;
        this.fetchFn = fetchFn;
        this.decodedByUrl = new Map();
        this.fetchControllers = new Set();
        this.snapshot = compositeReferenceSnapshotPure();
        this.live = [];
        this.generation = 0;
        this.destroyed = false;
        this.failures = [];
    }

    async _decodeUrl(url) {
        if (this.decodedByUrl.has(url)) return this.decodedByUrl.get(url);
        if (typeof this.fetchFn !== 'function') {
            throw new Error('Hybrid preview cannot fetch reference audio');
        }
        const promise = (async () => {
            const controller = typeof AbortController === 'function'
                ? new AbortController() : null;
            if (controller) this.fetchControllers.add(controller);
            try {
                const response = await this.fetchFn(
                    url, controller ? { signal: controller.signal } : undefined);
                if (!response?.ok) throw new Error(`Hybrid preview could not load ${url}`);
                return decodeAudioData(this.context, await response.arrayBuffer());
            } finally {
                if (controller) this.fetchControllers.delete(controller);
            }
        })();
        this.decodedByUrl.set(url, promise);
        try {
            const buffer = await promise;
            this.decodedByUrl.set(url, Promise.resolve(buffer));
            return buffer;
        } catch (error) {
            if (this.decodedByUrl.get(url) === promise) this.decodedByUrl.delete(url);
            throw error;
        }
    }

    async prepare(input) {
        if (this.destroyed) throw new Error('Hybrid reference mixer was destroyed');
        const generation = ++this.generation;
        const snapshot = compositeReferenceSnapshotPure(input);
        const failures = [];
        await Promise.all(snapshot.sources.map(async source => {
            if (source.buffer || !source.url) return;
            try {
                source.buffer = await this._decodeUrl(source.url);
            } catch (error) {
                failures.push({ sourceId: source.id, error });
            }
        }));
        if (this.destroyed || generation !== this.generation) {
            throw new Error('Hybrid reference preparation was cancelled');
        }
        this.failures = failures;
        this.snapshot = snapshot;
        return { snapshot, failures: failures.slice() };
    }

    schedule(cursorTime, {
        when = this.context.currentTime,
        endTime = Number.POSITIVE_INFINITY,
    } = {}) {
        if (this.destroyed) return 0;
        this.cancel();
        const placements = compositeReferencePlacementsPure(
            this.snapshot, cursorTime, { endTime });
        const sourceGains = new Map();
        for (const placement of placements) {
            let sourceGain = sourceGains.get(placement.sourceId);
            if (!sourceGain) {
                sourceGain = this.context.createGain();
                sourceGain.gain.setValueAtTime(
                    placement.gain, Math.max(0, finite(when)));
                sourceGain.connect(this.target);
                sourceGains.set(placement.sourceId, sourceGain);
            }
            const node = this.context.createBufferSource();
            node.buffer = placement.buffer;
            const startsAt = Math.max(0, finite(when)) + placement.delay;
            let regionGain = null;
            if (placement.trimmed) {
                regionGain = this.context.createGain();
                const envelope = _declickEnvelopePure(
                    startsAt, placement.duration, COMPOSITE_REFERENCE_DECLICK_SECONDS);
                regionGain.gain.setValueAtTime(envelope[0].gain, envelope[0].t);
                for (let index = 1; index < envelope.length; index++) {
                    regionGain.gain.linearRampToValueAtTime(
                        envelope[index].gain, envelope[index].t);
                }
                node.connect(regionGain);
                regionGain.connect(sourceGain);
            } else {
                node.connect(sourceGain);
            }
            node.start(startsAt, placement.offset, placement.duration);
            this.live.push({ node, regionGain });
        }
        for (const gain of sourceGains.values()) this.live.push({ gain });
        return placements.length;
    }

    cancel() {
        for (const item of this.live) {
            stopNode(item.node);
            try { item.regionGain?.disconnect?.(); } catch (_) { /* already disconnected */ }
            try { item.gain?.disconnect?.(); } catch (_) { /* already disconnected */ }
        }
        this.live = [];
    }

    destroy() {
        if (this.destroyed) return;
        this.cancel();
        this.destroyed = true;
        this.generation++;
        for (const controller of this.fetchControllers) controller.abort();
        this.fetchControllers.clear();
        this.decodedByUrl.clear();
        this.snapshot = compositeReferenceSnapshotPure();
        this.target = null;
    }
}
