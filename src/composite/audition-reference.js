/* Feature-owned reference-audio snapshot and mixer.
 *
 * Integration supplies plain public metadata. This module never reads S,
 * host, the Editor transport, or mixer globals. Stable pure region helpers are
 * reused one-way from audio.js; no Hybrid state enters the core audio module.
 */

import {
    _audioRegionPlacementsPure,
    _regionStartPure,
} from '../audio.js';

export const COMPOSITE_REFERENCE_DECLICK_SECONDS = 0.005;
export const COMPOSITE_REFERENCE_STOP_FADE_SECONDS = 0.004;
export const COMPOSITE_REFERENCE_CLEANUP_DELAY_MS = 8;

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
            const mediaEnd = placement.offset + duration;
            out.push({
                sourceId: source.id,
                buffer: source.buffer,
                gain: source.gain,
                regionId: region.id,
                offset: placement.offset,
                delay: placement.delay,
                duration,
                trimmed: region.srcIn > 0 || region.srcOut < bufferDuration,
                // A seek into the middle of media and any stop before the
                // natural buffer tail are artificial waveform cuts even when
                // the authored region itself is the implicit full-file span.
                // They need the same short edge treatment as authored trims.
                fadeIn: placement.offset > 1e-6,
                fadeOut: mediaEnd < bufferDuration - 1e-6,
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

function boundaryEnvelope(startTime, duration, {
    fadeIn = false,
    fadeOut = false,
    fadeSeconds = COMPOSITE_REFERENCE_DECLICK_SECONDS,
} = {}) {
    const start = Math.max(0, finite(startTime));
    const length = Math.max(0, finite(duration));
    const fade = Math.min(Math.max(0, finite(fadeSeconds)), length / 2);
    const points = [{ t: start, gain: fadeIn ? 0 : 1 }];
    if (fadeIn && fade > 0) points.push({ t: start + fade, gain: 1 });
    if (fadeOut && fade > 0) {
        const outStart = start + length - fade;
        if (outStart > points[points.length - 1].t) {
            points.push({ t: outStart, gain: 1 });
        }
        points.push({ t: start + length, gain: 0 });
    }
    return points;
}

export class CompositeReferenceMixer {
    constructor({
        context,
        target,
        fetchFn = globalThis.fetch?.bind(globalThis),
        setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
        clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
        stopFadeSeconds = COMPOSITE_REFERENCE_STOP_FADE_SECONDS,
        cleanupDelayMs = COMPOSITE_REFERENCE_CLEANUP_DELAY_MS,
    } = {}) {
        if (!context) throw new Error('Hybrid reference mixer requires an AudioContext');
        this.context = context;
        this.target = target || context.destination;
        this.fetchFn = fetchFn;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.stopFadeSeconds = Math.max(0, Math.min(0.02,
            finite(stopFadeSeconds, COMPOSITE_REFERENCE_STOP_FADE_SECONDS)));
        this.cleanupDelayMs = Math.max(0, Math.trunc(finite(
            cleanupDelayMs, COMPOSITE_REFERENCE_CLEANUP_DELAY_MS)));
        this.decodedByUrl = new Map();
        this.fetchControllers = new Set();
        this.snapshot = compositeReferenceSnapshotPure();
        this.live = [];
        this.retired = new Set();
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
            // A muted/soloed-away source cannot contribute to this immutable
            // pass, so do not make Play wait for or report its unavailable URL.
            if (!(source.gain > 0) || source.buffer || !source.url) return;
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
        const requested = snapshot.sources.filter(source => source.gain > 0
            && (source.buffer || source.url));
        const playable = requested.filter(source => source.buffer);
        if (requested.length && !playable.length && failures.length) {
            const error = new Error('Hybrid preview could not load any audible reference audio');
            error.failures = failures.slice();
            throw error;
        }
        return {
            snapshot,
            failures: failures.slice(),
            playableSourceCount: playable.length,
        };
    }

    _cleanupBatch(batch) {
        if (!batch) return;
        for (const item of batch.items || []) {
            stopNode(item.node);
            try { item.regionGain?.disconnect?.(); } catch (_) { /* already disconnected */ }
            try { item.sourceGain?.disconnect?.(); } catch (_) { /* already disconnected */ }
        }
        try { batch.outputGain?.disconnect?.(); } catch (_) { /* already disconnected */ }
        batch.items = [];
    }

    _retireBatch(batch, immediate = false) {
        if (!batch) return;
        const now = Math.max(0, finite(this.context?.currentTime));
        const fade = immediate ? 0 : this.stopFadeSeconds;
        const parameter = batch.outputGain?.gain;
        try {
            parameter?.cancelScheduledValues?.(now);
            parameter?.setValueAtTime?.(Math.max(0, finite(parameter.value, 1)), now);
            if (fade > 0 && typeof parameter?.linearRampToValueAtTime === 'function') {
                parameter.linearRampToValueAtTime(0, now + fade);
            } else {
                parameter?.setValueAtTime?.(0, now);
            }
        } catch (_) { /* node stop below remains the hard fallback */ }
        for (const item of batch.items || []) {
            try { item.node?.stop?.(now + fade); } catch (_) { /* already ended */ }
        }
        if (immediate || typeof this.setTimeoutFn !== 'function') {
            this._cleanupBatch(batch);
            return;
        }
        const job = { id: null, run: null };
        job.run = () => {
            if (!this.retired.delete(job)) return;
            this._cleanupBatch(batch);
        };
        this.retired.add(job);
        try {
            job.id = this.setTimeoutFn(
                job.run, Math.ceil(fade * 1000) + this.cleanupDelayMs);
        } catch (_) {
            this.retired.delete(job);
            this._cleanupBatch(batch);
        }
    }

    _pruneEnded() {
        const now = Math.max(0, finite(this.context?.currentTime));
        const keep = [];
        for (const batch of this.live) {
            if (Number.isFinite(Number(batch?.endsAt)) && Number(batch.endsAt) <= now) {
                this._cleanupBatch(batch);
            } else {
                keep.push(batch);
            }
        }
        this.live = keep;
    }

    schedule(cursorTime, {
        when = this.context.currentTime,
        endTime = Number.POSITIVE_INFINITY,
        append = false,
    } = {}) {
        if (this.destroyed) return 0;
        if (append) this._pruneEnded();
        else this.cancel();
        const placements = compositeReferencePlacementsPure(
            this.snapshot, cursorTime, { endTime });
        const outputGain = this.context.createGain();
        outputGain.gain.setValueAtTime(1, Math.max(0, finite(this.context.currentTime)));
        outputGain.connect(this.target);
        const sourceGains = new Map();
        const batch = { outputGain, items: [], endsAt: Math.max(0, finite(when)) };
        for (const placement of placements) {
            let sourceGain = sourceGains.get(placement.sourceId);
            if (!sourceGain) {
                sourceGain = this.context.createGain();
                sourceGain.gain.setValueAtTime(
                    placement.gain, Math.max(0, finite(when)));
                sourceGain.connect(outputGain);
                sourceGains.set(placement.sourceId, sourceGain);
            }
            const node = this.context.createBufferSource();
            node.buffer = placement.buffer;
            const startsAt = Math.max(0, finite(when)) + placement.delay;
            let regionGain = null;
            if (placement.fadeIn || placement.fadeOut) {
                regionGain = this.context.createGain();
                const envelope = boundaryEnvelope(startsAt, placement.duration, {
                    fadeIn: placement.fadeIn,
                    fadeOut: placement.fadeOut,
                });
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
            batch.items.push({ node, regionGain });
            batch.endsAt = Math.max(batch.endsAt, startsAt + placement.duration);
        }
        for (const sourceGain of sourceGains.values()) {
            batch.items.push({ sourceGain });
        }
        if (placements.length) this.live.push(batch);
        else this._cleanupBatch(batch);
        return placements.length;
    }

    cancel({ immediate = false } = {}) {
        for (const batch of this.live) this._retireBatch(batch, immediate);
        this.live = [];
    }

    destroy() {
        if (this.destroyed) return;
        this.cancel({ immediate: true });
        this.destroyed = true;
        this.generation++;
        for (const controller of this.fetchControllers) controller.abort();
        this.fetchControllers.clear();
        for (const job of [...this.retired]) {
            if (job.id !== null && typeof this.clearTimeoutFn === 'function') {
                try { this.clearTimeoutFn(job.id); } catch (_) { /* timer already fired */ }
            }
            job.run();
        }
        this.decodedByUrl.clear();
        this.snapshot = compositeReferenceSnapshotPure();
        this.target = null;
    }
}
