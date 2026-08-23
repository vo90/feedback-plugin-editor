import assert from 'node:assert/strict';
import test from 'node:test';

import {
    _compositeEligibleSourcesPure,
    _compositeAutomaticSummaryPure,
    _compositeAutomaticOverviewPure,
    _compositeAnalysisConfigEqualPure,
    _compositeDefaultNameForSourcePure,
    _compositeExperimentalPreferencesPure,
    _compositeExperimentalPassageInspectorPure,
    _compositeExperimentalSummaryPure,
    _compositeGapFillPreferencesPure,
    _compositeGuidedPreferencesPure,
    _compositeModalShortcutPure,
    _compositePreviewPreferencesPure,
    _compositeReviewContinueLabelPure,
    _compositeSourcePairStatePure,
    _compositeTimelineStageActivePure,
    _compositeTimelineZoomControlsPure,
    _compositeUniqueNamePure,
    CreateCompositeArrangementCmd,
    HYBRID_DIALOG_STYLE,
} from '../src/composite/resolver-ui.js';
import {
    HYBRID_PREVIEW_TONES,
    HYBRID_TIMELINE_ZOOM_MAX,
    hybridDialogSizePure,
    hybridPreviewPreferencesMigrationPure,
} from '../src/composite/preferences.js';
import { host } from '../src/host.js';
import { EditHistory } from '../src/history.js';
import { S, sessionIsDirty } from '../src/state.js';

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
    assert.match(HYBRID_DIALOG_STYLE, /height:calc\(100vh - 5\.5rem\)/);
    assert.match(HYBRID_DIALOG_STYLE, /position:absolute/);
    assert.match(HYBRID_DIALOG_STYLE, /left:1rem;top:1rem/);
    assert.match(HYBRID_DIALOG_STYLE, /resize:both/);
    assert.match(HYBRID_DIALOG_STYLE, /max-width:calc\(100vw - 1rem\)/);
    assert.match(HYBRID_DIALOG_STYLE, /grid-template-rows:auto minmax\(0, 1fr\) auto/);
    assert.match(HYBRID_DIALOG_STYLE, /display:grid/);
    assert.doesNotMatch(HYBRID_DIALOG_STYLE, /90rem|54rem/);
});

test('Hybrid workspace size preferences keep only sensible desktop dimensions', () => {
    assert.deepEqual(hybridDialogSizePure(null), {
        width: null, height: null, maximized: false,
    });
    assert.deepEqual(hybridDialogSizePure('{broken'), {
        width: null, height: null, maximized: false,
    });
    assert.deepEqual(hybridDialogSizePure({ width: 1440.4, height: 880.8 }), {
        width: 1440, height: 881, maximized: false,
    });
    assert.deepEqual(hybridDialogSizePure({
        width: 1440, height: 880, maximized: true,
    }), {
        width: 1440, height: 880, maximized: true,
    });
    assert.deepEqual(hybridDialogSizePure({ width: 100, height: 200 }), {
        width: null, height: null, maximized: false,
    });
});

test('Hybrid naming follows the selected instrument without technical wording', () => {
    assert.equal(_compositeDefaultNameForSourcePure({ type: 'bass' }), 'Hybrid Bass');
    assert.equal(_compositeDefaultNameForSourcePure({ type: 'guitar' }), 'Hybrid Guitar');
});

test('source pairing explains the compatibility problem before analysis', () => {
    const arrangements = [
        { name: 'Lead', type: 'guitar', tuning: [40, 45, 50, 55, 59, 64] },
        { name: 'Rhythm', type: 'guitar', tuning: [40, 45, 50, 55, 59, 64] },
        { name: 'Bass', type: 'bass', tuning: [28, 33, 38, 43] },
        { name: 'Drop', type: 'guitar', tuning: [38, 45, 50, 55, 59, 64] },
    ];
    assert.equal(_compositeSourcePairStatePure(arrangements, 0, 1).ok, true);
    assert.match(_compositeSourcePairStatePure(arrangements, 0, 0).message, /different tracks/i);
    assert.match(_compositeSourcePairStatePure(arrangements, 0, 2).message, /Guitar and bass/i);
    assert.match(_compositeSourcePairStatePure(arrangements, 0, 3).message, /Tunings differ/i);
});

