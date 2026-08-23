/* Stable data contract for the opt-in Experimental Automatic planner.
 *
 * Keep versioning, reason codes, and player-facing profile policy separate
 * from the detection algorithms. This gives reports, tests, and the UI one
 * deterministic vocabulary while Standard Automatic remains untouched.
 */

import {
    HYBRID_EXPERIMENTAL_PROFILE_BALANCED,
    HYBRID_EXPERIMENTAL_PROFILE_FILL_MORE,
    HYBRID_EXPERIMENTAL_PROFILE_STRICT,
} from './preferences.js';

export const HYBRID_EXPERIMENTAL_ENGINE_VERSION = 2;

export const EXPERIMENTAL_REASON = Object.freeze({
    TIMING_BLOCKED: 'timing-blocked',
    PARTIAL_GESTURE: 'partial-gesture',
    SHARED_DEPENDENCY: 'shared-dependency',
    BROKEN_CONNECTION: 'broken-connection',
    PARTIAL_PASSAGE: 'partial-passage',
    WEAK_ENTRY: 'weak-entry',
    WEAK_EXIT: 'weak-exit',
    ISOLATED: 'isolated-note',
    POSITION_ENTRY: 'position-entry',
    POSITION_EXIT: 'position-exit',
    DENSITY_ENTRY: 'density-entry',
    DENSITY_EXIT: 'density-exit',
    PLAYABILITY: 'playability',
});

export const EXPERIMENTAL_PROFILE_RULES = Object.freeze({
    [HYBRID_EXPERIMENTAL_PROFILE_STRICT]: Object.freeze({
        restBoundaryBeats: 1, handoffFrets: 5, minimumAutoNotes: 2,
        maximumBars: 2, densityRatio: 2.75, autoScore: 90, reviewScore: 62,
        weakBoundaryAction: 'left-out', isolatedAction: 'left-out',
    }),
    [HYBRID_EXPERIMENTAL_PROFILE_BALANCED]: Object.freeze({
        restBoundaryBeats: 0.75, handoffFrets: 7, minimumAutoNotes: 1,
        maximumBars: 4, densityRatio: 4, autoScore: 76, reviewScore: 42,
        weakBoundaryAction: 'review', isolatedAction: 'review',
    }),
    [HYBRID_EXPERIMENTAL_PROFILE_FILL_MORE]: Object.freeze({
        restBoundaryBeats: 0.5, handoffFrets: 10, minimumAutoNotes: 1,
        maximumBars: 6, densityRatio: 6, autoScore: 62, reviewScore: 30,
        weakBoundaryAction: 'automatic', isolatedAction: 'review',
    }),
});

export function normalizeExperimentalProfile(value) {
    return EXPERIMENTAL_PROFILE_RULES[value]
        ? value : HYBRID_EXPERIMENTAL_PROFILE_BALANCED;
}
