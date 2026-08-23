# Automatic Hybrid Merge — Investigation and Improvement Opportunities

Status: **Automatic Merge v2 implemented as the opt-in Experimental smart fill.**
Standard Automatic remains the unchanged default and control result. The
experimental preference is versioned, so a previous opt-in does not silently
authorize the v2 rules.

## Implementation record

| Audit opportunity | Automatic Merge v2 result |
| --- | --- |
| Riff-aware filling | Complete source gestures are segmented into passages at sections, shared phrase boundaries, bars, strong beats, meaningful rests, and a profile-specific maximum length. A timing-safe fragment of a larger passage is never silently auto-added. |
| Complete gesture relationships | Chords, trails, hammer-ons, pull-offs, local strum topology, links, and pitched slides are kept atomic. Reused importer strum numbers stay local; dangling connections are reported and left out. |
| Musical handoffs | Entry/exit space, structural boundaries, fret movement, attack-density changes, incomplete passages, and isolated notes feed a deterministic 0–100 handoff score. Hard timing remains authoritative. |
| Semantic duplicates | Play-equivalent notes can collapse despite teaching-only annotations or different raw strum IDs. Unknown authored fields and audible technique differences remain conservative. |
| Playability analysis | The completed result is compared with the untouched base track. New stretch and handoff warnings identify the affected passage without turning advisory findings into silent deletion. |
| Arrangement metadata | Known chord shapes/functions, complete handshapes, base phrases, fully selected fill phrases, and compatible tone changes are projected into the Hybrid. Anchors remain deliberately recomputed by the normal save path. Unsafe or undefined tone metadata is skipped with a visible warning. |
| Synchronization preflight | Ordered one-to-one note matching checks coherent offset and drift. Source-length and shared-grid differences are warnings; only strong coherent offset/drift evidence blocks Experimental analysis. |
| Player workflow | The final preview includes a filterable passage inspector, explicit outcomes/reasons, handoff measurements, clickable overview bands, focused playback, metadata warnings, and a copyable Standard-versus-Experimental report. |

The implementation contract lives separately from its algorithms so the
engine version, reason codes, and Strict/Balanced/Fill more policies stay
stable and testable. Synthetic validation of 10,000 notes completed in about
1.2 seconds on the development machine; the UI continues to virtualize the
visible timeline rather than rendering every note at once.

## Standard Automatic control behavior

Automatic Hybrid currently:

1. Verifies instrument family, tuning, string count, capo, and cent offset.
2. Flattens source notes and chords into playable entries.
3. Removes strict duplicates using a tempo-aware 1–5 ms timing tolerance.
4. Treats every base-track note and its complete trail as occupied.
5. Adds the configured safety margin before and after that occupancy.
6. Finds sufficiently large empty windows.
7. Adds a complete fill chord or connected gesture only if it fits entirely in one window.
8. Skips everything else without requiring review.
9. Performs a final cross-source, same-string overlap check.

This is a strong safety-first foundation, but it understands timing and individual gestures better than musical phrases, handoffs, or source-level chart metadata.

## Highest-value improvements

### 1. Riff-aware automatic filling

Build a hierarchy of notes, atomic gestures, short riffs, and candidate passages. Prefer complete phrases and trim only at sensible boundaries derived from authored phrases, song sections, bars, meaningful rests, and strong beats. This avoids accepting only the middle of a rhythm phrase after its pickup or ending was rejected.

### 2. Complete playable-gesture relationships

Duration-based trails, ties, and pitched slides are protected. Extend atomic grouping to hammer-on and pull-off arrivals, authored strum groups, and malformed or dangling technique connections. The engine should never emit an isolated destination or split an authored strum.

### 3. Musical handoff evaluation

Keep the configured margin as the absolute timing floor, then evaluate:

- time from the last base gesture to the first fill gesture;
- time from the last fill gesture to the returning base gesture;
- fret-position movement;
- attack density at both edges;
- bar and phrase alignment;
- isolated one-note insertions.

Classify questionable but timing-safe handoffs for optional review instead of silently including or deleting them.

### 4. Semantic duplicate handling

Distinguish:

- exact duplicates;
- musically equivalent notes whose teaching metadata differs;
- real variants in sustain, articulation, harmony, position, or audible technique.

Normalize inactive technique defaults and compare strum-group relationships rather than raw group numbers. Non-audible fields such as fret-finger and scale-degree annotations should not necessarily force a musical difference. Preserve the base track's annotations when collapsing a musically equivalent duplicate.

For larger timing differences, detect a consistent track-wide or measure-wide offset instead of exposing a dangerously broad duplicate-tolerance slider.

### 5. Broader playability analysis

In addition to impossible same-string overlaps, run advisory checks for extreme stretches, abrupt position changes, finger conflicts, broken legato sequences, open-string bends, and unusually dense handoffs. Only indisputably impossible cases should block creation.

### 6. Preserve arrangement metadata

Where a complete passage comes from one source, preserve compatible chord names, chord fingerings, arpeggio metadata, handshapes, phrases, and tone changes. Recompute anchors against the completed hybrid. The v2 implementation now preserves compatible selected metadata as described above; anchors are still intentionally recomputed rather than copied.

### 7. Synchronization preflight

Before merging, report whether the sources appear synchronized. Detect consistent timing offsets, measure drift, large length differences, unusually low duplicate correspondence, and notes significantly displaced from the shared grid.

## Recommended player workflow

Automatic results should classify passages as:

- **Added automatically** — safe, complete, and musically sensible.
- **Possible additions to review** — timing-safe but with an awkward boundary, incomplete phrase, or difficult handoff.
- **Left out** — genuine overlaps or broken gestures.

The user should be able to create the safe result immediately or select **Review possible additions**, which would reuse the existing Guided review UI only for uncertain passages. This is not Full Union.

Report passages as well as raw note counts, and make the result timeline clickable so each inserted passage and its two transitions can be auditioned. Show excluded regions and their reasons.

## Settings recommendation

Keep normal setup simple:

- **Strict** — complete phrases and generous transitions.
- **Balanced** — recommended default.
- **Fill more** — shorter phrases and tighter but still playable transitions.

Retain beats/seconds, minimum gap, and margin under Advanced rather than adding many new numeric controls.

## Longer-term possibilities

- Multiple ordered fill tracks.
- Editable merge recipes that can be regenerated after source edits.
- Section-level inclusion and exclusion controls.
- Audio-onset assistance as supporting evidence.
- Guitar-stem-aware scoring when reliable stems exist.
- Alternative automatic suggestions such as safer and more complete.

Audio analysis should not become the primary merge authority until it can reliably distinguish guitar attacks from drums and other instruments.

## Recommended implementation priority

1. Complete gesture grouping and semantic duplicate handling.
2. Add riff-aware candidate segmentation.
3. Add handoff scoring and avoid isolated insertions.
4. Surface safe, reviewable, and rejected passages.
5. Add alignment and full-playability diagnostics.
6. Preserve chord, phrase, handshape, and tone metadata.
7. Consider multiple fill tracks and audio-assisted scoring.

Automatic Merge v2 is now the implemented experimental milestone. The items
under **Longer-term possibilities** remain deliberately deferred: multiple fill
tracks, persistent/regenerable recipes, section-level overrides, audio or stem
analysis, and alternative-result generation are not part of this version.
