/* Bridge the Editor's chrome theme into the body-mounted Hybrid modal.
 *
 * The modal is intentionally outside #plugin-editor so its fixed positioning
 * uses the desktop viewport. CSS custom properties therefore cannot inherit
 * naturally; copy only the stable chrome contract into feature-owned names.
 */

export const HYBRID_EDITOR_THEME_TOKEN_MAP = Object.freeze({
    '--ed-app': '--hybrid-chrome-app',
    '--ed-panel': '--hybrid-chrome-panel',
    '--ed-field': '--hybrid-chrome-field',
    '--ed-btn': '--hybrid-chrome-btn',
    '--ed-btn-hover': '--hybrid-chrome-btn-hover',
    '--ed-border': '--hybrid-chrome-border',
    '--ed-text-strong': '--hybrid-chrome-text-strong',
    '--ed-text-2': '--hybrid-chrome-text-2',
    '--ed-text': '--hybrid-chrome-text',
    '--ed-text-dim': '--hybrid-chrome-text-dim',
    '--ed-text-faint': '--hybrid-chrome-text-faint',
    '--ed-accent': '--hybrid-chrome-accent',
    '--ed-accent-hover': '--hybrid-chrome-accent-hover',
    '--ed-on-accent': '--hybrid-chrome-on-accent',
});

export function applyHybridThemeInheritance(modal, {
    editor = null,
    getComputedStyleFn = globalThis.getComputedStyle,
} = {}) {
    const source = editor || modal?.ownerDocument?.getElementById?.('plugin-editor');
    if (!modal?.style || !source || typeof getComputedStyleFn !== 'function') return false;

    let computed;
    try { computed = getComputedStyleFn(source); } catch (_) { return false; }
    if (!computed || typeof computed.getPropertyValue !== 'function') return false;

    for (const [editorToken, hybridToken] of Object.entries(
        HYBRID_EDITOR_THEME_TOKEN_MAP)) {
        const value = String(computed.getPropertyValue(editorToken) || '').trim();
        if (value) modal.style.setProperty(hybridToken, value);
        else modal.style.removeProperty(hybridToken);
    }

    const theme = String(source.getAttribute?.('data-editor-theme') || '').trim();
    if (theme) modal.setAttribute?.('data-editor-theme', theme);
    else modal.removeAttribute?.('data-editor-theme');
    return true;
}
