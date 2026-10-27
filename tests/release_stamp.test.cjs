'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {stamp,contentHash}=require('../scripts/release_stamp.cjs');
test('preview provenance is repeatable and changes when public bytes change',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-stamp-'));
  try {
    fs.writeFileSync(path.join(root,'index.html'),'preview');
    const env={GITHUB_REPOSITORY:'ponnhide/yachielab-preview',GITHUB_REF:'refs/heads/codex/preview',GITHUB_EVENT_NAME:'push',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
    const first=stamp(root,env);assert.equal(contentHash(root),first.contentHash);assert.deepEqual(stamp(root,env),first);
    for(const changed of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REPOSITORY:'yachielab/yachielab.github.io'},{GITHUB_SHA:'main'}])assert.throws(()=>stamp(root,{...env,...changed}));
    fs.writeFileSync(path.join(root,'index.html'),'changed');assert.notEqual(contentHash(root),first.contentHash);
    const code='import importlib.util,sys,pathlib;s=importlib.util.spec_from_file_location("p", ".github/release/promote.py");m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.content_hash(pathlib.Path(sys.argv[1])))';
    assert.equal(execFileSync(process.env.PYTHON||'python3',['-c',code,root],{cwd:path.join(__dirname,'..'),encoding:'utf8'}).trim(),contentHash(root));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
