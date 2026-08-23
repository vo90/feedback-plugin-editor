/* Sample-clock guide scheduling for Hybrid Track auditions.
 *
 * Events use preview.js's immutable `{ t, midi, sus }` shape. The scheduler
 * owns no Editor state and knows nothing about arrangements or the DOM.
 */

export const COMPOSITE_GUIDE_LOOKAHEAD_SECONDS = 0.3;
export const COMPOSITE_GUIDE_LATE_RECOVERY_SECONDS = 0.04;
export const COMPOSITE_GUIDE_TICK_MS = 25;
export const COMPOSITE_GUIDE_STOP_FADE_SECONDS = 0.004;
export const COMPOSITE_GUIDE_CLEANUP_DELAY_MS = 8;

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function compositeGuideEventsPure(events) {
    if (!Array.isArray(events)) return [];
    return events
        .filter(event => event && Number.isFinite(Number(event.t))
            && Number.isInteger(Number(event.midi))
            && Number(event.midi) >= 0 && Number(event.midi) <= 127)
        .map(event => ({
            t: Number(event.t),
            midi: Number(event.midi),
            sus: Math.max(0, finite(event.sus)),
        }))
        .sort((left, right) => left.t - right.t
            || left.midi - right.midi || left.sus - right.sus);
}

// Half-open window, with the lower edge included. The inclusive lower edge is
// what lets a note exactly at a seek/play cursor sound on the first tick.
export function compositeGuideGroupsInWindowPure(events, from, to, voiceCap = 6) {
    if (!Array.isArray(events) || !events.length || !(to > from)) return [];
    const cap = Math.max(1, Math.min(12, Math.trunc(Number(voiceCap) || 6)));
    let low = 0;
    let high = events.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (events[middle].t < from) low = middle + 1;
        else high = middle;
    }
    const groups = [];
    let group = null;
    let bucketKey = null;
    for (let index = low; index < events.length && events[index].t < to; index++) {
        const event = events[index];
        const key = Math.round(event.t * 1000);
        if (key !== bucketKey) {
            bucketKey = key;
            group = { t: event.t, key, voices: [{ midi: event.midi, sus: event.sus }] };
            groups.push(group);
        } else if (group.voices.length < cap
                && !group.voices.some(voice => voice.midi === event.midi)) {
            group.voices.push({ midi: event.midi, sus: event.sus });
        }
    }
    return groups;
}

export function compositeChordVoiceGainPure(voiceCount, baseGain = 0.5) {
    const count = Math.max(1, Math.min(12, Math.trunc(Number(voiceCount) || 1)));
    const base = Math.max(0, Math.min(1, finite(baseGain, 0.5)));
    return base / Math.sqrt(count);
}

export function compositeGuideScheduleWindowPure(nowChart, scheduledUntil, {
    includeCursor = false,
    lookahead = COMPOSITE_GUIDE_LOOKAHEAD_SECONDS,
    lateRecovery = COMPOSITE_GUIDE_LATE_RECOVERY_SECONDS,
    endTime = Number.POSITIVE_INFINITY,
} = {}) {
    const now = finite(nowChart);
    const watermark = Number.isFinite(Number(scheduledUntil))
        ? Number(scheduledUntil) : now;
    const from = includeCursor ? watermark
        : Math.max(watermark, now - Math.max(0, finite(lateRecovery)));
    const rawTo = now + Math.max(0, finite(lookahead));
    return {
        from,
        to: Math.min(rawTo, Number.isFinite(Number(endTime))
            ? Number(endTime) : Number.POSITIVE_INFINITY),
    };
}

