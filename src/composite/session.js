/* Mutable state for one open Hybrid Track builder.
 *
 * Keeping the modal's plan, navigation, preview, and custom drafts together
 * makes cancellation/restoration explicit and avoids unrelated module globals.
 */

export function createHybridBuilderSession() {
    return {
        plan: null,
        analysisConfig: null,
        setupDirty: false,
        setupDirtyMessage: '',
        analyzing: false,
        stage: 'setup',
        hasReviewWork: false,
        conflictIndex: 0,
        previewMode: '',
        previewPlaying: false,
        previewLoading: false,
        previewRequestId: 0,
        previewRestore: null,
        previewRecordingGain: 1,
        wholeSongLoop: false,
        timelineSeekTime: 0,
        timelineScrollLeft: 0,
        timelineFocusReview: false,
        timelineFocusPassage: false,
        inspectedPassageId: '',
        passageFilter: 'all',
        previewLastMode: 'song',
        customDrafts: new Map(),
        creating: false,
        createRequestId: 0,
        createController: null,
        createSessionId: null,
        createPlan: null,
        closePromptPending: false,
        closeDecisionPromise: null,
        closeDecisionResolve: null,
    };
}

export function markHybridReviewWork(session) {
    if (session?.plan?.strategy === 'guided'
        || session?.plan?.strategy === 'experimental'
            && Array.isArray(session.plan.conflicts) && session.plan.conflicts.length) {
        session.hasReviewWork = true;
    }
    return !!session?.hasReviewWork;
}

export function hybridCloseGuardKind(session) {
    if (session?.creating) return 'creating';
    return session?.hasReviewWork ? 'review' : 'none';
}

export function hybridCloseAction(kind, choice) {
    if (kind === 'none') return 'close';
    if (choice !== 'discard') return 'keep';
    return kind === 'creating' ? 'cancel-creation' : 'discard-review';
}

export function beginHybridCreation(session, { sessionId, plan } = {}) {
    if (!session || session.creating || !sessionId || !plan) return null;
    const controller = new AbortController();
    const request = {
        id: ++session.createRequestId,
        sessionId,
        plan,
        controller,
    };
    session.creating = true;
    session.createController = controller;
    session.createSessionId = sessionId;
    session.createPlan = plan;
    return request;
}

export function hybridCreationIsCurrent(session, request, { sessionId, plan } = {}) {
    return !!(session && request && session.creating
        && session.createRequestId === request.id
        && session.createController === request.controller
        && session.createSessionId === request.sessionId
        && session.createPlan === request.plan
        && sessionId === request.sessionId
        && plan === request.plan);
}

export function completeHybridCreation(session, request) {
    if (!session || !request || session.createRequestId !== request.id) return false;
    session.creating = false;
    session.createController = null;
    session.createSessionId = null;
    session.createPlan = null;
    return true;
}

export function cancelHybridCreation(session) {
    if (!session) return false;
    const controller = session.createController;
    const wasCreating = !!session.creating;
    session.createRequestId++;
    session.creating = false;
    session.createController = null;
    session.createSessionId = null;
    session.createPlan = null;
    if (controller && !controller.signal.aborted) controller.abort();
    return wasCreating;
}

export function resetHybridBuilderReview(session) {
    cancelHybridCreation(session);
    session.plan = null;
    session.analysisConfig = null;
    session.setupDirty = false;
    session.setupDirtyMessage = '';
    session.analyzing = false;
    session.stage = 'setup';
    session.hasReviewWork = false;
    session.conflictIndex = 0;
    session.previewLoading = false;
    session.previewRecordingGain = 1;
    session.previewRequestId++;
    session.wholeSongLoop = false;
    session.timelineSeekTime = 0;
    session.timelineScrollLeft = 0;
    session.timelineFocusReview = false;
    session.timelineFocusPassage = false;
    session.inspectedPassageId = '';
    session.passageFilter = 'all';
    session.previewLastMode = 'song';
    session.customDrafts.clear();
    session.closePromptPending = false;
    session.closeDecisionPromise = null;
    session.closeDecisionResolve = null;
}
