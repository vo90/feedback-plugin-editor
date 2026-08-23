/* Mutable state for one open Hybrid Track builder.
 *
 * Keeping the modal's plan, navigation, preview, and custom drafts together
 * makes cancellation/restoration explicit and avoids unrelated module globals.
 */

export function createHybridBuilderSession() {
    return {
        plan: null,
        planSessionId: null,
        planEditGeneration: null,
        planSourceGuard: null,
        planRevision: 0,
        resolutionRevision: 0,
        analysisConfig: null,
        setupDirty: false,
        setupDirtyMessage: '',
        analyzing: false,
        analysisRequestId: 0,
        analysisController: null,
        analysisSessionId: null,
        analysisEditGeneration: null,
        analysisConfigToken: null,
        analysisSourceGuard: null,
        stage: 'setup',
        hasReviewWork: false,
        conflictIndex: 0,
        previewMode: '',
        previewPlaying: false,
        previewLoading: false,
        previewRequestId: 0,
        previewController: null,
        previewControllerSessionId: null,
        previewControllerGeneration: 0,
        previewControllerPending: null,
        previewControllerDestroyPromise: null,
        previewRecordingGain: 1,
        wholeSongLoop: false,
        timelineSeekTime: 0,
        timelineScrollLeft: 0,
        timelineNotesScrollLeft: 0,
        timelineFocusReview: false,
        previewLastMode: 'song',
        customDrafts: new Map(),
        creating: false,
        createRequestId: 0,
        createController: null,
        createSessionId: null,
        createEditGeneration: null,
        createPlan: null,
        closePromptPending: false,
        closeDecisionPromise: null,
        closeDecisionResolve: null,
    };
}

export function beginHybridAnalysis(session, {
    sessionId, configToken, editGeneration, sourceGuard = null,
} = {}) {
    if (!session || session.analyzing || !sessionId || !configToken) return null;
    const controller = new AbortController();
    const request = {
        id: ++session.analysisRequestId,
        sessionId,
        editGeneration: Number.isFinite(Number(editGeneration))
            ? Math.trunc(Number(editGeneration)) : null,
        configToken,
        sourceGuard,
        controller,
    };
    session.analyzing = true;
    session.analysisController = controller;
    session.analysisSessionId = sessionId;
    session.analysisEditGeneration = request.editGeneration;
    session.analysisConfigToken = configToken;
    session.analysisSourceGuard = sourceGuard;
    return request;
}

export function hybridAnalysisIsCurrent(session, request, {
    sessionId, configToken, editGeneration, sourceGuard = request?.sourceGuard,
} = {}) {
    return !!(session && request && session.analyzing
        && session.analysisRequestId === request.id
        && session.analysisController === request.controller
        && session.analysisSessionId === request.sessionId
        && session.analysisEditGeneration === request.editGeneration
        && session.analysisConfigToken === request.configToken
        && session.analysisSourceGuard === request.sourceGuard
        && sessionId === request.sessionId
        && (request.editGeneration === null
            || request.editGeneration === Math.trunc(Number(editGeneration)))
        && configToken === request.configToken
        && sourceGuard === request.sourceGuard
        && !request.controller.signal.aborted);
}

export function completeHybridAnalysis(session, request) {
    if (!session || !request || session.analysisRequestId !== request.id
            || session.analysisController !== request.controller) return false;
    session.analyzing = false;
    session.analysisController = null;
    session.analysisSessionId = null;
    session.analysisEditGeneration = null;
    session.analysisConfigToken = null;
    session.analysisSourceGuard = null;
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
    session.analysisEditGeneration = null;
    session.analysisConfigToken = null;
    session.analysisSourceGuard = null;
    if (controller && !controller.signal.aborted) controller.abort();
    return wasAnalyzing;
}

export function installHybridPlan(session, plan, sessionId = null, editGeneration = null,
    sourceGuard = null) {
    if (!session) return 0;
    session.plan = plan || null;
    session.planSessionId = session.plan && sessionId ? sessionId : null;
    session.planEditGeneration = session.plan && Number.isFinite(Number(editGeneration))
        ? Math.trunc(Number(editGeneration)) : null;
    session.planSourceGuard = session.plan ? sourceGuard : null;
    session.planRevision++;
    session.resolutionRevision = 0;
    return session.planRevision;
}

export function hybridPlanSessionIsCurrent(session, {
    sessionId, format, editGeneration,
} = {}) {
    return !!(session?.plan && session.planSessionId
        && session.planSessionId === sessionId
        && (session.planEditGeneration === null
            || session.planEditGeneration === Math.trunc(Number(editGeneration)))
        && format === 'sloppak');
}

export function markHybridResolutionChanged(session) {
    if (!session) return 0;
    session.resolutionRevision++;
    return session.resolutionRevision;
}

export function markHybridReviewWork(session) {
    if (session?.plan?.strategy === 'guided') {
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

export function beginHybridCreation(session, {
    sessionId, plan, editGeneration,
} = {}) {
    if (!session || session.creating || !sessionId || !plan) return null;
    const controller = new AbortController();
    const request = {
        id: ++session.createRequestId,
        sessionId,
        editGeneration: Number.isFinite(Number(editGeneration))
            ? Math.trunc(Number(editGeneration)) : null,
        plan,
        controller,
    };
    session.creating = true;
    session.createController = controller;
    session.createSessionId = sessionId;
    session.createEditGeneration = request.editGeneration;
    session.createPlan = plan;
    return request;
}

export function hybridCreationIsCurrent(session, request, {
    sessionId, plan, editGeneration,
} = {}) {
    return !!(session && request && session.creating
        && session.createRequestId === request.id
        && session.createController === request.controller
        && session.createSessionId === request.sessionId
        && session.createEditGeneration === request.editGeneration
        && session.createPlan === request.plan
        && sessionId === request.sessionId
        && (request.editGeneration === null
            || request.editGeneration === Math.trunc(Number(editGeneration)))
        && plan === request.plan
        && !request.controller.signal.aborted);
}

export function completeHybridCreation(session, request) {
    if (!session || !request || session.createRequestId !== request.id) return false;
    session.creating = false;
    session.createController = null;
    session.createSessionId = null;
    session.createEditGeneration = null;
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
    session.createEditGeneration = null;
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
    session.previewPlaying = false;
    session.previewMode = '';
    session.previewController = null;
    session.previewControllerSessionId = null;
    session.previewControllerPending = null;
    session.previewRecordingGain = 1;
    session.previewRequestId++;
    session.wholeSongLoop = false;
    session.timelineSeekTime = 0;
    session.timelineScrollLeft = 0;
    session.timelineNotesScrollLeft = 0;
    session.timelineFocusReview = false;
    session.previewLastMode = 'song';
    session.customDrafts.clear();
    session.closePromptPending = false;
    session.closeDecisionPromise = null;
    session.closeDecisionResolve = null;
}