// Project chart events onto an elapsed, monotonically increasing loop clock.
// The first segment runs from the requested cursor to loopEnd; every later
// segment starts at loopStart. This lets Web Audio queue both sides of a loop
// boundary on one sample-clock pass instead of restarting from requestAnimationFrame.
export function compositeGuideLoopGroupsInWindowPure(events, from, to, {
    cursorTime = 0,
    loopStart = 0,
    loopEnd = 0,
    voiceCap = 6,
} = {}) {
    if (!Array.isArray(events) || !events.length || !(to > from)) return [];
    const cursor = finite(cursorTime);
    const end = finite(loopEnd);
    const start = Math.max(0, Math.min(end, finite(loopStart)));
    const period = end - start;
    if (!(period > 0)) return [];
    const firstSpan = Math.max(0, end - cursor);
    const groups = [];
    const boundedFrom = Math.max(0, finite(from));
    const boundedTo = Math.max(boundedFrom, finite(to));
    const append = (chartFrom, chartTo, elapsedBase, chartBase, cycleKey) => {
        if (!(chartTo > chartFrom)) return;
        for (const group of compositeGuideGroupsInWindowPure(
                events, chartFrom, chartTo, voiceCap)) {
            groups.push({
                ...group,
                elapsed: Math.round((elapsedBase + (group.t - chartBase)) * 1e9) / 1e9,
                key: `${cycleKey}:${group.key}`,
            });
        }
    };

    if (boundedFrom < firstSpan) {
        const segmentFrom = boundedFrom;
        const segmentTo = Math.min(firstSpan, boundedTo);
        append(cursor + segmentFrom, cursor + segmentTo, 0, cursor, 'first');
    }
    if (boundedTo > firstSpan) {
        const repeatFrom = Math.max(firstSpan, boundedFrom);
        let cycle = Math.max(0, Math.floor((repeatFrom - firstSpan) / period));
        // A lookahead normally spans at most one or two cycles. The bound is a
        // defensive guard against a malformed sub-millisecond loop.
        for (let count = 0; count < 2048; count++, cycle++) {
            const cycleElapsed = firstSpan + cycle * period;
            if (cycleElapsed >= boundedTo) break;
            const localFrom = Math.max(0, repeatFrom - cycleElapsed);
            const localTo = Math.min(period, boundedTo - cycleElapsed);
            append(start + localFrom, start + localTo,
                cycleElapsed, start, `loop-${cycle}`);
        }
    }
    return groups.filter(group => group.elapsed >= boundedFrom - 1e-9
        && group.elapsed < boundedTo - 1e-9).sort((left, right) => left.elapsed - right.elapsed
        || left.t - right.t || String(left.key).localeCompare(String(right.key)));
}

function cancelVoice(voice) {
    try {
        if (typeof voice?.cancel === 'function') voice.cancel();
        else if (typeof voice?.osc?.stop === 'function') voice.osc.stop();
    } catch (_) { /* a stopped/closed voice is already cancelled */ }
    try { voice?.gain?.disconnect?.(); } catch (_) { /* already disconnected */ }
}

export class CompositeGuideScheduler {
    constructor({
        context,
        target,
        voice,
        nowChart,
        chartToContext,
        setIntervalFn = globalThis.setInterval?.bind(globalThis),
        clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
        setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
        clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
        tickMs = COMPOSITE_GUIDE_TICK_MS,
        lookahead = COMPOSITE_GUIDE_LOOKAHEAD_SECONDS,
        lateRecovery = COMPOSITE_GUIDE_LATE_RECOVERY_SECONDS,
        stopFadeSeconds = COMPOSITE_GUIDE_STOP_FADE_SECONDS,
        cleanupDelayMs = COMPOSITE_GUIDE_CLEANUP_DELAY_MS,
    } = {}) {
        if (!context) throw new Error('Hybrid guide scheduler requires an AudioContext');
        if (typeof voice !== 'function') {
            throw new Error('Hybrid guide scheduler requires a voice function');
        }
        this.context = context;
        this.target = target || context.destination;
        this.voice = voice;
        this.nowChart = typeof nowChart === 'function' ? nowChart : () => 0;
        this.chartToContext = typeof chartToContext === 'function'
            ? chartToContext : chartTime => context.currentTime + chartTime;
        this.setIntervalFn = setIntervalFn;
        this.clearIntervalFn = clearIntervalFn;
        this.setTimeoutFn = setTimeoutFn;
        this.clearTimeoutFn = clearTimeoutFn;
        this.tickMs = Math.max(5, Math.trunc(finite(tickMs, COMPOSITE_GUIDE_TICK_MS)));
        this.lookahead = Math.max(0.01, finite(
            lookahead, COMPOSITE_GUIDE_LOOKAHEAD_SECONDS));
        this.lateRecovery = Math.max(0, finite(
            lateRecovery, COMPOSITE_GUIDE_LATE_RECOVERY_SECONDS));
        this.stopFadeSeconds = Math.max(0, Math.min(0.02,
            finite(stopFadeSeconds, COMPOSITE_GUIDE_STOP_FADE_SECONDS)));
        this.cleanupDelayMs = Math.max(0, Math.trunc(finite(
            cleanupDelayMs, COMPOSITE_GUIDE_CLEANUP_DELAY_MS)));
        this.events = [];
        this.program = 27;
        this.voiceCap = 6;
        this.baseGain = 0.5;
        this.endTime = Number.POSITIVE_INFINITY;
        this.loop = null;
        this.startContextTime = 0;
        this.cursorTime = 0;
        this.scheduledUntil = 0;
        this.includeCursor = false;
        this.lastBucketKey = null;
        this.voices = [];
        this.activePass = null;
        this.passPool = [];
        this.retiredCleanups = new Set();
        this.timer = null;
        this.running = false;
        this.destroyed = false;
        this.generation = 0;
    }

