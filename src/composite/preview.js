/* Composite resolver preview helpers.
 *
 * Convert the merge engine's beat-based entries into the Editor audio
 * scheduler's pitched-event shape.  This stays pure so capo, tuning, trails,
 * and tempo-map conversion can be verified without WebAudio or a DOM.
 */

import { timeOf } from '../beats.js';
import { _openMidiForArr, _soundingPitchPure } from '../lanes.js';

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

// FluidR3's clean-electric samples average about -16.6 dBFS while active.
// WebAudioFont voices are scheduled at 0.5 (-6 dB), so -22.6 dBFS is the
// stable reference target shared by generated tones and the real recording.
// The recording analysis is deliberately conservative: it may turn a mastered
// mix down substantially, but it never chases silence or boosts beyond +6 dB.
export const COMPOSITE_PREVIEW_TARGET_RMS = 10 ** (-22.6 / 20);
const COMPOSITE_PREVIEW_GATE_RMS = 10 ** (-50 / 20);
const COMPOSITE_PREVIEW_PEAK_CEILING = 10 ** (-1 / 20);
const COMPOSITE_PREVIEW_MIN_RECORDING_GAIN = 10 ** (-18 / 20);
const COMPOSITE_PREVIEW_MAX_RECORDING_GAIN = 10 ** (6 / 20);
const COMPOSITE_PREVIEW_ANALYSIS_WINDOW_SECONDS = 0.05;
const COMPOSITE_PREVIEW_MAX_ANALYSIS_SAMPLES = 250000;

export function compositePreviewVolumeGainPure(volume) {
    const value = Number(volume);
    if (!Number.isFinite(value)) return 0.75;
    return Math.max(0, Math.min(100, value)) / 100;
}

export function compositePreviewMixPure(mode, {
    volume = 75,
    toneTrimGain = 1,
    recordingGain = 1,
} = {}) {
    const output = compositePreviewVolumeGainPure(volume);
    const tone = Math.max(0, Math.min(4, finite(toneTrimGain, 1)));
    const recording = Math.max(0, Math.min(4, finite(recordingGain, 1)));
    const guideOnly = mode === 'primary' || mode === 'secondary' || mode === 'result';
    return {
        referenceGain: mode === 'song' ? output * recording : 0,
        guideGain: guideOnly ? output * tone : 0,
    };
}

// Measure one fixed preview region without playing it.  Fifty-millisecond
// windows below -50 dBFS are gated out, so an intro/rest does not make the
// next real note jump in level.  Long whole-song previews are sampled with a
// bounded stride; short review sections still inspect every sample.  The
// returned gain is constant for the whole loop (no compressor pumping).
export function compositeRecordingPreviewLevelPure(buffer, startTime, endTime, options = {}) {
    const sampleRate = Number(buffer && buffer.sampleRate);
    const channelCount = Math.max(0, Math.trunc(Number(buffer && buffer.numberOfChannels) || 0));
    const frameCount = Math.max(0, Math.trunc(Number(buffer && buffer.length) || 0));
    if (!(sampleRate > 0) || !channelCount || !frameCount
            || typeof buffer.getChannelData !== 'function') {
        return { gain: 1, rms: 0, peak: 0, silent: true };
    }
    const rawStart = Number(startTime);
    const rawEnd = Number(endTime);
    const from = Math.max(0, Math.min(frameCount,
        Math.floor((Number.isFinite(rawStart) ? rawStart : 0) * sampleRate)));
    const fallbackEnd = frameCount / sampleRate;
    const to = Math.max(from, Math.min(frameCount,
        Math.ceil((Number.isFinite(rawEnd) ? rawEnd : fallbackEnd) * sampleRate)));
    if (to <= from) return { gain: 1, rms: 0, peak: 0, silent: true };

    const channels = [];
    try {
        for (let channel = 0; channel < channelCount; channel++) {
            const data = buffer.getChannelData(channel);
            if (data && typeof data.length === 'number') channels.push(data);
        }
    } catch (_) {
        return { gain: 1, rms: 0, peak: 0, silent: true };
    }
    if (!channels.length) return { gain: 1, rms: 0, peak: 0, silent: true };

    const maximumSamples = Math.max(1000,
        Math.trunc(finite(options.maximumSamples, COMPOSITE_PREVIEW_MAX_ANALYSIS_SAMPLES)));
    const stride = Math.max(1, Math.floor((to - from) * channels.length / maximumSamples));
    const windowFrames = Math.max(stride,
        Math.floor(sampleRate * COMPOSITE_PREVIEW_ANALYSIS_WINDOW_SECONDS));
    let activeSquares = 0;
    let activeSamples = 0;
    let peak = 0;
    for (let windowStart = from; windowStart < to; windowStart += windowFrames) {
        const windowEnd = Math.min(to, windowStart + windowFrames);
        let squares = 0;
        let samples = 0;
        for (let frame = windowStart; frame < windowEnd; frame += stride) {
            for (const channel of channels) {
                const sample = Number(channel[frame]) || 0;
                const magnitude = Math.abs(sample);
                if (magnitude > peak) peak = magnitude;
                squares += sample * sample;
                samples++;
            }
        }
        if (!samples) continue;
        const windowRms = Math.sqrt(squares / samples);
        if (windowRms >= COMPOSITE_PREVIEW_GATE_RMS) {
            activeSquares += squares;
            activeSamples += samples;
        }
    }
    if (!activeSamples) return { gain: 1, rms: 0, peak, silent: true };

    const rms = Math.sqrt(activeSquares / activeSamples);
    const targetRms = Math.max(0.001, finite(options.targetRms, COMPOSITE_PREVIEW_TARGET_RMS));
    const minimumGain = Math.max(0, finite(options.minimumGain, COMPOSITE_PREVIEW_MIN_RECORDING_GAIN));
    const maximumGain = Math.max(minimumGain,
        finite(options.maximumGain, COMPOSITE_PREVIEW_MAX_RECORDING_GAIN));
    const peakCeiling = Math.max(0.1, Math.min(1,
        finite(options.peakCeiling, COMPOSITE_PREVIEW_PEAK_CEILING)));
    const wanted = Math.max(minimumGain, Math.min(maximumGain, targetRms / rms));
    const peakSafe = peak > 0 ? peakCeiling / peak : maximumGain;
    return { gain: Math.max(0, Math.min(wanted, peakSafe)), rms, peak, silent: false };
}

