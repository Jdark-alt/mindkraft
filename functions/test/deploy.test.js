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

test('composeQuest reads its key from the runtime environment', () => {
    // NOT Secret Manager: binding a secret makes the deploy call setIamPolicy,
    // which this CI service account is not permitted to do. The key is written
    // into functions/.env at deploy time instead, like the VAPID keys.
    const block = index.slice(index.indexOf('exports.composeQuest'));
    assert.ok(!/secrets:\s*\[/.test(block), 'must not declare a Secret Manager binding');

    const model = fs.readFileSync(path.join(__dirname, '..', 'lib', 'model.js'), 'utf8');
    assert.match(model, /process\.env\.ANTHROPIC_API_KEY/, 'the key comes from the environment');
    assert.match(workflow, /ANTHROPIC_API_KEY:\s*\$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
    assert.match(workflow, /printf 'ANTHROPIC_API_KEY=/);
});

test('the composer never writes to the user document itself', () => {
    // It READS users/{uid} for activities and writes the rate-limit counter —
    // but only into the aiUsage SUBCOLLECTION, which saveUserData()'s
    // full-document overwrite cannot clobber.
    const block = index.slice(index.indexOf('// ══ QUEST COMPOSER'));
    const writers = [...new Set([...block.matchAll(/(\w+)\.(set|update)\(/g)].map((m) => m[1]))];
    assert.deepStrictEqual(writers, ['ref'], 'only the aiUsage doc ref writes, got: ' + writers.join(','));
    assert.match(block, /collection\('aiUsage'\)\.doc\('questComposer'\)/);
    assert.ok(!/doc\(uid\)\.(set|update)\(/.test(block), 'never writes users/{uid} directly');
});

test('the uid is never taken from the payload', () => {
    const block = index.slice(index.indexOf('exports.composeQuest'));
    assert.match(block, /const uid = request\.auth\.uid;/);
    assert.ok(!/uid\s*=\s*(data|request\.data)/.test(block));
});

test('a failed composition costs the user nothing', () => {
    const block = index.slice(index.indexOf('exports.composeQuest'));
    const consumeAt = block.indexOf('consumeQuota(quota)');
    const specGuard = block.indexOf('if (!spec)');
    assert.ok(specGuard !== -1 && consumeAt > specGuard,
        'the quota is spent only after a valid spec exists');
    for (const reason of ['gate', 'ratelimit', 'model', 'invalid']) {
        assert.ok(block.includes(`reason: '${reason}'`), `returns reason '${reason}'`);
    }
});
