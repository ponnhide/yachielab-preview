'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const {createPlan, runPlan} = require('../../scripts/check.cjs');
const root = path.resolve(__dirname, '../..');

test('the check entrypoint finds every current and future nested regression without shell globs', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-checks-'));
  try {
    for (const file of ['tests/cms/render.test.mjs', 'tests/js/runtime.test.cjs', 'tests/js/new/nested.test.cjs', 'tests/js/browser-harness.cjs']) {
      fs.mkdirSync(path.dirname(path.join(temporary, file)), {recursive: true});
      fs.writeFileSync(path.join(temporary, file), '');
    }
    const plan = createPlan(temporary, 'node');
    assert.deepEqual(plan[0].args.slice(1).map(file => path.relative(temporary, file)),
      ['tests/cms/render.test.mjs', 'tests/js/new/nested.test.cjs', 'tests/js/runtime.test.cjs']);
    fs.rmSync(path.join(temporary, 'tests/cms'), {recursive: true});
    assert.throws(() => createPlan(temporary, 'node'), /No cms regression tests/);
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});

test('running the entrypoint outside the repository still selects its own CMS, JS, Python and CSS checks', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/check.cjs'), '--list'], {cwd: os.tmpdir(), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.map(step => step.name), ['node', 'python', 'css', 'audit']);
  assert.ok(plan[0].args.includes(path.join(root, 'tests/cms/render.test.mjs')));
  assert.ok(plan[0].args.includes(path.join(root, 'tests/js/runtime.test.cjs')));
  assert.ok(plan[0].args.includes(path.join(root, 'tests/ci/check.test.cjs')));
});

test('a failed command returns failure while subsequent independent checks still run', () => {
  const logs = [];
  const code = runPlan([
    {name: 'broken', command: process.execPath, args: ['-e', 'process.exit(7)']},
    {name: 'next', command: process.execPath, args: ['-e', 'process.exit(0)']}
  ], {output: value => logs.push(value)});
  assert.equal(code, 1);
  assert.ok(logs.some(line => line === 'Running next checks' || line.endsWith('Running next checks')));
  assert.ok(logs.some(line => line === 'FAILED broken: exit 7'));
  assert.equal(logs.at(-1), '\nFailed checks: broken');
});

test('missing executables and interrupted processes cannot become a passing check', () => {
  for (const step of [
    {name: 'missing', command: path.join(os.tmpdir(), 'missing-preview-check-executable'), args: []},
    {name: 'interrupted', command: process.execPath, args: ['-e', 'process.kill(process.pid,"SIGTERM")']}
  ]) {
    const logs = [];
    assert.equal(runPlan([step], {output: value => logs.push(value)}), 1);
    assert.ok(logs.some(line => /^FAILED .*: (ENOENT|SIGTERM)$/.test(line)));
  }
});

test('invalid groups fail before executing a command', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/check.cjs'), 'publish'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown check group/);
  assert.equal(result.stdout, '');
});
