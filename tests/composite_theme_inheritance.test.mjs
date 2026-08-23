import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    applyHybridThemeInheritance,
    HYBRID_EDITOR_THEME_TOKEN_MAP,
} from '../src/composite/theme-inheritance.js';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

function cssVariables(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
    return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
        .map(([, name, value]) => [name, value.trim()]));
}

function relativeLuminance(hex) {
    const channels = hex.match(/[\da-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255)
        .map(value => value <= 0.03928
            ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left, right) {
    const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

function assertReadable(foreground, background, label) {
    assert.match(foreground, /^#[\da-f]{6}$/i, `${label} foreground must be testable hex`);
    assert.match(background, /^#[\da-f]{6}$/i, `${label} background must be testable hex`);
    assert.ok(contrast(foreground, background) >= 4.5,
        `${label} contrast is ${contrast(foreground, background).toFixed(2)}:1`);
}

class FakeStyle {
    constructor(values = {}) {
        this.values = new Map(Object.entries(values));
    }

    setProperty(name, value) {
        this.values.set(name, value);
    }

    removeProperty(name) {
        const previous = this.values.get(name) || '';
        this.values.delete(name);
        return previous;
    }

    getPropertyValue(name) {
        return this.values.get(name) || '';
    }
}

class FakeElement {
    constructor(attributes = {}) {
        this.attributes = new Map(Object.entries(attributes));
        this.style = new FakeStyle();
        this.ownerDocument = null;
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }
}

test('Hybrid theme bridge copies computed Editor tokens into feature-owned names', () => {
    const editor = new FakeElement({ 'data-editor-theme': 'light' });
    const modal = new FakeElement();
    modal.ownerDocument = {
        getElementById: id => id === 'plugin-editor' ? editor : null,
    };
    const computedValues = new Map(Object.keys(HYBRID_EDITOR_THEME_TOKEN_MAP)
        .map((name, index) => [name, `  rgb(${index} ${index + 1} ${index + 2})  `]));
    let styledElement = null;

    assert.equal(applyHybridThemeInheritance(modal, {
        getComputedStyleFn: element => {
            styledElement = element;
            return { getPropertyValue: name => computedValues.get(name) || '' };
        },
    }), true);
    assert.strictEqual(styledElement, editor);
    for (const [editorToken, hybridToken] of Object.entries(
        HYBRID_EDITOR_THEME_TOKEN_MAP)) {
        assert.equal(modal.style.getPropertyValue(hybridToken),
            computedValues.get(editorToken).trim());
    }
    assert.equal(modal.getAttribute('data-editor-theme'), 'light');
});

test('Hybrid theme bridge clears stale tokens and dark theme identity on reuse', () => {
    const editor = new FakeElement();
    const modal = new FakeElement({ 'data-editor-theme': 'medium' });
    for (const hybridToken of Object.values(HYBRID_EDITOR_THEME_TOKEN_MAP)) {
        modal.style.setProperty(hybridToken, 'stale');
    }
    const retainedEditorToken = '--ed-panel';
    const retainedHybridToken = HYBRID_EDITOR_THEME_TOKEN_MAP[retainedEditorToken];

    assert.equal(applyHybridThemeInheritance(modal, {
        editor,
        getComputedStyleFn: () => ({
            getPropertyValue: name => name === retainedEditorToken ? '#ffffff' : '',
        }),
    }), true);
    assert.equal(modal.style.getPropertyValue(retainedHybridToken), '#ffffff');
    for (const hybridToken of Object.values(HYBRID_EDITOR_THEME_TOKEN_MAP)) {
        if (hybridToken !== retainedHybridToken) {
            assert.equal(modal.style.getPropertyValue(hybridToken), '');
        }
    }
    assert.equal(modal.getAttribute('data-editor-theme'), null,
        'the Editor encodes its default dark identity by omitting the attribute');
});

test('Hybrid theme bridge fails closed when the source style is unavailable', () => {
    const editor = new FakeElement({ 'data-editor-theme': 'light' });
    const modal = new FakeElement();
    assert.equal(applyHybridThemeInheritance(modal, {
        editor,
        getComputedStyleFn: () => { throw new Error('style unavailable'); },
    }), false);
    assert.equal(modal.getAttribute('data-editor-theme'), null);
    assert.equal(applyHybridThemeInheritance(null, { editor, getComputedStyleFn: () => ({}) }),
        false);
});

test('Hybrid stylesheet themes chrome while keeping tablature surfaces dark', () => {
    const css = read('assets/composite/hybrid.css');
    assert.match(css, /--hybrid-chrome-app:\s*#0f172a/,
        'the feature retains the existing dark chrome as its fallback');
    assert.match(css,
        /#editor-composite-modal \.bg-dark-800 \{ background-color: var\(--hybrid-chrome-panel\); \}/);
    assert.match(css,
        /#editor-composite-modal \.text-gray-300 \{ color: var\(--hybrid-chrome-text\); \}/);
    assert.match(css,
        /#editor-composite-modal #editor-composite-timeline-scroller[\s\S]*background-color: var\(--hybrid-tablature-surface\)/);
    assert.match(css,
        /#editor-composite-modal \[data-composite-timeline-header\],[\s\S]*color-scheme: dark/);
    assert.doesNotMatch(css, /--hybrid-tablature-(?:surface|header):\s*var\(--hybrid-chrome-/,
        'tablature colors must remain independent from light and medium chrome');
});

test('Hybrid semantic chrome stays readable in medium and light themes', () => {
    const css = read('assets/composite/hybrid.css');
    const editorTheme = read('assets/v3-theme.css');
    const defaults = cssVariables(css, '#editor-composite-modal');
    const lightOverrides = cssVariables(css,
        '#editor-composite-modal[data-editor-theme="light"]');
    const light = { ...defaults, ...lightOverrides };
    const editorMedium = cssVariables(editorTheme,
        '#plugin-editor[data-v3-layout="1"][data-editor-theme="medium"]');
    const editorLight = cssVariables(editorTheme,
        '#plugin-editor[data-v3-layout="1"][data-editor-theme="light"]');

    const roles = ['info', 'secondary', 'success', 'warning', 'danger'];
    for (const role of roles) {
        assertReadable(defaults[`--hybrid-semantic-${role}`], editorMedium['--ed-panel'],
            `medium ${role} text`);
        assertReadable(defaults[`--hybrid-semantic-${role}-strong`],
            defaults[`--hybrid-semantic-${role}-surface`], `medium ${role} surface`);
        assertReadable(light[`--hybrid-semantic-${role}`], editorLight['--ed-panel'],
            `light ${role} text`);
        assertReadable(light[`--hybrid-semantic-${role}-strong`],
            light[`--hybrid-semantic-${role}-surface`], `light ${role} surface`);
    }
    for (const theme of [editorMedium, editorLight]) {
        assertReadable(theme['--ed-on-accent'], theme['--ed-accent'], 'accent action');
        assertReadable(theme['--ed-on-accent'], theme['--ed-accent-hover'],
            'accent hover action');
    }
    assertReadable(defaults['--hybrid-semantic-on-action'],
        defaults['--hybrid-semantic-action-success'], 'success action');
    assertReadable(defaults['--hybrid-semantic-on-action'],
        defaults['--hybrid-semantic-action-success-hover'], 'success hover action');
});

test('Hybrid semantic remaps stay in setup and review chrome, outside tablature', () => {
    const css = read('assets/composite/hybrid.css');
    assert.match(css,
        /\.bg-accent\s*\{[\s\S]*?color:\s*var\(--hybrid-chrome-on-accent\);[\s\S]*?\}/);
    assert.match(css,
        /#editor-composite-setup \.bg-sky-950\\\/20,[\s\S]*?var\(--hybrid-semantic-info-surface\)/);
    assert.match(css,
        /#editor-composite-setup \.bg-violet-950\\\/20[\s\S]*?var\(--hybrid-semantic-secondary-surface\)/);
    assert.match(css,
        /\.editor-composite-review-details-panel \.text-sky-300[\s\S]*?var\(--hybrid-semantic-info\)/);
    assert.match(css,
        /\[data-composite-review-notices\] \.bg-amber-950\\\/25[\s\S]*?var\(--hybrid-semantic-warning-surface\)/);
    assert.match(css,
        /#editor-composite-finish[\s\S]*?var\(--hybrid-semantic-on-action\)/);
    assert.doesNotMatch(css,
        /#editor-composite-timeline-(?:map|scroller)[^{]*\{[^}]*--hybrid-semantic-/,
        'semantic chrome variables must not recolor the fixed-dark notation surface');
});
