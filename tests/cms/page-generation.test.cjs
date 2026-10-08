'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), {test} = require('node:test');
const Cheerio = require('cheerio');
const root = path.resolve(__dirname, '../..');
const SITE = 'https://ponnhide.github.io/yachielab-preview';
const SHA = 'a'.repeat(40);
const TEMPLATE = '<html lang="en" data-theme="preserved"><head><title>Generic template title</title><meta property="og:title" content="Generic template title"><meta property="og:url" content="old-url"></head><body data-page="blank"><header id="normal_header">old header</header><aside>old sidebar</aside><main><section class="posts">old template body</section></main><section id="mobile-menu">old mobile</section><footer>old footer</footer></body></html>';
const SHARED = {header:'<div id="latest-header"><h1>Shared title</h1></div>', footer:'<div id="latest-footer">Footer</div>', sidebar:'<div id="latest-sidebar">Sidebar</div>', mobilemenu:'<div id="latest-mobile">Mobile</div>'};

function fixture(options = {}) {
  const state = {rendered:[], reads:[], staged:[], published:[], validations:[], released:0, logs:[]};
  const pages = options.pages || ['fresh','existing'];
  const context = {pages, pendingAssets:[], cacheStats:{}, spreadsheet:{getActiveSheet:()=>({getName:()=>options.active || 'fresh'}),toast(){}}};
  const entries = options.entries || {'existing.html':{type:'blob',sha:SHA},'index.html':{type:'blob',sha:SHA}};
  const sources = new Set(options.sources || [...pages,...Object.keys(SHARED)]);
  const fragments = {...SHARED, ...Object.fromEntries(pages.map(name=>[name,'<h1>'+name+' heading</h1><p>'+name+' body</p>'])), ...options.fragments};
  const sandbox = {
    Cheerio, PREVIEW_SITE_URL:SITE, PREVIEW_REPOSITORY:'ponnhide/yachielab-preview', PREVIEW_BRANCH:'codex/preview', REPO_NAME:'ponnhide/yachielab-preview', BRANCH:'codex/preview', GITHUB_TOKEN:'not-a-live-token',
    console:Object.fromEntries(['info','warn','error'].map(level=>[level,message=>state.logs.push([level,message])])),
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>state.released++})},
    Utilities:{base64Decode:content=>Buffer.from(content,'base64'),newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')})},
    cmsContext_:()=>context, cmsGithubSnapshot_:()=>({entries}),
    cmsAssertPageName_(name,creating) {state.validations.push([name,creating]);if(typeof name!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(name)||/^(?:index|blank|404|header|footer|sidebar|mobilemenu)$/.test(name))throw Error('Invalid page name.');},
    cmsSheetRows_(name) {if(!sources.has(name))throw Error('Missing CMS tab: '+name);return {values:[['Lab','Language','Function']]};},
    cmsCacheRenderRows_(name) {state.rendered.push(name);if(!sources.has(name))throw Error('Missing CMS tab: '+name);return fragments[name] || '';},
    cmsCacheCanSkipFragment_:()=>false,
    cmsCacheStagePage_:(file,selector,fragment)=>state.staged.push({file,selector,fragment}),
    cmsCacheCommit_:()=>{}, cmsAssetsCommit_:()=>{},
    getGithubFileContent(token,repo,filename,branch) {
      state.reads.push(filename); assert.equal(repo,'ponnhide/yachielab-preview'); assert.equal(branch,'codex/preview');
      if(filename==='blank.html' && options.noTemplate)return null;
      const html=filename==='blank.html' ? options.template ?? TEMPLATE : options.existingHtml ?? TEMPLATE.replace('old template body','<h1>Existing body kept</h1>');
      return {sha:SHA,content:Buffer.from(html).toString('base64')};
    },
    cmsPublish_(files) {state.published.push(files);return {changed:files.length>0,pages:files.length,assets:0};},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'cms/Cms.gs'),'utf8'),sandbox,{filename:'Cms.gs'});
  state.context=context; state.run=sandbox; return state;
}

