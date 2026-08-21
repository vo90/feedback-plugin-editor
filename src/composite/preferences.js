/* Persisted Hybrid Track setup preferences. */

import { normalizeCompositeGapFillOptions } from './gap-fill-engine.js';
import { GUIDED_REPEAT_MODE_EVERY, GUIDED_REPEAT_MODE_MATCHING } from './guided-engine.js';

const GAP_FILL_KEY = 'editorCompositeGapFill';
const GUIDED_KEY = 'editorCompositeGuided';
const PREVIEW_KEY = 'editorCompositePreview';

export const HYBRID_PREVIEW_DEFAULTS = Object.freeze({ tone: 'clean', volume: 75 });

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
    return { tone, volume };
}

export function loadHybridPreviewPreferences() {
    let raw = null;
    try { raw = localStorage.getItem(PREVIEW_KEY); } catch (_) { /* blocked storage */ }
    return hybridPreviewPreferencesPure(raw);
}

export function saveHybridPreviewPreferences(preferences) {
    const normalized = hybridPreviewPreferencesPure(preferences);
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(normalized)); } catch (_) { /* blocked storage */ }
    return normalized;
}
