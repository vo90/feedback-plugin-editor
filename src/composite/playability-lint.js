/* Hybrid-only fretted playability lint.
 *
 * The normal Editor keeps its established exhaustive overlap rule. Experimental
 * Hybrid analysis can inspect several full-song candidates, so it substitutes
 * an equivalent active-set sweep for that one potentially quadratic rule while
 * reusing the Editor's other public, DOM-free checks unchanged.
 */

import {
    LINT_CLUSTER_EPSILON,
    LINT_OVERLAP_EPSILON,
    _lintFingerConflictPure,
    _lintLegatoJumpPure,
    _lintOpenPure,
    _lintStretchPure,
} from '../playability-lint.js';

export function compositeLintOverlapPure(nn) {
    const issues = [];
    if (!Array.isArray(nn)) return issues;
    const byString = new Map();
    nn.forEach((n, i) => {
        if (!n || !Number.isInteger(n.string) || !Number.isFinite(n.time)) return;
        if (!byString.has(n.string)) byString.set(n.string, []);
        byString.get(n.string).push({ n, i });
    });
    for (const list of byString.values()) {
        list.sort((a, b) => a.n.time - b.n.time);
        let active = [];
        for (let k = 0; k < list.length; k++) {
            const cur = list[k];
            // Expired predecessors cannot overlap this or a later attack, so
            // the sweep retains only notes that can still produce an issue.
            active = active.filter(prev =>
                prev.n.time + (Number(prev.n.sustain) || 0) - cur.n.time
                    > LINT_OVERLAP_EPSILON);
            const immediate = k > 0 ? list[k - 1] : null;
            const immediateIsActive = immediate && active.includes(immediate);
            const immediateSameInstant = immediate
                && Math.abs(cur.n.time - immediate.n.time) < LINT_CLUSTER_EPSILON;
            if (immediateSameInstant && !immediateIsActive) active.push(immediate);
            // Walk newest to oldest to preserve the Editor rule's issue order.
            for (let j = active.length - 1; j >= 0; j--) {
                const prev = active[j];
                const prevEnd = prev.n.time + (Number(prev.n.sustain) || 0);
                const overlap = prevEnd - cur.n.time;
                const sameInstant = prev === immediate && immediateSameInstant;
                if (overlap > LINT_OVERLAP_EPSILON || sameInstant) {
                    issues.push({
                        rule: 'overlap', time: cur.n.time,
                        indices: [prev.i, cur.i],
                        detail: sameInstant
                            ? `two notes on string ${cur.n.string} at one instant`
                            : `string ${cur.n.string}: sustain overlaps a later note by ${overlap.toFixed(3)}s`,
                    });
                }
            }
            if (immediateSameInstant && !immediateIsActive) active.pop();
            active.push(cur);
        }
    }
    return issues;
}

export function compositePlayabilityLintPure(nn, anchors) {
    return [
        ..._lintStretchPure(nn, anchors),
        ...compositeLintOverlapPure(nn),
        ..._lintOpenPure(nn),
        ..._lintLegatoJumpPure(nn, anchors),
        ..._lintFingerConflictPure(nn),
    ].sort((a, b) => a.time - b.time);
}
