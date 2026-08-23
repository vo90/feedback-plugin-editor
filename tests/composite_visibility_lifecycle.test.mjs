import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    createHybridEditorScreenVisibilityObserver,
} from '../src/composite/entry.js';
import {
    _compositeModalSessionIsCurrentPure,
} from '../src/composite/resolver-ui.js';

const resolverSource = fs.readFileSync(
    new URL('../src/composite/resolver-ui.js', import.meta.url), 'utf8');
const entrySource = fs.readFileSync(
    new URL('../src/composite/entry.js', import.meta.url), 'utf8');

test('the lazy feature entry follows only the Editor screen active class', () => {
    const screen = {
        active: true,
        classList: {
            contains(name) { return name === 'active' && screen.active; },
        },
    };
    const documentObject = {
        getElementById(id) { return id === 'plugin-editor' ? screen : null; },
    };
    let installedObserver = null;
    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.disconnectCount = 0;
            installedObserver = this;
        }

        observe(target, options) {
            this.target = target;
            this.options = options;
        }

        disconnect() {
            this.disconnectCount++;
        }

        fire() {
            this.callback([{ type: 'attributes', attributeName: 'class' }]);
        }
    }
    let resumes = 0;
    let suspends = 0;
    const visibility = createHybridEditorScreenVisibilityObserver({
        documentObject,
        MutationObserverClass: FakeMutationObserver,
        onActive: () => { resumes++; },
        onInactive: () => { suspends++; },
    });

    assert.equal(visibility.start(), true);
    assert.equal(resumes, 1);
    assert.equal(suspends, 0);
    assert.equal(installedObserver.target, screen);
    assert.deepEqual(installedObserver.options,
        { attributes: true, attributeFilter: ['class'] });

    screen.active = false;
    installedObserver.fire();
    assert.equal(suspends, 1);
    installedObserver.fire();
    assert.equal(suspends, 1, 'unchanged class state is idempotent');

    screen.active = true;
    installedObserver.fire();
    assert.equal(resumes, 2);

    const stoppedObserver = installedObserver;
    visibility.stop();
    assert.equal(stoppedObserver.disconnectCount, 1);
    screen.active = false;
    stoppedObserver.fire();
    assert.equal(suspends, 1, 'queued callbacks cannot act after feature teardown');
});

test('Hybrid modal resume requires the same compatible Editor and plan session', () => {
    const editor = { sessionId: 'song-a', format: 'sloppak' };
    assert.equal(_compositeModalSessionIsCurrentPure('song-a', editor), true);
    assert.equal(_compositeModalSessionIsCurrentPure('song-a', editor, 'song-a'), true);
    assert.equal(_compositeModalSessionIsCurrentPure('song-a', {
        ...editor, sessionId: 'song-b',
    }, 'song-a'), false);
    assert.equal(_compositeModalSessionIsCurrentPure('song-a', {
        ...editor, format: 'rocksmith',
    }, 'song-a'), false);
    assert.equal(_compositeModalSessionIsCurrentPure('song-a', editor, 'song-b'), false);
    assert.equal(_compositeModalSessionIsCurrentPure(null, editor), false);
});

test('screen suspension stays feature-owned and preserves review state', () => {
    assert.match(entrySource,
        /new MutationObserverClass\(sync\)[\s\S]*attributeFilter:\s*\['class'\]/,
        'the lazy entry observes only the Editor screen class');
    assert.match(entrySource,
        /function editorTeardownCompositeArrangementUi\(\)[\s\S]*uninstallHybridEditorScreenVisibilityObserver\(\)/,
        'feature teardown must disconnect the screen observer');
    assert.match(resolverSource,
        /export function editorSuspendCompositeArrangementUi\(\)[\s\S]*endCompositePreviewPlayback\(\)[\s\S]*stopCompositeModalDocumentKeyboard\(\)[\s\S]*modal\.hidden = true/,
        'suspension must stop private playback and keyboard capture before hiding');
    assert.match(resolverSource,
        /export function editorResumeCompositeArrangementUi\(\)[\s\S]*_compositeModalSessionIsCurrentPure[\s\S]*closeCompositeModalImmediately\(modal\)[\s\S]*modal\.hidden = false[\s\S]*installCompositeModalDocumentKeyboard\(modal\)/,
        'resume must validate song ownership before restoring the modal and keyboard');

    const suspendBody = resolverSource.match(
        /export function editorSuspendCompositeArrangementUi\(\) \{([\s\S]*?)\n\}/,
    )?.[1] || '';
    assert.doesNotMatch(suspendBody,
        /resetHybridBuilderReview|cancelHybridAnalysis|cancelHybridCreation|disposeCompositePreviewSession/,
        'screen suspension must keep the in-progress plan and review choices');
});
