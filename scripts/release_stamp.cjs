'use strict';
// Bind the deployed files to the exact successful preview run. No build timestamp:
// production can reproduce and compare every public byte before changing host config.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function contentHash(folder) {
  const names=[];
  function walk(base) {for(const e of fs.readdirSync(base,{withFileTypes:true})) {
    const f=path.join(base,e.name);
    if(e.isSymbolicLink())throw Error('Symlink in release artifact.');
    if(e.isDirectory())walk(f);else if(e.isFile())names.push(path.relative(folder,f).split(path.sep).join('/'));
  }}
  walk(folder);
  const hash=crypto.createHash('sha256');
  for(const name of names.filter(n=>n!=='release.json').sort()) {
    const sha=crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,name))).digest('hex');
    hash.update(name+'\0'+sha+'\n');
  }
  return hash.digest('hex');
}
function stamp(folder,env=process.env) {
  if(env.GITHUB_REPOSITORY!=='ponnhide/yachielab-preview'||env.GITHUB_REF!=='refs/heads/codex/preview'||env.GITHUB_EVENT_NAME!=='push')throw Error('Only the preview push workflow can stamp a release.');
  if(!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||''))throw Error('Invalid preview provenance.');
  const record={schema:1,repository:env.GITHUB_REPOSITORY,branch:'codex/preview',commit:env.GITHUB_SHA,runId:String(env.GITHUB_RUN_ID),runAttempt:Number(env.GITHUB_RUN_ATTEMPT),contentHash:contentHash(folder)};
  fs.writeFileSync(path.join(folder,'release.json'),JSON.stringify(record,null,2)+'\n');
  return record;
}
module.exports={contentHash,stamp};
if(require.main===module)console.log(JSON.stringify(stamp(path.resolve(process.argv[2]||'dist/site'))));
