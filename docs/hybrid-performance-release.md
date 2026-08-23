# Hybrid Track performance release checklist

This checklist protects the player-facing behavior of the Hybrid Track builder
while its transport, timeline, and analysis paths are optimized.

## Invariants

- Standard Automatic produces the same accepted and omitted notes for the same
  inputs and settings.
- Original source arrangements remain unchanged.
- Manual and repeated-section choices retain their current meaning.
- Review and Final Preview use the same timeline and transport behavior.
- Generated preview audio never mixes with the original recording.
- Closing, cancelling, Undo, and save-dirty behavior remain unchanged.

## Development telemetry

Telemetry is disabled by default and remains in memory on the local machine.
Before opening the builder, enable it from the Editor developer console:

```js
localStorage.editorHybridPerf = '1';
location.reload();
```

The opt-in persists in this isolated profile. Wait for the reloaded Editor to
be idle, open Hybrid Track, and play each required tone/source once to complete
cold sample loading. Stop playback, then clear startup and cold-load samples
immediately before the measured warm scenario:

```js
editorHybridPerformance.reset();
```

This reset is required because Chromium's buffered long-task observer can see
work completed before the Hybrid builder opened. After exercising the warm
scenario:

```js
editorHybridPerformance.snapshot();
editorHybridPerformance.assess();
```

`assess()` reports each measured release gate as pass, fail, or not run. Missing
interactions remain not run instead of being treated as successful; use the
scenario list below until the assessment is complete.

Disable it with:

```js
editorHybridPerformance.enable(false);
localStorage.removeItem('editorHybridPerf');
```

## Repeatable planner benchmark

```powershell
node scripts/hybrid-performance.mjs --notes=1000 --iterations=3
node scripts/hybrid-performance.mjs --notes=5000 --iterations=3
node scripts/hybrid-performance.mjs --notes=20000 --iterations=3
```

The benchmark is synthetic and complements, rather than replaces, profiling
with the real Majesty fixture. `ok` describes planner correctness, not an
acceptable duration. Every phase reports its first `coldMs` sample separately
from the `warm` summary; compare warm medians only after at least five isolated
iterations when making a release decision.

On the same machine and power profile, investigate a warm-median regression of
more than 25% from the recorded baseline. At 20,000 notes per source, the
player-facing resolved-entry, timeline-model, and overview phases should each
remain below 50 ms median, and visible-lane SVG work should remain below 16 ms
median. Planner computation runs in a Worker; its baseline budgets are 1.2 s
for Standard, 1.8 s for Guided, and 3.5 s for Experimental. Record the commit,
CPU, memory, Node/Electron version, window size, DPR, power state, and raw JSON
with every release run.

## Required scenarios

- Automatic, Experimental, and Review sections yourself.
- Repeated-riff grouping and detached individual decisions.
- Review timeline, inspected Experimental passage, and Final Preview.
- Cold and warm Clean, Edge, and Distortion tones.
- Original, Lead, Rhythm, and Hybrid playback.
- Space immediately after opening, before clicking the timeline; the stopped
  playhead and overview marker must already be visible at the current position.
- Play, Space, Stop, Restart, mode replacement, click-seek, and drag-seek.
- Restart keeps the main playhead and overview viewport synchronized.
- Fit, 60, 120, 240, and 480 px/beat plus Ctrl+wheel five-pixel steps.
- Change presets, Ctrl+wheel zoom, lane height, and window size during playback;
  Follow remains enabled unless the player explicitly toggles it off.
- Click and drag the overview at the first note, label-gutter boundary, middle,
  and song end; the pointer, viewport, and audible seek stay exact.
- Choose Base/Fill/Custom and use Previous/Next while playback is stopped and
  running; the review workspace and camera stay mounted.
- Default and maximum lane heights.
- Restored, maximized, rapidly resized, and 4K/high-DPI windows.
- Sparse, Majesty, 5,000-note, and 20,000-note inputs.
- Twenty open/analyse/review/close cycles and multiple song switches.
- Cancel analysis, switch songs during analysis/materialization, and verify a
  stale Worker response cannot replace or create work in the new session.

## Release gates

