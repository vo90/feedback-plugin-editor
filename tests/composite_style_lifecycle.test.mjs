import assert from 'node:assert/strict';
import test from 'node:test';

import {
    editorTeardownCompositeArrangementUi,
    ensureHybridTrackStyles,
} from '../src/composite/entry.js';

class FakeLink {
    constructor(owner) {
        this.owner = owner;
        this.dataset = {};
        this.href = '';
        this.isConnected = false;
        this.sheet = null;
        this.listeners = new Map();
    }

    addEventListener(type, callback) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(callback);
    }

    removeEventListener(type, callback) {
        this.listeners.get(type)?.delete(callback);
    }

    handlers(type) {
        return [...(this.listeners.get(type) || [])];
    }

    fire(type) {
        for (const callback of this.handlers(type)) callback({ type, target: this });
    }

    remove() {
        this.isConnected = false;
    }
}

class FakeDocument {
    constructor() {
        this.links = [];
        this.head = { appendChild: link => this.append(link) };
        this.documentElement = this.head;
    }

    createElement(tagName) {
        assert.equal(tagName, 'link');
        const link = new FakeLink(this);
        this.links.push(link);
        return link;
    }

    append(link) {
        if (!this.links.includes(link)) this.links.push(link);
        link.isConnected = true;
        return link;
    }

    querySelectorAll(selector) {
        if (!selector.includes('data-editor-feature-style')) return [];
        return this.links.filter(link => link.isConnected
            && link.dataset.editorFeatureStyle === 'hybrid-track-builder');
    }

    getElementById() {
        return null;
    }

    connectedLinks() {
        return this.links.filter(link => link.isConnected);
    }
}

function useFakeDocument(t) {
    const previousDocument = globalThis.document;
    const documentObject = new FakeDocument();
    globalThis.document = documentObject;
    t.after(() => {
        try { editorTeardownCompositeArrangementUi(); }
        finally { globalThis.document = previousDocument; }
    });
    return documentObject;
}

test('Hybrid stylesheet callers share one owned load and teardown removes it', async t => {
    const documentObject = useFakeDocument(t);
    const first = ensureHybridTrackStyles();
    const link = documentObject.connectedLinks()[0];

    assert.ok(link);
    assert.equal(ensureHybridTrackStyles(), first,
        'concurrent opens await the same feature stylesheet');

    link.fire('load');
    assert.equal(await first, link);
    assert.equal(link.dataset.loaded, 'true');
    assert.equal(ensureHybridTrackStyles(), first,
        'an installed stylesheet keeps its settled ownership record');

    editorTeardownCompositeArrangementUi();
    assert.equal(link.isConnected, false);
    assert.deepEqual(documentObject.connectedLinks(), []);
});

test('stale Hybrid stylesheet events cannot corrupt a newer load', async t => {
    const documentObject = useFakeDocument(t);
    const first = ensureHybridTrackStyles();
    const staleLink = documentObject.connectedLinks()[0];
    const [staleLoaded] = staleLink.handlers('load');
    const [staleFailed] = staleLink.handlers('error');
    const cancelled = assert.rejects(first, /stylesheet load was cancelled/);

    editorTeardownCompositeArrangementUi();
    await cancelled;
    assert.equal(staleLink.isConnected, false);

    const current = ensureHybridTrackStyles();
    const currentLink = documentObject.connectedLinks()[0];
    assert.notEqual(currentLink, staleLink);

    // Model browser events that were already queued before listener cleanup.
    staleLoaded();
    staleFailed();
    assert.equal(currentLink.isConnected, true);
    assert.equal(ensureHybridTrackStyles(), current,
        'stale handlers cannot clear the current load record');
    assert.deepEqual(documentObject.connectedLinks(), [currentLink]);

    currentLink.fire('load');
    assert.equal(await current, currentLink);
    assert.equal(currentLink.dataset.loaded, 'true');
});