function entryEndBeat(entry) {
    const start = finite(entry && entry.startBeat);
    return Math.max(start, finite(entry && entry.endBeat, start),
        finite(entry && entry.effectiveEndBeat, start));
}

export function compositePreviewEventsPure(entries, arrangement, beats, stringCount = 6) {
    const count = Math.max(1, Math.trunc(finite(stringCount, 6)));
    const openMidi = _openMidiForArr(arrangement || {}, count);
    const tuning = Array.isArray(arrangement && arrangement.tuning) ? arrangement.tuning : [];
    const capo = finite(arrangement && arrangement.capo);
    const events = [];
    for (const entry of entries || []) {
        const startBeat = finite(entry && entry.startBeat, Number.NaN);
        const string = Math.trunc(finite(entry && entry.string, Number.NaN));
        const fret = finite(entry && entry.fret, Number.NaN);
        if (!Number.isFinite(startBeat) || !Number.isFinite(string) || !Number.isFinite(fret)) continue;
        const midi = _soundingPitchPure(openMidi, tuning, capo, string, fret);
        if (!Number.isFinite(midi) || midi < 0 || midi > 127) continue;
        const startTime = timeOf(beats, startBeat);
        const endTime = timeOf(beats, entryEndBeat(entry));
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
        events.push({
            t: startTime,
            midi,
            sus: Math.max(0, endTime - startTime),
        });
    }
    return events.sort((a, b) => a.t - b.t || a.midi - b.midi || a.sus - b.sus);
}

export function compositePreviewRegionPure(context, beats) {
    const startBeat = finite(context && context.startBeat);
    const startTime = Math.max(0, timeOf(beats, startBeat));
    const rawEnd = timeOf(beats, finite(context && context.endBeat, startBeat + 1));
    const endTime = Math.max(startTime + 0.05, rawEnd);
    return { startTime, endTime, mode: 'bar' };
}

// The four player-facing audition choices. Keeping availability and wording
// DOM-free makes the contract testable: only one real/generated source is ever
// described as active, and an empty lane is explained instead of playing
// confusing silence.
export function compositePreviewModesPure(view, {
    audioAvailable = false,
    resultReady = false,
} = {}) {
    const lanes = new Map((view && Array.isArray(view.lanes) ? view.lanes : [])
        .map(lane => [lane.id, Array.isArray(lane.entries) ? lane.entries : []]));
    const names = view && view.names ? view.names : {};
    const laneMode = (id, label, ready = true, pendingReason = '') => {
        const hasNotes = (lanes.get(id) || []).length > 0;
        const available = ready && hasNotes;
        return {
            id,
            label,
            available,
            unavailableReason: !ready ? pendingReason
                : hasNotes ? '' : `${label.replace(/ only$/, '')} has no notes in this section.`,
        };
    };
    return [
        {
            id: 'song',
            label: 'Original song',
            available: !!audioAvailable,
            unavailableReason: audioAvailable ? '' : 'No recording is loaded.',
        },
        laneMode('primary', `${names.primary || 'Base track'} only`),
        laneMode('secondary', `${names.secondary || 'Fill track'} only`),
        laneMode('result', 'Hybrid only', !!resultReady, 'Choose what to play first.'),
    ];
}

// One mutually-exclusive audio contract for every Hybrid builder audition.
// The controller supplies a different event lane, but this policy guarantees
// the real recording and generated part never compete in the speaker output.
export function compositePreviewAudioPolicyPure(mode) {
    const guideOnly = mode === 'primary' || mode === 'secondary' || mode === 'result';
    return {
        referenceAudio: guideOnly ? 'muted' : 'audible',
        metronome: false,
        allowClapFallback: false,
    };
}
