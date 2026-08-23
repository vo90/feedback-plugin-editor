import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compositeTimelineCameraCoveragePure,
    compositeTimelineCameraUrgencyPure,
} from '../src/composite/timeline-camera-policy.js';

const context = { startBeat: 0, endBeat: 100 };

test('camera coverage reports directional pixel headroom', () => {
    const forward = compositeTimelineCameraCoveragePure({
        context,
        zoom: 120,
        renderedRange: { startBeat: 10, endBeat: 50 },
        viewportRange: { startBeat: 20, endBeat: 30 },
        direction: 1,
    });
    assert.equal(forward.coversViewport, true);
    assert.equal(forward.leftHeadroomPx, 1200);
    assert.equal(forward.rightHeadroomPx, 2400);
    assert.equal(forward.travelHeadroomPx, 2400);

    const reverse = compositeTimelineCameraCoveragePure({
        context,
        zoom: 120,
        renderedRange: { startBeat: 10, endBeat: 50 },
        viewportRange: { startBeat: 20, endBeat: 30 },
        direction: -1,
    });
    assert.equal(reverse.travelHeadroomPx, 1200);
});

test('camera coverage becomes critical as soon as either viewport edge is unpainted', () => {
    const leftMiss = compositeTimelineCameraCoveragePure({
        context, zoom: 60,
        renderedRange: { startBeat: 12, endBeat: 40 },
        viewportRange: { startBeat: 10, endBeat: 20 },
    });
    assert.equal(leftMiss.coversViewport, false);
    assert.equal(leftMiss.coversLeft, false);
    assert.equal(compositeTimelineCameraUrgencyPure({ coverage: leftMiss }), 'critical');

    const rightMiss = compositeTimelineCameraCoveragePure({
        context, zoom: 60,
        renderedRange: { startBeat: 0, endBeat: 20 },
        viewportRange: { startBeat: 15, endBeat: 21 },
    });
    assert.equal(rightMiss.coversViewport, false);
    assert.equal(rightMiss.coversRight, false);
    assert.equal(compositeTimelineCameraUrgencyPure({ coverage: rightMiss }), 'critical');
});

test('camera urgency promotes soft work before urgent and critical coverage repair', () => {
    const coverage = headroom => ({ coversViewport: true, travelHeadroomPx: headroom });
    assert.equal(compositeTimelineCameraUrgencyPure({
        coverage: coverage(2000), viewportWidth: 1000,
    }), 'none');
    assert.equal(compositeTimelineCameraUrgencyPure({
        coverage: coverage(1200), viewportWidth: 1000,
    }), 'soft');
    assert.equal(compositeTimelineCameraUrgencyPure({
        coverage: coverage(500), viewportWidth: 1000,
    }), 'urgent');
    assert.equal(compositeTimelineCameraUrgencyPure({
        coverage: coverage(500), viewportWidth: 1000, standbyReady: true,
    }), 'none');
});

test('an exact zoom commit is urgent during playback even with ample coverage', () => {
    assert.equal(compositeTimelineCameraUrgencyPure({
        coverage: { coversViewport: true, travelHeadroomPx: 10_000 },
        viewportWidth: 1000,
        exactRenderPending: true,
    }), 'urgent');
});

test('invalid or missing geometry always requests critical repair', () => {
    const missing = compositeTimelineCameraCoveragePure({ context, zoom: 120 });
    assert.equal(missing.valid, false);
    assert.equal(missing.coversViewport, false);
    assert.equal(compositeTimelineCameraUrgencyPure({ coverage: missing }), 'critical');
});
