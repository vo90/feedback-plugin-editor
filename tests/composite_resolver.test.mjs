import assert from 'node:assert/strict';
import test from 'node:test';

import {
    _compositeEligibleSourcesPure,
    _compositeAutomaticSummaryPure,
    _compositeAnalysisConfigEqualPure,
    _compositeDefaultNameForSourcePure,
    _compositeGapFillPreferencesPure,
    _compositeGuidedSummaryPure,
    _compositeGuidedPreferencesPure,
    _compositeModalShortcutPure,
    _compositePreviewPreferencesPure,
    _compositeReviewContinueLabelPure,
    _compositeReviewCustomSelectionPure,
    _compositeSourcePairStatePure,
    _compositeTimelineKeyboardSeekPure,
    _compositeTimelineLaneResizeKeyPure,
    _compositeTimelineSeekAriaPure,
    _compositeTimelineStageActivePure,
    _compositeTimelineEffectiveZoomPure,
    _compositeTimelineZoomControlsPure,
    _compositeUniqueNamePure,
    CreateCompositeArrangementCmd,
    HYBRID_DIALOG_STYLE,
} from '../src/composite/resolver-ui.js';
import {
    HYBRID_PREVIEW_TONES,
    HYBRID_TIMELINE_DISPLAY_NOTES,
    HYBRID_TIMELINE_DISPLAY_OVERVIEW,
    HYBRID_TIMELINE_FOLLOW_CENTERED,
    HYBRID_TIMELINE_FOLLOW_OFF,
    HYBRID_TIMELINE_FOLLOW_PAGED,
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

test('Hybrid audition preferences remember a safe shared tone and volume', () => {
    const defaults = {
        tone: 'clean', volume: 75, timelineZoom: 120,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
        laneHeights: { primary: 158, secondary: 158, result: 158 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_CENTERED,
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
        timelineZoom: 1,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
    }), {
        ...defaults,
        timelineZoom: 5,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
    }, 'the computed Overview fit never leaks below the persisted note-zoom floor');
    assert.deepEqual(_compositePreviewPreferencesPure({
        timelineDisplayMode: 'unknown',
    }), defaults, 'unknown display modes fall back to Notes');
    assert.deepEqual(_compositePreviewPreferencesPure({
        timelineZoom: 999,
        laneHeights: { primary: 1, secondary: 200, result: 999 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_OFF,
    }), {
        ...defaults,
        timelineZoom: 480,
        laneHeights: { primary: 128, secondary: 200, result: 320 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_OFF,
    });
    assert.deepEqual(_compositePreviewPreferencesPure({
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_PAGED,
    }), {
        ...defaults,
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_PAGED,
    }, 'page-by-page follow is a persisted preview choice');
    const invalid = _compositePreviewPreferencesPure({
        timelineFollowMode: 'unknown',
        followPlayhead: false,
    });
    assert.deepEqual(invalid, defaults, 'invalid modes fall back to centered follow');
    assert.equal(Object.hasOwn(invalid, 'followPlayhead'), false,
        'normalized preferences have one follow-mode source of truth');
});

test('Hybrid timeline zoom defaults migrate once without losing other audition settings', () => {
    assert.equal(HYBRID_TIMELINE_ZOOM_MAX, 480);
    assert.deepEqual(hybridPreviewPreferencesMigrationPure({
        tone: 'edge', volume: 81, timelineZoom: 32,
        laneHeights: { primary: 180, secondary: 190, result: 200 },
        followPlayhead: false,
    }, 1), {
        tone: 'edge', volume: 81, timelineZoom: 120,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
        laneHeights: { primary: 180, secondary: 190, result: 200 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_OFF,
    });
    assert.deepEqual(hybridPreviewPreferencesMigrationPure({ timelineZoom: 240 }, 2), {
        tone: 'clean', volume: 75, timelineZoom: 240,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
        laneHeights: { primary: 158, secondary: 158, result: 158 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_CENTERED,
    }, 'version-two note zoom choices stay remembered');
    assert.deepEqual(hybridPreviewPreferencesMigrationPure({ timelineZoom: 4 }, 2), {
        tone: 'clean', volume: 75, timelineZoom: 120,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
        laneHeights: { primary: 158, secondary: 158, result: 158 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_CENTERED,
    }, 'a pre-mode fit zoom becomes an explicit Overview without replacing note zoom');
    assert.equal(hybridPreviewPreferencesMigrationPure({ timelineZoom: 5 }, 2)
        .timelineDisplayMode, HYBRID_TIMELINE_DISPLAY_NOTES,
    'the old manual zoom floor remains a Notes view');
    assert.deepEqual(hybridPreviewPreferencesMigrationPure({
        timelineZoom: 180,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
    }, 3), {
        tone: 'clean', volume: 75, timelineZoom: 180,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
        laneHeights: { primary: 158, secondary: 158, result: 158 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_CENTERED,
    }, 'current explicit mode and note zoom both remain persisted');
    assert.deepEqual(hybridPreviewPreferencesMigrationPure({
        tone: 'distortion',
        volume: 64,
        timelineZoom: 205,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
        laneHeights: { primary: 170, secondary: 180, result: 190 },
        followPlayhead: false,
    }, 3), {
        tone: 'distortion',
        volume: 64,
        timelineZoom: 205,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
        laneHeights: { primary: 170, secondary: 180, result: 190 },
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_OFF,
    }, 'version-three preferences migrate without losing timeline or audition choices');
    assert.deepEqual(hybridPreviewPreferencesMigrationPure({
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_PAGED,
        followPlayhead: false,
    }, 3).timelineFollowMode, HYBRID_TIMELINE_FOLLOW_PAGED,
    'an already-written valid enum is preserved during an interrupted migration');
    assert.equal(hybridPreviewPreferencesMigrationPure({ followPlayhead: true }, 0)
        .timelineFollowMode, HYBRID_TIMELINE_FOLLOW_CENTERED,
    'legacy enabled follow becomes centered follow');
    assert.equal(hybridPreviewPreferencesMigrationPure({ followPlayhead: false }, 0)
        .timelineFollowMode, HYBRID_TIMELINE_FOLLOW_OFF,
    'legacy disabled follow remains off');
    assert.equal(hybridPreviewPreferencesMigrationPure({
        timelineFollowMode: 'invalid', followPlayhead: false,
    }, 3).timelineFollowMode, HYBRID_TIMELINE_FOLLOW_CENTERED,
    'an invalid enum falls back safely instead of creating a fourth state');
    const current = hybridPreviewPreferencesMigrationPure({
        timelineFollowMode: HYBRID_TIMELINE_FOLLOW_PAGED,
        followPlayhead: false,
    }, 4);
    assert.equal(current.timelineFollowMode, HYBRID_TIMELINE_FOLLOW_PAGED);
    assert.equal(Object.hasOwn(current, 'followPlayhead'), false,
        'current preferences never retain the obsolete boolean');
});

test('the guided review CTA becomes a full-song preview action after the final choice', () => {
    assert.equal(_compositeReviewContinueLabelPure(3), 'Next unresolved →');
    assert.equal(_compositeReviewContinueLabelPure(1), 'Next unresolved →');
    assert.equal(_compositeReviewContinueLabelPure(0), 'Preview full song →');
});

test('a repeated manual choice remains editable without a local draft', () => {
    const selectedEntryIds = ['repeat-primary-1', 'repeat-secondary-2'];
    const conflict = { resolution: 'custom', selectedEntryIds };
    assert.equal(_compositeReviewCustomSelectionPure(conflict), selectedEntryIds,
        'the mapped committed selection is used when visiting another occurrence');
    const localDraft = ['repeat-secondary-2'];
    assert.equal(_compositeReviewCustomSelectionPure(conflict, localDraft, true), localDraft,
        'an occurrence-local draft still wins while editing');
    assert.equal(_compositeReviewCustomSelectionPure({ resolution: 'primary' }), null);
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
    assert.equal(_compositeModalShortcutPure({
        key: ' ', editable: true, spaceEditable: true,
    }), null, 'an interactive control keeps its native Space behavior');
    assert.equal(_compositeModalShortcutPure({
        key: ' ', editable: true, spaceEditable: true,
    }), null, 'text-editing controls keep literal Space input');
    assert.deepEqual(_compositeModalShortcutPure({ key: ' ', repeat: true }), {
        kind: 'consume',
    }, 'holding Space cannot rapidly start and stop the preview');
    assert.deepEqual(_compositeModalShortcutPure({ key: '2', repeat: true }), {
        kind: 'consume',
    }, 'holding a sound shortcut cannot repeatedly reload its preview');
    assert.deepEqual(_compositeModalShortcutPure({ key: 'ArrowRight', stage: 'review' }), {
        kind: 'next',
    });
    assert.equal(_compositeModalShortcutPure({
        key: 'ArrowRight', stage: 'review', navigationReserved: true,
    }), null, 'the focused timeline scroller keeps native horizontal keyboard panning');
    assert.deepEqual(_compositeModalShortcutPure({
        key: ' ', stage: 'review', navigationReserved: true,
    }), { kind: 'play-toggle' }, 'native panning does not steal timeline transport Space');
    assert.deepEqual(_compositeModalShortcutPure({
        key: '2', stage: 'review', navigationReserved: true,
    }), { kind: 'preview', mode: 'primary' },
    'native panning does not disable sound-selection shortcuts');
    assert.equal(_compositeModalShortcutPure({ key: ' ', stage: 'setup' }), null,
        'Setup never exposes Hybrid transport shortcuts');
    assert.equal(_compositeModalShortcutPure({ key: '1', stage: 'setup' }), null);
    assert.equal(_compositeModalShortcutPure({
        key: ' ', stage: 'review', transportAvailable: false,
    }), null, 'a hidden, inert, or busy review cannot start playback');
    assert.equal(_compositeModalShortcutPure({
        key: '1', stage: 'final-preview', transportAvailable: false,
    }), null, 'sound shortcuts cannot target unavailable preview controls');
    assert.equal(_compositeModalShortcutPure({
        key: 'ArrowRight', stage: 'review', transportAvailable: false,
    }), null, 'busy review navigation cannot click an inert decision control');
    assert.equal(_compositeModalShortcutPure({
        key: 'ArrowRight', stage: 'final-preview',
    }), null);
    assert.equal(_compositeModalShortcutPure({ key: '2', editable: true }), null);
    assert.equal(_compositeModalShortcutPure({ key: '2', modified: true }), null);
});

test('timeline seek sliders and lane separators use bounded keyboard steps', () => {
    const context = { startBeat: 4, endBeat: 36 };
    assert.deepEqual(_compositeTimelineSeekAriaPure({ context }, 12.125), {
        min: '4', max: '36', now: '12.125', text: 'Beat 12.125 of 36',
    });
    assert.deepEqual(_compositeTimelineSeekAriaPure({ context }, 99), {
        min: '4', max: '36', now: '36', text: 'Beat 36 of 36',
    }, 'ARIA values stay inside the same seek bounds as keyboard input');
    const seek = (key, currentBeat = 12) => _compositeTimelineKeyboardSeekPure({
        key, currentBeat, context, pageBeats: 8,
    });
    assert.equal(seek('ArrowLeft'), 11);
    assert.equal(seek('ArrowDown'), 11);
    assert.equal(seek('ArrowRight'), 13);
    assert.equal(seek('ArrowUp'), 13);
    assert.equal(seek('PageUp'), 4);
    assert.equal(seek('PageDown'), 20);
    assert.equal(seek('Home'), 4);
    assert.equal(seek('End'), 36);
    assert.equal(seek('ArrowLeft', 4), 4);
    assert.equal(seek('ArrowRight', 36), 36);
    assert.equal(seek('Enter'), null);

    assert.equal(_compositeTimelineLaneResizeKeyPure('ArrowUp', 158), 150);
    assert.equal(_compositeTimelineLaneResizeKeyPure('ArrowDown', 158), 166);
    assert.equal(_compositeTimelineLaneResizeKeyPure('PageUp', 158), 128);
    assert.equal(_compositeTimelineLaneResizeKeyPure('PageDown', 158), 190);
    assert.equal(_compositeTimelineLaneResizeKeyPure('Home', 200), 128);
    assert.equal(_compositeTimelineLaneResizeKeyPure('End', 200), 320);
    assert.equal(_compositeTimelineLaneResizeKeyPure('ArrowUp', 128), 128);
    assert.equal(_compositeTimelineLaneResizeKeyPure('ArrowDown', 320), 320);
    assert.equal(_compositeTimelineLaneResizeKeyPure('ArrowLeft', 158), null);
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
        key: 'Escape', previewActive: true, transportAvailable: false,
    }), { kind: 'stop-preview' },
    'an active preview can still be stopped while other transport is gated');
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
    const html = _compositeTimelineZoomControlsPure(
        120, HYBRID_TIMELINE_DISPLAY_NOTES);
    assert.match(html, /id="editor-composite-time-zoom" type="range"/);
    assert.match(html, /min="5" max="480" step="5" value="120"/);
    assert.match(html, /Fine zoom in 5 px\/beat steps/);
    assert.match(html, /Normal — 120 px\/beat/);
    assert.match(html, /id="editor-composite-time-overview" aria-pressed="false"/);
    assert.match(html, />Whole-song overview<\/button>/);

    const overview = _compositeTimelineZoomControlsPure(
        120, HYBRID_TIMELINE_DISPLAY_OVERVIEW);
    assert.match(overview, /id="editor-composite-time-overview" aria-pressed="true"/);
    assert.match(overview, />Whole-song overview<\/button>/);
    assert.match(overview, />Whole song · details hidden<\/output>/);
    assert.match(overview, /data-composite-note-zoom-controls[^>]* hidden/);
    assert.match(overview, /id="editor-composite-time-preset"[^>]* disabled/);
    assert.match(overview, /id="editor-composite-time-zoom"[^>]* disabled/);
    assert.match(overview, /data-composite-time-zoom="out"[^>]* disabled/);
    assert.match(overview, /data-composite-time-zoom="in"[^>]* disabled/);
    assert.doesNotMatch(overview, /aria-disabled/,
        'native disabled state cannot become stale after leaving Overview');
});

test('explicit Overview computes fit without changing the saved note zoom', () => {
    const context = { startBeat: 0, endBeat: 100 };
    const notes = {
        timelineZoom: 120,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
    };
    const overview = {
        ...notes,
        timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_OVERVIEW,
    };
    assert.equal(_compositeTimelineEffectiveZoomPure(context, 1200, notes), 120);
    const narrow = _compositeTimelineEffectiveZoomPure(context, 900, overview);
    const wide = _compositeTimelineEffectiveZoomPure(context, 1500, overview);
    assert.ok(wide > narrow, 'Overview recomputes its fit when the workspace grows');
    assert.equal(overview.timelineZoom, 120,
        'computed fit never replaces the remembered Notes zoom');
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

test('manual review summary distinguishes a completed review from no work needed', () => {
    assert.deepEqual(_compositeGuidedSummaryPure({ reviewDecisions: 2 }, 2), {
        title: 'Review complete ✓',
        description: '2 choices complete · inspect or listen before creating',
    });
    assert.deepEqual(_compositeGuidedSummaryPure({ reviewDecisions: 0 }, 0), {
        title: 'No review needed ✓',
        description: 'The tracks match, or only one track plays at a time · inspect or listen before creating',
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
