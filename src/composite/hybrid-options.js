/* Dependency-free Hybrid Track UI and playback options.
 *
 * Keep these values in a leaf module so timeline rendering and the private
 * preview transport do not load preference storage or planning engines.
 */

// Display-only Overview may need well below one pixel per beat for unusually
// long charts. Persisted/readable Notes zoom still has its separate 5 px floor.
export const HYBRID_TIMELINE_ZOOM_MIN = 0.01;
export const HYBRID_TIMELINE_ZOOM_MAX = 480;
export const HYBRID_TIMELINE_ZOOM_CONTROL_MIN = 5;
export const HYBRID_TIMELINE_ZOOM_STEP = 5;
export const HYBRID_TIMELINE_LANE_MIN = 128;
export const HYBRID_TIMELINE_LANE_MAX = 320;
export const HYBRID_TIMELINE_DISPLAY_NOTES = 'notes';
export const HYBRID_TIMELINE_DISPLAY_OVERVIEW = 'overview';
export const HYBRID_TIMELINE_FOLLOW_CENTERED = 'centered';
export const HYBRID_TIMELINE_FOLLOW_PAGED = 'paged';
export const HYBRID_TIMELINE_FOLLOW_OFF = 'off';
export const HYBRID_PREVIEW_DEFAULTS = Object.freeze({
    tone: 'clean',
    volume: 75,
    timelineZoom: 120,
    timelineDisplayMode: HYBRID_TIMELINE_DISPLAY_NOTES,
    laneHeights: Object.freeze({ primary: 158, secondary: 158, result: 158 }),
    timelineFollowMode: HYBRID_TIMELINE_FOLLOW_CENTERED,
});

// These are Hybrid-builder audition presets, deliberately separate from the
// Editor's general per-instrument guide voice. The trims level-match the
// active sample material in the vendored FluidR3 programs: programs 29 and 30
// are naturally about 3.25 dB and 4.62 dB louder than program 27 respectively.
export const HYBRID_PREVIEW_TONES = Object.freeze([
    Object.freeze({ id: 'clean', label: 'Clean', gm: 27, trimGain: 1 }),
    Object.freeze({ id: 'edge', label: 'Edge', gm: 29, trimGain: 10 ** (-3.25 / 20) }),
    Object.freeze({ id: 'distortion', label: 'Distortion', gm: 30, trimGain: 10 ** (-4.62 / 20) }),
]);

export const HYBRID_GAP_FILL_CONTROL_CONFIG = Object.freeze({
    beats: Object.freeze({
        minimumMax: 16, minimumStep: 0.25, marginMax: 8, marginStep: 0.125,
    }),
    seconds: Object.freeze({
        minimumMax: 30, minimumStep: 0.05, marginMax: 10, marginStep: 0.025,
    }),
});