test('new pages use real template DOM, latest shared components, body and escaped page metadata', () => {
  const heading='R & D <lab> "quoted"';
  const state=fixture({fragments:{fresh:'<h1>   </h1><h1>R &amp; D &lt;lab&gt; "quoted"</h1><h1>Later</h1><p>Fresh body</p>'}});
  const file=state.run.cmsCreatePage_('fresh'), $=Cheerio.load(file.html);
  assert.equal(file.path,'fresh.html');assert.equal(file.expectedAbsent,true);
  assert.equal($('html').attr('lang'),'en');assert.equal($('html').attr('data-theme'),'preserved');
  assert.equal($('body').attr('data-page'),'fresh');assert.equal($('title').text(),heading);
  assert.equal($('meta[property="og:title"]').attr('content'),heading);
  assert.equal($('meta[name="twitter:title"]').attr('content'),heading);
  assert.equal($('meta[name="cms-generated-page"]').attr('content'),'true');
  assert.equal($('meta[property="og:url"]').attr('content'),SITE+'/fresh.html');
  for(const id of ['latest-header','latest-footer','latest-sidebar','latest-mobile'])assert.equal($('#'+id).length,1);
  assert.equal($('.posts p').text(),'Fresh body');assert.equal($('title lab').length,0);
  assert.equal(state.staged.length,5);assert.deepEqual(state.validations,[['fresh',false]]);
  assert.equal(state.published.length,0,'Rendering does not publish before the caller collects its batch');
  assert.ok(!/^\s*<!doctype/i.test(file.html),'New pages retain the template document mode');
});

test('the actual blank template generates one complete page with its original assets and document mode', () => {
  const blank=fs.readFileSync(path.join(root,'blank.html'),'utf8'),state=fixture({template:blank});
  const file=state.run.cmsCreatePage_('fresh'),$=Cheerio.load(file.html);
  for(const selector of ['#normal_header','footer','aside','#mobile-menu','.posts'])assert.equal($(selector).length,1);
  assert.equal($('link[href="./css/common.css"]').length,1);
  assert.equal($('.posts h1').text(),'fresh heading');assert.equal($('title').text(),'fresh heading');
  assert.equal(/^\s*<!doctype/i.test(file.html),/^\s*<!doctype/i.test(blank));
});

test('missing metadata is added safely and an empty heading retains the template title', () => {
  const state=fixture({template:TEMPLATE.replace(/<title>[\s\S]*?<\/title>|<meta\b[^>]*>/g,''),fragments:{fresh:'<h1>New title</h1>'}});
  const $=Cheerio.load(state.run.cmsCreatePage_('fresh').html);
  assert.equal($('head title').text(),'New title');assert.equal($('meta[property="og:url"]').attr('content'),SITE+'/fresh.html');
  const empty=fixture({fragments:{fresh:'<h1>  </h1><p>Only body</p>'}});
  assert.equal(Cheerio.load(empty.run.cmsCreatePage_('fresh').html)('title').text(),'Generic template title');
});

test('editing a generated page heading refreshes its metadata without adopting original page metadata', () => {
  const original=fixture().run.cmsCreatePage_('fresh');
  const heading='Updated <title> & 日本語';
  const state=fixture({pages:['fresh'],entries:{'fresh.html':{type:'blob',sha:SHA}},existingHtml:original.html,fragments:{fresh:'<h1>Updated &lt;title&gt; &amp; 日本語</h1>'}});
  state.run.update_webpage();
  const $=Cheerio.load(state.published[0][0].html);
  assert.equal($('title').text(),heading);assert.equal($('meta[property="og:title"]').attr('content'),heading);
  assert.equal($('meta[name="twitter:title"]').attr('content'),heading);
  assert.equal($('meta[property="og:url"]').attr('content'),SITE+'/fresh.html');
  assert.equal(state.published[0][0].expectedAbsent,undefined);
  const legacy=fixture({active:'existing'});legacy.run.update_webpage();
  const old=Cheerio.load(legacy.published[0][0].html);
  assert.equal(old('title').text(),'Generic template title');assert.equal(old('meta[property="og:title"]').attr('content'),'Generic template title');
  assert.equal(old('meta[property="og:url"]').attr('content'),'old-url');assert.equal(old('meta[name="cms-generated-page"]').length,0);
});

test('normal current-page update automatically creates a registered absent HTML in one publication', () => {
  const state=fixture();state.run.update_webpage();
  assert.equal(state.published.length,1);assert.equal(state.published[0].length,1);
  assert.equal(state.published[0][0].path,'fresh.html');assert.equal(state.published[0][0].expectedAbsent,true);
  assert.equal(state.released,1);
});

test('all-page update batches existing and missing pages and reads template/shared sources once', () => {
  const state=fixture({pages:['fresh','existing','second']});state.run.update_all_webpages();
  assert.equal(state.published.length,1);
  assert.deepEqual(Array.from(state.published[0],file=>file.path),['fresh.html','existing.html','second.html']);
  assert.equal(state.reads.filter(name=>name==='blank.html').length,1);
  for(const name of Object.keys(SHARED))assert.equal(state.rendered.filter(value=>value===name).length,1);
  const existing=state.published[0][1],$=Cheerio.load(existing.html);
  assert.equal(existing.expectedSha,SHA);assert.equal(existing.expectedAbsent,undefined);
  assert.equal($('#normal_header').text(),'old header');assert.equal($('footer').text(),'old footer');
  assert.equal($('title').text(),'Generic template title');assert.equal($('.posts h1').text(),'existing heading');
});

