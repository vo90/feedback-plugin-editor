/* Standalone transport for Hybrid Track audition modes.
 *
 * The controller owns its AudioContext, graph, clock, scheduled voices, and
 * reference buffers. It consumes feature preview events and plain reference
 * metadata; it never mutates the Editor transport or persistent song state.
 */

import { HYBRID_PREVIEW_TONES } from './preferences.js';
import { CompositeSoundfontLoader } from './audition-soundfont.js';
import { CompositeGuideScheduler } from './audition-guide-scheduler.js';
import { CompositeReferenceMixer } from './audition-reference.js';

export const COMPOSITE_PREVIEW_START_LEAD_SECONDS = 0.005;

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function gainValue(value, fallback = 1, maximum = 4) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(maximum, number)) : fallback;
}

function volumeValue(value, fallback = 0.75) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    // Existing Hybrid preferences are percentages; direct controller clients
    // may use normalized 0..1 values.
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

export function compositePreviewOutputLatencyPure(context) {
    const output = Number(context?.outputLatency);
    if (Number.isFinite(output) && output > 0) return output;
    const base = Number(context?.baseLatency);
    return Number.isFinite(base) && base > 0 ? base : 0;
}

// Paint/presentation time only. Scheduling continues to use the raw transport
// clock, while the marker waits one held output buffer so it follows what the
// listener actually hears. Clamping at anchorChartTime prevents a seek/start
// marker from briefly walking backwards during that buffer.
export function compositePreviewPresentationTimePure(
    anchorChartTime, anchorContextTime, contextTime, outputLatency,
) {
    const chart = Math.max(0, finite(anchorChartTime));
    const wall = finite(anchorContextTime);
    const now = finite(contextTime, wall);
    const latency = Math.max(0, finite(outputLatency));
    return chart + Math.max(0, now - latency - wall);
}

function normalizeTone(raw) {
    if (raw && typeof raw === 'object') {
        const program = Number(raw.gm ?? raw.program);
        if ([27, 29, 30].includes(program)) {
            return {
                id: typeof raw.id === 'string' ? raw.id : `gm-${program}`,
                label: typeof raw.label === 'string' ? raw.label : `GM ${program}`,
                gm: program,
                trimGain: gainValue(raw.trimGain, 1),
            };
        }
    }
    const id = typeof raw === 'string' ? raw : 'clean';
    return HYBRID_PREVIEW_TONES.find(candidate => candidate.id === id)
        || HYBRID_PREVIEW_TONES[0];
}

function normalizeModeDefinition(mode, raw = {}) {
    const definition = raw && typeof raw === 'object' ? raw : {};
    const kind = definition.kind === 'reference' || mode === 'song'
        ? 'reference' : 'guide';
    return {
        ...definition,
        kind,
        events: definition.events || [],
        voiceCap: Math.max(1, Math.min(12,
            Math.trunc(Number(definition.voiceCap) || 6))),
    };
}

function applyGain(parameter, value, context, immediate = false) {
    if (!parameter || !context) return;
    const now = Math.max(0, finite(context.currentTime));
    try { parameter.cancelScheduledValues?.(now); } catch (_) { /* simple fake params */ }
    if (immediate || typeof parameter.setTargetAtTime !== 'function') {
        if (typeof parameter.setValueAtTime === 'function') parameter.setValueAtTime(value, now);
        else parameter.value = value;
    } else {
        parameter.setTargetAtTime(value, now, 0.02);
    }
}

