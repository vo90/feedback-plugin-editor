/* Mutable state for one open Hybrid Track builder.
 *
 * Keeping the modal's plan, navigation, preview, and custom drafts together
 * makes cancellation/restoration explicit and avoids unrelated module globals.
 */

export function createHybridBuilderSession() {
    return {
        plan: null,
        planRevision: 0,
        resolutionRevision: 0,
        viewRevision: 0,
        analysisConfig: null,
        setupDirty: false,
        setupDirtyMessage: '',
        analyzing: false,
        analysisRequestId: 0,
        analysisController: null,
        analysisSessionId: null,
        analysisConfigToken: null,
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

export function beginHybridAnalysis(session, { sessionId, configToken } = {}) {
    if (!session || session.analyzing || !sessionId || !configToken) return null;
    const controller = new AbortController();
    const request = {
        id: ++session.analysisRequestId,
        sessionId,
        configToken,
        controller,
    };
    session.analyzing = true;
    session.analysisController = controller;
    session.analysisSessionId = sessionId;
    session.analysisConfigToken = configToken;
    return request;
}

export function hybridAnalysisIsCurrent(session, request, { sessionId, configToken } = {}) {
    return !!(session && request && session.analyzing
        && session.analysisRequestId === request.id
        && session.analysisController === request.controller
        && session.analysisSessionId === request.sessionId
        && session.analysisConfigToken === request.configToken
        && sessionId === request.sessionId
        && configToken === request.configToken
        && !request.controller.signal.aborted);
}

export function completeHybridAnalysis(session, request) {
    if (!session || !request || session.analysisRequestId !== request.id
            || session.analysisController !== request.controller) return false;
    session.analyzing = false;
    session.analysisController = null;
    session.analysisSessionId = null;
    session.analysisConfigToken = null;
    return true;
}

export function cancelHybridAnalysis(session) {
    if (!session) return false;
    const controller = session.analysisController;
    const wasAnalyzing = !!session.analyzing;
    session.analysisRequestId++;
    session.analyzing = false;
    session.analysisController = null;
    session.analysisSessionId = null;
    session.analysisConfigToken = null;
    if (controller && !controller.signal.aborted) controller.abort();
    return wasAnalyzing;
}

export function installHybridPlan(session, plan) {
    if (!session) return 0;
    session.plan = plan || null;
    session.planRevision++;
    session.resolutionRevision = 0;
    session.viewRevision++;
    return session.planRevision;
}

export function markHybridResolutionChanged(session) {
    if (!session) return 0;
    session.resolutionRevision++;
    session.viewRevision++;
    return session.resolutionRevision;
}

export function markHybridViewChanged(session) {
    if (!session) return 0;
    return ++session.viewRevision;
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
    cancelHybridAnalysis(session);
    cancelHybridCreation(session);
    installHybridPlan(session, null);
    session.analysisConfig = null;
    session.setupDirty = false;
    session.setupDirtyMessage = '';
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
