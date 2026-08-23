import { performance } from 'node:perf_hooks';

import { analyzeExperimentalAutoComposite } from '../src/composite/experimental-auto-engine.js';
import { analyzeGapFillComposite } from '../src/composite/gap-fill-engine.js';
import { analyzeGuidedComposite } from '../src/composite/guided-engine.js';

function numericArg(name, fallback) {
    const prefix = `--${name}=`;
    const raw = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const noteCount = numericArg('notes', 1000);
const iterations = numericArg('iterations', 3);
const secondsPerBeat = 0.5;
const beatCount = noteCount * 2 + 32;
const beats = Array.from({ length: beatCount }, (_, index) => ({
    time: index * secondsPerBeat,
    measure: index % 4 === 0 ? index / 4 + 1 : -1,
}));

function note(index, sourceOffset) {
    const beat = index * 2 + sourceOffset;
    return {
        beat,
        beatEnd: beat + 0.2,
        time: beat * secondsPerBeat,
        sustain: secondsPerBeat * 0.2,
        string: index % 6,
        fret: (index * 5 + sourceOffset) % 19,
        techniques: index % 17 === 0 ? { palm_mute: true } : {},
    };
}

function arrangement(name, sourceOffset) {
    return {
        name,
        type: 'guitar',
        tuning: [0, 0, 0, 0, 0, 0],
        capo: 0,
        notes: Array.from({ length: noteCount }, (_, index) => note(index, sourceOffset)),
        chords: [],
        chord_templates: [],
        anchors: [],
        anchors_user: [],
        handshapes: [],
        phrases: [],
    };
}

const sources = {
    primary: arrangement('Benchmark Lead', 0),
    secondary: arrangement('Benchmark Rhythm', 1),
    beats,
    sections: [],
};
const gapFill = { unit: 'beats', minimumGap: 1, transitionMargin: 0.25 };

function summary(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = ratio => sorted[Math.min(sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
    return {
        medianMs: Number(percentile(0.5).toFixed(2)),
        p95Ms: Number(percentile(0.95).toFixed(2)),
        maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    };
}

function measure(name, callback) {
    const samples = [];
    let lastResult = null;
    for (let iteration = 0; iteration < iterations; iteration++) {
        const start = performance.now();
        lastResult = callback();
        samples.push(performance.now() - start);
    }
    return {
        name,
        ...summary(samples),
        ok: lastResult?.ok === true,
        decisions: lastResult?.conflicts?.length || 0,
    };
}

const results = [
    measure('standard', () => analyzeGapFillComposite({ ...sources, gapFill })),
    measure('guided', () => analyzeGuidedComposite({ ...sources, repeatMode: 'matching-riffs' })),
    measure('experimental', () => analyzeExperimentalAutoComposite({
        ...sources, gapFill, profile: 'balanced',
    })),
];

process.stdout.write(`${JSON.stringify({ noteCountPerSource: noteCount, iterations, results }, null, 2)}\n`);