test('shared update creates absent pages completely and preserves existing page bodies', () => {
  const state=fixture();state.run.update_shared_components();
  assert.equal(state.published.length,1);
  const files=state.published[0],fresh=files.find(file=>file.path==='fresh.html'),existing=files.find(file=>file.path==='existing.html');
  assert.equal(fresh.expectedAbsent,true);assert.equal(Cheerio.load(fresh.html)('.posts h1').text(),'fresh heading');
  assert.equal(Cheerio.load(existing.html)('.posts h1').text(),'Existing body kept');
  for(const name of Object.keys(SHARED))assert.equal(state.rendered.filter(value=>value===name).length,1);
  assert.equal(state.rendered.filter(name=>name==='existing').length,0);
});

test('updating one shared component gives new pages the other three latest components too', () => {
  const state=fixture({active:'sidebar'});state.run.update_webpage();
  const files=state.published[0],fresh=Cheerio.load(files.find(file=>file.path==='fresh.html').html),existing=Cheerio.load(files.find(file=>file.path==='existing.html').html);
  for(const id of ['latest-header','latest-footer','latest-sidebar','latest-mobile'])assert.equal(fresh('#'+id).length,1);
  assert.equal(existing('#latest-sidebar').length,1);assert.equal(existing('#normal_header').text(),'old header');
  assert.equal(existing('footer').text(),'old footer');assert.equal(existing('.posts h1').text(),'Existing body kept');
  for(const name of Object.keys(SHARED))assert.equal(state.rendered.filter(value=>value===name).length,1);
});

test('Add missing registered pages uses the same complete generator and never rewrites existing HTML', () => {
  const state=fixture({pages:['fresh','existing','second']});state.run.addNewpage();
  assert.equal(state.published.length,1);assert.deepEqual(Array.from(state.published[0],file=>file.path),['fresh.html','second.html']);
  assert.equal(state.reads.filter(name=>name==='blank.html').length,1);
  const complete=fixture({pages:['existing']});complete.run.makeNewpage();
  assert.equal(complete.reads.length,0);assert.equal(complete.rendered.length,0);assert.equal(complete.published[0].length,0);
});

test('unregistered/excluded, invalid or already present pages never reach template reading or publication', () => {
  for(const name of ['yuka','header','../escape','existing']) {
    const state=fixture({sources:['fresh','existing','yuka',...Object.keys(SHARED)]});
    assert.throws(()=>state.run.cmsCreatePage_(name));assert.equal(state.reads.length,0);assert.equal(state.published.length,0);
  }
  const selected=fixture({active:'yuka',sources:['yuka',...Object.keys(SHARED)]});
  assert.throws(()=>selected.run.update_webpage(),/intentionally outside/);assert.equal(selected.published.length,0);
});

test('missing source tabs abort the entire batch before any publication', () => {
  const state=fixture({pages:['fresh','missing'],sources:['fresh',...Object.keys(SHARED)]});
  assert.throws(()=>state.run.update_all_webpages(),/Missing CMS tab: missing/);
  assert.equal(state.published.length,0);assert.equal(state.released,1);
  const missing=fixture({sources:Object.keys(SHARED)});
  assert.throws(()=>missing.run.cmsCreatePage_('fresh'),/Missing CMS tab/);assert.equal(missing.reads.length,0);
});

test('each missing or duplicate template container prevents generation before any fragment is staged', () => {
  const containers=['<header id="normal_header">old header</header>','<aside>old sidebar</aside>','<section class="posts">old template body</section>','<section id="mobile-menu">old mobile</section>','<footer>old footer</footer>'];
  for(const container of containers)for(const replacement of ['',container+container]) {
    const state=fixture({template:TEMPLATE.replace(container,replacement)});
    assert.throws(()=>state.run.cmsCreatePage_('fresh'),/exactly one/);
    assert.equal(state.staged.length,0);assert.equal(state.rendered.length,0);assert.equal(state.published.length,0);
  }
  const absent=fixture({noTemplate:true});assert.throws(()=>absent.run.cmsCreatePage_('fresh'),/Missing blank.html/);assert.equal(absent.published.length,0);
});

test('source fragments cannot introduce duplicate page containers into a newly generated page', () => {
  const state=fixture({fragments:{fresh:'<h1>Title</h1><section class="posts">Accidental nested body</section>'}});
  assert.throws(()=>state.run.cmsCreatePage_('fresh'),/output must contain exactly one \.posts/);
  assert.equal(state.staged.length,0);assert.equal(state.published.length,0);
});
