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
