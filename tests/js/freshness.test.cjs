'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../js/freshness.js'),'utf8');
const old='a'.repeat(64),latest='b'.repeat(64);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
  const requested=[],navigated=[],listeners=new Map(),storage=options.storage||new Map();
  const clock={now:1000000};
  const location=new URL(options.url||'https://ponnhide.github.io/yachielab-preview/contact.html?lang=JA&affil=Osaka&campaign=lab#address');
  location.replace=url=>navigated.push(url);
  const document={
    currentScript:{src:'https://ponnhide.github.io/yachielab-preview/js/freshness.js?v=123',getAttribute:key=>({'data-page-version':old,'data-page':'contact.html',...options.attributes})[key]},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)
  };
  const window={location,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(options.blockedStorage)throw Error('blocked');storage.set(key,value);}},
    fetch:(url,config)=>{requested.push({url,config});return options.fetch?options.fetch():Promise.resolve({ok:true,json:()=>Promise.resolve(options.manifest||{version:1,pages:{'contact.html':latest}})});}
  };
  vm.runInNewContext(source,{window,document,URL,Date:{now:()=>clock.now}});
  return {requested,navigated,listeners,storage,clock};
}
test('cached HTML checks only its same-origin manifest without using the browser cache and refreshes the same page',async()=>{
  const f=fixture();await tick();
  assert.equal(f.requested.length,1);
  assert.equal(f.requested[0].url,'https://ponnhide.github.io/yachielab-preview/site-version.json');
  assert.equal(f.requested[0].config.cache,'no-store');
  assert.equal(f.requested[0].config.credentials,'same-origin');
  assert.equal(f.navigated.length,1);
  const next=new URL(f.navigated[0]);
  assert.equal(next.pathname,'/yachielab-preview/contact.html');
  assert.equal(next.searchParams.get('lang'),'JA');assert.equal(next.searchParams.get('affil'),'Osaka');
  assert.equal(next.searchParams.get('campaign'),'lab');assert.equal(next.hash,'#address');
  assert.equal(next.searchParams.get('_sitev'),latest);assert.equal(f.listeners.size,0);
});
test('current HTML, another page change, missing/invalid manifest and failed network do not reload',async()=>{
  for(const manifest of [{version:1,pages:{'contact.html':old,'joinus.html':latest}},{version:1,pages:{}},{version:2,pages:{'contact.html':latest}},{version:1,pages:{'contact.html':'https://evil.invalid/'}}]){
    const f=fixture({manifest});await tick();assert.equal(f.navigated.length,0);assert.equal(f.listeners.size,0);
  }
  for(const fetch of [()=>Promise.reject(Error('offline')),()=>Promise.resolve({ok:false}),()=>Promise.resolve({ok:true,json:()=>Promise.reject(Error('invalid JSON'))})]){
    const f=fixture({fetch});await tick();assert.equal(f.navigated.length,0);assert.equal(f.listeners.size,0);
  }
});
test('stale CDN responses and alternating revisions cannot cause a refresh loop',async()=>{
  const storage=new Map();const first=fixture({storage});await tick();assert.equal(first.navigated.length,1);
  const same=fixture({url:first.navigated[0],storage});await tick();assert.equal(same.navigated.length,0);
  const different=fixture({url:first.navigated[0],storage,manifest:{version:1,pages:{'contact.html':'c'.repeat(64)}}});await tick();assert.equal(different.navigated.length,0);
  const blocked=fixture({blockedStorage:true});await tick();assert.equal(blocked.navigated.length,0);
});
test('a slow response or user interaction never interrupts reading or lab controls',async()=>{
  for(const event of ['pointerdown','keydown','slow']){
    let respond;const f=fixture({fetch:()=>new Promise(resolve=>{respond=resolve;})});
    if(event==='slow')f.clock.now+=5001;else f.listeners.get(event)();
    respond({ok:true,json:()=>Promise.resolve({version:1,pages:{'contact.html':latest}})});
    await tick();assert.equal(f.navigated.length,0);assert.equal(f.listeners.size,0);
  }
});
test('root index entries work while 404 paths, foreign origins and unstamped source pages make no check',async()=>{
  const root=fixture({url:'https://ponnhide.github.io/yachielab-preview/?lang=EN',attributes:{'data-page':'index.html'},manifest:{version:1,pages:{'index.html':latest}}});await tick();assert.equal(root.navigated.length,1);
  for(const options of [{url:'https://ponnhide.github.io/yachielab-preview/missing.html'},{url:'https://elsewhere.invalid/yachielab-preview/contact.html'},{attributes:{'data-page-version':null}}]){
    const f=fixture(options);await tick();assert.equal(f.requested.length,0);assert.equal(f.navigated.length,0);
  }
});