test('analysis settings compare structurally so review choices are never replaced silently', () => {
    const config = {
        primaryIndex: 0,
        secondaryIndex: 1,
        strategy: 'gap-fill',
        gapFill: { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 },
        experimentalEnabled: false,
        experimentalProfile: 'balanced',
    };
    assert.equal(_compositeAnalysisConfigEqualPure(config, { ...config }), true);
    assert.equal(_compositeAnalysisConfigEqualPure(config, {
        ...config, gapFill: { ...config.gapFill, transitionMargin: 0.5 },
    }), false);
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

test('experimental Automatic is versioned, opt-in, and Balanced by default', () => {
    assert.deepEqual(_compositeExperimentalPreferencesPure(null), {
        enabled: false, profile: 'balanced', version: 2,
    });
    assert.deepEqual(_compositeExperimentalPreferencesPure({
        enabled: true, profile: 'fill-more', version: 2,
    }), { enabled: true, profile: 'fill-more', version: 2 });
    assert.deepEqual(_compositeExperimentalPreferencesPure({
        enabled: true, profile: 'strict', version: 1,
    }), { enabled: false, profile: 'strict', version: 2 },
    'an old rule version requires a fresh opt-in');
});

test('Hybrid audition preferences remember a safe shared tone and volume', () => {
    const defaults = {
        tone: 'clean', volume: 75, timelineZoom: 120,
        laneHeights: { primary: 158, secondary: 158, result: 158 },
        followPlayhead: true,
    };
    assert.deepEqual(_compositePreviewPreferencesPure(null), defaults);
    assert.deepEqual(_compositePreviewPreferencesPure('{broken'), defaults);
    assert.deepEqual(_compositePreviewPreferencesPure({ tone: 'edge', volume: 82.6 }), {
        ...defaults, tone: 'edge', volume: 83,
    });
    assert.deepEqual(_compositePreviewPreferencesPure({ tone: 'unknown', volume: 999 }), {
        ...defaults, tone: 'clean', volume: 100,
    });
    assert.deepEqual(_compositePreviewPreferencesPure({ tone: 'distortion', volume: null }), {
        ...defaults, tone: 'distortion', volume: 75,
    });
    assert.deepEqual(_compositePreviewPreferencesPure({
        timelineZoom: 999,
        laneHeights: { primary: 1, secondary: 200, result: 999 },
        followPlayhead: false,
    }), {
        ...defaults,
        timelineZoom: 480,
        laneHeights: { primary: 128, secondary: 200, result: 320 },
        followPlayhead: false,
    });
});

test('Hybrid timeline zoom defaults migrate once without losing other audition settings', () => {
    assert.equal(HYBRID_TIMELINE_ZOOM_MAX, 480);
    assert.deepEqual(hybridPreviewPreferencesMigrationPure({
        tone: 'edge', volume: 81, timelineZoom: 32,
        laneHeights: { primary: 180, secondary: 190, result: 200 },
        followPlayhead: false,
    }, 1), {
        tone: 'edge', volume: 81, timelineZoom: 120,
        laneHeights: { primary: 180, secondary: 190, result: 200 },
        followPlayhead: false,
    });
    assert.equal(hybridPreviewPreferencesMigrationPure({ timelineZoom: 240 }, 2)
        .timelineZoom, 240, 'current-version choices stay remembered');
});

test('the guided review CTA becomes a full-song preview action after the final choice', () => {
    assert.equal(_compositeReviewContinueLabelPure(3), 'Continue to next choice →');
    assert.equal(_compositeReviewContinueLabelPure(1), 'Continue to next choice →');
    assert.equal(_compositeReviewContinueLabelPure(0), 'Preview full song →');
});

test('the shared timeline and modal shortcuts cover review and final preview coherently', () => {
    assert.equal(_compositeTimelineStageActivePure('review'), true);
    assert.equal(_compositeTimelineStageActivePure('final-preview'), true);
    assert.equal(_compositeTimelineStageActivePure('setup'), false);
    assert.deepEqual(_compositeModalShortcutPure({ key: '1' }), {
        kind: 'preview', mode: 'song',
    });
    assert.deepEqual(_compositeModalShortcutPure({ key: '4' }), {
        kind: 'preview', mode: 'result',
    });
    assert.deepEqual(_compositeModalShortcutPure({ key: ' ' }), { kind: 'play-toggle' });
    assert.deepEqual(_compositeModalShortcutPure({ key: 'ArrowRight', stage: 'review' }), {
        kind: 'next',
    });
    assert.equal(_compositeModalShortcutPure({
        key: 'ArrowRight', stage: 'final-preview',
    }), null);
    assert.equal(_compositeModalShortcutPure({ key: '2', editable: true }), null);
    assert.equal(_compositeModalShortcutPure({ key: '2', modified: true }), null);
});

test('Escape stops one active Hybrid preview before a separate press may close', () => {
    assert.deepEqual(_compositeModalShortcutPure({
        key: 'Escape', previewActive: true,
    }), { kind: 'stop-preview' });
    assert.deepEqual(_compositeModalShortcutPure({
        key: 'Escape', previewActive: true, editable: true,
    }), { kind: 'stop-preview' },
    'Escape still stops auditioning while focus is on a preview control');
    assert.deepEqual(_compositeModalShortcutPure({
        key: 'Escape', repeat: true,
    }), { kind: 'consume' },
    'holding the same key cannot stop and then close the builder');
    assert.equal(_compositeModalShortcutPure({
        key: 'Escape', previewActive: false,
    }), null, 'a later physical press reaches the existing modal close guard');
    assert.equal(_compositeModalShortcutPure({
        key: 'Escape', previewActive: true, modified: true,
    }), null, 'modified system Escape shortcuts are not claimed');
});

test('shared review and final-preview zoom controls restore five-pixel fine zoom', () => {
    const html = _compositeTimelineZoomControlsPure(120);
    assert.match(html, /id="editor-composite-time-zoom" type="range"/);
    assert.match(html, /min="5" max="480" step="5" value="120"/);
    assert.match(html, /Fine zoom in 5 px\/beat steps/);
    assert.match(html, /Normal — 120 px\/beat/);
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
        description: 'Lead unchanged · 1 Rhythm note added · 2 skipped (too close)',
        added: 1,
        skipped: 2,
    });
});

