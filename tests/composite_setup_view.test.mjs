import assert from 'node:assert/strict';
import test from 'node:test';

import {
    hybridTrackNameValidationPure,
    renderHybridSetupView,
} from '../src/composite/setup-view.js';

test('Hybrid track names are validated before leaving Setup', () => {
    assert.deepEqual(hybridTrackNameValidationPure('   ', ['Lead']), {
        ok: false, name: '', message: 'Enter a name for the new Hybrid Track.',
    });
    assert.deepEqual(hybridTrackNameValidationPure(' hybrid guitar ', ['Hybrid Guitar']), {
        ok: false,
        name: 'hybrid guitar',
        message: 'Another track already uses that name.',
    });
    assert.deepEqual(hybridTrackNameValidationPure('Hybrid Guitar 2', ['Hybrid Guitar']), {
        ok: true, name: 'Hybrid Guitar 2', message: '',
    });
});

test('Hybrid Setup exposes its name error beside the name input', () => {
    const markup = renderHybridSetupView();
    assert.match(markup,
        /id="editor-composite-name"[^>]+aria-describedby="editor-composite-name-error"/);
    assert.match(markup,
        /id="editor-composite-name-error"[^>]+role="alert"/);
});