export class CompositePreviewController {
    constructor({
        audioContextFactory = null,
        soundfontLoader = null,
        referenceMixerFactory = null,
        guideSchedulerFactory = null,
        requestAnimationFrameFn = globalThis.requestAnimationFrame?.bind(globalThis),
        cancelAnimationFrameFn = globalThis.cancelAnimationFrame?.bind(globalThis),
        setIntervalFn = globalThis.setInterval?.bind(globalThis),
        clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
        onStateChange = null,
        onTimeUpdate = null,
        modes = {},
        mode = 'song',
        tone = 'clean',
        volume = 75,
        startTime = 0,
        endTime = 0,
        startLeadSeconds = COMPOSITE_PREVIEW_START_LEAD_SECONDS,
    } = {}) {
        const DefaultAudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        this.audioContextFactory = typeof audioContextFactory === 'function'
            ? audioContextFactory
            : DefaultAudioContext ? () => new DefaultAudioContext() : null;
        this.soundfont = soundfontLoader || new CompositeSoundfontLoader();
        this.referenceMixerFactory = referenceMixerFactory;
        this.guideSchedulerFactory = guideSchedulerFactory;
        this.requestAnimationFrameFn = requestAnimationFrameFn;
        this.cancelAnimationFrameFn = cancelAnimationFrameFn;
        this.setIntervalFn = setIntervalFn;
        this.clearIntervalFn = clearIntervalFn;
        this.onStateChange = typeof onStateChange === 'function' ? onStateChange : null;
        this.onTimeUpdate = typeof onTimeUpdate === 'function' ? onTimeUpdate : null;
        this.modes = new Map(Object.entries(modes || {}).map(
            ([id, definition]) => [id, normalizeModeDefinition(id, definition)]));
        this.mode = typeof mode === 'string' ? mode : 'song';
        this.tone = normalizeTone(tone);
        this.mix = { volume: volumeValue(volume), referenceGain: 1, guideGain: 1 };
        this.range = {
            startTime: Math.max(0, finite(startTime)),
            endTime: Math.max(0, finite(endTime)),
        };
        if (this.range.endTime < this.range.startTime) {
            this.range.endTime = this.range.startTime;
        }
        this.loop = { enabled: false, startTime: this.range.startTime, endTime: this.range.endTime };
        this.cursor = this.range.startTime;
        this.startLeadSeconds = Math.max(0, Math.min(0.05,
            finite(startLeadSeconds, COMPOSITE_PREVIEW_START_LEAD_SECONDS)));
        this.context = null;
        this.masterGain = null;
        this.referenceGain = null;
        this.guideGain = null;
        this.limiter = null;
        this.referenceMixer = null;
        this.guideScheduler = null;
        this.playing = false;
        this.loading = false;
        this.anchorChartTime = this.cursor;
        this.anchorContextTime = 0;
        this.heldOutputLatency = 0;
        this.frame = null;
        this.generation = 0;
        this.destroyed = false;
        this.lastError = null;
        this.loopRestartPending = false;
    }

    _definition(mode = this.mode) {
        return this.modes.get(mode) || null;
    }

    _effectiveRange(definition = this._definition()) {
        const start = Math.max(0, finite(
            definition?.startTime, this.range.startTime));
        let end = finite(definition?.endTime, this.range.endTime);
        if (!(end > start)) end = finite(definition?.duration);
        if (!(end > start)) end = Math.max(start, this.range.endTime);
        return { startTime: start, endTime: end };
    }

    _effectiveEnd(definition = this._definition()) {
        const range = this._effectiveRange(definition);
        if (this.loop.enabled && this.loop.endTime > this.loop.startTime) {
            return Math.min(range.endTime, this.loop.endTime);
        }
        return range.endTime;
    }

    _effectiveLoopStart(definition = this._definition()) {
        const range = this._effectiveRange(definition);
        return Math.max(range.startTime, Math.min(range.endTime,
            finite(this.loop.startTime, range.startTime)));
    }

    _clampTime(value, definition = this._definition()) {
        const range = this._effectiveRange(definition);
        return Math.max(range.startTime, Math.min(range.endTime, finite(value, range.startTime)));
    }

    _rawCurrentTime() {
        if (!this.playing || !this.context) return this.cursor;
        return this.anchorChartTime + Math.max(0,
            finite(this.context.currentTime) - this.anchorContextTime);
    }

    _presentationCurrentTime() {
        if (!this.playing || !this.context) return this.cursor;
        return compositePreviewPresentationTimePure(
            this.anchorChartTime,
            this.anchorContextTime,
            this.context.currentTime,
            this.heldOutputLatency,
        );
    }

    isPlaying() {
        return this.playing;
    }

    currentTime() {
        return this._clampTime(this._presentationCurrentTime());
    }

    presentationTime() {
        return this.currentTime();
    }

    transportTime() {
        return this._clampTime(this._rawCurrentTime());
    }

    state() {
        return {
            playing: this.playing,
            loading: this.loading,
            mode: this.mode,
            time: this.currentTime(),
            transportTime: this.transportTime(),
            tone: this.tone.id,
            loop: { ...this.loop },
            error: this.lastError,
        };
    }

