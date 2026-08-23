import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const lazyBlock = mainSource.match(
    /\/\* @pure:hybrid-lazy-loader:start \*\/[\s\S]*?\/\* @pure:hybrid-lazy-loader:end \*\//,
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((accept, decline) => {
        resolve = accept;
        reject = decline;
    });
    return { promise, resolve, reject };
}

function loadLazyBoundary(loadFeatureModule) {
    assert.ok(lazyBlock, 'main.js exposes the focused lazy-loader test block');
    const windowObject = {};
    const statuses = [];
    const errors = [];
    const executable = lazyBlock[0]
        .replace(/\/\* @pure:hybrid-lazy-loader:(?:start|end) \*\//g, '')
        .replace("import('./composite/entry.js')", 'loadFeatureModule()');
    const boundary = new Function(
        'window', 'setStatus', 'console', 'loadFeatureModule',
        `${executable}\nreturn {`
            + ' show: () => window.editorShowCompositeArrangementModal(),'
            + ' teardown: _teardownHybridFeature,'
            + '};',
    )(
        windowObject,
        message => statuses.push(message),
        { error: (...args) => errors.push(args) },
        loadFeatureModule,
    );
    return { ...boundary, statuses, errors };
}

test('a stale Hybrid import cannot tear down a newer reinjection', async () => {
    const firstImport = deferred();
    const secondImport = deferred();
    const imports = [firstImport.promise, secondImport.promise];
    let importIndex = 0;
    let opens = 0;
    let teardowns = 0;
    const feature = {
        async editorShowCompositeArrangementModal() {
            opens++;
            return true;
        },
        editorTeardownCompositeArrangementUi() {
            teardowns++;
        },
    };
    const boundary = loadLazyBoundary(() => imports[importIndex++]);

    const staleOpen = boundary.show();
    boundary.teardown();
    const currentOpen = boundary.show();

    secondImport.resolve(feature);
    assert.equal(await currentOpen, true);
    assert.equal(opens, 1);

    firstImport.resolve(feature);
    assert.equal(await staleOpen, false);
    assert.equal(teardowns, 0,
        'the stale caller owns no entry side effects and must not close the current modal');
    assert.deepEqual(boundary.statuses, []);
    assert.deepEqual(boundary.errors, []);

    boundary.teardown();
    assert.equal(teardowns, 1, 'the active generation remains owned by normal teardown');
});
