import assert from 'node:assert/strict';
import test from 'node:test';

import {
    commitCompositeArrangement,
    compositeEditorArrangementNameTaken,
    compositeEditorContainsArrangement,
    compositeEditorSessionIsCurrent,
    CreateCompositeArrangementCmd,
    keepCompositeEditorLoop,
    readCompositeAnalysisSnapshot,
    readCompositeEditorSnapshot,
    readCompositePreviewAudioSnapshot,
    setCompositeEditorStatus,
    stopCompositeEditorPlayback,
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

test('Hybrid status bridge delegates without exposing its Editor owner', () => {
    const statuses = [];
    setCompositeEditorStatus('Ready', message => statuses.push(message));
    assert.deepEqual(statuses, ['Ready']);
});

test('Hybrid audio snapshot exposes plain reference metadata and reuses only the active buffer', () => {
    const activeBuffer = { duration: 12 };
    const state = fakeState({
        beats: [{ time: 0 }, { time: 1 }],
        duration: 10,
        audioShift: 0.5,
        activeAudioSourceId: 'rhythm',
        activeAudioSourceOffset: 0.25,
        audioUrl: '/rhythm.ogg',
        audioBuffer: activeBuffer,
        waveformPeaks: { rms: [0.1] },
        masterAudioUrl: '/master.ogg',
        masterAudioDuration: 11,
        stems: [{ id: 'rhythm', url: '/rhythm.ogg', offset: 0.25 }],
        trackSession: {
            tracks: [{ type: 'audio', sourceId: 'rhythm', regions: [] }],
            removedSourceIds: [],
        },
    });
    const snapshot = readCompositePreviewAudioSnapshot(state, {
        partStripState: key => key === 'audio:rhythm'
            ? { audible: true, vol: 0.6, solo: true }
            : { audible: true, vol: 0.8, solo: false },
    });

    assert.equal(snapshot.available, true);
    assert.equal(snapshot.activeBuffer, activeBuffer);
    assert.equal(snapshot.duration, 12.75);
    assert.equal(snapshot.reference.sources.length, 2);
    assert.equal(snapshot.reference.sources[0].id, 'master');
    assert.equal(snapshot.reference.sources[0].buffer, null);
    assert.equal(snapshot.reference.sources[1].buffer, activeBuffer);
    assert.deepEqual(snapshot.reference.sources[1].mix, {
        gain: 0.6, audible: true, solo: true,
    });
    assert.equal(snapshot.reference.beatToTime(1), 1);
});

test('Hybrid transport bridge only stops active Editor playback', () => {
    const calls = [];
    assert.equal(stopCompositeEditorPlayback({ playing: false }, () => calls.push('stop')), false);
    assert.equal(stopCompositeEditorPlayback({ playing: true }, () => calls.push('stop')), true);
    assert.deepEqual(calls, ['stop']);
});

test('Keep Editor loop is the explicit loop mutation bridge', () => {
    const calls = [];
    const state = { loopEnabled: false };
    const region = { startTime: 2, endTime: 4, mode: 'bar' };
    const kept = keepCompositeEditorLoop(region, {
        state,
        editor: { editorSeekToTime: time => calls.push(['seek', time]) },
        setRegion: value => calls.push(['region', value]),
        setEnabled: enabled => {
            state.loopEnabled = enabled;
            calls.push(['enabled', enabled]);
        },
    });
    assert.equal(kept, true);
    assert.deepEqual(calls, [
        ['region', region], ['seek', 2], ['enabled', true],
    ]);
    assert.notEqual(calls[0][1], region, 'the Editor receives its own region object');
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
