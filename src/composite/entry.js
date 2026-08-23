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

let stylePromise = null;
let styleElement = null;
let rejectStyleLoad = null;
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

export function ensureHybridTrackStyles() {
    if (typeof document === 'undefined') return Promise.resolve(null);
    const existing = matchingStyleElement();
    if (existing?.dataset.loaded === 'true') {
        styleElement = existing;
        return Promise.resolve(existing);
    }
    if (stylePromise && styleElement?.isConnected) return stylePromise;

    for (const stale of document.querySelectorAll(
            `link[data-editor-feature-style="${STYLE_OWNER}"]`)) {
        if (stale !== existing) stale.remove();
    }
    const link = existing || document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_URL;
    link.dataset.editorFeatureStyle = STYLE_OWNER;
    link.dataset.loaded = 'false';
    if (!link.isConnected) (document.head || document.documentElement).appendChild(link);
    styleElement = link;

    stylePromise = new Promise((resolve, reject) => {
        rejectStyleLoad = reject;
        const loaded = () => {
            cleanup();
            rejectStyleLoad = null;
            link.dataset.loaded = 'true';
            resolve(link);
        };
        const failed = () => {
            cleanup();
            rejectStyleLoad = null;
            if (styleElement === link) styleElement = null;
            link.remove();
            stylePromise = null;
            reject(new Error('Hybrid Track stylesheet could not be loaded'));
        };
        const cleanup = () => {
            link.removeEventListener('load', loaded);
            link.removeEventListener('error', failed);
        };
        link.addEventListener('load', loaded, { once: true });
        link.addEventListener('error', failed, { once: true });
        // A link adopted from an earlier in-flight import may already be ready.
        if (link.sheet) loaded();
    });
    return stylePromise;
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
        const rejectPending = rejectStyleLoad;
        rejectStyleLoad = null;
        rejectPending?.(new Error('Hybrid Track stylesheet load was cancelled'));
        stylePromise = null;
        if (styleElement?.isConnected) styleElement.remove();
        styleElement = null;
    }
}
