/* Pure markup for the Hybrid Track setup screen. */

import { GUIDED_REPEAT_MODE_EVERY, GUIDED_REPEAT_MODE_MATCHING } from './guided-engine.js';

function escapeMarkup(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function optionMarkup(source) {
    const name = source.arrangement.name || `Track ${source.index + 1}`;
    return `<option value="${source.index}">${escapeMarkup(name)}</option>`;
}

export function renderHybridSetupView({
    sources = [], name = 'Hybrid Guitar', gapFillUnit = 'beats', gapFillValues = {},
    guidedRepeatMode = GUIDED_REPEAT_MODE_MATCHING,
} = {}) {
    const options = sources.map(optionMarkup).join('');
    return `<section id="editor-composite-setup" class="p-5 overflow-y-auto"><div class="max-w-5xl mx-auto space-y-5">`
        + `<section><h4 class="text-base font-semibold">1. Choose the tracks and name the result</h4><p class="text-sm text-gray-400 mt-1">The base track is kept. The fill track supplies the extra or alternative parts.</p>`
        + `<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">`
        + `<label class="block rounded-lg border border-sky-800/60 bg-sky-950/20 p-3 text-sm text-sky-100"><b>Base track — always kept</b><select id="editor-composite-primary" class="mt-2 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm">${options}</select></label>`
        + `<label class="block rounded-lg border border-violet-800/60 bg-violet-950/20 p-3 text-sm text-violet-100"><b>Fill track</b><select id="editor-composite-secondary" class="mt-2 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm">${options}</select></label>`
        + `<label class="block rounded-lg border border-gray-700 bg-dark-900/40 p-3 text-sm text-gray-200"><b>New Hybrid Track name</b><input id="editor-composite-name" maxlength="60" value="${escapeMarkup(name)}" class="mt-2 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"></label></div></section>`
        + `<fieldset><legend class="text-base font-semibold">2. Choose how to build the hybrid</legend><div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">`
        + `<label data-composite-mode-card="gap-fill" class="cursor-pointer rounded-xl border border-accent bg-sky-950/25 p-4 hover:border-sky-400"><span class="flex items-start gap-3"><input type="radio" name="editor-composite-strategy" value="gap-fill" checked class="mt-1 accent-accent"><span><b class="block text-base text-white">Automatic</b><span class="block text-sm text-gray-300 mt-1">Keep the base track and add fill-track notes only where the complete notes and trails fit safely.</span><span class="block text-xs text-emerald-300 mt-2">Fastest · no section-by-section choices</span></span></span></label>`
        + `<label data-composite-mode-card="guided" class="cursor-pointer rounded-xl border border-gray-600 bg-dark-700/50 p-4 hover:border-violet-400"><span class="flex items-start gap-3"><input type="radio" name="editor-composite-strategy" value="guided" class="mt-1 accent-accent"><span><b class="block text-base text-white">Review sections yourself</b><span class="block text-sm text-gray-300 mt-1">The song is divided into musical sections. Choose the base track, fill track, or a manual mix where they differ.</span><span class="block text-xs text-violet-300 mt-2">More control · repeated riffs can share one choice</span></span></span></label>`
        + `</div></fieldset>`
        + `<section id="editor-composite-guided-controls" hidden class="rounded-lg border border-gray-700 bg-dark-900/50 p-4"><h4 class="text-sm font-semibold">Repeated riffs</h4>`
        + `<label class="block text-sm text-gray-300 mt-2">How should repeated sections be reviewed?<select id="editor-composite-repeat-mode" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"><option value="${GUIDED_REPEAT_MODE_MATCHING}"${guidedRepeatMode === GUIDED_REPEAT_MODE_MATCHING ? ' selected' : ''}>Review matching riffs once (recommended)</option><option value="${GUIDED_REPEAT_MODE_EVERY}"${guidedRepeatMode === GUIDED_REPEAT_MODE_EVERY ? ' selected' : ''}>Review every occurrence separately</option></select></label>`
        + `<p class="text-xs text-gray-400 mt-2">When the same playable riff appears again, one choice can be reused. Every copy still gets its own playability check.</p></section>`
        + `<details id="editor-composite-gap-controls" class="rounded-lg border border-gray-700 bg-dark-900/50 p-4"><summary class="cursor-pointer text-sm font-semibold hover:text-white">Advanced safety settings</summary>`
        + `<div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3"><label class="block text-sm text-gray-300">Timing unit<select id="editor-composite-gap-unit" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"><option value="beats"${gapFillUnit === 'beats' ? ' selected' : ''}>Beats — follows song tempo</option><option value="seconds"${gapFillUnit === 'seconds' ? ' selected' : ''}>Seconds — fixed real time</option></select></label>`
        + `<label class="block text-sm text-gray-300"><span id="editor-composite-min-gap-label">Smallest gap to fill (${gapFillUnit})</span><input id="editor-composite-min-gap" type="number" min="0" value="${gapFillValues.minimumGap}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"></label>`
        + `<label class="block text-sm text-gray-300"><span id="editor-composite-margin-label">Extra space before and after (${gapFillUnit})</span><input id="editor-composite-margin" type="number" min="0" value="${gapFillValues.transitionMargin}" class="mt-1 w-full bg-dark-700 border border-gray-600 rounded px-3 py-2 text-sm"></label></div>`
        + `<p class="text-xs text-gray-400 mt-2">A fill-track note is added only when its entire chord, trail, and connected technique fit between base-track parts.</p></details>`
        + `</div></section>`;
}
