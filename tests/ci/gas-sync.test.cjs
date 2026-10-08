'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const sync=require('../../scripts/gas_sync.cjs');
const root=path.resolve(__dirname,'../..');
function temporary(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yachie-gas-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('source staging excludes retired directories and credentials and pins the preview guard',t=>{
 const dir=temporary(t),cms=path.join(dir,'cms');fs.mkdirSync(cms);
 for(const name of ['Cms.gs','RenderCache.gs','Renderer.gs','PreviewIsolation.gs','appsscript.json'])fs.copyFileSync(path.join(root,'cms',name),path.join(cms,name));
 fs.mkdirSync(path.join(cms,'legacy'));fs.writeFileSync(path.join(cms,'legacy','archive.gs'),'old code must never ship');
 const bundle=sync.sourceBundle(dir,'abc');assert(!Object.keys(bundle.files).some(x=>x.includes('legacy')));assert(bundle.files['BuildInfo.gs'].includes(bundle.fingerprint));
 fs.writeFileSync(path.join(cms,'BuildInfo.gs'),'generated');assert.throws(()=>sync.sourceBundle(dir),/generated in private staging/);fs.unlinkSync(path.join(cms,'BuildInfo.gs'));
 fs.writeFileSync(path.join(cms,'Renderer.gs'),'const credential = "'+'ghp_'+'x'.repeat(32)+'";');assert.throws(()=>sync.sourceBundle(dir),/Credential-like/);
});
test('changed source changes the build fingerprint but a documentation-only commit does not',t=>{
 const a=sync.sourceBundle(root,'a'),b=sync.sourceBundle(root,'b');assert.equal(a.fingerprint,b.fingerprint);assert.notEqual(a.files['BuildInfo.gs'],b.files['BuildInfo.gs']);
 const dir=temporary(t);fs.mkdirSync(path.join(dir,'cms'));for(const [n,s]of Object.entries(a.files))if(n!=='BuildInfo.gs')fs.writeFileSync(path.join(dir,'cms',n),s);
 fs.appendFileSync(path.join(dir,'cms','Renderer.gs'),'\n// change\n');assert.notEqual(sync.sourceBundle(dir).fingerprint,a.fingerprint);
});
test('a production target or an unsafe runtime scope is rejected before synchronization',t=>{
 const guard=fs.readFileSync(path.join(root,'cms','PreviewIsolation.gs'),'utf8');assert.throws(()=>sync.assertGuard(guard.replace(sync.TARGET.repository,'yachielab/yachielab.github.io')),/guard mismatch/);
 const dir=temporary(t);fs.mkdirSync(path.join(dir,'cms'));for(const [n,s]of Object.entries(sync.sourceBundle(root).files))if(n!=='BuildInfo.gs')fs.writeFileSync(path.join(dir,'cms',n),s);
 const m=JSON.parse(fs.readFileSync(path.join(dir,'cms','appsscript.json')));m.oauthScopes.push('https://www.googleapis.com/auth/drive');fs.writeFileSync(path.join(dir,'cms','appsscript.json'),JSON.stringify(m));assert.throws(()=>sync.sourceBundle(dir),/OAuth/);
});
function flow(t,options={}) {const dir=temporary(t),bundle=sync.sourceBundle(root,'reviewed'),events=[],paths={before:path.join(dir,'before'),stage:path.join(dir,'stage'),after:path.join(dir,'after')};
 const before={...bundle.files};if(!options.identical)before['Renderer.gs']+='\n// previous\n';if(options.foreign)before['Foreign.gs']='unexpected';
 const pull=destination=>{events.push('pull');sync.writeProject(destination,destination===paths.before?before:options.readback||bundle.files);};const push=()=>events.push('push');
 return {bundle,events,run:()=>sync.synchronize({bundle,...paths,pull,push,validate:()=>{events.push('check');if(options.checkFailure)throw Error('checks failed');}})};
}
test('check failure blocks every remote call and unmanaged remote modules block the write',t=>{
 const bad=flow(t,{checkFailure:true});assert.throws(bad.run,/checks failed/);assert.deepEqual(bad.events,['check']);
 const foreign=flow(t,{foreign:true});assert.throws(foreign.run,/Unmanaged/);assert(!foreign.events.includes('push'));
});
test('the complete remote roster rejects nested or empty unknown modules and duplicate identities',t=>{
 const bundle=sync.sourceBundle(root),result={pulledFiles:Object.keys(bundle.files),deletedFiles:[]};assert.equal(sync.validatePullRoster(result,bundle.files).length,Object.keys(bundle.files).length);
 for(const extra of ['nested/Foreign.gs','Foreign.gs','Renderer.js','../Renderer.gs'])assert.throws(()=>sync.validatePullRoster({...result,pulledFiles:result.pulledFiles.concat(extra)},bundle.files),/remote/);
 const dir=temporary(t);sync.writeProject(dir,bundle.files);fs.mkdirSync(path.join(dir,'nested'));fs.writeFileSync(path.join(dir,'nested','Foreign.gs'),'');assert.throws(()=>sync.readProject(dir),/remote directory/);
});
test('synchronization saves a before snapshot and verifies the full roster after the single write',t=>{
 const f=flow(t);assert.deepEqual(f.run(),{changed:true,verified:true});assert.deepEqual(f.events,['check','pull','push','pull']);
 const same=flow(t,{identical:true});assert.deepEqual(same.run(),{changed:false,verified:true});assert.deepEqual(same.events,['check','pull']);
});
test('readback mismatch cannot report success and whitespace normalization preserves code differences',t=>{
 const files={...sync.sourceBundle(root,'reviewed').files};files['Renderer.gs']+='\n// remote drift';const f=flow(t,{readback:files});assert.throws(f.run,/Remote readback mismatch/);
 assert.deepEqual(sync.differences({'x.gs':'x\r\n'},{'x.gs':'x\n'}),[]);assert.deepEqual(sync.differences({'x.gs':'x;'},{'x.gs':'y;'}),['x.gs']);
});
test('runtime cache revision is read late and automatically changes with the synchronized source',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'cms','RenderCache.gs'),'utf8'),context);assert.equal(context.cmsRendererVersion_(),'2026-10-08.2');
 context.CMS_SOURCE_FINGERPRINT_='a'.repeat(64);assert.equal(context.cmsRendererVersion_(),'source:'+'a'.repeat(64));context.CMS_SOURCE_FINGERPRINT_='b'.repeat(64);assert.equal(context.cmsRendererVersion_(),'source:'+'b'.repeat(64));
});