    configure({ events, program = 27, voiceCap = 6, baseGain = 0.5 } = {}) {
        if (this.destroyed) return false;
        // A mode change must be as cheap as Stop even with a dense lookahead.
        // The prior pass is silenced now and its individual envelopes retire
        // outside the input event, provided Web Audio can isolate the pass.
        this.stop();
        this.events = compositeGuideEventsPure(events);
        this.program = Number(program);
        this.voiceCap = Math.max(1, Math.min(12, Math.trunc(Number(voiceCap) || 6)));
        this.baseGain = Math.max(0, Math.min(1, finite(baseGain, 0.5)));
        this.lastBucketKey = null;
        this.generation++;
        return true;
    }

    start(cursorTime, {
        endTime = Number.POSITIVE_INFINITY,
        startContextTime = this.context.currentTime,
        loop = null,
    } = {}) {
        if (this.destroyed) return false;
        this.stop();
        this.running = true;
        this.endTime = Number.isFinite(Number(endTime))
            ? Number(endTime) : Number.POSITIVE_INFINITY;
        this.cursorTime = Math.max(0, finite(cursorTime));
        const loopStart = Math.max(0, finite(loop?.startTime));
        this.loop = loop && loop.enabled !== false && this.endTime > loopStart
            ? { startTime: loopStart, endTime: this.endTime }
            : null;
        this.startContextTime = Math.max(0, finite(
            startContextTime, this.context.currentTime));
        this.scheduledUntil = this.loop ? 0 : this.cursorTime;
        this.includeCursor = true;
        this.lastBucketKey = null;
        this.generation++;
        this.activePass = this._createPass(this.generation);
        this.voices = this.activePass.voices;
        if (typeof this.setIntervalFn === 'function') {
            this.timer = this.setIntervalFn(() => this.tick(), this.tickMs);
        }
        // Fill the first 300 ms synchronously. Waiting one interval here would
        // make the first note feel late even though Web Audio schedules ahead.
        this.tick();
        return true;
    }

    tick() {
        if (!this.running || this.destroyed) return 0;
        const pass = this.activePass;
        if (!pass) return 0;
        const contextNow = finite(this.context.currentTime);
        this.voices = this.voices.filter(item => {
            if (!Number.isFinite(Number(item?.until)) || Number(item.until) > contextNow) {
                return true;
            }
            return false;
        });
        pass.voices = this.voices;
        const now = this.loop
            ? Math.max(0, contextNow - this.startContextTime)
            : Math.max(0, finite(this.nowChart()));
        const window = compositeGuideScheduleWindowPure(now, this.scheduledUntil, {
            includeCursor: this.includeCursor,
            lookahead: this.lookahead,
            lateRecovery: this.lateRecovery,
            endTime: this.loop ? Number.POSITIVE_INFINITY : this.endTime,
        });
        if (!(window.to > window.from)) {
            this.includeCursor = false;
            return 0;
        }
        const generation = this.generation;
        let scheduled = 0;
        const groups = this.loop
            ? compositeGuideLoopGroupsInWindowPure(
                this.events, window.from, window.to, {
                    cursorTime: this.cursorTime,
                    loopStart: this.loop.startTime,
                    loopEnd: this.loop.endTime,
                    voiceCap: this.voiceCap,
                })
            : compositeGuideGroupsInWindowPure(
                this.events, window.from, window.to, this.voiceCap);
        for (const group of groups) {
            if (generation !== this.generation || !this.running) break;
            if (group.key === this.lastBucketKey) continue;
            this.lastBucketKey = group.key;
            const desiredWhen = this.loop
                ? this.startContextTime + group.elapsed
                : this.chartToContext(group.t);
            const when = Math.max(contextNow, finite(desiredWhen, contextNow));
            const voiceGain = compositeChordVoiceGainPure(
                group.voices.length, this.baseGain);
            for (const event of group.voices) {
                const scheduledVoice = this.voice({
                    context: this.context,
                    target: pass.target,
                    program: this.program,
                    when,
                    midi: event.midi,
                    duration: event.sus,
                    gain: voiceGain,
                    generation,
                });
                if (scheduledVoice) {
                    this.voices.push(scheduledVoice);
                    scheduled++;
                }
            }
        }
        this.scheduledUntil = Math.max(this.scheduledUntil, window.to);
        this.includeCursor = false;
        return scheduled;
    }

    cancelVoices() {
        const pass = this.activePass || {
            node: null,
            target: this.target,
            voices: this.voices,
        };
        this.activePass = null;
        this.voices = [];
        this._silencePass(pass);
        this._cleanupPass(pass);
    }

    _createPass(generation) {
        let node = this.passPool.pop() || null;
        try {
            if (!node && typeof this.context?.createGain === 'function') {
                node = this.context.createGain();
            }
            if (node) {
                const now = Math.max(0, finite(this.context?.currentTime));
                node.gain?.cancelScheduledValues?.(now);
                node.gain?.setValueAtTime?.(1, now);
                node.connect(this.target);
            }
        } catch (_) {
            try { node?.disconnect?.(); } catch (_) { /* incomplete gain node */ }
            node = null;
        }
        return {
            generation,
            node,
            target: node || this.target,
            voices: [],
        };
    }

