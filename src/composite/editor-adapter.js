/* Hybrid Track boundary to the normal Editor.
 *
 * The planner, resolver, and review UI should not know how the Editor stores
 * arrangements, selects a track, refreshes its chrome, or commits history.
 * Keep those product-level details in this deliberately small adapter.
 */

import { host } from '../host.js';
import { arrKind } from '../instrument.js';
import { timeOf } from '../beats.js';
import { stopPlayback } from '../audio.js';
import { _setBarSel, _setLoopRegionEnabled } from '../loop.js';
import { S } from '../state.js';
import { setStatus } from '../ui.js';

function editorState(bindings = {}) {
    return bindings.state || S;
}

function editorHost(bindings = {}) {
    return bindings.host || host;
}

function editorDocument(bindings = {}) {
    return Object.prototype.hasOwnProperty.call(bindings, 'document')
        ? bindings.document : globalThis.document;
}

// References are intentional: analysis already sends a structured-cloned
// payload to its Worker, while setup/name checks should stay constant-time.
export function readCompositeEditorSnapshot(state = S) {
    const arrangements = Array.isArray(state.arrangements) ? state.arrangements : [];
    return {
        arrangements,
        beats: Array.isArray(state.beats) ? state.beats : [],
        sections: Array.isArray(state.sections) ? state.sections : [],
        sessionId: state.sessionId,
        format: state.format,
        currentIndex: Number.isInteger(state.currentArr) ? state.currentArr : 0,
    };
}

export function readCompositeAnalysisSnapshot(primaryIndex, secondaryIndex, state = S) {
    const editor = readCompositeEditorSnapshot(state);
    return {
        ...editor,
        primaryIndex,
        secondaryIndex,
        primary: editor.arrangements[primaryIndex],
        secondary: editor.arrangements[secondaryIndex],
    };
}

export function compositeEditorSessionIsCurrent(sessionId, state = S) {
    return state.sessionId === sessionId;
}

export function compositeEditorArrangementNameTaken(name, state = S) {
    const wanted = String(name || '').trim().toLowerCase();
    return readCompositeEditorSnapshot(state).arrangements.some(arrangement =>
        String(arrangement?.name || '').trim().toLowerCase() === wanted);
}

export function compositeEditorContainsArrangement(arrangement, state = S) {
    return readCompositeEditorSnapshot(state).arrangements.includes(arrangement);
}

export function setCompositeEditorStatus(message, reporter = setStatus) {
    reporter(message);
}

// The Hybrid preview owns a separate AudioContext and transport. This is the
// only ordinary-preview bridge into the Editor transport: stop any unrelated
// Editor playback before the private audition starts, without borrowing its
// clock, cursor, loop, mixer, or guide policy.
export function stopCompositeEditorPlayback(state = S, stop = stopPlayback) {
    if (!state.playing) return false;
    stop();
    return true;
}

function compositeAudioSources(state, editor) {
    const removed = new Set(Array.isArray(state.trackSession?.removedSourceIds)
        ? state.trackSession.removedSourceIds.map(String) : []);
    const activeId = typeof state.activeAudioSourceId === 'string'
        ? state.activeAudioSourceId : 'master';
    const masterUrl = state.masterAudioUrl
        || (activeId === 'master' ? state.audioUrl : '') || '';
    const sourceRows = [];
    if (!removed.has('master') && (masterUrl || activeId === 'master' && state.audioBuffer)) {
        sourceRows.push({ id: 'master', url: masterUrl, offset: 0 });
    }
    for (const source of Array.isArray(state.stems) ? state.stems : []) {
        const id = typeof source?.id === 'string' ? source.id : '';
        const url = typeof source?.url === 'string' ? source.url : '';
        if (!id || removed.has(id) || sourceRows.some(candidate => candidate.id === id)) continue;
        if (!url && !(id === activeId && state.audioBuffer)) continue;
        sourceRows.push({ ...source, id, url, offset: Number(source.offset) || 0 });
    }
    return sourceRows.map(source => {
        const strip = editor.partStripState?.(`audio:${source.id}`) || {};
        return {
            ...source,
            buffer: source.id === activeId ? state.audioBuffer || null : source.buffer || null,
            mix: {
                gain: Number.isFinite(Number(strip.vol)) ? Number(strip.vol) : 1,
                audible: strip.audible !== false,
                solo: strip.solo === true,
            },
        };
    });
}

