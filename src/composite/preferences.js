/* Persisted Hybrid Track setup preferences. */

import { normalizeCompositeGapFillOptions } from './gap-fill-engine.js';
import { GUIDED_REPEAT_MODE_EVERY, GUIDED_REPEAT_MODE_MATCHING } from './guided-engine.js';
import {
    HYBRID_PREVIEW_DEFAULTS,
    HYBRID_PREVIEW_TONES,
    HYBRID_TIMELINE_DISPLAY_NOTES,
    HYBRID_TIMELINE_DISPLAY_OVERVIEW,
    HYBRID_TIMELINE_FOLLOW_CENTERED,
    HYBRID_TIMELINE_FOLLOW_OFF,
    HYBRID_TIMELINE_FOLLOW_PAGED,
    HYBRID_TIMELINE_LANE_MAX,
    HYBRID_TIMELINE_LANE_MIN,
    HYBRID_TIMELINE_ZOOM_CONTROL_MIN,
    HYBRID_TIMELINE_ZOOM_MAX,
} from './hybrid-options.js';

// Compatibility facade for existing resolver and test imports. New playback
// and timeline consumers should import the dependency-free leaf directly.
export * from './hybrid-options.js';

const GAP_FILL_KEY = 'editorCompositeGapFill';
const GUIDED_KEY = 'editorCompositeGuided';
const PREVIEW_KEY = 'editorCompositePreview';
const DIALOG_SIZE_KEY = 'editorCompositeDialogSize';
const TIMELINE_PREF_VERSION_KEY = 'editorCompositeTimelineVersion';
const TIMELINE_PREF_VERSION = 4;

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
    const timelineFollowMode = [
        HYBRID_TIMELINE_FOLLOW_CENTERED,
        HYBRID_TIMELINE_FOLLOW_PAGED,
        HYBRID_TIMELINE_FOLLOW_OFF,
    ].includes(parsed.timelineFollowMode)
        ? parsed.timelineFollowMode : HYBRID_PREVIEW_DEFAULTS.timelineFollowMode;
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
    return {
        tone,
        volume,
        timelineZoom,
        timelineDisplayMode,
        laneHeights,
        timelineFollowMode,
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
    const timelineFollowMode = Object.hasOwn(parsed, 'timelineFollowMode')
        ? parsed.timelineFollowMode
        : parsed.followPlayhead === false
            ? HYBRID_TIMELINE_FOLLOW_OFF : HYBRID_TIMELINE_FOLLOW_CENTERED;
    const migrated = { ...parsed, timelineFollowMode };
    delete migrated.followPlayhead;
    if (Number(version) >= 3) return hybridPreviewPreferencesPure(migrated);
    if (Number(version) >= 2) {
        const previousZoom = Number(parsed.timelineZoom);
        const legacyOverview = Number.isFinite(previousZoom)
            && previousZoom < HYBRID_TIMELINE_ZOOM_CONTROL_MIN;
        return hybridPreviewPreferencesPure({
            ...migrated,
            timelineZoom: legacyOverview
                ? HYBRID_PREVIEW_DEFAULTS.timelineZoom : parsed.timelineZoom,
            timelineDisplayMode: legacyOverview
                ? HYBRID_TIMELINE_DISPLAY_OVERVIEW : HYBRID_TIMELINE_DISPLAY_NOTES,
        });
    }
    return hybridPreviewPreferencesPure({
        ...migrated,
        timelineZoom: HYBRID_PREVIEW_DEFAULTS.timelineZoom,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
    });
}