test('experimental summary distinguishes automatic, reviewed, and left-out notes', () => {
    assert.deepEqual(_compositeExperimentalSummaryPure({
        secondaryAddedCleanly: 4,
        secondaryReviewable: 3,
        secondarySkippedByStrategy: 2,
    }, { primary: 'Lead', secondary: 'Rhythm' }), {
        title: 'Experimental hybrid ready',
        description: 'Lead unchanged · 4 Rhythm added automatically · 3 added after review · 2 left out',
        added: 4, reviewed: 3, skipped: 2,
    });
});

test('experimental passage inspector exposes outcomes, filtering, and focused handoffs', () => {
    const entry = { id: 'secondary:1' };
    const plan = {
        strategy: 'experimental',
        passages: [{
            id: 'experimental:passage:1', status: 'review', label: '<Bar 2>',
            handoffScore: 72, noteCount: 1, entries: [entry],
            explanation: 'Needs a choice.', reasons: ['Large position change'],
            handoff: {
                entryGapBeats: 1, entryGapSeconds: 0.5,
                exitGapBeats: 2, exitGapSeconds: 1,
                entryFretShift: 8, exitFretShift: 2,
            },
        }],
        conflicts: [{
            id: 'experimental:passage:1', resolution: 'secondary',
            selectedEntryIds: ['secondary:1'],
        }],
        playability: { newWarnings: [{
            passageId: 'experimental:passage:1', detail: 'Very wide stretch',
        }] },
    };
    const html = _compositeExperimentalPassageInspectorPure(plan, {
        inspectedPassageId: 'experimental:passage:1', passageFilter: 'reviewed',
    });
    assert.match(html, /Passage inspector/);
    assert.match(html, /1 reviewed/);
    assert.match(html, /aria-label="Experimental passage inspector" open/);
    assert.match(html, /value="reviewed" selected/);
    assert.match(html, /Entry space/);
    assert.match(html, /accepted · 1\/1 notes/);
    assert.match(html, /Playability advisory/);
    assert.match(html, /Very wide stretch/);
    assert.match(html, /&lt;Bar 2&gt;/);
    assert.doesNotMatch(html, /<Bar 2>/);
});