    _emitState() {
        this.onStateChange?.(this.state());
    }

    _emitTime(time = this.currentTime()) {
        this.onTimeUpdate?.(time, this.state());
    }

    _applyMix(immediate = false) {
        if (!this.context) return;
        applyGain(this.masterGain?.gain, this.mix.volume, this.context, immediate);
        applyGain(this.referenceGain?.gain,
            this.mix.referenceGain, this.context, immediate);
        applyGain(this.guideGain?.gain,
            this.mix.guideGain * gainValue(this.tone.trimGain, 1),
            this.context, immediate);
    }

    _buildAudioGraph() {
        this.masterGain = this.context.createGain();
        this.referenceGain = this.context.createGain();
        this.guideGain = this.context.createGain();
        this.referenceGain.connect(this.masterGain);
        this.guideGain.connect(this.masterGain);
        if (typeof this.context.createDynamicsCompressor === 'function') {
            this.limiter = this.context.createDynamicsCompressor();
            if (this.limiter.threshold) this.limiter.threshold.value = -1;
            if (this.limiter.knee) this.limiter.knee.value = 0;
            if (this.limiter.ratio) this.limiter.ratio.value = 20;
            if (this.limiter.attack) this.limiter.attack.value = 0.003;
            if (this.limiter.release) this.limiter.release.value = 0.1;
            this.masterGain.connect(this.limiter);
            this.limiter.connect(this.context.destination);
        } else {
            this.masterGain.connect(this.context.destination);
        }
        const referenceOptions = { context: this.context, target: this.referenceGain };
        this.referenceMixer = typeof this.referenceMixerFactory === 'function'
            ? this.referenceMixerFactory(referenceOptions)
            : new CompositeReferenceMixer(referenceOptions);
        const guideOptions = {
            context: this.context,
            target: this.guideGain,
            voice: options => this.soundfont.voice(
                options.context, options.target, options.program, options.when,
                options.midi, options.duration, options.gain),
            nowChart: () => this._rawCurrentTime(),
            chartToContext: chartTime => this.anchorContextTime
                + (chartTime - this.anchorChartTime),
            setIntervalFn: this.setIntervalFn,
            clearIntervalFn: this.clearIntervalFn,
        };
        this.guideScheduler = typeof this.guideSchedulerFactory === 'function'
            ? this.guideSchedulerFactory(guideOptions)
            : new CompositeGuideScheduler(guideOptions);
        this._applyMix(true);
    }

    async _ensureContext() {
        if (this.context) return this.context;
        if (!this.audioContextFactory) {
            throw new Error('Hybrid preview audio is unavailable in this environment');
        }
        const context = this.audioContextFactory();
        if (!context) throw new Error('Hybrid preview could not create an AudioContext');
        this.context = context;
        this._buildAudioGraph();
        return context;
    }

    _stopScheduled() {
        this.guideScheduler?.stop?.();
        this.referenceMixer?.cancel?.();
    }

    _cancelFrame() {
        if (this.frame !== null && typeof this.cancelAnimationFrameFn === 'function') {
            this.cancelAnimationFrameFn(this.frame);
        }
        this.frame = null;
    }

    _requestFrame() {
        if (!this.playing || this.frame !== null
                || typeof this.requestAnimationFrameFn !== 'function') return;
        this.frame = this.requestAnimationFrameFn(() => {
            this.frame = null;
            this._presentationTick();
        });
    }

    _presentationTick() {
        if (!this.playing || this.destroyed) return;
        const raw = this._rawCurrentTime();
        const end = this._effectiveEnd();
        if (end > 0 && raw >= end) {
            if (this.loop.enabled && !this.loopRestartPending) {
                this.loopRestartPending = true;
                const restartAt = this._effectiveLoopStart();
                this._emitTime(end);
                this._beginAt(restartAt).finally(() => {
                    this.loopRestartPending = false;
                });
                return;
            }
            this._haltAt(end, { emit: true });
            return;
        }
        this.cursor = this.currentTime();
        this._emitTime(this.cursor);
        this._requestFrame();
    }

