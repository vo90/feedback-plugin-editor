/* Sample-clock guide scheduling for Hybrid Track auditions.
 *
 * Events use preview.js's immutable `{ t, midi, sus }` shape. The scheduler
 * owns no Editor state and knows nothing about arrangements or the DOM.
 */

export const COMPOSITE_GUIDE_LOOKAHEAD_SECONDS = 0.3;
export const COMPOSITE_GUIDE_LATE_RECOVERY_SECONDS = 0.04;
export const COMPOSITE_GUIDE_TICK_MS = 25;

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
        tickMs = COMPOSITE_GUIDE_TICK_MS,
        lookahead = COMPOSITE_GUIDE_LOOKAHEAD_SECONDS,
        lateRecovery = COMPOSITE_GUIDE_LATE_RECOVERY_SECONDS,
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
        this.tickMs = Math.max(5, Math.trunc(finite(tickMs, COMPOSITE_GUIDE_TICK_MS)));
        this.lookahead = Math.max(0.01, finite(
            lookahead, COMPOSITE_GUIDE_LOOKAHEAD_SECONDS));
        this.lateRecovery = Math.max(0, finite(
            lateRecovery, COMPOSITE_GUIDE_LATE_RECOVERY_SECONDS));
        this.events = [];
        this.program = 27;
        this.voiceCap = 6;
        this.baseGain = 0.5;
        this.endTime = Number.POSITIVE_INFINITY;
        this.scheduledUntil = 0;
        this.includeCursor = false;
        this.lastBucketKey = null;
        this.voices = [];
        this.timer = null;
        this.running = false;
        this.destroyed = false;
        this.generation = 0;
    }

    configure({ events, program = 27, voiceCap = 6, baseGain = 0.5 } = {}) {
        if (this.destroyed) return false;
        this.cancelVoices();
        this.events = compositeGuideEventsPure(events);
        this.program = Number(program);
        this.voiceCap = Math.max(1, Math.min(12, Math.trunc(Number(voiceCap) || 6)));
        this.baseGain = Math.max(0, Math.min(1, finite(baseGain, 0.5)));
        this.lastBucketKey = null;
        this.generation++;
        return true;
    }

    start(cursorTime, { endTime = Number.POSITIVE_INFINITY } = {}) {
        if (this.destroyed) return false;
        this.stop();
        this.running = true;
        this.endTime = Number.isFinite(Number(endTime))
            ? Number(endTime) : Number.POSITIVE_INFINITY;
        this.scheduledUntil = Math.max(0, finite(cursorTime));
        this.includeCursor = true;
        this.lastBucketKey = null;
        this.generation++;
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
        const contextNow = finite(this.context.currentTime);
        this.voices = this.voices.filter(item => {
            if (!Number.isFinite(Number(item?.until)) || Number(item.until) > contextNow) {
                return true;
            }
            return false;
        });
        const now = Math.max(0, finite(this.nowChart()));
        const window = compositeGuideScheduleWindowPure(now, this.scheduledUntil, {
            includeCursor: this.includeCursor,
            lookahead: this.lookahead,
            lateRecovery: this.lateRecovery,
            endTime: this.endTime,
        });
        if (!(window.to > window.from)) {
            this.includeCursor = false;
            return 0;
        }
        const generation = this.generation;
        let scheduled = 0;
        for (const group of compositeGuideGroupsInWindowPure(
                this.events, window.from, window.to, this.voiceCap)) {
            if (generation !== this.generation || !this.running) break;
            if (group.key === this.lastBucketKey) continue;
            this.lastBucketKey = group.key;
            const when = Math.max(contextNow, finite(
                this.chartToContext(group.t), contextNow));
            const voiceGain = compositeChordVoiceGainPure(
                group.voices.length, this.baseGain);
            for (const event of group.voices) {
                const scheduledVoice = this.voice({
                    context: this.context,
                    target: this.target,
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
        for (const voice of this.voices) cancelVoice(voice);
        this.voices = [];
    }

    stop() {
        if (this.timer !== null && typeof this.clearIntervalFn === 'function') {
            this.clearIntervalFn(this.timer);
        }
        this.timer = null;
        this.running = false;
        this.includeCursor = false;
        this.generation++;
        this.cancelVoices();
    }

    destroy() {
        if (this.destroyed) return;
        this.stop();
        this.destroyed = true;
        this.events = [];
        this.target = null;
    }
}
