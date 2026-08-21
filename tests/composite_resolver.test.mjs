import assert from 'node:assert/strict';
import test from 'node:test';

import {
    _compositeEligibleSourcesPure,
    _compositeAutomaticSummaryPure,
    _compositeAutomaticOverviewPure,
    _compositeGapFillPreferencesPure,
    _compositeGuidedPreferencesPure,
    _compositePreviewPreferencesPure,
    _compositeUniqueNamePure,
    CreateCompositeArrangementCmd,
    HYBRID_DIALOG_STYLE,
} from '../src/composite/resolver-ui.js';
import { HYBRID_PREVIEW_TONES } from '../src/composite/preferences.js';
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

test('Hybrid review workspace grows with the app and remains manually resizable', () => {
    assert.match(HYBRID_DIALOG_STYLE, /width:calc\(100vw - 2rem\)/);
    assert.match(HYBRID_DIALOG_STYLE, /height:calc\(100vh - 2rem\)/);
    assert.match(HYBRID_DIALOG_STYLE, /resize:both/);
    assert.match(HYBRID_DIALOG_STYLE, /max-width:calc\(100vw - 1rem\)/);
    assert.doesNotMatch(HYBRID_DIALOG_STYLE, /90rem|54rem/);
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

test('Guided repetition preferences default safely and remember grouped review', () => {
    assert.deepEqual(_compositeGuidedPreferencesPure(null), {
        repeatMode: 'matching-repetitions',
    });
    assert.deepEqual(_compositeGuidedPreferencesPure(JSON.stringify({
        repeatMode: 'matching-repetitions',
    })), {
        repeatMode: 'matching-repetitions',
    });
    assert.deepEqual(_compositeGuidedPreferencesPure('{broken'), {
        repeatMode: 'matching-repetitions',
    });
});

test('Hybrid audition preferences remember a safe shared tone and volume', () => {
    assert.deepEqual(_compositePreviewPreferencesPure(null), { tone: 'clean', volume: 75 });
    assert.deepEqual(_compositePreviewPreferencesPure('{broken'), { tone: 'clean', volume: 75 });
    assert.deepEqual(_compositePreviewPreferencesPure({ tone: 'edge', volume: 82.6 }), {
        tone: 'edge', volume: 83,
    });
    assert.deepEqual(_compositePreviewPreferencesPure({ tone: 'unknown', volume: 999 }), {
        tone: 'clean', volume: 100,
    });
    assert.deepEqual(_compositePreviewPreferencesPure({ tone: 'distortion', volume: null }), {
        tone: 'distortion', volume: 75,
    });
});

test('Hybrid audition exposes the three level-matched local guitar programs', () => {
    assert.deepEqual(HYBRID_PREVIEW_TONES.map(({ id, label, gm }) => ({ id, label, gm })), [
        { id: 'clean', label: 'Clean', gm: 27 },
        { id: 'edge', label: 'Edge', gm: 29 },
        { id: 'distortion', label: 'Distortion', gm: 30 },
    ]);
    assert.ok(Math.abs(20 * Math.log10(HYBRID_PREVIEW_TONES[1].trimGain) + 3.25) < 1e-9);
    assert.ok(Math.abs(20 * Math.log10(HYBRID_PREVIEW_TONES[2].trimGain) + 4.62) < 1e-9);
});

test('automatic result summary uses player-facing track names and outcomes', () => {
    assert.deepEqual(_compositeAutomaticSummaryPure({
        secondaryAddedCleanly: 1,
        secondarySkippedByStrategy: 2,
    }, { primary: 'Lead', secondary: 'Rhythm' }), {
        title: 'Ready to create',
        description: 'Lead stays unchanged. 1 Rhythm note was added in safe gaps. 2 Rhythm notes were left out because they were too close to Lead.',
        added: 1,
        skipped: 2,
    });
});

test('automatic overview renders visible, escaped fill-note marks', () => {
    const html = _compositeAutomaticOverviewPure({
        sourceEntries: {
            primary: [{ startBeat: 0, endBeat: 1 }],
            secondary: [{ startBeat: 8, endBeat: 9 }],
        },
        fixedEntries: [{ source: 'secondary', startBeat: 4, endBeat: 5 }],
    }, { secondary: '<Rhythm>' });
    assert.match(html, /min-width:3px;background:#c084fc/);
    assert.match(html, /left:44\.444/);
    assert.match(html, /Added from &lt;Rhythm&gt;/);
    assert.doesNotMatch(html, /Added from <Rhythm>/);
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
