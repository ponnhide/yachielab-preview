'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createBrowser, descendants} = require('./browser-harness.cjs');
const A = 'a'.repeat(40), B = 'b'.repeat(40);
function fixture(manifest, html = '<html><body><img id="photo" src="./img/photo.jpg?size=2&amp;v=old#crop"></body></html>') {
  const browser = createBrowser(html);
  const requests = [];
  browser.window.fetch = (url, options) => { requests.push({url,options}); return Promise.resolve({ok:true,json:()=>Promise.resolve(manifest)}); };
  browser.requests = requests;
  const prepare = element => { element.style.setProperty = (key,value) => { element.style[key] = String(value); }; return element; };
  descendants(browser.document).forEach(prepare);
  const create = browser.document.createElement;
  browser.document.createElement = tag => prepare(create(tag));
  return browser;
}
test('same-name source update gets the new version without losing query/hash; external URLs remain unchanged', async () => {
  const browser = fixture({version:1,assets:{'img/photo.jpg':A,'img/日本語.jpg':B}});
  browser.run('assets.js'); assert.equal(await browser.window.YachieAssets.ready, true);
  const api = browser.window.YachieAssets;
  assert.equal(new URL(browser.element('photo').src).searchParams.get('v'), A.slice(0,12));
  assert.equal(new URL(browser.element('photo').src).searchParams.get('size'),'2');
  assert.equal(new URL(browser.element('photo').src).hash,'#crop');
  assert.equal(api.versionUrl(browser.element('photo').src),browser.element('photo').src);
  assert.equal(new URL(api.versionUrl('./img/%E6%97%A5%E6%9C%AC%E8%AA%9E.jpg')).searchParams.get('v'),B.slice(0,12));
  for(const url of ['https://other.example/img/photo.jpg','data:image/png;base64,AA','./img/unknown.jpg']) assert.equal(api.versionUrl(url),url);
  assert.equal(browser.requests.length,1); assert.equal(browser.requests[0].options.cache,'no-store');
  assert.match(browser.requests[0].url,/\/asset-versions\.json$/);
});
test('fresh manifest replaces an old same-name version while malformed/offline manifests preserve working image URLs', async () => {
  const changed = fixture({version:1,assets:{'img/photo.jpg':B}});
  changed.run('assets.js'); await changed.window.YachieAssets.ready;
  assert.match(changed.element('photo').src,/v=bbbbbbbbbbbb/);
  for(const manifest of [{version:1,assets:{'img/../private':A}},{version:1,assets:{'img/photo.jpg':'https://private.example'}},{version:2,assets:{}}]) {
    const browser=fixture(manifest),old=browser.element('photo').src;browser.run('assets.js');
    assert.equal(await browser.window.YachieAssets.ready,false);assert.equal(browser.element('photo').src,old);
  }
  const offline=fixture({});offline.window.fetch=()=>Promise.reject(new Error('Offline'));
  const old=offline.element('photo').src;offline.run('assets.js');assert.equal(await offline.window.YachieAssets.ready,false);assert.equal(offline.element('photo').src,old);
});
test('srcset, inline backgrounds, PDF links and same-origin imported CSS use their own correct versions', async () => {
  const browser=fixture({version:1,assets:{'img/photo.jpg':A,'img/other.jpg':B,'pdf/paper.pdf':B}},'<html><body><source id="sizes" srcset="./img/photo.jpg 1x, ./img/other.jpg 2x"><div id="bg" style="background:url(./img/photo.jpg)"></div><a id="paper" href="./pdf/paper.pdf#page=2"></a></body></html>');
  const values={'background-image':'url(../../img/photo.jpg)'};
  const style=Object.assign(['background-image'],{getPropertyValue:k=>values[k],getPropertyPriority:()=> 'important',setProperty(k,v,p){values[k]=v;assert.equal(p,'important');}});
  const imported={href:'https://ponnhide.github.io/yachielab-preview/css/pages/page.css',cssRules:[{style}]};
  browser.document.styleSheets=[{cssRules:[{styleSheet:imported}]}];
  browser.run('assets.js');await browser.window.YachieAssets.ready;
  assert.match(browser.element('sizes').getAttribute('srcset'),/photo\.jpg\?v=aaaaaaaaaaaa 1x.*other\.jpg\?v=bbbbbbbbbbbb 2x/);
  assert.match(browser.element('bg').getAttribute('style'),/v=aaaaaaaaaaaa/);
  assert.match(browser.element('paper').getAttribute('href'),/v=bbbbbbbbbbbb#page=2/);
  assert.match(values['background-image'],/\/yachielab-preview\/img\/photo\.jpg\?v=aaaaaaaaaaaa/);
});
test('dynamic image replacement and added nodes receive their own version, without rewriting unrelated attributes', async () => {
  const browser=fixture({version:1,assets:{'img/photo.jpg':A,'img/other.jpg':B}});
  let observer;
  browser.window.MutationObserver=class{constructor(callback){observer=callback;}observe(){}};
  browser.run('assets.js');await browser.window.YachieAssets.ready;
  const image=browser.element('photo');image.setAttribute('src','./img/other.jpg?v=old');
  observer([{type:'attributes',target:image}]);assert.match(image.src,/v=bbbbbbbbbbbb/);
  const added=browser.document.createElement('img');added.setAttribute('src','./img/photo.jpg');
  observer([{type:'childList',addedNodes:[added]}]);assert.match(added.src,/v=aaaaaaaaaaaa/);
  const old=image.src;observer([{type:'attributes',target:image}]);assert.equal(image.src,old);
});
test('homepage highlight swaps use the highlighted image SHA, then restore the normal image SHA', async () => {
  const browser=fixture({version:1,assets:{'img/H_1r.png':A,'img/H_2r.png':B}},require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../index.html'),'utf8'));
  browser.window.fetch=(url)=>Promise.resolve({ok:true,json:()=>Promise.resolve(url.endsWith('asset-versions.json')?{version:1,assets:{'img/H_1r.png':A,'img/H_2r.png':B}}:{logoActiveOpacity:1,logoInactiveOpacity:0.5,logoTransitionMs:300})});
  browser.run('assets.js');browser.run('common.js');await browser.window.YachieAssets.ready;browser.run('index.js');
  browser.element('main_research_EN').dispatch('mouseenter');assert.match(browser.element('main_research_img').src,/H_2r\.png\?v=bbbbbbbbbbbb$/);
  browser.element('main_research_EN').dispatch('mouseleave');assert.match(browser.element('main_research_img').src,/H_1r\.png\?v=aaaaaaaaaaaa$/);
});

test('new homepage controller tolerates a cached older common controller with no assetUrl API', () => {
  const browser = createBrowser('index.html');
  browser.window.YachieSite = {isHomePage:true};
  assert.doesNotThrow(()=>browser.run('index.js'));
  browser.element('main_research_EN').dispatch('mouseenter');
  assert.match(new URL(browser.element('main_research_img').src).pathname,/H_2r\.png$/);
});

const C = 'c'.repeat(40), D = 'd'.repeat(40);
function aliasManifest(overrides = {}) {
  return {version:1,assets:{'img/photo.jpg':A,'img/optimized/photo--aaaaaaaaaaaa.webp':B,'img/other.png':C,'img/optimized/other--cccccccccccc.webp':D,'pdf/paper.pdf':C},
    displayAssets:{'img/photo.jpg':{sourceSha:A,targetPath:'img/optimized/photo--aaaaaaaaaaaa.webp',targetSha:B},'img/other.png':{sourceSha:C,targetPath:'img/optimized/other--cccccccccccc.webp',targetSha:D}},...overrides};
}
test('verified display aliases version images, srcset, poster and CSS while image/PDF download anchors keep originals', async () => {
  const browser=fixture(aliasManifest(),'<html><body><img id="photo" src="./img/photo.jpg?size=2&amp;v=old#crop"><source id="sizes" srcset="./img/photo.jpg 1x, ./img/other.png 2x"><video id="video" poster="./img/photo.jpg"></video><div id="background" style="background:url(./img/photo.jpg)"></div><a id="download" href="./img/photo.jpg?download=1#full"></a><area id="maplink" href="./img/photo.jpg"><a id="pdf" href="./pdf/paper.pdf#page=2"></a></body></html>');
  const values={'background-image':'url(../img/photo.jpg)'};
  browser.document.styleSheets=[{href:'https://ponnhide.github.io/yachielab-preview/css/page.css',cssRules:[{style:Object.assign(['background-image'],{getPropertyValue:k=>values[k],getPropertyPriority:()=>'',setProperty(k,v){values[k]=v;}})}]}];
  browser.run('assets.js');assert.equal(await browser.window.YachieAssets.ready,true);
  const image=new URL(browser.element('photo').src);assert.match(image.pathname,/img\/optimized\/photo--aaaaaaaaaaaa\.webp$/);assert.equal(image.searchParams.get('v'),B.slice(0,12));assert.equal(image.searchParams.get('size'),'2');assert.equal(image.hash,'#crop');
  assert.match(browser.element('sizes').getAttribute('srcset'),/photo--aaaaaaaaaaaa\.webp\?[^ ]*v=bbbbbbbbbbbb 1x.*other--cccccccccccc\.webp\?[^ ]*v=dddddddddddd 2x/);
  assert.match(browser.element('video').getAttribute('poster'),/optimized\/photo--aaaaaaaaaaaa\.webp/);assert.match(browser.element('background').getAttribute('style'),/optimized\/photo--aaaaaaaaaaaa\.webp/);assert.match(values['background-image'],/optimized\/photo--aaaaaaaaaaaa\.webp/);
  const download=new URL(browser.element('download').getAttribute('href'));assert.match(download.pathname,/img\/photo\.jpg$/);assert.equal(download.searchParams.get('v'),A.slice(0,12));assert.equal(download.searchParams.get('download'),'1');assert.equal(download.hash,'#full');
  assert.match(browser.element('maplink').getAttribute('href'),/img\/photo\.jpg\?v=aaaaaaaaaaaa$/);assert.match(browser.element('pdf').getAttribute('href'),/pdf\/paper\.pdf\?v=cccccccccccc#page=2$/);assert.equal(browser.requests.length,1);
  const changed=browser.element('photo').src;browser.window.YachieAssets.apply();assert.equal(browser.element('photo').src,changed);assert.equal(browser.window.YachieAssets.versionUrl(changed),changed);
});
test('stale original or derivative hashes fall back to the current original including pre-rewritten artifact URLs', async () => {
  for(const field of ['source','target','missing']) {
    const manifest=aliasManifest();if(field==='missing')delete manifest.assets['img/optimized/photo--aaaaaaaaaaaa.webp'];else manifest.assets[field==='source'?'img/photo.jpg':'img/optimized/photo--aaaaaaaaaaaa.webp']=C;
    const browser=fixture(manifest);browser.run('assets.js');assert.equal(await browser.window.YachieAssets.ready,true);
    const image=new URL(browser.element('photo').src);assert.match(image.pathname,/img\/photo\.jpg$/);assert.equal(image.searchParams.get('v'),(field==='source'?C:A).slice(0,12));
    const fromArtifact=new URL(browser.window.YachieAssets.versionUrl('./img/optimized/photo--aaaaaaaaaaaa.webp?x=1#crop'));assert.match(fromArtifact.pathname,/img\/photo\.jpg$/);assert.equal(fromArtifact.searchParams.get('x'),'1');assert.equal(fromArtifact.hash,'#crop');
  }
});
test('malformed, missing, external and traversal aliases are ignored while ordinary asset versions still apply', async () => {
  const badAliases=[null,[],{'img/photo.jpg':{sourceSha:A,targetPath:'https://evil.example/photo.webp',targetSha:B}},{'img/photo.jpg':{sourceSha:A,targetPath:'img/optimized/../photo.webp',targetSha:B}},{'img/photo.jpg':{sourceSha:A,targetPath:'img/optimized/%2e%2e/photo.webp',targetSha:B}},{'img/photo.jpg':{sourceSha:'bad',targetPath:'img/optimized/photo--aaaaaaaaaaaa.webp',targetSha:B}},{'img/photo.jpg':{sourceSha:A,targetPath:'img/optimized/missing.webp',targetSha:B}},{'pdf/paper.pdf':{sourceSha:C,targetPath:'img/optimized/photo--aaaaaaaaaaaa.webp',targetSha:B}}];
  for(const aliases of badAliases) {
    const browser=fixture(aliasManifest({displayAssets:aliases}));browser.run('assets.js');assert.equal(await browser.window.YachieAssets.ready,true);
    assert.match(new URL(browser.element('photo').src).pathname,/img\/photo\.jpg$/);assert.equal(new URL(browser.element('photo').src).searchParams.get('v'),A.slice(0,12));
    for(const value of ['https://other.example/img/photo.jpg','data:image/png;base64,AA','blob:https://other.example/value'])assert.equal(browser.window.YachieAssets.versionUrl(value),value);
  }
});
test('download anchors that already name a derivative recover the original, and dynamic display aliases remain idempotent', async () => {
  const browser=fixture(aliasManifest(),'<html><body><a id="download" href="./img/optimized/photo--aaaaaaaaaaaa.webp?download=1#full"></a><img id="photo" src="./img/photo.jpg"></body></html>');let observer;
  browser.window.MutationObserver=class{constructor(callback){observer=callback;}observe(){}};browser.run('assets.js');await browser.window.YachieAssets.ready;
  assert.match(new URL(browser.element('download').getAttribute('href')).pathname,/img\/photo\.jpg$/);
  browser.element('photo').setAttribute('src','./img/other.png?size=3');observer([{type:'attributes',target:browser.element('photo')}]);assert.match(browser.element('photo').src,/other--cccccccccccc\.webp\?size=3&asset=img%2Fother.png&v=dddddddddddd$/);
  const current=browser.element('photo').src;observer([{type:'attributes',target:browser.element('photo')}]);assert.equal(browser.element('photo').src,current);
});
test('homepage hover and preload keep logical image identities after artifact HTML already selected WebP derivatives', async () => {
  const manifest={version:1,assets:{'img/H_1r.png':A,'img/H_2r.png':C,'img/optimized/H_1r--aaaaaaaaaaaa.webp':B,'img/optimized/H_2r--cccccccccccc.webp':D},displayAssets:{'img/H_1r.png':{sourceSha:A,targetPath:'img/optimized/H_1r--aaaaaaaaaaaa.webp',targetSha:B},'img/H_2r.png':{sourceSha:C,targetPath:'img/optimized/H_2r--cccccccccccc.webp',targetSha:D}}};
  const browser=fixture(manifest,require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../index.html'),'utf8'));
  browser.element('main_research_img').setAttribute('src','./img/optimized/H_1r--aaaaaaaaaaaa.webp?v=bbbbbbbbbbbb');
  browser.window.YachieSite={isHomePage:true};browser.run('assets.js');await browser.window.YachieAssets.ready;browser.run('index.js');
  assert(browser.preloadSources.some(value=>/H_2r--cccccccccccc\.webp\?asset=img%2FH_2r.png&v=dddddddddddd$/.test(value)));
  browser.element('main_research_EN').dispatch('mouseenter');assert.match(browser.element('main_research_img').src,/H_2r--cccccccccccc\.webp\?asset=img%2FH_2r.png&v=dddddddddddd$/);
  browser.element('main_research_EN').dispatch('mouseleave');assert.match(browser.element('main_research_img').src,/H_1r--aaaaaaaaaaaa\.webp\?asset=img%2FH_1r.png&v=bbbbbbbbbbbb$/);
});

test('cached artifact HTML and CSS recover their original identity when an old derivative is absent from the latest manifest', async () => {
  const original='img/photo.jpg',old='./img/optimized/photo--aaaaaaaaaaaa.webp?size=2&v=bbbbbbbbbbbb&asset=img%2Fphoto.jpg#crop';
  const latest={version:1,assets:{[original]:C,'img/optimized/photo--cccccccccccc.webp':D},displayAssets:{[original]:{sourceSha:C,targetPath:'img/optimized/photo--cccccccccccc.webp',targetSha:D}}};
  const browser=fixture(latest,'<html><body><img id="photo" src="'+old.replace(/&/g,'&amp;')+'"><source id="sizes" srcset="'+old.replace(/&/g,'&amp;')+' 1x"><div id="background" style="background:url('+old.replace(/&/g,'&amp;')+')"></div><a id="download" href="'+old.replace(/&/g,'&amp;')+'"></a></body></html>');
  const values={'background-image':'url(../img/optimized/photo--aaaaaaaaaaaa.webp?asset=img%2Fphoto.jpg&v=old)'};
  browser.document.styleSheets=[{href:'https://ponnhide.github.io/yachielab-preview/css/page.css',cssRules:[{style:Object.assign(['background-image'],{getPropertyValue:k=>values[k],getPropertyPriority:()=>'',setProperty(k,v){values[k]=v;}})}]}];
  browser.run('assets.js');assert.equal(await browser.window.YachieAssets.ready,true);
  const actual=new URL(browser.element('photo').src);assert.match(actual.pathname,/photo--cccccccccccc\.webp$/);assert.equal(actual.searchParams.get('asset'),original);assert.equal(actual.searchParams.get('size'),'2');assert.equal(actual.searchParams.get('v'),D.slice(0,12));assert.equal(actual.hash,'#crop');
  assert.match(browser.element('sizes').getAttribute('srcset'),/photo--cccccccccccc\.webp/);assert.match(browser.element('background').getAttribute('style'),/photo--cccccccccccc\.webp/);assert.match(values['background-image'],/photo--cccccccccccc\.webp/);
  const download=new URL(browser.element('download').getAttribute('href'));assert.match(download.pathname,/img\/photo\.jpg$/);assert.equal(download.searchParams.get('v'),C.slice(0,12));assert.equal(download.searchParams.has('asset'),false);
  const saved=browser.element('photo').src;browser.window.YachieAssets.apply();assert.equal(browser.element('photo').src,saved);
  const noAlias=fixture({...latest,displayAssets:{}},'<html><body><img id="photo" src="'+old.replace(/&/g,'&amp;')+'"></body></html>');noAlias.run('assets.js');await noAlias.window.YachieAssets.ready;
  const fallback=new URL(noAlias.element('photo').src);assert.match(fallback.pathname,/img\/photo\.jpg$/);assert.equal(fallback.searchParams.get('v'),C.slice(0,12));assert.equal(fallback.searchParams.has('asset'),false);
});

test('derivative identity markers cannot select external, missing, non-raster, traversal or duplicate original paths', async () => {
  const browser=fixture(aliasManifest());browser.run('assets.js');await browser.window.YachieAssets.ready;
  for(const marked of ['https://evil.example/image.jpg','img/../photo.jpg','img/%2e%2e/photo.jpg','img/missing.jpg','pdf/paper.pdf','img/optimized/unknown.webp']) {
    const value='./img/optimized/retired.webp?asset='+encodeURIComponent(marked)+'&v=old';assert.equal(browser.window.YachieAssets.versionUrl(value),value);
  }
  const duplicate='./img/optimized/retired.webp?asset=img%2Fphoto.jpg&asset=img%2Fother.png&v=old';assert.equal(browser.window.YachieAssets.versionUrl(duplicate),duplicate);
  const outside='https://other.example/img/optimized/retired.webp?asset=img%2Fphoto.jpg';assert.equal(browser.window.YachieAssets.versionUrl(outside),outside);
  // A marker on an ordinary asset URL is never interpreted as derivative identity.
  const ordinary=new URL(browser.window.YachieAssets.versionUrl('./img/other.png?asset=img%2Fphoto.jpg'));assert.match(ordinary.pathname,/other--cccccccccccc\.webp$/);assert.equal(ordinary.searchParams.get('asset'),'img/other.png');
});
