import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import * as options from '../src/composite/hybrid-options.js';
import * as preferences from '../src/composite/preferences.js';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const COMPATIBILITY_EXPORTS = Object.freeze([
    'HYBRID_TIMELINE_ZOOM_MIN',
    'HYBRID_TIMELINE_ZOOM_MAX',
    'HYBRID_TIMELINE_ZOOM_CONTROL_MIN',
    'HYBRID_TIMELINE_ZOOM_STEP',
    'HYBRID_TIMELINE_LANE_MIN',
    'HYBRID_TIMELINE_LANE_MAX',
    'HYBRID_TIMELINE_DISPLAY_NOTES',
    'HYBRID_TIMELINE_DISPLAY_OVERVIEW',
    'HYBRID_TIMELINE_FOLLOW_CENTERED',
    'HYBRID_TIMELINE_FOLLOW_PAGED',
    'HYBRID_TIMELINE_FOLLOW_OFF',
    'HYBRID_PREVIEW_DEFAULTS',
    'HYBRID_PREVIEW_TONES',
    'HYBRID_GAP_FILL_CONTROL_CONFIG',
]);

test('Hybrid options are immutable and retain their public values', () => {
    assert.deepEqual(options.HYBRID_PREVIEW_TONES.map(({ id, gm }) => ({ id, gm })), [
        { id: 'clean', gm: 27 },
        { id: 'edge', gm: 29 },
        { id: 'distortion', gm: 30 },
    ]);
    assert.equal(options.HYBRID_PREVIEW_DEFAULTS.timelineZoom, 120);
    assert.equal(options.HYBRID_PREVIEW_DEFAULTS.timelineFollowMode, 'centered');
    assert.equal(options.HYBRID_TIMELINE_ZOOM_MIN, 0.01);
    assert.equal(options.HYBRID_TIMELINE_ZOOM_CONTROL_MIN, 5);

    assert.ok(Object.isFrozen(options.HYBRID_PREVIEW_DEFAULTS));
    assert.ok(Object.isFrozen(options.HYBRID_PREVIEW_DEFAULTS.laneHeights));
    assert.ok(Object.isFrozen(options.HYBRID_PREVIEW_TONES));
    assert.ok(options.HYBRID_PREVIEW_TONES.every(Object.isFrozen));
    assert.ok(Object.isFrozen(options.HYBRID_GAP_FILL_CONTROL_CONFIG));
    assert.ok(Object.isFrozen(options.HYBRID_GAP_FILL_CONTROL_CONFIG.beats));
    assert.ok(Object.isFrozen(options.HYBRID_GAP_FILL_CONTROL_CONFIG.seconds));
});

test('preferences keeps compatibility re-exports for Hybrid option consumers', () => {
    for (const name of COMPATIBILITY_EXPORTS) {
        assert.strictEqual(preferences[name], options[name], `${name} must be re-exported unchanged`);
    }
});

test('playback and timeline consumers depend only on the Hybrid options leaf', () => {
    const leaf = read('src/composite/hybrid-options.js');
    const previewController = read('src/composite/preview-controller.js');
    const timelineView = read('src/composite/timeline-view.js');

    assert.doesNotMatch(leaf, /^\s*import\s/m,
        'the options leaf must not acquire storage or planning dependencies');
    assert.match(previewController, /from ['"]\.\/hybrid-options\.js['"]/);
    assert.doesNotMatch(previewController, /from ['"]\.\/preferences\.js['"]/);
    assert.match(timelineView, /from ['"]\.\/hybrid-options\.js['"]/);
    assert.doesNotMatch(timelineView, /from ['"]\.\/preferences\.js['"]/);
});
