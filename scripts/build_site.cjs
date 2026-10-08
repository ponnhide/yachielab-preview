#!/usr/bin/env node
'use strict';
/** The deploy artifact contains public site files, never CMS/private/developer data. */
const fs=require('node:fs'),path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assets=require('./asset_maintenance.cjs');
const ROOT=path.resolve(__dirname,'..');
const STATIC_FILES=['site-settings.json','asset-versions.json','.nojekyll'];
const STATIC_DIRS=['css','js','img','img_new','pdf'];
function frontendTarget(value,relative) {
  try{let url;const decoded=value.replace(/&amp;/g,'&');
    if(/^(?:https?:)?\/\//i.test(decoded)){url=new URL(decoded,'https://ponnhide.github.io/');if(url.origin!=='https://ponnhide.github.io'||!url.pathname.startsWith('/yachielab-preview/'))return '';url.pathname=url.pathname.slice('/yachielab-preview'.length);}
    else{if(/^[a-z][a-z0-9+.-]*:/i.test(decoded))return '';url=new URL(decoded.replace(/^\/yachielab-preview\//,'/'),'https://asset.invalid/'+relative);}
    const target=decodeURIComponent(url.pathname.slice(1));return /^(?:css|js)\/.+\.(?:css|js)$/i.test(target)&&!/[\\\x00-\x1f]|(?:^|\/)\.\.(?:\/|$)/.test(target)?target:'';
  }catch(_){return '';}
}
function frontendUrl(value,relative,fingerprint) {
  if(!frontendTarget(value,relative))return value;const decoded=value.replace(/&amp;/g,'&'),hash=decoded.indexOf('#'),fragment=hash<0?'':decoded.slice(hash),before=hash<0?decoded:decoded.slice(0,hash),question=before.indexOf('?');
  const address=question<0?before:before.slice(0,question),parameters=new URLSearchParams(question<0?'':before.slice(question+1));parameters.set('v',fingerprint);return address+'?'+parameters.toString()+fragment;
}
function frontendFingerprint(files) {
  const digest=crypto.createHash('sha256');for(const [name,bytes]of [...files].sort(([a],[b])=>a.localeCompare(b))){digest.update(name+'\0');digest.update(bytes);digest.update('\0');}return digest.digest('hex').slice(0,12);
}
function versionFrontendCss(css,relative,fingerprint) {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(@import\s+)(?:url\(\s*(?:(["'])([\s\S]*?)\2|([^)]*?))\s*\)|(["'])([\s\S]*?)\5)/gi,(whole,opening,urlQuote,urlQuoted,urlBare,plainQuote,plainValue)=>{
    if(!opening)return whole;const value=urlQuote?urlQuoted:urlBare!==undefined?urlBare.trim():plainValue,changed=frontendUrl(value,relative,fingerprint);
    if(changed===value)return whole;return opening+(plainQuote?plainQuote+changed+plainQuote:'url("'+changed+'")');
  });
}
function versionFrontendHtml(html,relative,fingerprint) {
  function tag(token,attribute){return token.replace(/(\s+)([^\s"'<>/=]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,(whole,space,name,equal,dq,sq,bare)=>{
    if(name.toLowerCase()!==attribute)return whole;const old=dq??sq??bare,next=frontendUrl(old,relative,fingerprint);if(next===old)return whole;return space+name+equal+'"'+next.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"';});}
  return html.replace(/<!--[\s\S]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,token=>{
    if(token.startsWith('<!--'))return token;if(/^<script\b/i.test(token)){const opening=token.match(/^<(?:[^"'<>]|"[^"]*"|'[^']*')*>/)[0];return tag(opening,'src')+token.slice(opening.length);}
    if(/^<link\b/i.test(token)&&/(?:^|\s)stylesheet(?:\s|$)/i.test(assets.attributes(token).rel||''))return tag(token,'href');return token;
  });
}
function stampPageVersions(output,fingerprint) {
  const pages={},settings=fs.readFileSync(path.join(output,'site-settings.json'),'utf8'),versions=fs.readFileSync(path.join(output,'asset-versions.json'),'utf8');
  if(!fs.existsSync(path.join(output,'js/freshness.js')))throw new Error('Missing HTML freshness controller.');
  for(const name of fs.readdirSync(output).filter(name=>/^[\w-]+\.html$/.test(name)&&name!=='404.html').sort()) {
    const filename=path.join(output,name),html=fs.readFileSync(filename,'utf8');
    if(!/<\/head\s*>/i.test(html))throw new Error('Missing page head: '+name);
    const revision=crypto.createHash('sha256').update(html+'\0'+settings+'\0'+versions).digest('hex');
    pages[name]=revision;
    const loader='<script src="./js/freshness.js?v='+fingerprint+'" data-page="'+name+'" data-page-version="'+revision+'" defer></script>\n';
    fs.writeFileSync(filename,html.replace(/<\/head\s*>/i,loader+'</head>'));
  }
  fs.writeFileSync(path.join(output,'site-version.json'),JSON.stringify({version:1,pages},null,2)+'\n');
  return pages;
}
function allFiles(root) {
  const results=[];
  function walk(folder){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const name=path.join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('Public files cannot be symlinks.');if(entry.isDirectory())walk(name);else if(entry.isFile())results.push(name);}}
  walk(root);return results;
}
function rewriteUrl(value,relative,displayAssets) {
  const original=assets.localAsset(value,relative),alias=displayAssets[original];if(!alias)return value;
  const decoded=value.replace(/&amp;/g,'&'),fragment=decoded.includes('#')?decoded.slice(decoded.indexOf('#')):'';
  const before=fragment?decoded.slice(0,-fragment.length):decoded,query=before.includes('?')?before.slice(before.indexOf('?')+1):'';
  const parameters=new URLSearchParams(query);parameters.set('v',alias.targetSha.slice(0,12));parameters.set('asset',original);
  let address=path.posix.relative(path.posix.dirname(relative),alias.targetPath);if(!address.startsWith('.'))address='./'+address;
  return address+'?'+parameters.toString()+fragment;
}
function rewriteCss(css,relative,displayAssets) {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(\burl\(\s*)(?:(["'])([\s\S]*?)\2|([^)]*?))(\s*\))/gi,(whole,opening,quote,quoted,bare,closing)=>{
    if(!opening)return whole;const original=quote?quoted:bare.trim(),changed=rewriteUrl(original,relative,displayAssets);
    return changed===original?whole:opening+'"'+changed.replace(/"/g,'%22')+'"'+closing;
  });
}
function rewriteSrcset(value,relative,displayAssets) {
  // Current site srcsets contain no comma-bearing data URLs; retain data tokens.
  if(/(?:^|\s)data:/i.test(value))return value;
  return value.split(',').map(candidate=>candidate.replace(/^(\s*)(\S+)/,(_,space,url)=>space+rewriteUrl(url,relative,displayAssets))).join(',');
}
function rewriteTag(tag,relative,displayAssets) {
  return tag.replace(/(\s+)([^\s"'<>/=]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,(whole,space,name,equal,doubleQuoted,singleQuoted,bare)=>{
    if(!/^(?:src|srcset|poster|style)$/i.test(name))return whole; // Download hrefs always keep originals.
    const original=doubleQuoted??singleQuoted??bare,decoded=original.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
    const changed=name.toLowerCase()==='style'?rewriteCss(decoded,relative,displayAssets):name.toLowerCase()==='srcset'?rewriteSrcset(decoded,relative,displayAssets):rewriteUrl(decoded,relative,displayAssets);
    if(changed===decoded)return whole;
    const quote=singleQuoted!==undefined?"'":'"';let escaped=changed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    escaped=quote==='"'?escaped.replace(/"/g,'&quot;'):escaped.replace(/'/g,'&#39;');return space+name+equal+quote+escaped+quote;
  });
}
function rewriteHtml(html,relative,displayAssets) {
  return html.replace(/<!--[\s\S]*?-->|<script\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/script\s*>|<style\b(?:[^"'<>]|"[^"]*"|'[^']*')*>[\s\S]*?<\/style\s*>|<(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,token=>{
    if(token.startsWith('<!--'))return token;
    if(/^<script\b/i.test(token)){const opening=token.match(/^<(?:[^"'<>]|"[^"]*"|'[^']*')*>/)[0];return rewriteTag(opening,relative,displayAssets)+token.slice(opening.length);}
    if(/^<style\b/i.test(token)){const opening=token.match(/^<(?:[^"'<>]|"[^"]*"|'[^']*')*>/)[0],close=token.match(/<\/style\s*>$/i)[0];return rewriteTag(opening,relative,displayAssets)+rewriteCss(token.slice(opening.length,-close.length),relative,displayAssets)+close;}
    return rewriteTag(token,relative,displayAssets);
  });
}
function outputDirectory(root,relative,requireEmpty) {
  if(relative!=='dist/site')throw new Error('Build output must be dist/site.');
  const output=path.join(root,relative);if(fs.existsSync(path.join(root,'dist'))&&fs.lstatSync(path.join(root,'dist')).isSymbolicLink())throw new Error('Symlink output is forbidden.');
  if(fs.existsSync(output)&&(fs.lstatSync(output).isSymbolicLink()||(requireEmpty&&fs.readdirSync(output).length)))throw new Error('Build output must be an empty real directory.');return output;
}
function verify(root,output) {
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'asset-versions.json'),'utf8'));
  if(manifest.version!==1||!manifest.assets||typeof manifest.assets!=='object')throw new Error('Invalid build version manifest.');
  for(const [name,sha]of Object.entries(manifest.assets))if(!assets.safeAsset(name)||!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid public asset version.');
  const mapping=manifest.displayAssets||{};
  for(const [original,alias]of Object.entries(mapping)){
    if(!alias||Object.keys(alias).sort().join(',')!=='sourceSha,targetPath,targetSha'||!assets.safeAsset(original)||!assets.safeAsset(alias.targetPath)||!alias.targetPath.startsWith('img/optimized/')||manifest.assets[original]!==alias.sourceSha||manifest.assets[alias.targetPath]!==alias.targetSha)throw new Error('Invalid display alias.');
    const data=fs.readFileSync(path.join(output,alias.targetPath));if(assets.gitSha(data)!==alias.targetSha)throw new Error('Derivative hash mismatch.');
    if(assets.gitSha(fs.readFileSync(path.join(output,original)))!==alias.sourceSha)throw new Error('Original hash mismatch.');
  }
  for(const forbidden of ['cms','docs','tests','scripts','private','node_modules','.github'])if(fs.existsSync(path.join(output,forbidden)))throw new Error('Private/developer files leaked into site artifact.');
  const problems=[];
  for(const filename of allFiles(output).filter(name=>/\.(?:html|css)$/.test(name))){
    const relative=path.relative(output,filename).split(path.sep).join('/'),text=fs.readFileSync(filename,'utf8');
    const values=[];
    if(/\.html$/.test(relative)){
      for(const match of text.matchAll(/<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)){const a=assets.attributes(match[0]);for(const key of ['src','poster','href'])if(a[key])values.push(a[key]);if(a.srcset&&!/data:/i.test(a.srcset))values.push(...a.srcset.split(',').map(v=>v.trim().split(/\s+/)[0]));}
    }
    for(const match of text.matchAll(/url\(\s*(["']?)([^)]*?)\1\s*\)/gi))values.push(match[2]);
    for(const value of values){const target=assets.localAsset(value,relative)||frontendTarget(value,relative);if(target&&!fs.existsSync(path.join(output,target)))problems.push({source:relative,path:target});}
  }
  if(problems.length)throw new Error('Missing compiled asset references: '+JSON.stringify(problems.slice(0,10)));
  return {displayAliases:Object.keys(mapping).length,publicFiles:allFiles(output).length,publicBytes:allFiles(output).reduce((n,f)=>n+fs.statSync(f).size,0)};
}
async function build(root,output) {
  fs.mkdirSync(output,{recursive:true});
  for(const folder of STATIC_DIRS)if(fs.existsSync(path.join(root,folder)))fs.cpSync(path.join(root,folder),path.join(output,folder),{recursive:true,dereference:false});
  for(const name of fs.readdirSync(root).filter(n=>/\.html$/.test(n)).concat(STATIC_FILES))if(fs.existsSync(path.join(root,name)))fs.copyFileSync(path.join(root,name),path.join(output,name));
  execFileSync('python3',['scripts/site_audit.py','--output',path.join(root,'private/build-asset-inventory.json'),'--check'],{cwd:root,encoding:'utf8'});
  // The tool writes a private audit file; its printed summary is intentionally not parsed.
  const actualInventory=JSON.parse(fs.readFileSync(path.join(root,'private/build-asset-inventory.json'),'utf8'));
  const generated=await assets.generateDisplayAssets(root,output,actualInventory);
  const versions={version:1,assets:{},displayAssets:generated.displayAssets};
  for(const filename of allFiles(output).filter(f=>assets.safeAsset(path.relative(output,f).split(path.sep).join('/')))){const relative=path.relative(output,filename).split(path.sep).join('/');versions.assets[relative]=assets.gitSha(fs.readFileSync(filename));}
  for(const filename of allFiles(output).filter(f=>/\.(?:html|css)$/.test(f))){const relative=path.relative(output,filename).split(path.sep).join('/'),old=fs.readFileSync(filename,'utf8');fs.writeFileSync(filename,/\.html$/.test(relative)?rewriteHtml(old,relative,generated.displayAssets):rewriteCss(old,relative,generated.displayAssets));}
  const frontend=allFiles(output).filter(f=>/\.(?:css|js)$/.test(f)),fingerprint=frontendFingerprint(frontend.map(f=>[path.relative(output,f).split(path.sep).join('/'),fs.readFileSync(f)]));
  for(const filename of allFiles(output).filter(f=>/\.(?:html|css)$/.test(f))){const relative=path.relative(output,filename).split(path.sep).join('/'),old=fs.readFileSync(filename,'utf8');fs.writeFileSync(filename,/\.html$/.test(relative)?versionFrontendHtml(old,relative,fingerprint):versionFrontendCss(old,relative,fingerprint));}
  fs.writeFileSync(path.join(output,'asset-versions.json'),JSON.stringify(versions,null,2)+'\n');
  stampPageVersions(output,fingerprint);
  const summary=verify(root,output),adopted=generated.report.results.filter(r=>r.adopted);
  const report={...generated.report,summary:{...summary,frontendFingerprint:fingerprint,originalDisplayBytes:adopted.reduce((n,r)=>n+r.originalBytes,0),derivativeDisplayBytes:adopted.reduce((n,r)=>n+r.targetBytes,0),optimizedImages:adopted.length}};
  fs.writeFileSync(path.join(root,'dist/asset-build-report.json'),JSON.stringify(report,null,2)+'\n');
  return report.summary;
}
async function main(args=process.argv.slice(2)) {
  const i=args.indexOf('--output'),relative=i>=0?args[i+1]:'dist/site',output=outputDirectory(ROOT,relative,!args.includes('--verify'));
  console.log(JSON.stringify(args.includes('--verify')?verify(ROOT,output):await build(ROOT,output)));
}
module.exports={rewriteUrl,rewriteCss,rewriteHtml,rewriteSrcset,frontendTarget,frontendUrl,frontendFingerprint,versionFrontendCss,versionFrontendHtml,stampPageVersions,outputDirectory,verify,build};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
