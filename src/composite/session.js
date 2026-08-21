/* Mutable state for one open Hybrid Track builder.
 *
 * Keeping the modal's plan, navigation, preview, and custom drafts together
 * makes cancellation/restoration explicit and avoids unrelated module globals.
 */

export function createHybridBuilderSession() {
    return {
        plan: null,
        conflictIndex: 0,
        previewMode: '',
        previewPlaying: false,
        previewRestore: null,
        customDrafts: new Map(),
    };
}

export function resetHybridBuilderReview(session) {
    session.plan = null;
    session.conflictIndex = 0;
    session.customDrafts.clear();
}
