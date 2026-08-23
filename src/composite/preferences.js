/* Persisted Hybrid Track setup preferences. */

import { normalizeCompositeGapFillOptions } from './gap-fill-engine.js';
import { GUIDED_REPEAT_MODE_EVERY, GUIDED_REPEAT_MODE_MATCHING } from './guided-engine.js';

const GAP_FILL_KEY = 'editorCompositeGapFill';
const GUIDED_KEY = 'editorCompositeGuided';
const PREVIEW_KEY = 'editorCompositePreview';
const EXPERIMENTAL_KEY = 'editorCompositeExperimental';
const DIALOG_SIZE_KEY = 'editorCompositeDialogSize';
const TIMELINE_PREF_VERSION_KEY = 'editorCompositeTimelineVersion';
const TIMELINE_PREF_VERSION = 3;
// Increment whenever the opt-in engine changes its musical decision rules.
// A prior opt-in must never silently authorize materially different choices.
export const HYBRID_EXPERIMENTAL_PREF_VERSION = 2;
export const HYBRID_EXPERIMENTAL_PROFILE_STRICT = 'strict';
export const HYBRID_EXPERIMENTAL_PROFILE_BALANCED = 'balanced';
export const HYBRID_EXPERIMENTAL_PROFILE_FILL_MORE = 'fill-more';
export const HYBRID_EXPERIMENTAL_DEFAULTS = Object.freeze({
    enabled: false,
    profile: HYBRID_EXPERIMENTAL_PROFILE_BALANCED,
    version: HYBRID_EXPERIMENTAL_PREF_VERSION,
});

export const HYBRID_TIMELINE_ZOOM_MIN = 1;
export const HYBRID_TIMELINE_ZOOM_MAX = 480;
export const HYBRID_TIMELINE_ZOOM_CONTROL_MIN = 5;
export const HYBRID_TIMELINE_ZOOM_STEP = 5;
export const HYBRID_TIMELINE_LANE_MIN = 128;
export const HYBRID_TIMELINE_LANE_MAX = 320;
export const HYBRID_TIMELINE_DISPLAY_NOTES = 'notes';
export const HYBRID_TIMELINE_DISPLAY_OVERVIEW = 'overview';
export const HYBRID_PREVIEW_DEFAULTS = Object.freeze({
    tone: 'clean',
    volume: 75,
    timelineZoom: 120,
    timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
    laneHeights: Object.freeze({ primary: 158, secondary: 158, result: 158 }),
    followPlayhead: true,
});

export function hybridDialogSizePure(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const normalize = (value, minimum) => {
        const number = Number(value);
        return Number.isFinite(number) && number >= minimum
            ? Math.min(10000, Math.round(number)) : null;
    };
    return {
        width: normalize(parsed.width, 480),
        height: normalize(parsed.height, 400),
        maximized: parsed.maximized === true,
    };
}

export function loadHybridDialogSize() {
    let raw = null;
    try { raw = localStorage.getItem(DIALOG_SIZE_KEY); } catch (_) { /* blocked storage */ }
    return hybridDialogSizePure(raw);
}

export function saveHybridDialogSize(size) {
    const normalized = hybridDialogSizePure(size);
    try { localStorage.setItem(DIALOG_SIZE_KEY, JSON.stringify(normalized)); } catch (_) { /* blocked storage */ }
    return normalized;
}

// These are Hybrid-builder audition presets, deliberately separate from the
// Editor's general per-instrument guide voice.  The trims level-match the
// active sample material in the vendored FluidR3 programs: programs 29 and 30
// are naturally about 3.25 dB and 4.62 dB louder than program 27 respectively.
// Keeping the correction with the preset means Lead / Rhythm / Hybrid all use
// exactly the same gain staging when the user changes tone.
export const HYBRID_PREVIEW_TONES = Object.freeze([
    Object.freeze({ id: 'clean', label: 'Clean', gm: 27, trimGain: 1 }),
    Object.freeze({ id: 'edge', label: 'Edge', gm: 29, trimGain: 10 ** (-3.25 / 20) }),
    Object.freeze({ id: 'distortion', label: 'Distortion', gm: 30, trimGain: 10 ** (-4.62 / 20) }),
]);

export const HYBRID_GAP_FILL_CONTROL_CONFIG = Object.freeze({
    beats: Object.freeze({ minimumMax: 16, minimumStep: 0.25, marginMax: 8, marginStep: 0.125 }),
    seconds: Object.freeze({ minimumMax: 30, minimumStep: 0.05, marginMax: 10, marginStep: 0.025 }),
});