- No omitted attack exactly at playback or seek start.
- No skipped guide attacks during uninterrupted Majesty playback.
- One decode attempt per GM sample zone while a load is in flight.
- Warm transport state change within 8 ms and visible by the next frame.
- A warm Play request reaches running transport within 25 ms at p95.
- Generated preview mute automation scheduled within 5 ms.
- No full SVG/DOM rebuild from a playback or input animation frame.
- No interaction-generated main-thread task over 50 ms during playback.
- Overview and main playheads are scheduled once per display frame. On a
  nominal 60 Hz display the automated tolerance is p95 <= 25 ms; also inspect
  the trace for sustained low-rate stepping that a percentile can hide.
- A grouped dense overview marker opens the exact decision or passage painted
  at the pointer, including after a retained review choice changes its state.
- Map dragging performs at most one committed audio seek and one resume.
- Cancel responds within 50 ms while background analysis is running.
- After one warm-up cycle and explicit garbage collection, twenty lifecycle
  cycles retain zero Hybrid modal/timeline nodes after close and finish within
  the greater of 5% or 10 MB of the warm-up heap baseline. Capture before/after
  heap snapshots when either bound is exceeded.
- Existing correctness, save, Undo, and merge suites pass.
- The `[Unreleased]` changelog describes every player-visible change.

## Release evidence

Keep benchmark JSON and Chromium traces outside the repository because they
can contain local song metadata. Summarize the reproducible evidence here.

The measurements below are a historical, pre-isolation baseline. They were
captured before Hybrid audition moved from the shared Editor transport to its
feature-owned controller, so they must not be presented as release evidence
for the refactored branch without a fresh desktop trace and soak run.

| Field | Value |
| --- | --- |
| Date | 2026-08-23 |
| Historical measured code | `feature/hybrid-performance-release` at `aee04bd` |
| Machine | Intel Core i7-9750H, 6 cores / 12 threads, 15.8 GB RAM |
| Runtime | Node 24.18.0; Electron 35.7.5 |
| Power / graphics | Windows Balanced, AC power; GTX 1650 Max-Q + Intel UHD 630 |
| Synthetic sizes | 1,000 / 5,000 / 20,000 notes per source |
| Desktop fixture | Majesty; maximized native desktop |
| Native smoke | Passed Automatic preview, Space playback, preset zoom while playing, Follow retention, Restart synchronization, and Guided Previous/Next navigation |
| Iterations | 5 per size; first sample reported cold, remaining four summarized warm |
| Remaining evidence | DPR/window trace, warm desktop telemetry assessment, and 20-cycle heap soak |

Warm planner medians in milliseconds:

| Notes/source | Standard | Guided | Experimental |
| ---: | ---: | ---: | ---: |
| 1,000 | 38.28 | 95.92 | 93.95 |
| 5,000 | 153.57 | 267.20 | 406.39 |
| 20,000 | 515.99 | 1,220.42 | 2,090.27 |

The 20,000-note warm player-facing phase medians all remain inside their
budgets:

| Strategy | Resolved entries | Timeline model | Overview SVG | Visible lanes SVG |
| --- | ---: | ---: | ---: | ---: |
| Standard | 13.55 | 7.21 | 8.42 | 4.02 |
| Guided | 0.16 | 3.03 | 1.05 | 2.99 |
| Experimental | 4.56 | 13.36 | 10.65 | 2.12 |

At the same size, the Experimental comparison report was 14.10 ms warm median
and source guide-event conversion was 10.18 ms. The complete local measurement
summary is stored outside the repository with the other release artifacts.

The native Majesty smoke used Lead as the base and Rhythm as the fill. Before
playback, the red playhead and blue overview viewport were both initialized at
the beginning. Space started the original recording; switching from 120 to 60
px/beat during playback preserved Follow; Restart returned the playhead,
viewport, and scroll position together. Guided review advanced from decision 1
to 2 and back without rebuilding the workspace. The temporary review choice
was discarded and no Hybrid track or feedpak change was saved.

## Profiling notes

Record at least one Chromium Performance trace for Majesty at 120 px/beat and
one at Compact zoom. Include playback, Ctrl+wheel zoom, overview drag, lane
resize, one review choice, and Stop. Record a second trace at 4K/DPR 2 when the
hardware is available. Keep the traces out of the repository because they can
contain large decoded audio buffers and local song metadata.