// Snapshot the public song/audio metadata needed by the feature-owned
// reference mixer. No private Editor audio nodes, clocks, caches, or gain
// objects cross this seam; inactive sources are decoded by the feature from
// their URLs while the active decoded buffer is reused by identity.
export function readCompositePreviewAudioSnapshot(state = S, editor = host) {
    const sources = compositeAudioSources(state, editor);
    const activeOffset = Number(state.activeAudioSourceOffset) || 0;
    const audioShift = Number(state.audioShift) || 0;
    const activeBuffer = state.audioBuffer || null;
    const activeEnd = activeBuffer
        ? Math.max(0, Number(activeBuffer.duration) + audioShift + activeOffset) : 0;
    return {
        available: sources.length > 0,
        activeBuffer,
        waveformPeaks: state.waveformPeaks || null,
        activeSourceOffset: activeOffset,
        audioShift,
        duration: Math.max(0, Number(state.duration) || 0,
            Number(state.masterAudioDuration) || 0, activeEnd),
        reference: {
            sources,
            removedSourceIds: Array.isArray(state.trackSession?.removedSourceIds)
                ? state.trackSession.removedSourceIds : [],
            tracks: Array.isArray(state.trackSession?.tracks)
                ? state.trackSession.tracks : [],
            activeSourceId: typeof state.activeAudioSourceId === 'string'
                ? state.activeAudioSourceId : 'master',
            activeBuffer,
            activeUrl: typeof state.audioUrl === 'string' ? state.audioUrl : '',
            audioShift,
            duration: Math.max(0, Number(state.duration) || 0,
                Number(state.masterAudioDuration) || 0, activeEnd),
            beatToTime: beat => timeOf(state.beats, beat),
        },
    };
}

// Deliberate one-way handoff requested by the user. Ordinary Hybrid preview
// never calls this; only "Keep loop in editor" mutates the normal Editor loop.
export function keepCompositeEditorLoop(region, {
    state = S,
    editor = host,
    setRegion = _setBarSel,
    setEnabled = _setLoopRegionEnabled,
} = {}) {
    if (!region || !(Number(region.endTime) > Number(region.startTime))) return false;
    setRegion({ ...region });
    editor.editorSeekToTime(Math.max(0, Number(region.startTime) || 0));
    setEnabled(true);
    return !!state.loopEnabled;
}

export function clearCompositeEditorSelection(state = S) {
    state.sel.clear();
    state.toneSel = null;
    state.anchorSel = null;
    state.handshapeSel = null;
    state.drumEditMode = false;
    state.partsViewMode = false;
    state.tempoMapMode = false;
    state.tabViewMode = false;
}

function refreshCompositeEditorArrangement(state, editor, doc) {
    editor.updateArrangementSelector();
    const selector = doc?.getElementById?.('editor-arrangement');
    if (selector) selector.value = String(state.currentArr);
    editor.updateStatus();
    editor.draw();
}

export class CreateCompositeArrangementCmd {
    constructor(arrangement, bindings = {}) {
        this.arrangement = arrangement;
        this.bindings = bindings;
        this.previousArr = editorState(bindings).currentArr;
        this.insertIndex = -1;
        this.songScope = true;
    }

    exec() {
        const state = editorState(this.bindings);
        const arrangements = readCompositeEditorSnapshot(state).arrangements;
        const drumIndex = arrangements.findIndex(arrangement => arrKind(arrangement) === 'drums');
        this.insertIndex = drumIndex >= 0 ? drumIndex : arrangements.length;
        arrangements.splice(this.insertIndex, 0, this.arrangement);
        state.currentArr = this.insertIndex;
        clearCompositeEditorSelection(state);
        refreshCompositeEditorArrangement(
            state, editorHost(this.bindings), editorDocument(this.bindings));
    }

    rollback() {
        const state = editorState(this.bindings);
        const arrangements = readCompositeEditorSnapshot(state).arrangements;
        const index = arrangements.indexOf(this.arrangement);
        if (index >= 0) arrangements.splice(index, 1);
        state.currentArr = Math.max(0, Math.min(this.previousArr, arrangements.length - 1));
        clearCompositeEditorSelection(state);
        refreshCompositeEditorArrangement(
            state, editorHost(this.bindings), editorDocument(this.bindings));
    }
}

export function commitCompositeArrangement(arrangement, bindings = {}) {
    const command = new CreateCompositeArrangementCmd(arrangement, bindings);
    editorState(bindings).history.exec(command);
    return command;
}
