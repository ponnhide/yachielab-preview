#!/usr/bin/env node
'use strict';
/** Reversible preview archival and build-only display images. No network access. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const ASSET = /^(?:img|img_new|pdf)\/.+/;
const ROOT = path.resolve(__dirname, '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitSha = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
function safeAsset(value) {
  return typeof value === 'string' && ASSET.test(value) && !/[\\?#\x00-\x1f\x7f]/.test(value) && !/(?:^|\/)\.{1,2}(?:\/|$)|\/\/|\/$/.test(value);
}
function file(root, relative) {
  if (!safeAsset(relative)) throw new Error('Invalid public asset path.');
  const target = path.join(root, relative);
  for (let current = target; current !== root; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink asset paths are not supported.');
  }
  return target;
}
function readJson(filename) { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function writeJson(filename, data) { fs.mkdirSync(path.dirname(filename), {recursive:true}); fs.writeFileSync(filename, JSON.stringify(data, null, 2) + '\n'); }
function previewOnly(root) {
  if (execFileSync('git', ['branch','--show-current'], {cwd:root,encoding:'utf8'}).trim() !== 'codex/preview') throw new Error('Asset mutations are restricted to codex/preview.');
}
function archivePlan(root, inventory) {
  if (!inventory.scope || !inventory.scope.sheet_sources_supplied || inventory.summary.errors) throw new Error('Archive requires a successful audit including the current private Sheet snapshot.');
  const record = asset => {
    const bytes = fs.readFileSync(file(root, asset.path));
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) throw new Error('Asset changed after audit: ' + asset.path);
    return {originalPath:asset.path, bytes:bytes.length, sha256:asset.sha256, gitBlobSha:gitSha(bytes), referenceClass:asset.reference_class};
  };
  return {version:1, previewOnly:true, baselineCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    snapshotTabs:inventory.scope.sheet_tabs_supplied, note:'Reference-unconfirmed preview assets. External direct links are not proven unused. Production paths are unchanged.',
    retained:inventory.assets.filter(a=>a.status==='referenced').map(record),
    archived:inventory.assets.filter(a=>a.status==='review-candidate').map(record)};
}
function checkArchiveManifest(root, manifest, requireArchived) {
  if (!manifest || manifest.version !== 1 || manifest.previewOnly !== true || !Array.isArray(manifest.archived) || !Array.isArray(manifest.retained)) throw new Error('Invalid archive manifest.');
  const seen = new Set(); let changedRetained = 0,restored=0;
  for (const [group, records] of [['retained',manifest.retained], ['archived',manifest.archived]]) {
    for (const record of records) {
      if (!safeAsset(record.originalPath) || seen.has(record.originalPath) || !/^[a-f0-9]{64}$/.test(record.sha256) || !/^[a-f0-9]{40}$/.test(record.gitBlobSha) || !Number.isSafeInteger(record.bytes) || record.bytes < 0) throw new Error('Invalid archive record.');
      seen.add(record.originalPath); const target=file(root,record.originalPath);
      if (group==='retained') {
        if (!fs.existsSync(target)) throw new Error('Retained public path is missing: '+record.originalPath);
        if (sha256(fs.readFileSync(target))!==record.sha256) changedRetained++;
      } else {
        if (record.referenceClass !== 'review-candidate') throw new Error('Only review candidates can be archived.');
        if(record.restored===true){if(!fs.existsSync(target)||sha256(fs.readFileSync(target))!==record.sha256)throw new Error('Restored archive bytes changed.');restored++;}
        else if (requireArchived && fs.existsSync(target)) throw new Error('Archived path was restored; refresh the maintenance record: '+record.originalPath);
      }
    }
  }
  return {retained:manifest.retained.length, archived:manifest.archived.length-restored,restored, changedRetained};
}
function archive(root, inventory, privateDirectory, publicManifest) {
  previewOnly(root);
  const privateRoot=path.join(root,'private'), destination=path.resolve(privateDirectory);
  if (!destination.startsWith(privateRoot+path.sep)) throw new Error('Archive objects must remain under the ignored private/ directory.');
  if (fs.existsSync(publicManifest) || fs.existsSync(path.join(destination,'manifest.json'))) throw new Error('An archive manifest already exists. Review the existing recovery inventory before another archival operation.');
  const plan=archivePlan(root,inventory); fs.mkdirSync(path.join(destination,'objects'),{recursive:true});
  writeJson(path.join(destination,'manifest.json'),plan); // Recovery record exists before any path is removed.
  for (const record of plan.archived) {
    const original=file(root,record.originalPath), object=path.join(destination,'objects',record.sha256);
    if (!fs.existsSync(object)) fs.copyFileSync(original,object,fs.constants.COPYFILE_EXCL);
    if (sha256(fs.readFileSync(object))!==record.sha256) throw new Error('Archive byte verification failed.');
    fs.unlinkSync(original);
  }
  checkArchiveManifest(root,plan,true); writeJson(publicManifest,plan);
  return {archived:plan.archived.length,retained:plan.retained.length,archiveBytes:plan.archived.reduce((n,r)=>n+r.bytes,0),uniqueObjects:new Set(plan.archived.map(r=>r.sha256)).size};
}
function restore(root, manifest, privateDirectory, selected) {
  previewOnly(root); let restored=0;
  for (const record of manifest.archived.filter(r=>!selected || r.originalPath===selected)) {
    const original=file(root,record.originalPath);
    if (fs.existsSync(original)) { if (sha256(fs.readFileSync(original))!==record.sha256) throw new Error('Refusing to overwrite a changed public path.'); record.restored=true;continue; }
    const object=path.join(privateDirectory,'objects',record.sha256);
    const bytes=fs.existsSync(object)?fs.readFileSync(object):execFileSync('git',['cat-file','blob',record.gitBlobSha],{cwd:root,maxBuffer:Math.max(record.bytes+1024,1024*1024)});
    if (sha256(bytes)!==record.sha256 || gitSha(bytes)!==record.gitBlobSha) throw new Error('Restore byte verification failed.');
    fs.mkdirSync(path.dirname(original),{recursive:true}); fs.writeFileSync(original,bytes,{flag:'wx'}); record.restored=true;restored++;
  }
  return {restored};
}
function decode(value) { return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'"); }
function localAsset(value, relative) {
  try {
    value=decode(value);
    let url;
    if (/^(?:https?:)?\/\//i.test(value)) {
      url=new URL(value,'https://ponnhide.github.io/');
      if (url.origin!=='https://ponnhide.github.io' || !url.pathname.startsWith('/yachielab-preview/')) return '';
      const result=decodeURIComponent(url.pathname.slice('/yachielab-preview/'.length)); return safeAsset(result)?result:'';
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
    value=value.replace(/^\/yachielab-preview\//,'/');
    url=new URL(value,'https://asset.invalid/'+relative);
    const result=decodeURIComponent(url.pathname.slice(1)); return safeAsset(result)?result:'';
  } catch (_) { return ''; }
}
function attributes(tag) {
  const result={};
  const regexp=/\s+([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g; let match;
  while((match=regexp.exec(tag))) result[match[1].toLowerCase()]=decode(match[2]??match[3]??match[4]);
  return result;
}
function profileRoles(root) {
  const usage=new Map(), voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for (const name of fs.readdirSync(root).filter(n=>/\.html$/.test(n))) {
    const text=fs.readFileSync(path.join(root,name),'utf8'), stack=[];
    const tokens=/<!--[\s\S]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>|<style\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\s*>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi; let match;
    while((match=tokens.exec(text))) {
      const token=match[0]; if(/^<!--|^<script\b|^<style\b/i.test(token)) continue;
      const tag=(token.match(/^<\/?([\w:-]+)/)||[])[1]; if(!tag)continue;
      if(/^<\//.test(token)){ const i=stack.map(s=>s.tag).lastIndexOf(tag.toLowerCase());if(i>=0)stack.splice(i);continue; }
      const a=attributes(token),classes=String(a.class||'').split(/\s+/);
      if(tag.toLowerCase()==='img'&&a.src){const asset=localAsset(a.src,name);if(asset){const list=usage.get(asset)||[];list.push({page:name,profile:stack.some(s=>s.classes.includes('personal_photo'))});usage.set(asset,list);}}
      if(!voids.has(tag.toLowerCase())&&!/\/\s*>$/.test(token))stack.push({tag:tag.toLowerCase(),classes});
    }
  }
  return new Map([...usage].filter(([,uses])=>uses.length && uses.every(u=>u.profile)));
}
async function rawImage(sharp, filename, transform) {
  let operation=sharp(filename).autoOrient();
  if(transform==='profile-1024')operation=operation.resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true});
  return operation.keepMetadata().ensureAlpha().raw().toBuffer({resolveWithObject:true});
}
async function generateDisplayAssets(root, output, inventory) {
  const sharp=require('sharp'), profiles=profileRoles(root), displayAssets={}, results=[], cache=new Map();
  const eligible=inventory.assets.filter(a=>a.reference_class==='published-reference' && ['png','jpeg'].includes(a.kind));
  for(const asset of eligible) {
    const original=file(root,asset.path), bytes=fs.readFileSync(original), sourceSha=gitSha(bytes), metadata=await sharp(original).metadata();
    const transform=profiles.has(asset.path)?'profile-1024':'lossless-full';
    if(metadata.format==='jpeg'&&transform==='lossless-full'){results.push({path:asset.path,adopted:false,reason:'non-profile-jpeg-keeps-original'});continue;}
    if(metadata.depth!=='uchar'||(metadata.pages||1)!==1){results.push({path:asset.path,adopted:false,reason:'unsupported-depth-or-animation'});continue;}
    const stem=path.basename(asset.path,path.extname(asset.path)).replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,70)||'asset';
    const targetPath='img/optimized/'+stem+'--'+sourceSha.slice(0,12)+(transform==='profile-1024'?'-profile1024':'-full')+'.webp';
    const target=file(output,targetPath), key=sourceSha+':'+transform;
    let proof=cache.get(key);
    if(!proof){
      fs.mkdirSync(path.dirname(target),{recursive:true});
      let operation=sharp(original).autoOrient();
      if(transform==='profile-1024')operation=operation.resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true});
      await operation.keepMetadata().webp({lossless:true,effort:6}).toFile(target);
      const [expected,actual]=await Promise.all([rawImage(sharp,original,transform),rawImage(sharp,target,'lossless-full')]);
      const targetMetadata=await sharp(target).metadata();
      const profileSame=(!metadata.icc&&!targetMetadata.icc)||(metadata.icc&&targetMetadata.icc&&metadata.icc.equals(targetMetadata.icc));
      const data=fs.readFileSync(target),same=profileSame&&expected.info.width===actual.info.width&&expected.info.height===actual.info.height&&expected.data.equals(actual.data);
      proof={same,bytes:data.length,sha:gitSha(data),pixelSha256:sha256(actual.data),width:actual.info.width,height:actual.info.height,targetPath};cache.set(key,proof);
      if(!same||data.length>=bytes.length-1024||data.length>bytes.length*0.99){fs.unlinkSync(target);proof.adopted=false;}else proof.adopted=true;
    }
    if(proof.adopted){displayAssets[asset.path]={sourceSha,targetPath:proof.targetPath,targetSha:proof.sha};}
    results.push({path:asset.path,sourceSha,originalBytes:bytes.length,transform,profilePages:profiles.get(asset.path)?.map(u=>u.page)||[],adopted:proof.adopted,
      ...(proof.adopted?{targetPath:proof.targetPath,targetSha:proof.sha,targetBytes:proof.bytes,width:proof.width,height:proof.height,pixelSha256:proof.pixelSha256,pixelProof:transform==='profile-1024'?'exact-resized-reference':'exact-original-display-pixels'}:{reason:proof.same?'no-size-reduction':'pixel-mismatch'})});
    if(process.env.ASSET_PROGRESS==='1')process.stderr.write('image '+results.length+'/'+eligible.length+'\n');
  }
  return {displayAssets,report:{version:1,sharpVersion:sharp.versions.sharp,policy:'Only proven personal_photo roles use aspect-preserving 1024px maximum. Other images preserve full display pixels. Original source bytes are unchanged.',results}};
}
function check(root) {
  const manifest=path.join(root,'docs/assets/archive-manifest.json');
  if(!fs.existsSync(manifest))return{archived:0,retained:0,note:'No archive has been applied.'};
  const data=readJson(manifest),result=checkArchiveManifest(root,data,true),objects=path.join(root,'private/asset-archive/objects');
  if(fs.existsSync(objects)){const seen=new Set();for(const record of data.archived){if(seen.has(record.sha256))continue;const bytes=fs.readFileSync(path.join(objects,record.sha256));if(sha256(bytes)!==record.sha256||gitSha(bytes)!==record.gitBlobSha)throw new Error('Private recovery object is corrupt.');seen.add(record.sha256);}result.archiveObjectsVerified=seen.size;}
  return result;
}
async function main(args=process.argv.slice(2)) {
  const option=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
  if(args.includes('--check')){console.log(JSON.stringify(check(ROOT)));return;}
  if(args.includes('--archive')){const inventory=readJson(option('--inventory'));console.log(JSON.stringify(archive(ROOT,inventory,path.join(ROOT,'private/asset-archive'),path.join(ROOT,'docs/assets/archive-manifest.json'))));return;}
  if(args.includes('--restore')){const target=path.join(ROOT,'docs/assets/archive-manifest.json'),manifest=readJson(target);const result=restore(ROOT,manifest,path.join(ROOT,'private/asset-archive'),option('--path'));writeJson(target,manifest);console.log(JSON.stringify(result));return;}
  if(args.includes('--plan')){const p=archivePlan(ROOT,readJson(option('--inventory')));const objects=new Map(p.archived.map(r=>[r.sha256,r.bytes]));console.log(JSON.stringify({retained:p.retained.length,candidates:p.archived.length,bytes:p.archived.reduce((n,r)=>n+r.bytes,0),uniqueBytes:[...objects.values()].reduce((a,b)=>a+b,0),uniqueObjects:objects.size}));return;}
  throw new Error('Use --check, --plan --inventory <audit>, --archive --inventory <audit>, or --restore [--path <public-path>].');
}
module.exports={safeAsset,gitSha,sha256,archivePlan,checkArchiveManifest,archive,restore,localAsset,attributes,profileRoles,generateDisplayAssets,rawImage};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
