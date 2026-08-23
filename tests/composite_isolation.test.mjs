import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

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
    assert.doesNotMatch(resolver, /\/api\/plugins\/editor\/add-arrangement/);
    assert.match(resolver, /commitCompositeArrangement\(arrangement\)/);
    assert.match(adapter, /history\.exec\(command\)/,
        'the feature boundary must commit one undoable Editor command');
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

test('shared Editor modules never import the Hybrid feature', () => {
    for (const file of ['src/audio.js', 'src/gm-guide.js', 'src/playability-lint.js']) {
        const source = read(file);
        assert.doesNotMatch(source, /(?:from|import\()\s*['"]\.\/composite\//,
            `${file} must not depend on the optional feature`);
    }
});
