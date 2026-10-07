#!/usr/bin/env node
'use strict';
// Refresh public hashes/HTML without regenerating Sheet content or touching files.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const write = process.argv.includes('--write');
if (write && execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim() !== 'codex/preview') throw new Error('Writes are restricted to codex/preview.');
const entries = {};
function hash(data) { return crypto.createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex'); }
function inventory(folder) {
  for (const item of fs.readdirSync(path.join(root,folder),{withFileTypes:true})) {
    const relative=folder+'/'+item.name;
    if(item.isDirectory()) inventory(relative);
    else if(item.isFile()) entries[relative]={type:'blob',sha:hash(fs.readFileSync(path.join(root,relative)))};
  }
}
['img','img_new','pdf'].forEach(inventory);
const context={pendingAssets:[]};
const sandbox={PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})},cmsContext_:()=>context,cmsGithubSnapshot_:()=>({entries}),cmsGitBlobSha_:value=>hash(Buffer.isBuffer(value)?value:Buffer.from(value)),Utilities:{base64Decode:value=>Buffer.from(value,'base64')}};
vm.createContext(sandbox);
for(const file of ['PreviewIsolation.gs','AssetVersions.gs']) vm.runInContext(fs.readFileSync(path.join(root,'cms',file),'utf8'),sandbox,{filename:file});
const changes=[];
for(const name of fs.readdirSync(root).filter(name=>/\.html$/.test(name))) {
  const file=path.join(root,name),old=fs.readFileSync(file,'utf8');
  const next=sandbox.cmsVersionAssetHtml_(sandbox.previewPrepareHtml_(old));
  if(next!==old){changes.push(name);if(write)fs.writeFileSync(file,next);}
}
const manifest=JSON.stringify(sandbox.cmsAssetVersionsManifest_(),null,2)+'\n';
const target=path.join(root,'asset-versions.json');
const manifestChanged=!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==manifest;
if(write&&manifestChanged)fs.writeFileSync(target,manifest);
console.log(JSON.stringify({mode:write?'write':'inspect',assets:Object.keys(entries).length,htmlChanged:changes,manifestChanged}));