    _silencePass(pass) {
        const node = pass?.node;
        if (!node) return false;
        const parameter = node.gain;
        const now = Math.max(0, finite(this.context?.currentTime));
        if (parameter) {
            try {
                const current = Math.max(0, finite(parameter.value, 1));
                parameter.cancelScheduledValues?.(now);
                if (typeof parameter.setValueAtTime === 'function') {
                    parameter.setValueAtTime(current, now);
                } else {
                    parameter.value = current;
                }
                if (this.stopFadeSeconds > 0
                        && typeof parameter.linearRampToValueAtTime === 'function') {
                    parameter.linearRampToValueAtTime(0, now + this.stopFadeSeconds);
                } else if (typeof parameter.setValueAtTime === 'function') {
                    parameter.setValueAtTime(0, now);
                } else {
                    parameter.value = 0;
                }
                return true;
            } catch (_) { /* disconnect below is the atomic fallback */ }
        }
        if (typeof node.disconnect !== 'function') return false;
        try {
            node.disconnect();
            pass.disconnected = true;
            return true;
        } catch (_) {
            return false;
        }
    }

    _cleanupPass(pass) {
        for (const voice of pass?.voices || []) cancelVoice(voice);
        if (!pass?.disconnected) {
            try { pass?.node?.disconnect?.(); } catch (_) { /* already disconnected */ }
        }
        if (pass) {
            pass.voices = [];
            if (pass.node && !this.destroyed && this.passPool.length < 4) {
                this.passPool.push(pass.node);
            }
        }
    }

    _deferPassCleanup(pass) {
        const isolated = this._silencePass(pass);
        if (!isolated || typeof this.setTimeoutFn !== 'function') {
            this._cleanupPass(pass);
            return false;
        }
        const job = { id: null, run: null, discard: null };
        job.run = () => {
            if (!this.retiredCleanups.delete(job)) return;
            this._cleanupPass(pass);
        };
        job.discard = () => {
            if (!this.retiredCleanups.delete(job)) return;
            try { pass?.node?.disconnect?.(); } catch (_) { /* already disconnected */ }
            // The owning AudioContext is closing, so its scheduled source
            // nodes need no per-envelope cancellation. Dropping this retained
            // array releases the only scheduler-side references in O(1).
            if (pass) pass.voices = [];
        };
        this.retiredCleanups.add(job);
        try {
            job.id = this.setTimeoutFn(job.run, this.cleanupDelayMs);
            return true;
        } catch (_) {
            this.retiredCleanups.delete(job);
            this._cleanupPass(pass);
            return false;
        }
    }

    _retireActivePass() {
        const pass = this.activePass;
        this.activePass = null;
        this.voices = [];
        if (!pass) return false;
        return this._deferPassCleanup(pass);
    }

    _flushRetiredCleanups() {
        for (const job of [...this.retiredCleanups]) {
            if (job.id !== null && typeof this.clearTimeoutFn === 'function') {
                try { this.clearTimeoutFn(job.id); } catch (_) { /* timer already fired */ }
            }
            job.run();
        }
    }

    _discardRetiredCleanups() {
        for (const job of [...this.retiredCleanups]) {
            if (job.id !== null && typeof this.clearTimeoutFn === 'function') {
                try { this.clearTimeoutFn(job.id); } catch (_) { /* timer already fired */ }
            }
            job.discard();
        }
    }

    stop() {
        if (this.timer !== null && typeof this.clearIntervalFn === 'function') {
            this.clearIntervalFn(this.timer);
        }
        this.timer = null;
        this.running = false;
        this.includeCursor = false;
        this.generation++;
        this._retireActivePass();
    }

    destroy({ contextWillClose = false } = {}) {
        if (this.destroyed) return;
        if (contextWillClose) {
            if (this.timer !== null && typeof this.clearIntervalFn === 'function') {
                this.clearIntervalFn(this.timer);
            }
            this.timer = null;
            this.running = false;
            this.includeCursor = false;
            this.generation++;
            const pass = this.activePass;
            this.activePass = null;
            this.voices = [];
            if (pass) {
                this._silencePass(pass);
                try { pass.node?.disconnect?.(); } catch (_) { /* context is closing */ }
                pass.voices = [];
            }
        } else {
            this.stop();
        }
        this.destroyed = true;
        if (contextWillClose) this._discardRetiredCleanups();
        else this._flushRetiredCleanups();
        this.events = [];
        for (const node of this.passPool) {
            try { node?.disconnect?.(); } catch (_) { /* already disconnected */ }
        }
        this.passPool = [];
        this.target = null;
    }
}