test('experimental passage inspector bounds pathological result lists', () => {
    const plan = {
        strategy: 'experimental', conflicts: [],
        passages: Array.from({ length: 1000 }, (_, index) => ({
            id: `experimental:passage:${index + 1}`, status: 'automatic',
            label: `Bar ${index + 1}`, handoffScore: 90, noteCount: 1,
            entries: [], reasons: [],
        })),
    };
    const html = _compositeExperimentalPassageInspectorPure(plan);
    assert.equal((html.match(/data-composite-inspect-passage=/g) || []).length, 240);
    assert.match(html, /Showing up to 240 passages/);
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

test('Hybrid creation is one dirty history edit and Undo removes it from the song snapshot', t => {
    const before = {
        arrangements: S.arrangements,
        currentArr: S.currentArr,
        sessionId: S.sessionId,
        sessionDirty: S.sessionDirty,
        history: S.history,
        document: globalThis.document,
        hooks: {
            ensureArr: host.ensureArr,
            updateArrangementSelector: host.updateArrangementSelector,
            updateStatus: host.updateStatus,
            draw: host.draw,
        },
    };
    t.after(() => {
        S.arrangements = before.arrangements;
        S.currentArr = before.currentArr;
        S.sessionId = before.sessionId;
        S.sessionDirty = before.sessionDirty;
        S.history = before.history;
        globalThis.document = before.document;
        Object.assign(host, before.hooks);
    });

    const lead = { name: 'Lead', type: 'guitar', notes: [] };
    const rhythm = { name: 'Rhythm', type: 'guitar', notes: [] };
    const hybrid = { name: 'Hybrid Guitar', type: 'guitar', notes: [{ time: 1 }] };
    S.arrangements = [lead, rhythm];
    S.currentArr = 0;
    S.sessionId = 'hybrid-history-test';
    S.sessionDirty = false;
    globalThis.document = { getElementById: () => null };
    Object.assign(host, {
        ensureArr: () => true,
        updateArrangementSelector() {},
        updateStatus() {},
        draw() {},
    });
    S.history = new EditHistory();

    S.history.exec(new CreateCompositeArrangementCmd(hybrid));
    assert.deepEqual(S.arrangements, [lead, rhythm, hybrid]);
    assert.equal(S.history.undo.length, 1);
    assert.equal(sessionIsDirty(), true);

    S.history.doUndo();
    assert.deepEqual(S.arrangements, [lead, rhythm],
        'the next save snapshot excludes an undone Hybrid');
    assert.equal(S.history.redo.length, 1);

    S.history.doRedo();
    assert.deepEqual(S.arrangements, [lead, rhythm, hybrid]);
    assert.equal(S.arrangements[0], lead, 'source tracks keep their identity');
    assert.equal(S.arrangements[1], rhythm, 'source tracks remain untouched');
});