    _haltAt(time, { emit = false } = {}) {
        this.cursor = this._clampTime(time);
        this.generation++;
        this._stopScheduled();
        this._cancelFrame();
        this.playing = false;
        this.loading = false;
        this.anchorChartTime = this.cursor;
        if (emit) {
            this._emitTime(this.cursor);
            this._emitState();
        }
        return this.cursor;
    }

    async _beginAt(rawTime) {
        if (this.destroyed) return false;
        const definition = this._definition();
        if (!definition) throw new Error(`Hybrid preview mode is not defined: ${this.mode}`);
        const generation = ++this.generation;
        this._stopScheduled();
        this._cancelFrame();
        this.playing = false;
        this.loading = true;
        this.lastError = null;
        this.cursor = this._clampTime(rawTime, definition);
        this._emitState();
        try {
            const context = await this._ensureContext();
            if (context.state === 'suspended' && typeof context.resume === 'function') {
                await context.resume();
            }
            if (context.state === 'closed') {
                throw new Error('Hybrid preview AudioContext is closed');
            }
            if (definition.kind === 'guide') {
                await this.soundfont.prepare(context,
                    Number(definition.gm ?? this.tone.gm));
            } else {
                const supplied = typeof definition.snapshot === 'function'
                    ? definition.snapshot() : definition.snapshot || definition.reference || {};
                await this.referenceMixer.prepare(supplied);
            }
            if (this.destroyed || generation !== this.generation) return false;
            const startAt = Math.max(0, finite(context.currentTime)) + this.startLeadSeconds;
            // Sample once per start/restart. Some devices update outputLatency
            // while the graph settles; reading it every frame makes the marker
            // shimmer even though scheduled audio remains stable.
            this.heldOutputLatency = compositePreviewOutputLatencyPure(context);
            this.anchorChartTime = this.cursor;
            this.anchorContextTime = startAt;
            this.loading = false;
            this.playing = true;
            this._applyMix(true);
            const endTime = this._effectiveEnd(definition);
            if (definition.kind === 'guide') {
                const events = typeof definition.events === 'function'
                    ? definition.events() : definition.events;
                this.guideScheduler.configure({
                    events,
                    program: Number(definition.gm ?? this.tone.gm),
                    voiceCap: definition.voiceCap,
                    baseGain: gainValue(definition.voiceGain, 0.5, 1),
                });
                this.guideScheduler.start(this.cursor, { endTime });
            } else {
                this.referenceMixer.schedule(this.cursor, { when: startAt, endTime });
            }
            this._emitTime(this.cursor);
            this._emitState();
            this._requestFrame();
            return true;
        } catch (error) {
            if (generation !== this.generation || this.destroyed) return false;
            this.loading = false;
            this.playing = false;
            this.lastError = error instanceof Error ? error : new Error(String(error));
            this._stopScheduled();
            this._emitState();
            return false;
        }
    }

    defineMode(mode, definition) {
        if (typeof mode !== 'string' || !mode) return false;
        this.modes.set(mode, normalizeModeDefinition(mode, definition));
        return true;
    }

    async setMode(mode, definition = undefined) {
        if (typeof mode !== 'string' || !mode || this.destroyed) return false;
        if (definition !== undefined) this.defineMode(mode, definition);
        if (!this.modes.has(mode)) return false;
        const wasActive = this.playing || this.loading;
        const at = this.currentTime();
        this._haltAt(at);
        // A newly selected audition is a fresh request. Do not let a previous
        // load/decode failure leak through the configuration state emitted
        // before this mode's own start attempt begins.
        this.lastError = null;
        this.mode = mode;
        this.cursor = this._clampTime(at);
        this._emitTime(this.cursor);
        this._emitState();
        return wasActive ? this._beginAt(this.cursor) : true;
    }

    async start(mode = this.mode) {
        if (typeof mode === 'string' && mode !== this.mode) {
            if (!this.modes.has(mode)) return false;
            this.mode = mode;
        }
        const definition = this._definition();
        if (!definition) return false;
        let at = this.currentTime();
        const range = this._effectiveRange(definition);
        if (!(at < range.endTime)) at = range.startTime;
        return this._beginAt(at);
    }

    stop() {
        return this._haltAt(this.currentTime(), { emit: true });
    }

    pause() {
        return this.stop();
    }

