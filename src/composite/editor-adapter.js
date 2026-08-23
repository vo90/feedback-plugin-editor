/* Hybrid Track boundary to the normal Editor.
 *
 * The planner, resolver, and review UI should not know how the Editor stores
 * arrangements, selects a track, refreshes its chrome, or commits history.
 * Keep those product-level details in this deliberately small adapter.
 */

import { host } from '../host.js';
import { arrKind } from '../instrument.js';
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

export function seekCompositeEditorTime(time, editor = host) {
    editor.editorSeekToTime(time);
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
