/* Lazy entry point for the Hybrid Track workspace.
 *
 * Normal Editor startup imports only this module on demand. The sizeable
 * resolver, its diagnostics, and its private stylesheet therefore do not
 * affect an Editor session that never opens the feature.
 */

import {
    editorHideCompositeArrangementModal,
    editorShowCompositeArrangementModal as showCompositeArrangementModal,
    editorTeardownCompositeArrangementUi as teardownCompositeArrangementUi,
} from './resolver-ui.js';
import { installHybridPerformanceTools } from './performance.js';

const STYLE_OWNER = 'hybrid-track-builder';
const STYLE_URL = new URL('../../assets/composite/hybrid.css', import.meta.url).href;

let stylePromise = null;
let styleElement = null;
let rejectStyleLoad = null;

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
    return showCompositeArrangementModal();
}

export { editorHideCompositeArrangementModal };

export function editorTeardownCompositeArrangementUi() {
    teardownCompositeArrangementUi();
    const rejectPending = rejectStyleLoad;
    rejectStyleLoad = null;
    rejectPending?.(new Error('Hybrid Track stylesheet load was cancelled'));
    stylePromise = null;
    if (styleElement?.isConnected) styleElement.remove();
    styleElement = null;
}
