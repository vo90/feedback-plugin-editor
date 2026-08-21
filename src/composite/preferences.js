/* Persisted Hybrid Track setup preferences. */

import { normalizeCompositeGapFillOptions } from './gap-fill-engine.js';
import { GUIDED_REPEAT_MODE_EVERY, GUIDED_REPEAT_MODE_MATCHING } from './guided-engine.js';

const GAP_FILL_KEY = 'editorCompositeGapFill';
const GUIDED_KEY = 'editorCompositeGuided';

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