function valuesForUnit(unit, value) {
    const normalized = normalizeCompositeGapFillOptions({ unit, ...(value || {}) });
    return { minimumGap: normalized.minimumGap, transitionMargin: normalized.transitionMargin };
}

export function hybridGapFillPreferencesPure(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const unit = parsed.unit === 'seconds' ? 'seconds' : 'beats';
    return {
        unit,
        beats: valuesForUnit('beats', parsed.beats),
        seconds: valuesForUnit('seconds', parsed.seconds),
    };
}

export function loadHybridGapFillPreferences() {
    let raw = null;
    try { raw = localStorage.getItem(GAP_FILL_KEY); } catch (_) { /* blocked storage */ }
    return hybridGapFillPreferencesPure(raw);
}

export function saveHybridGapFillPreferences(preferences) {
    try { localStorage.setItem(GAP_FILL_KEY, JSON.stringify(preferences)); } catch (_) { /* blocked storage */ }
}

export function hybridGuidedPreferencesPure(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    return {
        repeatMode: parsed.repeatMode === GUIDED_REPEAT_MODE_EVERY
            ? GUIDED_REPEAT_MODE_EVERY : GUIDED_REPEAT_MODE_MATCHING,
    };
}

export function loadHybridGuidedPreferences() {
    let raw = null;
    try { raw = localStorage.getItem(GUIDED_KEY); } catch (_) { /* blocked storage */ }
    return hybridGuidedPreferencesPure(raw);
}

export function saveHybridGuidedPreferences(preferences) {
    try { localStorage.setItem(GUIDED_KEY, JSON.stringify(preferences)); } catch (_) { /* blocked storage */ }
}

export function hybridExperimentalPreferencesPure(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const knownProfiles = new Set([
        HYBRID_EXPERIMENTAL_PROFILE_STRICT,
        HYBRID_EXPERIMENTAL_PROFILE_BALANCED,
        HYBRID_EXPERIMENTAL_PROFILE_FILL_MORE,
    ]);
    const currentVersion = Number(parsed.version) === HYBRID_EXPERIMENTAL_PREF_VERSION;
    return {
        // A future/old preference shape may describe materially different
        // rules. Requiring a fresh opt-in is safer than silently changing an
        // automatic merge the user had previously enabled.
        enabled: currentVersion && parsed.enabled === true,
        profile: knownProfiles.has(parsed.profile)
            ? parsed.profile : HYBRID_EXPERIMENTAL_DEFAULTS.profile,
        version: HYBRID_EXPERIMENTAL_PREF_VERSION,
    };
}

export function loadHybridExperimentalPreferences() {
    let raw = null;
    try { raw = localStorage.getItem(EXPERIMENTAL_KEY); } catch (_) { /* blocked storage */ }
    return hybridExperimentalPreferencesPure(raw);
}

export function saveHybridExperimentalPreferences(preferences) {
    const normalized = hybridExperimentalPreferencesPure({
        ...(preferences || {}),
        version: HYBRID_EXPERIMENTAL_PREF_VERSION,
    });
    try { localStorage.setItem(EXPERIMENTAL_KEY, JSON.stringify(normalized)); } catch (_) { /* blocked storage */ }
    return normalized;
}

