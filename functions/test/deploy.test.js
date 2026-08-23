// The deploy filter is hand-maintained, and a function missing from it is
// never deployed — silently, with a green build. These tests make that
// failure loud and local instead.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-reminders.yml'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));

const codebase = firebaseJson.functions[0].codebase;
const exported = [...index.matchAll(/^exports\.(\w+)\s*=/gm)].map((m) => m[1]);

test('every exported function is named in the deploy filter', () => {
    assert.ok(exported.length > 0, 'no exports found — the regex is wrong');
    for (const fn of exported) {
        assert.ok(
            workflow.includes(`functions:${codebase}:${fn}`),
            `${fn} is exported but missing from the deploy filter — it would never ship`
        );
    }
});

test('the deploy filter carries the codebase prefix', () => {
    // Without it the filter matches nothing and the deploy aborts with
    // "No function matches given --only filters".
    const bare = exported.filter((fn) => workflow.includes(`--only functions:${fn}`)
        || workflow.includes(`,functions:${fn},`));
    assert.deepStrictEqual(bare, [], `these lack the ${codebase}: prefix: ${bare.join(', ')}`);
});

test('the deploy is never a bare functions deploy', () => {
    // A bare deploy DELETES any deployed function missing from source.
    assert.ok(!/--only\s+functions[,\s]/.test(workflow), 'bare `--only functions` found');
});
