'use strict';
// The same offline commands run locally and in GitHub Actions. No service credentials.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const groups = ['node', 'python', 'css', 'audit'];

function testFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? testFiles(filename) :
      entry.isFile() && /\.test\.(?:cjs|mjs)$/.test(entry.name) ? [filename] : [];
  }).sort();
}

function createPlan(projectRoot, group = 'all', python = process.env.PYTHON || 'python3') {
  if (group !== 'all' && !groups.includes(group)) throw new Error('Unknown check group: ' + group);
  const selected = group === 'all' ? groups : [group];
  return selected.map(name => {
    if (name === 'node') {
      const files = testFiles(path.join(projectRoot, 'tests'));
      for (const required of ['cms', 'js']) {
        if (!files.some(file => file.startsWith(path.join(projectRoot, 'tests', required) + path.sep))) {
          throw new Error('No ' + required + ' regression tests found.');
        }
      }
      return {name, command: process.execPath, args: ['--test', ...files]};
    }
    const scripts = {
      python: {command: python, args: ['scripts/test_site_audit.py']},
      css: {command: process.execPath, args: ['tests/css/check.mjs']},
      audit: {command: python, args: ['scripts/site_audit.py', '--check']}
    };
    const step = scripts[name];
    if (!fs.existsSync(path.join(projectRoot, step.args[0]))) throw new Error('Missing check: ' + step.args[0]);
    return {name, ...step};
  });
}

function runPlan(plan, {cwd = root, execute = spawnSync, output = console.log, env = process.env} = {}) {
  const failed = [];
  for (const step of plan) {
    output('\nRunning ' + step.name + ' checks');
    const result = execute(step.command, step.args, {
      cwd, stdio: 'inherit', shell: false,
      env: {...env, PYTHONDONTWRITEBYTECODE: '1'}
    });
    if (result.error || result.signal || result.status !== 0) {
      const reason = result.error ? result.error.code || 'process error' : result.signal || 'exit ' + result.status;
      output('FAILED ' + step.name + ': ' + reason);
      failed.push(step.name);
    }
  }
  output(failed.length ? '\nFailed checks: ' + failed.join(', ') : '\nAll checks passed.');
  return failed.length ? 1 : 0;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), list = args.includes('--list');
    const positional = args.filter(arg => arg !== '--list');
    if (positional.length > 1) throw new Error('Usage: node scripts/check.cjs [all|node|python|css|audit] [--list]');
    const plan = createPlan(root, positional[0] || 'all');
    if (list) console.log(JSON.stringify(plan, null, 2));
    else process.exitCode = runPlan(plan);
  } catch (error) {
    console.error('Checks could not start: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = {createPlan, runPlan};
