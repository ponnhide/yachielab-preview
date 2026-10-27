'use strict';
// Install only into the newly created unified workbook, never either original GAS project.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const original = require('./gas_sync.cjs');
const ROOT = path.resolve(__dirname, '..');
const TARGET = Object.freeze({
  scriptId: '1OXGZ7CPPLLYr1iYG7gUMFXUI5NuUAdHvmlKTZ5hIRK9kq1ZvN7NIQ-y8',
  spreadsheetId: '1LI4jAHL-3825jNSIznGX3cp3r7Bad-_DTiH9Pcq53j8',
  repository: 'ponnhide/yachielab-preview', branch: 'codex/preview'
});
function bundle(root = ROOT) {
  const source = original.sourceBundle(root, 'unified-preview-promotion');
  const files = {...source.files};
  files['PreviewIsolation.gs'] = files['PreviewIsolation.gs'].replace(original.TARGET.spreadsheetId, TARGET.spreadsheetId);
  original.assertGuard(files['PreviewIsolation.gs'], TARGET);
  const menu = /function onOpen\(\) \{[\s\S]*?\n\}/;
  if (!menu.test(files['Cms.gs'])) throw Error('Original menu was not found.');
  files['Cms.gs'] = files['Cms.gs'].replace(menu, 'function onOpen() {\n  cmsUnifiedOnOpen_();\n}');
  const marker = '    var stats = context.cacheStats || {};';
  if (!files['Cms.gs'].includes(marker)) throw Error('Preview save hook was not found.');
  files['Cms.gs'] = files['Cms.gs'].replace(marker, '    cmsUnifiedPreviewSaved_(result);\n' + marker);
  files['UnifiedRelease.gs'] = fs.readFileSync(path.join(root, 'cms/unified/Release.gs'), 'utf8');
  files['UnifiedControls.gs'] = fs.readFileSync(path.join(root, 'cms/unified/Controls.gs'), 'utf8');
  if (!files['UnifiedControls.gs'].includes(TARGET.spreadsheetId)) throw Error('Unified workbook guard mismatch.');
  delete files['BuildInfo.gs'];
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(original.canonical(files))).digest('hex');
  files['BuildInfo.gs'] = '// Generated for the unified workbook only.\nvar CMS_SOURCE_FINGERPRINT_ = ' + JSON.stringify(fingerprint) + ';\nvar CMS_SOURCE_GIT_REVISION_ = "unified-preview-promotion";\n';
  for (const [name, text] of Object.entries(files)) if (name.endsWith('.gs')) new vm.Script(text, {filename:name});
  return {files, fingerprint};
}
function writeProject(folder, files) {
  fs.mkdirSync(folder, {recursive:true, mode:0o700});
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text, {mode:0o600});
  fs.writeFileSync(path.join(folder, '.clasp.json'), JSON.stringify({scriptId:TARGET.scriptId, parentId:TARGET.spreadsheetId, rootDir:'.', scriptExtensions:['gs'], skipSubdirectories:true}), {mode:0o600});
  fs.writeFileSync(path.join(folder, '.claspignore'), '**/**\n!**/*.gs\n!**/appsscript.json\n');
}
function invoke(folder, args) {
  const env = {...process.env};
  for (const key of ['DEBUG','clasp_config_auth','clasp_config_project','clasp_config_ignore']) delete env[key];
  const p = spawnSync(process.execPath, [path.join(ROOT,'node_modules/@google/clasp/build/src/index.js'),'-A',path.join(ROOT,'private/gas-sync/.clasprc.json'),'-P',path.join(folder,'.clasp.json'),'-I',path.join(folder,'.claspignore'),'--json',...args], {cwd:folder, env, encoding:'utf8'});
  if (p.status !== 0 || p.error) throw Error('Apps Script request failed; detailed output withheld.');
  return JSON.parse(p.stdout);
}
function pull(folder, expected) {
  writeProject(folder, {});
  const roster = invoke(folder, ['pull']);
  original.validatePullRoster(roster, expected);
  const files = {};
  for (const name of roster.pulledFiles) files[name.replace(/\.js$/,'.gs')] = fs.existsSync(path.join(folder,name)) ? fs.readFileSync(path.join(folder,name),'utf8') : '';
  return files;
}
function main(mode) {
  if (!['plan','sync','verify'].includes(mode)) throw Error('Use plan, sync, or verify.');
  const candidate = bundle(), home = path.join(ROOT,'private/unified-cms');
  const stage = path.join(home,'stage');
  writeProject(stage, candidate.files);
  if (mode === 'plan') return console.log(JSON.stringify({target:TARGET, sourceFingerprint:candidate.fingerprint, files:Object.keys(candidate.files)}));
  const run = path.join(home,new Date().toISOString().replace(/[:.]/g,'-'));
  const before = pull(path.join(run,'before'), candidate.files);
  const guard = before['PreviewIsolation.gs'];
  if (guard.includes(TARGET.spreadsheetId)) original.assertGuard(guard,TARGET);
  else original.assertGuard(guard,original.TARGET); // A pristine native copy still has the old ID.
  const changes = original.differences(before,candidate.files);
  if (mode === 'verify' && changes.length) throw Error('Unified GAS differs: '+changes.join(', '));
  if (mode === 'sync' && changes.length) {
    const status = invoke(stage,['show-file-status']);
    const names = status.filesToPush.map(f=>path.basename(f)).sort();
    if (JSON.stringify(names)!==JSON.stringify(Object.keys(candidate.files).sort())) throw Error('Unexpected push roster.');
    invoke(stage,['push','--force']);
    const after = pull(path.join(run,'after'),candidate.files);
    original.assertGuard(after['PreviewIsolation.gs'],TARGET);
    if (original.differences(after,candidate.files).length) throw Error('Unified GAS readback differs.');
  }
  const result={target:TARGET, verified:true, changed:mode==='sync'&&changes.length>0, sourceFingerprint:candidate.fingerprint, productionPromotionImplemented:true, credentialsVerified:false};
  fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify(result));
}
module.exports={TARGET,bundle};
if (require.main===module) try {main(process.argv[2]||'plan');} catch(e) {console.error(e.message);process.exitCode=1;}
