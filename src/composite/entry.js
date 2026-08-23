/* Lazy entry point for the Hybrid Track workspace.
 *
 * Normal Editor startup imports only this module on demand. The sizeable
 * resolver, its diagnostics, and its private stylesheet therefore do not
 * affect an Editor session that never opens the feature.
 */

import {
    editorResumeCompositeArrangementUi,
    editorShowCompositeArrangementModal as showCompositeArrangementModal,
    editorSuspendCompositeArrangementUi,
    editorTeardownCompositeArrangementUi as teardownCompositeArrangementUi,
} from './resolver-ui.js';
import {
    installHybridPerformanceTools,
    uninstallHybridPerformanceTools,
} from './performance.js';

const STYLE_OWNER = 'hybrid-track-builder';
const STYLE_URL = new URL('../../assets/composite/hybrid.css', import.meta.url).href;

let styleLoadGeneration = 0;
let activeStyleLoad = null;
let editorScreenVisibilityObserver = null;

// The Hybrid modal is mounted under <body> so it can fill the desktop window,
// while the Editor itself is one of the host application's persistent screens.
// Keep that host-specific visibility bridge here in the lazy feature entry:
// normal Editor startup and its shared UI modules remain unaware of it.
export function createHybridEditorScreenVisibilityObserver({
    documentObject = globalThis.document,
    MutationObserverClass = globalThis.MutationObserver,
    onActive = editorResumeCompositeArrangementUi,
    onInactive = editorSuspendCompositeArrangementUi,
} = {}) {
    let target = null;
    let observer = null;
    let running = false;
    let lastActive = null;

    const sync = () => {
        if (!running) return false;
        const nextTarget = documentObject?.getElementById?.('plugin-editor') || null;
        if (nextTarget !== target) {
            observer?.disconnect();
            target = nextTarget;
            observer = target && typeof MutationObserverClass === 'function'
                ? new MutationObserverClass(sync) : null;
            observer?.observe(target, { attributes: true, attributeFilter: ['class'] });
        }
        const active = !!target?.classList?.contains('active');
        if (active === lastActive) return active;
        lastActive = active;
        if (active) onActive?.();
        else onInactive?.();
        return active;
    };

    return {
        start() {
            running = true;
            return sync();
        },
        stop() {
            running = false;
            observer?.disconnect();
            observer = null;
            target = null;
            lastActive = null;
        },
        sync,
    };
}

function installHybridEditorScreenVisibilityObserver() {
    editorScreenVisibilityObserver ||= createHybridEditorScreenVisibilityObserver();
    return editorScreenVisibilityObserver.start();
}

function uninstallHybridEditorScreenVisibilityObserver() {
    editorScreenVisibilityObserver?.stop();
    editorScreenVisibilityObserver = null;
}

function matchingStyleElement() {
    if (typeof document === 'undefined') return null;
    return [...document.querySelectorAll(`link[data-editor-feature-style="${STYLE_OWNER}"]`)]
        .find(link => link.href === STYLE_URL) || null;
}

function ownsHybridStyleLoad(record) {
    return !!record && activeStyleLoad === record
        && activeStyleLoad.generation === record.generation;
}

function cancelHybridStyleLoad(cause) {
    const record = activeStyleLoad;
    if (!record) return false;
    activeStyleLoad = null;
    record.cleanup();
    if (record.link?.isConnected) record.link.remove();
    if (!record.settled) {
        record.settled = true;
        record.reject(cause);
    }
    return true;
}

function createHybridStyleLoad(link) {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    const record = {
        generation: ++styleLoadGeneration,
        link,
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
        settled: false,
        cleanup: () => {},
    };
    const loaded = () => {
        // A removed link can still have a queued load event. Only the record
        // that currently owns the feature stylesheet may settle shared state.
        if (!ownsHybridStyleLoad(record) || record.settled) {
            record.cleanup();
            return;
        }
        record.settled = true;
        record.cleanup();
        link.dataset.loaded = 'true';
        record.resolve(link);
    };
    const failed = () => {
        if (!ownsHybridStyleLoad(record) || record.settled) {
            record.cleanup();
            return;
        }
        record.settled = true;
        record.cleanup();
        activeStyleLoad = null;
        if (link.isConnected) link.remove();
        record.reject(new Error('Hybrid Track stylesheet could not be loaded'));
    };
    record.cleanup = () => {
        link.removeEventListener('load', loaded);
        link.removeEventListener('error', failed);
    };
    activeStyleLoad = record;
    link.addEventListener('load', loaded, { once: true });
    link.addEventListener('error', failed, { once: true });
    // A loaded link can be adopted from an earlier Editor injection.
    if (link.dataset.loaded === 'true' || link.sheet) loaded();
    return record;
}

export function ensureHybridTrackStyles() {
    if (typeof document === 'undefined') return Promise.resolve(null);
    if (activeStyleLoad?.link?.isConnected
            && activeStyleLoad.link.href === STYLE_URL) {
        return activeStyleLoad.promise;
    }
    if (activeStyleLoad) {
        cancelHybridStyleLoad(new Error('Hybrid Track stylesheet load was replaced'));
    }

    const existing = matchingStyleElement();

    for (const stale of document.querySelectorAll(
            `link[data-editor-feature-style="${STYLE_OWNER}"]`)) {
        if (stale !== existing) stale.remove();
    }
    const link = existing || document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_URL;
    link.dataset.editorFeatureStyle = STYLE_OWNER;
    if (link.dataset.loaded !== 'true') link.dataset.loaded = 'false';
    if (!link.isConnected) (document.head || document.documentElement).appendChild(link);
    return createHybridStyleLoad(link).promise;
}

export async function editorShowCompositeArrangementModal() {
    await ensureHybridTrackStyles();
    installHybridPerformanceTools();
    const shown = await showCompositeArrangementModal();
    if (shown) installHybridEditorScreenVisibilityObserver();
    return shown;
}

export function editorTeardownCompositeArrangementUi() {
    uninstallHybridEditorScreenVisibilityObserver();
    try {
        teardownCompositeArrangementUi();
    } finally {
        uninstallHybridPerformanceTools();
        cancelHybridStyleLoad(
            new Error('Hybrid Track stylesheet load was cancelled'));
    }
}
