import assert from 'node:assert/strict';
import test from 'node:test';

import {
    _compositeEligibleSourcesPure,
    _compositeGapFillPreferencesPure,
    _compositeUniqueNamePure,
    CreateCompositeArrangementCmd,
} from '../src/composite/resolver-ui.js';
import { host } from '../src/host.js';
import { S } from '../src/state.js';

test('eligible composite sources are fretted arrangements with original indices', () => {
    const arrangements = [
        { name: 'Lead', type: 'guitar' },
        { name: 'Keys', type: 'piano' },
        { name: 'Drums', type: 'drums' },
        { name: 'Bass', type: 'bass' },
    ];
    assert.deepEqual(_compositeEligibleSourcesPure(arrangements).map(source => source.index), [0, 3]);
});

test('composite names are unique without changing their instrument-readable prefix', () => {
    assert.equal(_compositeUniqueNamePure(['Lead', 'Rhythm']), 'Hybrid Guitar');
    assert.equal(_compositeUniqueNamePure(['Hybrid Guitar']), 'Hybrid Guitar 2');
    assert.equal(_compositeUniqueNamePure(['hybrid guitar', 'HYBRID GUITAR 2']), 'Hybrid Guitar 3');
});

test('composite Gap Fill preferences remember separate beat and second values', () => {
    assert.deepEqual(_compositeGapFillPreferencesPure(null), {
        unit: 'beats',
        beats: { minimumGap: 1, transitionMargin: 0.25 },
        seconds: { minimumGap: 0.5, transitionMargin: 0.125 },
    });
    assert.deepEqual(_compositeGapFillPreferencesPure(JSON.stringify({
        unit: 'seconds',
        beats: { minimumGap: 2, transitionMargin: 0.5 },
        seconds: { minimumGap: 0.8, transitionMargin: 0.2 },
    })), {
        unit: 'seconds',
        beats: { minimumGap: 2, transitionMargin: 0.5 },
        seconds: { minimumGap: 0.8, transitionMargin: 0.2 },
    });
});

test('composite creation inserts before drums and rolls back without touching sources', t => {
    const before = {
        arrangements: S.arrangements,
        currentArr: S.currentArr,
        document: globalThis.document,
        hooks: {
            updateArrangementSelector: host.updateArrangementSelector,
            updateStatus: host.updateStatus,
            draw: host.draw,
        },
    };
    t.after(() => {
        S.arrangements = before.arrangements;
        S.currentArr = before.currentArr;
        globalThis.document = before.document;
        Object.assign(host, before.hooks);
    });

    const lead = { name: 'Lead', type: 'guitar', notes: [] };
    const drums = { name: 'Drums', type: 'drums' };
    const hybrid = { name: 'Hybrid', type: 'guitar', notes: [] };
    S.arrangements = [lead, drums];
    S.currentArr = 0;
    globalThis.document = { getElementById: () => null };
    Object.assign(host, { updateArrangementSelector() {}, updateStatus() {}, draw() {} });

    const command = new CreateCompositeArrangementCmd(hybrid);
    command.exec();
    assert.deepEqual(S.arrangements, [lead, hybrid, drums]);
    assert.equal(S.currentArr, 1);

    command.rollback();
    assert.deepEqual(S.arrangements, [lead, drums]);
    assert.equal(S.currentArr, 0);

    command.exec();
    assert.deepEqual(S.arrangements, [lead, hybrid, drums]);
    assert.equal(S.currentArr, 1);
});