export function hybridPreviewPreferencesPure(raw) {
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    const tone = HYBRID_PREVIEW_TONES.some(candidate => candidate.id === parsed.tone)
        ? parsed.tone : HYBRID_PREVIEW_DEFAULTS.tone;
    const rawVolume = parsed.volume === null || parsed.volume === undefined
        || typeof parsed.volume === 'boolean' ? Number.NaN : Number(parsed.volume);
    const volume = Number.isFinite(rawVolume)
        ? Math.max(0, Math.min(100, Math.round(rawVolume)))
        : HYBRID_PREVIEW_DEFAULTS.volume;
    const rawZoom = Number(parsed.timelineZoom);
    const timelineZoom = Number.isFinite(rawZoom)
        ? Math.max(HYBRID_TIMELINE_ZOOM_CONTROL_MIN,
            Math.min(HYBRID_TIMELINE_ZOOM_MAX, Math.round(rawZoom)))
        : HYBRID_PREVIEW_DEFAULTS.timelineZoom;
    const timelineDisplayMode = parsed.timelineDisplayMode
            === HYBRID_TIMELINE_DISPLAY_OVERVIEW
        ? HYBRID_TIMELINE_DISPLAY_OVERVIEW : HYBRID_TIMELINE_DISPLAY_NOTES;
    const rawHeights = parsed.laneHeights && typeof parsed.laneHeights === 'object'
        ? parsed.laneHeights : {};
    const laneHeights = {};
    for (const id of ['primary', 'secondary', 'result']) {
        const value = Number(rawHeights[id]);
        laneHeights[id] = Number.isFinite(value)
            ? Math.max(HYBRID_TIMELINE_LANE_MIN,
                Math.min(HYBRID_TIMELINE_LANE_MAX, Math.round(value)))
            : HYBRID_PREVIEW_DEFAULTS.laneHeights[id];
    }
    const followPlayhead = parsed.followPlayhead === undefined
        ? HYBRID_PREVIEW_DEFAULTS.followPlayhead : parsed.followPlayhead !== false;
    return {
        tone,
        volume,
        timelineZoom,
        timelineDisplayMode,
        laneHeights,
        followPlayhead,
    };
}

export function loadHybridPreviewPreferences() {
    let raw = null;
    let version = 0;
    try { raw = localStorage.getItem(PREVIEW_KEY); } catch (_) { /* blocked storage */ }
    try { version = Number(localStorage.getItem(TIMELINE_PREF_VERSION_KEY)) || 0; } catch (_) { /* blocked storage */ }
    const normalized = hybridPreviewPreferencesMigrationPure(raw, version);
    if (version < TIMELINE_PREF_VERSION) {
        try {
            localStorage.setItem(PREVIEW_KEY, JSON.stringify(normalized));
            localStorage.setItem(TIMELINE_PREF_VERSION_KEY, String(TIMELINE_PREF_VERSION));
        } catch (_) { /* blocked storage */ }
    }
    return normalized;
}

export function saveHybridPreviewPreferences(preferences) {
    const normalized = hybridPreviewPreferencesPure(preferences);
    try {
        localStorage.setItem(PREVIEW_KEY, JSON.stringify(normalized));
        localStorage.setItem(TIMELINE_PREF_VERSION_KEY, String(TIMELINE_PREF_VERSION));
    } catch (_) { /* blocked storage */ }
    return normalized;
}

// Continuous range/zoom input should update the live preview immediately but
// must not synchronously serialize localStorage for every pointer event. This
// small writer is DOM-free so the resolver can debounce persistence and still
// flush deterministically on change, close, or teardown.
export function createHybridPreferenceWriter(save, {
    delay = 160,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = timer => clearTimeout(timer),
} = {}) {
    if (typeof save !== 'function') throw new TypeError('A Hybrid preference save function is required');
    let timer = null;
    let pending = null;
    const flush = () => {
        if (timer !== null) clearTimer(timer);
        timer = null;
        if (pending === null) return null;
        const value = pending;
        pending = null;
        return save(value);
    };
    return {
        schedule(value) {
            pending = value;
            if (timer !== null) clearTimer(timer);
            timer = setTimer(flush, Math.max(0, Number(delay) || 0));
            return value;
        },
        flush,
        cancel() {
            if (timer !== null) clearTimer(timer);
            timer = null;
            pending = null;
        },
        pending() { return pending !== null; },
    };
}

export function hybridPreviewPreferencesMigrationPure(raw, version = 0) {
    if (Number(version) >= TIMELINE_PREF_VERSION) return hybridPreviewPreferencesPure(raw);
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object') parsed = {};
    if (Number(version) >= 2) {
        const previousZoom = Number(parsed.timelineZoom);
        const legacyOverview = Number.isFinite(previousZoom)
            && previousZoom < HYBRID_TIMELINE_ZOOM_CONTROL_MIN;
        return hybridPreviewPreferencesPure({
            ...parsed,
            timelineZoom: legacyOverview
                ? HYBRID_PREVIEW_DEFAULTS.timelineZoom : parsed.timelineZoom,
            timelineDisplayMode: legacyOverview
                ? HYBRID_TIMELINE_DISPLAY_OVERVIEW : HYBRID_TIMELINE_DISPLAY_NOTES,
        });
    }
    return hybridPreviewPreferencesPure({
        ...parsed,
        timelineZoom: HYBRID_PREVIEW_DEFAULTS.timelineZoom,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
    });
}
