import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    compositeReviewPopoverPlacementPure,
} from '../src/composite/review-popover.js';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

function assertContained(placement, bounds) {
    assert.ok(placement.left >= bounds.left);
    assert.ok(placement.left + placement.width <= bounds.right);
    assert.ok(placement.top >= bounds.top);
    assert.ok(placement.top + placement.maxHeight <= bounds.bottom);
}

test('Review popover opens below when its full content fits', () => {
    const placement = compositeReviewPopoverPlacementPure({
        anchorRect: { left: 900, top: 200, right: 1000, bottom: 230 },
        boundaryRect: { left: 100, top: 80, right: 1100, bottom: 720 },
        viewportRect: { left: 0, top: 0, right: 1200, bottom: 800 },
        contentHeight: 300,
    });
    assert.deepEqual(placement, {
        left: 328,
        top: 238,
        width: 672,
        maxHeight: 300,
        openUp: false,
        availableAbove: 104,
        availableBelow: 474,
    });
});

test('Review popover flips upward and shrinks to a narrow modal boundary', () => {
    const placement = compositeReviewPopoverPlacementPure({
        anchorRect: { left: 24, top: 600, right: 120, bottom: 630 },
        boundaryRect: { left: 20, top: 40, right: 460, bottom: 660 },
        viewportRect: { left: 0, top: 0, right: 480, bottom: 700 },
        contentHeight: 480,
    });
    assert.equal(placement.openUp, true);
    assert.equal(placement.width, 424);
    assert.equal(placement.left, 28);
    assert.equal(placement.maxHeight, 480);
    assertContained(placement, { left: 28, top: 48, right: 452, bottom: 652 });
});

test('Review popover never enforces a clipping minimum in scarce vertical space', () => {
    const placement = compositeReviewPopoverPlacementPure({
        anchorRect: { left: 250, top: 130, right: 310, bottom: 160 },
        boundaryRect: { left: 0, top: 0, right: 320, bottom: 300 },
        viewportRect: { left: 0, top: 0, right: 320, bottom: 300 },
        contentHeight: 480,
    });
    assert.equal(placement.openUp, false);
    assert.equal(placement.maxHeight, 124,
        'the old 144px floor could extend beyond the available boundary');
    assertContained(placement, { left: 8, top: 8, right: 312, bottom: 292 });
});

test('Review popover uses the viewport and modal intersection near desktop edges', () => {
    const placement = compositeReviewPopoverPlacementPure({
        anchorRect: { left: 760, top: 550, right: 790, bottom: 580 },
        boundaryRect: { left: -100, top: 50, right: 1000, bottom: 900 },
        viewportRect: { left: 0, top: 0, right: 800, bottom: 600 },
        contentHeight: 480,
    });
    assert.equal(placement.openUp, true);
    assertContained(placement, { left: 8, top: 58, right: 792, bottom: 592 });
});

test('resolver mounts theme inheritance and applies clamped popover geometry', () => {
    const resolver = read('src/composite/resolver-ui.js');
    const css = read('assets/composite/hybrid.css');
    const mount = resolver.indexOf('document.body.appendChild(modal)');
    const theme = resolver.indexOf('applyHybridThemeInheritance(modal)', mount);

    assert.ok(mount >= 0 && theme > mount,
        'the body-mounted modal must receive the Editor theme immediately after mounting');
    assert.match(resolver, /compositeReviewPopoverPlacementPure\(\{/);
    assert.match(resolver, /panel\.style\.left[\s\S]*panel\.style\.top/);
    assert.match(resolver, /panel\.style\.width[\s\S]*panel\.style\.maxHeight/);
    assert.match(resolver,
        /dialogResizeObserver = new ResizeObserver\([\s\S]*scheduleCompositeReviewDetailsPlacement\(\)/,
        'resizing or maximizing the Hybrid workspace recomputes an open panel');
    assert.match(resolver, /addEventListener\('resize', reviewDetailsWindowResize\)/,
        'viewport resize placement is installed with the modal');
    assert.match(resolver, /removeEventListener\('resize', reviewDetailsWindowResize\)/,
        'viewport resize placement is cleaned up with the modal');
    assert.match(resolver,
        /restoreCompositeReviewUi\(nextToolbar, snapshot\);[\s\S]*scheduleCompositeReviewDetailsPlacement\(\)/,
        'an open panel restored after decision navigation is positioned again');
    assert.match(resolver, /<summary>Section details<\/summary>/);
    assert.match(css,
        /\.editor-composite-review-details-panel \{[\s\S]*box-sizing: border-box;[\s\S]*overflow: auto;/);
    assert.doesNotMatch(resolver, /Math\.max\(144,\s*Math\.min\(480, available\)\)/,
        'the popover must not grow beyond a genuinely smaller boundary');
});
