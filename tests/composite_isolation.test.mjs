import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function repositoryFiles(relativeDirectory) {
    const root = path.join(repositoryRoot, relativeDirectory);
    const files = [];
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(absolute);
            else files.push(path.relative(repositoryRoot, absolute).replaceAll('\\', '/'));
        }
    };
    walk(root);
    return files.sort();
}

test('Hybrid Track is lazy and leaves normal Editor startup feature-free', () => {
    const main = read('src/main.js');
    assert.doesNotMatch(main, /from ['"]\.\/composite\//,
        'normal Editor startup must not statically import a Hybrid module');
    assert.match(main, /import\(['"]\.\/composite\/entry\.js['"]\)/,
        'the menu command loads the feature entry on demand');
    assert.doesNotMatch(main, /installHybridPerformanceTools/,
        'Hybrid diagnostics must not install during normal Editor startup');
});

test('Hybrid styling is a feature-owned, fully namespaced asset', () => {
    const theme = read('assets/v3-theme.css');
    const hybrid = read('assets/composite/hybrid.css');
    const entry = read('src/composite/entry.js');
    assert.doesNotMatch(theme, /editor-composite/,
        'the shared Editor theme must not contain Hybrid rules');
    assert.match(entry, /assets\/composite\/hybrid\.css/);
    assert.match(entry,
        /function editorTeardownCompositeArrangementUi[\s\S]*uninstallHybridPerformanceTools\(\)/,
        'screen teardown must detach feature-owned diagnostics');
    assert.match(hybrid, /#editor-composite-modal/);
    const selectorsOnly = hybrid.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const line of selectorsOnly.split(/\r?\n/)) {
        const selector = line.trim();
        if (!selector.endsWith('{') || selector.startsWith('@')) continue;
        assert.match(selector, /^#editor-composite-modal\b/,
            `unscoped Hybrid selector: ${selector}`);
    }
    assert.equal((hybrid.match(/\{/g) || []).length, (hybrid.match(/\}/g) || []).length,
        'the feature stylesheet must have balanced blocks');
});

test('Hybrid creation uses normal Editor history without a private backend write', () => {
    const resolver = read('src/composite/resolver-ui.js');
    const adapter = read('src/composite/editor-adapter.js');
    assert.match(resolver, /commitCompositeArrangement\(arrangement\)/);
    assert.match(adapter, /history\.exec\(command\)/,
        'the feature boundary must commit one undoable Editor command');

    for (const file of repositoryFiles('src/composite').filter(name => name.endsWith('.js'))) {
        const source = read(file);
        assert.doesNotMatch(source,
            /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
            `${file} must not write through the Editor backend`);
        assert.doesNotMatch(source, /\bsendBeacon\s*\(/,
            `${file} must not persist through a beacon`);
        const endpoints = source.match(
            /\/api\/plugins\/editor\/[A-Za-z0-9_./{}-]*/g,
        ) || [];
        for (const endpoint of endpoints) {
            assert.ok(endpoint.startsWith('/api/plugins/editor/wafont/'),
                `${file} reaches unexpected Editor endpoint ${endpoint}`);
        }
    }
});

test('Hybrid audition reaches Editor audio and loop state only through its adapter', () => {
    const resolver = read('src/composite/resolver-ui.js');
    const imports = resolver.slice(0, resolver.indexOf('export const HYBRID_DIALOG_STYLE'));
    assert.doesNotMatch(imports,
        /from ['"]\.\.\/(?:audio|loop|state)\.js['"]/,
        'the player-facing feature UI must not own normal Editor transport policy');
    assert.match(resolver, /createCompositePreviewController/);
    assert.match(resolver, /stopCompositeEditorPlayback\(\)/);
    assert.match(resolver, /keepCompositeEditorLoop\(region\)/,
        'the one explicit Editor-loop handoff stays visible at the boundary');
});

test('Hybrid music helpers enter through narrow feature-owned ports', () => {
    const ports = new Map([
        ['src/composite/timing-ports.js', ['beatAtTime', 'timeAtBeat']],
        ['src/composite/arrangement-ports.js', [
            'arrangementKind', 'isFrettedArrangementKind',
        ]],
        ['src/composite/fretboard-ports.js', [
            'openMidiForArrangement', 'soundingPitchForFret',
            'stringCountForArrangement',
        ]],
        ['src/composite/reference-audio-ports.js', [
            'audioRegionPlacements', 'audioRegionStart',
        ]],
    ]);
    for (const [file, aliases] of ports) {
        const port = read(file);
        assert.doesNotMatch(port, /from ['"]\.\.\/(?:state|host|loop|history)\.js['"]/,
            `${file} must not acquire Editor state or transport policy`);
        for (const alias of aliases) {
            assert.match(port, new RegExp(`\\bas ${alias}\\b`),
                `${file} must expose the feature-facing ${alias} name`);
        }
        assert.doesNotMatch(port, /\bas\s+_[A-Za-z]/,
            `private core helper names must not leak through ${file}`);
    }

    const directCoreImport = /from ['"]\.\.\/(?:beats|instrument|lanes|audio)\.js['"]/;
    const boundaryFiles = new Set([
        'src/composite/editor-adapter.js',
        ...ports.keys(),
    ]);
    for (const file of repositoryFiles('src/composite').filter(name =>
        name.endsWith('.js') && !boundaryFiles.has(name))) {
        assert.doesNotMatch(read(file), directCoreImport,
            `${file} must import music helpers through a narrow feature port`);
    }

    assert.doesNotMatch(read('src/composite/timing-ports.js'), /audio\.js/,
        'timing-only planners must not load the stateful Editor audio graph');
});

test('Hybrid DOM helpers enter through one feature-owned UI port', () => {
    const port = read('src/composite/ui-ports.js');
    for (const alias of [
        'escapeEditorMarkup',
        'promptEditorChoice',
        'installEditorModalKeyboard',
    ]) {
        assert.match(port, new RegExp(`\\bas ${alias}\\b`),
            `ui-ports.js must expose the feature-facing ${alias} name`);
    }
    assert.doesNotMatch(port, /\bas\s+_[A-Za-z]/,
        'private core UI helper names must not leak through the feature boundary');

    const directUiImport = /from ['"]\.\.\/ui\.js['"]/;
    const boundaryFiles = new Set([
        'src/composite/editor-adapter.js',
        'src/composite/ui-ports.js',
    ]);
    for (const file of repositoryFiles('src/composite').filter(name =>
        name.endsWith('.js') && !boundaryFiles.has(name))) {
        assert.doesNotMatch(read(file), directUiImport,
            `${file} must import DOM helpers through ui-ports.js`);
    }
});

test('only the two deliberate normal-Editor hooks mention the Hybrid feature', () => {
    const normalSources = repositoryFiles('src').filter(file =>
        file.endsWith('.js') && !file.startsWith('src/composite/'));
    const featureMarker = /\bHybrid\b|editorComposite|CompositeArrangement|editor-composite|['"]\.\/composite\//i;
    const legacyCorePreviewHook = /editor(?:ClearGuidePreview|PlaybackVisualTime|PrepareGuidePreview|SetGuidePreview|UpdateGuidePreviewMix|WarmGuidePreview)/;
    const mentioned = [];
    for (const file of normalSources) {
        const source = read(file);
        if (featureMarker.test(source)) mentioned.push(file);
        assert.doesNotMatch(source, legacyCorePreviewHook,
            `${file} must not regain feature-specific preview policy`);
    }
    assert.deepEqual(mentioned, ['src/main.js', 'src/menu-bar.js'],
        'normal Editor integration is limited to the lazy command and its menu item');

    const main = read('src/main.js');
    assert.equal((main.match(/import\(['"]\.\/composite\/entry\.js['"]\)/g) || []).length, 1);
    assert.doesNotMatch(main, /from ['"]\.\/composite\//,
        'the normal startup graph must remain feature-free');
    const menu = read('src/menu-bar.js');
    assert.match(menu, /Create Hybrid Track…[^\n]+editorShowCompositeArrangementModal/);
    assert.doesNotMatch(menu, /(?:from|import\()\s*['"]\.\/composite\//,
        'the menu hook must not load implementation code');
});
