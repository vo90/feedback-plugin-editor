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

After exercising the builder:

```js
editorHybridPerformance.snapshot();
```

Disable it with:

```js
editorHybridPerformance.enable(false);
localStorage.removeItem('editorHybridPerf');
```

## Repeatable planner benchmark

```powershell
npm run benchmark:hybrid -- --notes=1000 --iterations=3
npm run benchmark:hybrid -- --notes=5000 --iterations=3
```

The benchmark is synthetic and complements, rather than replaces, profiling
with the real Majesty fixture.

## Required scenarios

- Automatic, Experimental, and Review sections yourself.
- Repeated-riff grouping and detached individual decisions.
- Review timeline, inspected Experimental passage, and Final Preview.
- Cold and warm Clean, Edge, and Distortion tones.
- Original, Lead, Rhythm, and Hybrid playback.
- Play, Space, Stop, Restart, mode replacement, click-seek, and drag-seek.
- Fit, 60, 120, 240, and 480 px/beat plus Ctrl+wheel five-pixel steps.
- Default and maximum lane heights.
- Restored, maximized, rapidly resized, and 4K/high-DPI windows.
- Sparse, Majesty, 5,000-note, and 20,000-note inputs.
- Twenty open/analyse/review/close cycles and multiple song switches.

## Release gates

- No omitted attack exactly at playback or seek start.
- No skipped guide attacks during uninterrupted Majesty playback.
- One decode attempt per GM sample zone while a load is in flight.
- Warm transport state change within 8 ms and visible by the next frame.
- Generated preview mute automation scheduled within 5 ms.
- No full SVG/DOM rebuild from a playback or input animation frame.
- No interaction-generated main-thread task over 50 ms during playback.
- Overview and main playheads update at the display refresh rate.
- Map dragging performs at most one committed audio seek and one resume.
- Cancel responds within 50 ms while background analysis is running.
- No recurring DOM-node or heap growth across the lifecycle soak test.
- Existing correctness, save, Undo, and merge suites pass.

## Profiling notes

Record at least one Chromium Performance trace for Majesty at 120 px/beat and
one at Compact zoom. Include playback, Ctrl+wheel zoom, overview drag, lane
resize, one review choice, and Stop. Record a second trace at 4K/DPR 2 when the
hardware is available. Keep the traces out of the repository because they can
contain large decoded audio buffers and local song metadata.
