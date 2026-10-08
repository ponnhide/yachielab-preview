'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const sharp=require('sharp');
const a=require('../../scripts/asset_maintenance.cjs'),b=require('../../scripts/build_site.cjs');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'asset-maintenance-test-'));for(const name of ['img','img_new','pdf','css','js','private','docs/assets'])fs.mkdirSync(path.join(root,name),{recursive:true});execFileSync('git',['init','-b','codex/preview'],{cwd:root,stdio:'ignore'});fs.mkdirSync(path.join(root,'.git/refs/heads/codex'),{recursive:true});fs.writeFileSync(path.join(root,'.git/refs/heads/codex/preview'),'a'.repeat(40)+'\n');return root;}
function record(root,relative,status){const data=fs.readFileSync(path.join(root,relative));return{path:relative,bytes:data.length,sha256:a.sha256(data),kind:'png',status,reference_class:status==='referenced'?'published-reference':'review-candidate'};}
test('preview archival deduplicates private copies, retains referenced bytes, and restores original URLs exactly',()=>{
 const root=fixture();try{
 fs.writeFileSync(path.join(root,'img/active.png'),'original active bytes');fs.writeFileSync(path.join(root,'img/one.png'),'same candidate bytes');fs.writeFileSync(path.join(root,'img/two.png'),'same candidate bytes');
 const inventory={scope:{sheet_sources_supplied:1,sheet_tabs_supplied:38},summary:{errors:0},assets:[record(root,'img/active.png','referenced'),record(root,'img/one.png','review-candidate'),record(root,'img/two.png','review-candidate')]};
 const before=fs.readFileSync(path.join(root,'img/active.png')),privateDir=path.join(root,'private/archive'),manifest=path.join(root,'docs/assets/archive-manifest.json');
 const result=a.archive(root,inventory,privateDir,manifest);assert.equal(result.archived,2);assert.equal(result.uniqueObjects,1);assert.deepEqual(fs.readFileSync(path.join(root,'img/active.png')),before);assert.equal(fs.existsSync(path.join(root,'img/one.png')),false);
 const plan=JSON.parse(fs.readFileSync(manifest));assert.deepEqual(a.restore(root,plan,privateDir),{restored:2});assert.equal(fs.readFileSync(path.join(root,'img/two.png'),'utf8'),'same candidate bytes');
 fs.writeFileSync(path.join(root,'img/one.png'),'new data');assert.throws(()=>a.restore(root,plan,privateDir),/overwrite/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('archive refuses stale audits, non-preview branch and traversal before removing any public bytes',()=>{
 const root=fixture();try{
 fs.writeFileSync(path.join(root,'img/candidate.png'),'data');const inv={scope:{sheet_sources_supplied:1,sheet_tabs_supplied:38},summary:{errors:0},assets:[record(root,'img/candidate.png','review-candidate')]};
 fs.writeFileSync(path.join(root,'img/candidate.png'),'changed');assert.throws(()=>a.archivePlan(root,inv),/changed after audit/);
 fs.writeFileSync(path.join(root,'img/candidate.png'),'data');execFileSync('git',['symbolic-ref','HEAD','refs/heads/main'],{cwd:root});assert.throws(()=>a.archive(root,inv,path.join(root,'private/archive'),path.join(root,'docs/archive.json')),/codex\/preview/);
 assert.equal(fs.readFileSync(path.join(root,'img/candidate.png'),'utf8'),'data');assert.equal(a.safeAsset('img/../private/file'),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('repeat archival refuses both public and private recovery manifests before removing bytes',()=>{
 const root=fixture();try{
 const original=path.join(root,'img/candidate.png');fs.writeFileSync(original,'data');
 const inv={scope:{sheet_sources_supplied:1,sheet_tabs_supplied:38},summary:{errors:0},assets:[record(root,'img/candidate.png','review-candidate')]};
 const privateDir=path.join(root,'private/archive'),publicManifest=path.join(root,'docs/assets/archive-manifest.json');
 fs.writeFileSync(publicManifest,'existing public inventory');assert.throws(()=>a.archive(root,inv,privateDir,publicManifest),/manifest already exists/);
 assert.equal(fs.readFileSync(publicManifest,'utf8'),'existing public inventory');assert.equal(fs.readFileSync(original,'utf8'),'data');
 fs.unlinkSync(publicManifest);fs.mkdirSync(privateDir,{recursive:true});fs.writeFileSync(path.join(privateDir,'manifest.json'),'existing private inventory');
 assert.throws(()=>a.archive(root,inv,privateDir,publicManifest),/manifest already exists/);assert.equal(fs.readFileSync(path.join(privateDir,'manifest.json'),'utf8'),'existing private inventory');assert.equal(fs.readFileSync(original,'utf8'),'data');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('profile roles require every HTML image occurrence to be in personal_photo, keeping paper figures full size',()=>{
 const root=fixture();try{fs.writeFileSync(path.join(root,'people.html'),'<section class="member"><div class="personal_photo"><img src="./img/profile.png?v=abc"></div></section><section class="paper_photo"><img class="personal_img" src="./img/figure.png"></section>');
 let roles=a.profileRoles(root);assert.equal(roles.has('img/profile.png'),true);assert.equal(roles.has('img/figure.png'),false);
 fs.writeFileSync(path.join(root,'index.html'),'<img src="img/profile.png">');assert.equal(a.profileRoles(root).has('img/profile.png'),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('display compilation changes image/style URLs before loading while keeping download links, comments and scripts',()=>{
 const alias={'img/a.png':{sourceSha:'a'.repeat(40),targetPath:'img/optimized/a.webp',targetSha:'b'.repeat(40)}};
 const original='<a href="./img/a.png?download=1">Original</a><img src="./img/a.png?x=2&amp;v=old#photo" srcset="img/a.png 1x, img/a.png 2x"><!-- <img src="img/a.png"> --><script>const t="<img src=\'img/a.png\'>";</script>';
 const html=b.rewriteHtml(original,'index.html',alias);assert(html.includes('href="./img/a.png?download=1"'));assert(html.includes('src="./img/optimized/a.webp?x=2&amp;v=bbbbbbbbbbbb&amp;asset=img%2Fa.png#photo"'));assert(html.includes('<!-- <img src="img/a.png"> -->'));assert(html.includes('const t="<img src=\'img/a.png\'>";'));
 const css=b.rewriteCss('a{background:url("../../img/a.png")}b{content:"url(../../img/a.png)"}/*url(../../img/a.png)*/','css/pages/example.css',alias);assert(css.includes('url("../../img/optimized/a.webp?v=bbbbbbbbbbbb&asset=img%2Fa.png")'));assert(css.includes('content:"url(../../img/a.png)"'));assert(css.includes('/*url(../../img/a.png)*/'));
});
test('compiled HTML, CSS and srcset retain validated original identity for later stale-derivative recovery',()=>{
 const alias={'img/photo.png':{sourceSha:'a'.repeat(40),targetPath:'img/optimized/photo-old.webp',targetSha:'b'.repeat(40)}};
 const input='<img src="img/photo.png?asset=img%2Fwrong.png&amp;x=2#portrait" srcset="img/photo.png 1x, img/photo.png?size=2 2x" style="background:url(img/photo.png)">';
 const html=b.rewriteHtml(input,'people.html',alias),tag=a.attributes(html);
 const check=value=>{const url=new URL(value,'https://preview.invalid/');assert.equal(url.searchParams.get('asset'),'img/photo.png');assert.equal(url.searchParams.get('v'),'bbbbbbbbbbbb');};
 check(tag.src);assert.equal(new URL(tag.src,'https://preview.invalid/').hash,'#portrait');assert.equal(new URL(tag.src,'https://preview.invalid/').searchParams.get('x'),'2');
 for(const token of tag.srcset.split(','))check(token.trim().split(/\s+/)[0]);
 check(tag.style.match(/url\("([^"]+)"\)/)[1]);
 const css=b.rewriteCss('a{background:url("../../img/photo.png?other=1")}','css/pages/example.css',alias);check(css.match(/url\("([^"]+)"\)/)[1]);
 assert.equal(b.rewriteHtml(html,'people.html',alias),html);assert.equal(b.rewriteCss(css,'css/pages/example.css',alias),css);
});
test('build output restriction rejects nonempty directories and compiled alias corruption is detected',()=>{
 const root=fixture();try{assert.throws(()=>b.outputDirectory(root,'img',true),/dist\/site/);const output=b.outputDirectory(root,'dist/site',true);fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'file'),'x');assert.throws(()=>b.outputDirectory(root,'dist/site',true),/empty/);
 fs.writeFileSync(path.join(output,'asset-versions.json'),JSON.stringify({version:1,assets:{},displayAssets:{'img/a.png':{sourceSha:'a'.repeat(40),targetPath:'img/optimized/a.webp',targetSha:'b'.repeat(40)}}}));assert.throws(()=>b.verify(root,output),/alias/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('profile thumbnail and scientific PNG keep exact expected RGBA, dimensions, orientation and source bytes',async()=>{
 const root=fixture(),output=path.join(root,'dist/site');try{
 fs.mkdirSync(output,{recursive:true});const profile=path.join(root,'img/profile.png'),figure=path.join(root,'img/figure.png');
 await sharp({create:{width:1200,height:1600,channels:4,background:{r:80,g:120,b:160,alpha:1}}}).png({compressionLevel:0}).toFile(profile);
 await sharp({create:{width:128,height:80,channels:4,background:{r:240,g:50,b:20,alpha:1}}}).png({compressionLevel:0}).toFile(figure);
 fs.writeFileSync(path.join(root,'people.html'),'<div class="personal_photo"><img src="img/profile.png"></div><div class="paper_photo"><img src="img/figure.png"></div>');
 const original=fs.readFileSync(profile),inv={assets:[record(root,'img/profile.png','referenced'),record(root,'img/figure.png','referenced')]};
 const generated=await a.generateDisplayAssets(root,output,inv);assert.equal(Object.keys(generated.displayAssets).length,2);
 for(const result of generated.report.results){assert.equal(result.adopted,true);const decoded=await a.rawImage(sharp,path.join(output,result.targetPath),'lossless-full'),expected=await a.rawImage(sharp,path.join(root,result.path),result.transform);assert.deepEqual(decoded.data,expected.data);if(result.transform==='profile-1024')assert.equal(Math.max(result.width,result.height),1024);else assert.deepEqual([result.width,result.height],[128,80]);}
 assert.deepEqual(fs.readFileSync(profile),original);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('profile JPEG preserves embedded ICC and applies EXIF orientation exactly once',async()=>{
 const root=fixture(),output=path.join(root,'dist/site');try{
 fs.mkdirSync(output,{recursive:true});const filename=path.join(root,'img/profile.jpg');
 await sharp({create:{width:800,height:1200,channels:3,background:{r:70,g:135,b:170}}}).withMetadata({orientation:6}).withIccProfile('p3').jpeg({quality:95}).toFile(filename);
 fs.writeFileSync(path.join(root,'people.html'),'<div class="personal_photo"><img src="img/profile.jpg"></div>');
 const source=record(root,'img/profile.jpg','referenced');source.kind='jpeg';const result=await a.generateDisplayAssets(root,output,{assets:[source]});
 const entry=result.report.results[0];assert.equal(entry.adopted,true);assert.deepEqual([entry.width,entry.height],[1024,683]);
 const [original,derivative]=await Promise.all([sharp(filename).metadata(),sharp(path.join(output,entry.targetPath)).metadata()]);assert.deepEqual(derivative.icc,original.icc);assert.notEqual(derivative.orientation,6);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('frontend fingerprint is stable, changes with JS, and versions scripts/styles/imports without changing external URLs',()=>{
 const files=[['css/base.css',Buffer.from('body{}')],['js/index.js',Buffer.from('const x=1;')]];
 const hash=b.frontendFingerprint(files);assert.equal(hash,b.frontendFingerprint([...files].reverse()));assert.notEqual(hash,b.frontendFingerprint([files[0],['js/index.js',Buffer.from('const x=2;')]]));
 const html='<script src="js/index.js?x=2&amp;v=old#run"></script><link rel="stylesheet" href="css/base.css"><script src="https://external.example/js/index.js"></script><a href="css/base.css">Download</a>';
 const result=b.versionFrontendHtml(html,'index.html',hash);assert(result.includes('src="js/index.js?x=2&amp;v='+hash+'#run"'));assert(result.includes('href="css/base.css?v='+hash+'"'));assert(result.includes('src="https://external.example/js/index.js"'));assert(result.includes('<a href="css/base.css">'));
 const css=b.versionFrontendCss('@import "base.css?x=3";@import url("other.css");/* @import "comment.css"; */body{content:"@import x.css"}','css/common.css',hash);assert(css.includes('base.css?x=3&v='+hash));assert(css.includes('other.css?v='+hash));assert(css.includes('/* @import "comment.css"; */'));
});

test('built page versions follow Sheet HTML changes independently and include settings/assets without touching source HTML',()=>{
 const root=fixture();try{
  const output=path.join(root,'dist/site');fs.mkdirSync(path.join(output,'js'),{recursive:true});
  fs.writeFileSync(path.join(output,'js/freshness.js'),'// controller');
  const original='<html><head><title>Page</title></head><body>Original</body></html>';
  const seed=(contact=original,settings='{}',assets='{}')=>{
   for(const name of ['contact.html','joinus.html','404.html'])fs.writeFileSync(path.join(output,name),name==='contact.html'?contact:original);
   fs.writeFileSync(path.join(output,'site-settings.json'),settings);fs.writeFileSync(path.join(output,'asset-versions.json'),assets);
   return b.stampPageVersions(output,'1'.repeat(12));
  };
  fs.writeFileSync(path.join(root,'contact.html'),original);
  const first=seed(),repeat=seed();assert.deepEqual(first,repeat);assert.deepEqual(Object.keys(first),['contact.html','joinus.html']);
  const compiled=fs.readFileSync(path.join(output,'contact.html'),'utf8');
  assert(compiled.includes('data-page="contact.html" data-page-version="'+first['contact.html']+'"'));
  assert(compiled.includes('./js/freshness.js?v=111111111111'));assert(compiled.indexOf('freshness.js')<compiled.indexOf('</head>'));
  assert.equal(fs.readFileSync(path.join(root,'contact.html'),'utf8'),original);
  assert.equal(fs.readFileSync(path.join(output,'404.html'),'utf8'),original);
  const changed=seed(original.replace('Original','Sheet change'));
  assert.notEqual(changed['contact.html'],first['contact.html']);assert.equal(changed['joinus.html'],first['joinus.html']);
  const settings=seed(original,'{"logoInactiveOpacity":0.4}');assert.notEqual(settings['contact.html'],first['contact.html']);
  const assets=seed(original,'{}','{"assets":{"img/a.png":"new"}}');assert.notEqual(assets['joinus.html'],first['joinus.html']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'site-version.json'))),{version:1,pages:assets});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
