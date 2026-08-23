import assert from 'node:assert/strict';
import test from 'node:test';

import {
    commitCompositeArrangement,
    compositeEditorArrangementNameTaken,
    compositeEditorContainsArrangement,
    compositeEditorSessionIsCurrent,
    CreateCompositeArrangementCmd,
    readCompositeAnalysisSnapshot,
    readCompositeEditorSnapshot,
    seekCompositeEditorTime,
    setCompositeEditorStatus,
} from '../src/composite/editor-adapter.js';

function fakeState(overrides = {}) {
    return {
        arrangements: [],
        beats: [],
        sections: [],
        sessionId: 'song-a',
        format: 'sloppak',
        currentArr: 0,
        sel: new Set(),
        toneSel: null,
        anchorSel: null,
        handshapeSel: null,
        drumEditMode: false,
        partsViewMode: false,
        tempoMapMode: false,
        tabViewMode: false,
        ...overrides,
    };
}

function fakeHost(calls) {
    return {
        updateArrangementSelector() { calls.push('selector'); },
        updateStatus() { calls.push('status'); },
        draw() { calls.push('draw'); },
    };
}

test('Hybrid Editor snapshots expose only the project references analysis needs', () => {
    const lead = { name: 'Lead' };
    const rhythm = { name: 'Rhythm' };
    const state = fakeState({
        arrangements: [lead, rhythm],
        beats: [{ time: 0 }],
        sections: [{ name: 'verse' }],
        currentArr: 1,
    });

    const editor = readCompositeEditorSnapshot(state);
    assert.equal(editor.arrangements, state.arrangements);
    assert.equal(editor.beats, state.beats);
    assert.equal(editor.sections, state.sections);
    assert.equal(editor.sessionId, 'song-a');
    assert.equal(editor.format, 'sloppak');
    assert.equal(editor.currentIndex, 1);

    const analysis = readCompositeAnalysisSnapshot(1, 0, state);
    assert.equal(analysis.primary, rhythm);
    assert.equal(analysis.secondary, lead);
    assert.equal(analysis.arrangements, state.arrangements);
});

test('Hybrid Editor identity and name checks stay behind the adapter', () => {
    const lead = { name: 'Lead' };
    const state = fakeState({ arrangements: [lead, { name: 'Hybrid Guitar' }] });
    assert.equal(compositeEditorSessionIsCurrent('song-a', state), true);
    assert.equal(compositeEditorSessionIsCurrent('song-b', state), false);
    assert.equal(compositeEditorContainsArrangement(lead, state), true);
    assert.equal(compositeEditorContainsArrangement({ name: 'Lead' }, state), false);
    assert.equal(compositeEditorArrangementNameTaken(' hybrid guitar ', state), true);
    assert.equal(compositeEditorArrangementNameTaken('Hybrid Guitar 2', state), false);
});

test('Hybrid status and seek bridges delegate without exposing their Editor owners', () => {
    const statuses = [];
    const seeks = [];
    setCompositeEditorStatus('Ready', message => statuses.push(message));
    seekCompositeEditorTime(12.5, { editorSeekToTime: time => seeks.push(time) });
    assert.deepEqual(statuses, ['Ready']);
    assert.deepEqual(seeks, [12.5]);
});

test('Hybrid arrangement command inserts before drums, clears selection, and rolls back', () => {
    const lead = { name: 'Lead', type: 'guitar' };
    const drums = { name: 'Drums', type: 'drums' };
    const hybrid = { name: 'Hybrid', type: 'guitar' };
    const state = fakeState({
        arrangements: [lead, drums],
        sel: new Set([3]),
        toneSel: {},
        anchorSel: {},
        handshapeSel: {},
        drumEditMode: true,
        partsViewMode: true,
        tempoMapMode: true,
        tabViewMode: true,
    });
    const calls = [];
    const selector = { value: '' };
    const bindings = {
        state,
        host: fakeHost(calls),
        document: { getElementById: id => id === 'editor-arrangement' ? selector : null },
    };

    const command = new CreateCompositeArrangementCmd(hybrid, bindings);
    command.exec();
    assert.deepEqual(state.arrangements, [lead, hybrid, drums]);
    assert.equal(state.currentArr, 1);
    assert.equal(selector.value, '1');
    assert.equal(state.sel.size, 0);
    assert.equal(state.toneSel, null);
    assert.equal(state.anchorSel, null);
    assert.equal(state.handshapeSel, null);
    assert.equal(state.drumEditMode, false);
    assert.equal(state.partsViewMode, false);
    assert.equal(state.tempoMapMode, false);
    assert.equal(state.tabViewMode, false);
    assert.deepEqual(calls, ['selector', 'status', 'draw']);

    command.rollback();
    assert.deepEqual(state.arrangements, [lead, drums]);
    assert.equal(state.currentArr, 0);
    assert.equal(selector.value, '0');
    assert.deepEqual(calls, [
        'selector', 'status', 'draw',
        'selector', 'status', 'draw',
    ]);
});

test('Hybrid final commit enters normal Editor history as one song-scoped command', () => {
    const hybrid = { name: 'Hybrid', type: 'guitar' };
    const calls = [];
    let committed = null;
    const state = fakeState();
    state.history = {
        exec(command) {
            committed = command;
            command.exec();
        },
    };
    const command = commitCompositeArrangement(hybrid, {
        state,
        host: fakeHost(calls),
        document: null,
    });

    assert.equal(command, committed);
    assert.equal(command.songScope, true);
    assert.deepEqual(state.arrangements, [hybrid]);
    assert.deepEqual(calls, ['selector', 'status', 'draw']);
});