    async seek(time) {
        if (this.destroyed) return false;
        const wasActive = this.playing || this.loading;
        const target = this._clampTime(time);
        this._haltAt(target);
        this._emitTime(this.cursor);
        this._emitState();
        return wasActive ? this._beginAt(target) : true;
    }

    async restart() {
        const target = this.loop.enabled
            ? this._effectiveLoopStart() : this._effectiveRange().startTime;
        return this.seek(target);
    }

    setLoop(raw, startTime = undefined, endTime = undefined) {
        const object = raw && typeof raw === 'object' ? raw : null;
        const enabled = object ? object.enabled !== false : !!raw;
        const range = this._effectiveRange();
        const wasActive = this.playing || this.loading;
        const at = wasActive ? this.currentTime() : this.cursor;
        const start = this._clampTime(
            object?.startTime ?? startTime ?? this.loop.startTime ?? range.startTime);
        const end = this._clampTime(
            object?.endTime ?? endTime ?? this.loop.endTime ?? range.endTime);
        const next = {
            enabled: enabled && end > start,
            startTime: start,
            endTime: Math.max(start, end),
        };
        const changed = next.enabled !== this.loop.enabled
            || next.startTime !== this.loop.startTime || next.endTime !== this.loop.endTime;
        this.loop = next;
        // Reference nodes and the guide lookahead are capped at the endpoint
        // active when a pass starts. Re-seat a live pass when Loop changes so
        // disabling it cannot leave the remainder of the song silent, and
        // enabling it cannot leave already-queued voices beyond the new edge.
        if (wasActive && changed) {
            this._haltAt(at);
            void this._beginAt(at);
        }
        this._emitState();
        return { ...this.loop };
    }

    setRange(startTime, endTime) {
        const start = Math.max(0, finite(startTime));
        const end = Math.max(start, finite(endTime, start));
        this.range = { startTime: start, endTime: end };
        this.cursor = this._clampTime(this.currentTime());
        if (!(this.loop.endTime > this.loop.startTime)) {
            this.loop = { enabled: false, startTime: start, endTime: end };
        } else {
            this.setLoop(this.loop);
        }
        this._emitTime(this.cursor);
        return { ...this.range };
    }

    setMix(options = {}) {
        if (Object.prototype.hasOwnProperty.call(options, 'volume')) {
            this.mix.volume = volumeValue(options.volume, this.mix.volume);
        }
        if (Object.prototype.hasOwnProperty.call(options, 'referenceGain')) {
            this.mix.referenceGain = gainValue(
                options.referenceGain, this.mix.referenceGain);
        }
        if (Object.prototype.hasOwnProperty.call(options, 'guideGain')) {
            this.mix.guideGain = gainValue(options.guideGain, this.mix.guideGain);
        }
        this._applyMix(false);
        return { ...this.mix };
    }

    async setTone(tone) {
        if (this.destroyed) return false;
        const next = normalizeTone(tone);
        const changed = next.gm !== this.tone.gm || next.trimGain !== this.tone.trimGain;
        this.tone = next;
        this._applyMix(false);
        const active = this.playing || this.loading;
        if (!changed || !active || this._definition()?.kind !== 'guide') {
            this._emitState();
            return true;
        }
        const at = this.currentTime();
        this._haltAt(at);
        return this._beginAt(at);
    }

    async destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.generation++;
        this._stopScheduled();
        this._cancelFrame();
        this.playing = false;
        this.loading = false;
        // This controller owns and closes the context below. Let the guide
        // scheduler disconnect dense passes without walking every envelope on
        // the modal-close input path; context.close() retires those nodes.
        this.guideScheduler?.destroy?.({ contextWillClose: true });
        this.referenceMixer?.destroy?.();
        this.soundfont?.destroy?.();
        for (const node of [
            this.referenceGain, this.guideGain, this.masterGain, this.limiter,
        ]) {
            try { node?.disconnect?.(); } catch (_) { /* context already closed */ }
        }
        const context = this.context;
        this.context = null;
        if (context && context.state !== 'closed' && typeof context.close === 'function') {
            try { await context.close(); } catch (_) { /* browser already closed it */ }
        }
        this._emitState();
    }
}

export function createCompositePreviewController(options) {
    return new CompositePreviewController(options);
}
