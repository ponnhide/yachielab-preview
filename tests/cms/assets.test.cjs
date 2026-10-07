'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const root = path.resolve(__dirname, '../..');
const jpegA = Buffer.from([255,216,255,224,1,2,3]);
const jpegB = Buffer.from([255,216,255,224,4,5,6]);
const remote = 'https://www.dropbox.com/example/photo.jpg?rlkey=private-key&dl=0';
function bytes(value) { return [...Buffer.from(typeof value === 'string' ? value : (value || []).map(byte => byte & 255))]; }
function blob(value) { return {getBytes: () => bytes(value), getDataAsString: () => Buffer.from(bytes(value)).toString('utf8')}; }
function gitSha(value) { const b = Buffer.from(bytes(value)); return crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex'); }
function fixture() {
  const state = {entries: {}, grid: null, fetches: [], servers: new Map(), drives: new Map(), privateWrites: 0, reads: 0, creates: 0, restored: 0,
    active: {name:'content'}, now: Date.UTC(2026,9,8), failWrite: false, warnings: [], blobReads: 0, metadataReads: 0};
  const sheet = {
    getLastRow: () => state.grid?.length || 0,
    getDataRange: () => ({getValues() {state.reads++;return state.grid.map(row=>row.slice());}}),
    getRange: (_row,_col,height,width) => ({setValues(values) {
      if (state.failWrite) throw new Error('private storage failed');
      assert.equal(values.length,height);assert(values.every(row=>row.length===width));state.grid=values.map(row=>row.slice());state.privateWrites++;
    }}),
    clearContents() {state.grid=[];}, getMaxRows: () => 1000, getMaxColumns: () => 26,
    setFrozenRows() {},insertRowsAfter() {},insertColumnsAfter() {}
  };
  state.newRun = (flags={}) => {
    const context = {assets:{},pendingAssets:[],spreadsheet:{
      getSheetByName(name) {assert.equal(name,'_cms_assets');return state.grid ? sheet : null;},
      getNumSheets:()=>5,getActiveSheet:()=>state.active,
      insertSheet(name,index) {assert.equal(name,'_cms_assets');assert.equal(index,5);state.active=sheet;state.creates++;state.grid=[];return sheet;},
      setActiveSheet(original) {state.active=original;state.restored++;}
    },...flags};
    class Clock extends Date {constructor(...args) {super(...(args.length ? args : [state.now]));}static now(){return state.now;}}
    const sandbox = {Date:Clock,console:{warn:value=>state.warnings.push(value)},
      cmsContext_:()=>context,cmsGithubSnapshot_:()=>({entries:state.entries}),
      previewWritablePath_:value=>/^(?:img|pdf)\/[^/?%\\\x00-\x1f]+$/.test(value),
      Utilities:{newBlob:blob,base64Encode:value=>Buffer.from(bytes(value)).toString('base64'),base64Decode:value=>[...Buffer.from(value,'base64')]},
      previewFetch_(url,options) {
        state.fetches.push({url,options});const server=state.servers.get(url);assert(server,'Missing mock server '+url);
        assert(['get','delete','patch','post','put'].includes(options.method || 'get'),'Mock must enforce the actual Apps Script HTTP method enum');
        const partial = options.headers.Range === 'bytes=0-0';
        if (partial && server.rangeError) throw new Error('Range probe failed');
        let status=(partial ? server.rangeStatus : server.status) || 200;
        if ((status===200 || status===206) && !server.ignoreConditional && ((server.etag && options.headers['If-None-Match']===server.etag)||(!server.etag && server.modified && options.headers['If-Modified-Since']===server.modified))) status=304;
        const headers={};if(server.etag)headers.ETag=server.etag;if(server.modified)headers['Last-Modified']=server.modified;
        if (partial && server.rangeLength !== undefined) headers[status===206 ? 'Content-Range' : 'Content-Length']=status===206 ? 'bytes 0-0/'+server.rangeLength : String(server.rangeLength);
        return {getResponseCode:()=>status,getAllHeaders:()=>headers,getBlob:()=>{assert.notEqual(status,304,'304 must never read body');return blob(status===206 ? server.body.subarray(0,1) : server.body);}};
      },
      DriveApp:{getFileById(id) {
        state.metadataReads++;const file=state.drives.get(id);if(!file)throw new Error('Drive unavailable');
        return {getName:()=>file.name,getLastUpdated:()=>new Clock(file.modified),getSize:()=>file.size === undefined ? file.body.length : file.size,getBlob:()=>{state.blobReads++;return blob(file.body);}};
      }}
    };
    vm.createContext(sandbox);
    ['Hashes.gs','RenderCache.gs','AssetRegistry.gs','AssetStore.gs'].forEach(name=>vm.runInContext(fs.readFileSync(path.join(root,'cms',name),'utf8'),sandbox,{filename:name}));
    state.run={sandbox,context};return state.run;
  };
  state.http = (url,body=jpegA,options={}) => {const source=state.run.sandbox.cmsAssetSource_(url);state.servers.set(source.downloadUrl,{body,...options});return source.downloadUrl;};
  state.publish = ({wrongSha=false}={}) => {
    const {sandbox,context}=state.run;const assetShas={};
    context.pendingAssets.forEach(asset=>{state.entries[asset.path]={type:'blob',sha:gitSha(Buffer.from(asset.content,'base64'))};});
    Object.keys(state.entries).forEach(name=>assetShas[name]=state.entries[name].sha);
    if(wrongSha)Object.keys(context.assetRegistry?.staged||{}).forEach(key=>assetShas[context.assetRegistry.staged[key].path]='f'.repeat(40));
    const result={changed:context.pendingAssets.length>0,assetShas};sandbox.cmsAssetsCommit_(result);return result;
  };
  state.newRun();return state;
}

test('source identities preserve authorization queries and normalize only Dropbox delivery flags or Drive ID',()=>{
  const {sandbox:r}=fixture().run;
  const a=r.cmsAssetSource_(remote),b=r.cmsAssetSource_(remote.replace('dl=0','raw=1'));
  assert.equal(a.identity,b.identity);assert.match(a.identity,/rlkey=private-key/);assert.match(a.downloadUrl,/rlkey=private-key&dl=1$/);
  assert.notEqual(a.identity,r.cmsAssetSource_(remote.replace('private-key','other-key')).identity);
  assert.notEqual(r.cmsAssetSource_('https://example.org/x.jpg?dl=0').identity,r.cmsAssetSource_('https://example.org/x.jpg?dl=1').identity);
  assert.equal(r.cmsAssetSource_('https://drive.google.com/file/d/abc/view?usp=sharing').identity,r.cmsAssetSource_('https://drive.google.com/file/d/abc/edit').identity);
});

test('malformed HTTP validators cannot become formulas in the private registry',()=>{
  const s=fixture();s.http(remote,jpegA,{etag:'=IMPORTDATA("https://untrusted.example")',modified:' =1+1'});
  s.run.sandbox.uploadImg(remote);s.publish();
  assert.equal(s.grid[1][5],'');assert.equal(s.grid[1][6],'');
});

test('initial sync uses a source-owned filename, keeps legacy assets and only writes private registry after publish',()=>{
  const s=fixture(),r=s.run.sandbox;const original=s.active;
  s.entries['img/photo.jpg']={type:'blob',sha:gitSha(jpegB)};s.http(remote,jpegA,{etag:'"A"'});
  const url=r.uploadImg(remote),item=s.run.context.pendingAssets[0];
  assert.match(item.path,/^img\/photo--[a-f0-9]{12}\.jpg$/);assert.equal(url,'./'+item.path+'?v='+gitSha(jpegA).slice(0,12));
  assert.equal(s.privateWrites,0);assert.equal(s.creates,0);assert.equal(s.entries['img/photo.jpg'].sha,gitSha(jpegB));
  assert.throws(()=>r.cmsAssetsCommit_({error:'publish failed'}),/successful publish/);assert.equal(s.privateWrites,0);
  assert.equal(s.publish().assetsSaved,true);assert.equal(s.privateWrites,1);assert.equal(s.active,original);assert.equal(s.restored,1);
  assert.equal(s.grid[0].length,10);assert.match(JSON.stringify(s.grid),/private-key/);assert.doesNotMatch(url,/private-key|dropbox/);
});

test('normal preflight immediately detects changed same-source bytes before row cache lookup and preserves its path',()=>{
  const s=fixture();const endpoint=s.http(remote,jpegA,{etag:'"A"'});
  const row=['All','Common','Publication (custom)',remote],parameters=['/* img url'];
  const first=s.run.sandbox.cmsAssetRowFingerprint_(row,parameters);s.publish();
  s.servers.set(endpoint,{body:jpegB,etag:'"B"'});s.now+=1000;s.newRun();
  const second=s.run.sandbox.cmsAssetRowFingerprint_(row,parameters);
  assert.equal(second[0].path,first[0].path);assert.notEqual(second[0].sha,first[0].sha);assert.equal(s.fetches.at(-1).options.headers['If-None-Match'],'"A"');
  assert.equal(s.run.context.pendingAssets.length,1);assert.equal(s.run.sandbox.uploadImg(remote),'./'+second[0].path+'?v='+gitSha(jpegB).slice(0,12));
  assert.equal(s.fetches.length,2,'preflight/fingerprint/upload share one check per execution');s.publish();
});

test('conditional ETag/Last-Modified checks use 304 without body downloads and stage validators until successful publish',()=>{
  for(const options of [{etag:'"A"'},{modified:'Thu, 08 Oct 2026 00:00:00 GMT'}]) {
    const s=fixture();s.http(remote,jpegA,options);s.run.sandbox.uploadImg(remote);s.publish();const writes=s.privateWrites;
    s.now+=1000;s.newRun();s.run.sandbox.uploadImg(remote);
    assert.equal(s.run.context.pendingAssets.length,0);assert.equal(s.run.context.assetStats.notModified,1);assert.equal(s.run.context.assetStats.downloaded,0);
    assert.equal(s.privateWrites,writes);assert.equal(s.publish().assetsSaved,true);assert.equal(s.privateWrites,writes,'Unchanged verified registry requires no Sheet rewrite');
  }
});

test('without validators every normal execution downloads current bytes; identical bytes queue no upload',()=>{
  const s=fixture();s.http(remote);s.run.sandbox.uploadImg(remote);s.publish();s.newRun();
  s.run.sandbox.uploadImg(remote);assert.deepEqual({...s.fetches.at(-1).options.headers},{});assert.equal(s.run.context.assetStats.downloaded,1);assert.equal(s.run.context.pendingAssets.length,0);
});

test('same-name different sources own different paths including across separate page updates',()=>{
  const s=fixture(),other=remote.replace('/example/','/different/');s.http(remote,jpegA);s.http(other,jpegB);
  const first=s.run.sandbox.uploadImg(remote);s.publish();s.newRun();const second=s.run.sandbox.uploadImg(other);s.publish();
  assert.notEqual(first.split('?')[0],second.split('?')[0]);assert.equal(Object.keys(s.entries).length,2);
  assert.equal(s.entries[first.slice(2).split('?')[0]].sha,gitSha(jpegA));assert.equal(s.entries[second.slice(2).split('?')[0]].sha,gitSha(jpegB));
  assert.equal(s.grid.length,3);
});

test('Drive metadata avoids unchanged blob reads, sees replacements immediately and forced refresh retrieves bytes',()=>{
  const s=fixture(),url='https://drive.google.com/file/d/fileid/view';s.drives.set('fileid',{name:'photo.jpg',body:jpegA,modified:s.now});
  const first=s.run.sandbox.uploadImg(url);s.publish();assert.equal(s.blobReads,1);
  s.newRun();assert.equal(s.run.sandbox.uploadImg(url),first);assert.equal(s.blobReads,1);assert.equal(s.run.context.assetStats.notModified,1);
  s.drives.set('fileid',{name:'photo.jpg',body:jpegB,modified:s.now+1000});s.newRun();const changed=s.run.sandbox.uploadImg(url);
  assert.equal(s.blobReads,2);assert.notEqual(changed,first);s.publish();
  s.newRun({refreshAssets:true});s.run.sandbox.uploadImg(url);assert.equal(s.blobReads,3);assert.equal(s.run.context.pendingAssets.length,0);
});

test('missing or externally changed published bytes never trust old validators or Drive metadata',()=>{
  for(const missing of [true,false]) {
    const s=fixture();s.http(remote,jpegA,{etag:'"A"'});const url=s.run.sandbox.uploadImg(remote);s.publish();const filename=url.slice(2).split('?')[0];
    if(missing)delete s.entries[filename];else s.entries[filename].sha=gitSha(jpegB);
    s.newRun();s.run.sandbox.uploadImg(remote);assert.deepEqual({...s.fetches.at(-1).options.headers},{});assert.equal(s.run.context.pendingAssets.length,1);
  }
});

test('HTTP/Drive failures and invalid bytes abort preparation without private writes or stale fallback',()=>{
  for(const options of [{status:403},{status:500},{body:Buffer.from('<html>not an image</html>')},{body:Buffer.from('%PDF-wrong-extension')}]) {
    const s=fixture();const endpoint=s.http(remote,jpegA,{etag:'"A"'});s.run.sandbox.uploadImg(remote);s.publish();const writes=s.privateWrites;
    s.servers.set(endpoint,{body:jpegA,...options});s.newRun();assert.throws(()=>s.run.sandbox.uploadImg(remote));
    assert.equal(s.run.context.pendingAssets.length,0);assert.equal(s.privateWrites,writes);assert.equal(Object.keys(s.run.context.assetRegistry.staged).length,0);
  }
  const s=fixture();assert.throws(()=>s.run.sandbox.uploadImg('https://drive.google.com/file/d/missing/view'),/Drive unavailable/);assert.equal(s.privateWrites,0);
});

test('force asset refresh bypasses validators and unexpected unvalidated 304 is an error',()=>{
  const s=fixture();const endpoint=s.http(remote,jpegA,{etag:'"A"'});s.run.sandbox.uploadImg(remote);s.publish();s.newRun({refreshAssets:true});
  s.run.sandbox.uploadImg(remote);assert.deepEqual({...s.fetches.at(-1).options.headers},{});assert.equal(s.run.context.assetStats.downloaded,1);
  s.servers.set(endpoint,{status:304});s.newRun({refreshAssets:true});assert.throws(()=>s.run.sandbox.uploadImg(remote),/304/);
});

test('local asset SHA changes update the version URL while preserving unrelated query and anchor',()=>{
  const s=fixture();s.entries['img/photo.jpg']={type:'blob',sha:gitSha(jpegA)};
  assert.equal(s.run.sandbox.uploadImg('./img/photo.jpg?download=1&v=old#panel'),'./img/photo.jpg?download=1&v='+gitSha(jpegA).slice(0,12)+'#panel');
  s.entries['img/photo.jpg'].sha=gitSha(jpegB);s.newRun();assert.equal(s.run.sandbox.uploadImg('img/photo.jpg'),'./img/photo.jpg?v='+gitSha(jpegB).slice(0,12));
  assert.equal(s.fetches.length,0);assert.equal(s.grid,null);assert.equal(s.run.sandbox.uploadImg('./img/missing.jpg'),'./img/missing.jpg');
});

test('row preflight matches renderer fields, skips Pass/preset logos and includes Dropbox Markdown links',()=>{
  const s=fixture();s.http(remote);const r=s.run.sandbox;
  assert.equal(r.cmsAssetsPrepareRow_(['All','Common','Pass',remote],['/* img url']).length,0);
  assert.equal(r.cmsAssetsPrepareRow_(['All','Common','Content','frontlogo','https://www.dropbox.com/x/two_logos_on_white_on_black.svg'],['/* ID','/* img url']).length,0);
  const manifest=r.cmsAssetsPrepareRow_(['All','Common','News','![photo]('+remote+')'],['/* Text']);assert.equal(manifest.length,1);
  assert.equal(r.cmsAssetsPrepareRow_(['All','Common','Member','A Member','[CV]('+remote+')'],['/* Name','/* Personal links']).length,1,'Member personal links also participate before warm reuse');
  assert.equal(r.cmsAssetsPrepareRow_(['All','Common','Alumni','**Heading**',remote],['/* Name','/* Photo url']).length,0);
  assert.equal(r.cmsAssetsPrepareRow_(['All','Common','Alumni','Rich heading',remote],['/* Name','/* Photo url'],{alumniHeading:true}).length,0);
  r.PreElement=['All','Common','H1','Heading'];
  assert.equal(r.cmsAssetsPrepareRow_(['All','Common','Alumni','Heading',remote],['/* Name','/* Photo url']).length,0);
  assert.equal(r.cmsAssetRowFingerprint_(['All','Common','Content',remote],['/* img url']).length,1);assert.equal(s.fetches.length,1);
});

test('private registry corruption regenerates source checks and mismatched published SHA cannot record staged validators',()=>{
  const s=fixture();s.http(remote,jpegA,{etag:'"A"'});s.run.sandbox.uploadImg(remote);s.publish();
  s.grid[1][4]='f'.repeat(40);s.newRun();s.run.sandbox.uploadImg(remote);assert.deepEqual({...s.fetches.at(-1).options.headers},{});assert.equal(s.run.context.assetStats.registryErrors,1);
  assert.equal(s.publish().assetsSaved,true);assert.equal(s.grid[1][4],gitSha(jpegA));
  const empty=fixture();empty.http(remote);empty.run.sandbox.uploadImg(remote);empty.publish({wrongSha:true});assert.equal(empty.grid,null,'Never save metadata for bytes not confirmed published');
});

test('registry save failure after successful publication stays distinct and forces a full source check on next update',()=>{
  const s=fixture();const endpoint=s.http(remote,jpegA,{etag:'"A"'});s.run.sandbox.uploadImg(remote);s.publish();
  s.servers.set(endpoint,{body:jpegB,etag:'"B"'});s.newRun();s.run.sandbox.uploadImg(remote);s.failWrite=true;const result=s.publish();
  assert.equal(result.changed,true);assert.equal(result.assetsSaved,false);assert.doesNotMatch(JSON.stringify(s.warnings),/private-key|dropbox/);
  s.failWrite=false;s.newRun();s.run.sandbox.uploadImg(remote);assert.deepEqual({...s.fetches.at(-1).options.headers},{});assert.equal(s.run.context.pendingAssets.length,0);s.publish();
  assert.equal(s.grid[1][4],gitSha(jpegB));
});

test('publisher PDFs retain existing published or external links with explicit warnings, never pretending to synchronize',()=>{
  const s=fixture(),url='https://www.nature.com/articles/paper.pdf';
  s.entries['pdf/paper.pdf']={type:'blob',sha:gitSha('%PDF-published')};
  assert.equal(s.run.sandbox.uploadImg(url),'./pdf/paper.pdf?v='+gitSha('%PDF-published').slice(0,12));
  assert.equal(s.fetches.length,0);assert.equal(s.run.context.pendingAssets.length,0);assert.deepEqual([...s.run.context.assetWarnings],['pdf-sync-manual']);
  assert.equal(s.run.sandbox.uploadImg(url),'./pdf/paper.pdf?v='+gitSha('%PDF-published').slice(0,12));assert.equal(s.run.context.assetWarnings.length,1);
  s.newRun({refreshAssets:true});assert.equal(s.run.sandbox.uploadImg('https://www.science.org/new.pdf'),'https://www.science.org/new.pdf');
  assert.equal(s.fetches.length,0);assert.equal(s.grid,null);assert.equal(s.run.context.assetWarnings.length,1);
});

test('explicitly refreshed Dropbox PDFs remain managed assets and save only after validated publication',()=>{
  const s=fixture(),url='https://www.dropbox.com/x/paper.pdf?rlkey=private-key&dl=0';s.http(url,Buffer.from('%PDF-1.7\nbody'),{etag:'"PDF"'});
  s.newRun({refreshAssets:true});const output=s.run.sandbox.uploadImg(url);assert.match(output,/^\.\/pdf\/paper--[a-f0-9]{12}\.pdf\?v=[a-f0-9]{12}$/);
  assert.equal(s.run.context.assetWarnings,undefined);assert.equal(s.run.context.pendingAssets.length,1);assert.equal(s.publish().assetsSaved,true);
});

test('supported GET Range detects oversized Dropbox PDF without full-body download or fresh registry',()=>{
  for (const flags of [{refreshAssets:true},{refreshAssets:true,forceRegenerate:true}]) {
    const s=fixture(),url='https://www.dropbox.com/x/large.pdf?rlkey=private-key&dl=0';
    s.http(url,Buffer.from('%PDF-small'),{rangeStatus:206,rangeLength:16*1024*1024+1});s.entries['pdf/large.pdf']={type:'blob',sha:gitSha('%PDF-old')};
    s.newRun(flags);const output=s.run.sandbox.uploadImg(url);
    assert.equal(output,'./pdf/large.pdf?v='+gitSha('%PDF-old').slice(0,12));assert.equal(s.fetches.length,1);assert.equal(s.fetches[0].options.method,'get');assert.equal(s.fetches[0].options.headers.Range,'bytes=0-0');
    assert.equal(s.run.context.pendingAssets.length,0);assert.equal(Object.keys(s.run.context.assetRegistry.staged).length,0);
    assert.deepEqual([...s.run.context.assetWarnings],['oversized-pdf-kept']);s.run.sandbox.uploadImg(url);assert.equal(s.run.context.assetWarnings.length,1);
    s.publish();assert.equal(s.grid,null,'Retained PDF must not receive a fresh registry entry');
  }
});

test('oversized PDF keeps an actual source-owned published link, preserves its old verification, and a missing link stays external',()=>{
  const s=fixture(),url='https://www.dropbox.com/x/large.pdf?rlkey=private-key&dl=0';const endpoint=s.http(url,Buffer.from('%PDF-small'),{rangeStatus:206,rangeLength:10,etag:'"old"'});
  s.newRun({refreshAssets:true});const owned=s.run.sandbox.uploadImg(url);s.publish();const record=JSON.stringify(s.grid);
  s.servers.set(endpoint,{body:Buffer.from('%PDF-new'),rangeStatus:206,rangeLength:20*1024*1024,etag:'"new"'});s.now+=1000;s.newRun({refreshAssets:true});
  assert.equal(s.run.sandbox.uploadImg(url),owned);assert.equal(Object.keys(s.run.context.assetRegistry.staged).length,0);s.publish();assert.equal(JSON.stringify(s.grid),record);
  const absent=fixture();absent.http(url,Buffer.from('%PDF-unused'),{rangeStatus:206,rangeLength:20*1024*1024});absent.newRun({refreshAssets:true});assert.equal(absent.run.sandbox.uploadImg(url),url);
  assert.equal(absent.run.context.pendingAssets.length,0);assert.equal(absent.fetches.length,1);assert.deepEqual([...absent.run.context.assetWarnings],['oversized-pdf-kept']);
});

test('an ignored Range response is reused once and an actual oversized PDF body retains the old link',()=>{
  const size=16*1024*1024+1,body=Buffer.alloc(size);body.write('%PDF-1.7');
  for(const options of [{rangeLength:size},{}]) {
    const s=fixture(),url='https://www.dropbox.com/x/large.pdf?dl=0';s.http(url,body,options);s.entries['pdf/large.pdf']={type:'blob',sha:gitSha('%PDF-old')};
    s.newRun({refreshAssets:true});const output=s.run.sandbox.uploadImg(url);assert.match(output,/^\.\/pdf\/large\.pdf\?v=/);assert.equal(s.fetches.length,1);
    assert.equal(s.fetches[0].options.headers.Range,'bytes=0-0');assert.equal(s.run.context.pendingAssets.length,0);assert.equal(Object.keys(s.run.context.assetRegistry.staged).length,0);
    assert.deepEqual([...s.run.context.assetWarnings],['oversized-pdf-kept']);
  }
});

test('manual small 206 probes fetch complete PDF; later ordinary updates keep it without checking documents',()=>{
  const s=fixture(),url='https://www.dropbox.com/x/paper.pdf?dl=0',body=Buffer.from('%PDF-1.7\nsmall');
  s.http(url,body,{rangeStatus:206,rangeLength:body.length,etag:'"PDF"'});s.newRun({refreshAssets:true});const output=s.run.sandbox.uploadImg(url);
  assert.match(output,/paper--[a-f0-9]{12}\.pdf\?v=/);assert.equal(s.fetches.length,2);assert.equal(s.fetches[0].options.headers.Range,'bytes=0-0');assert.equal(s.fetches[1].options.headers.Range,undefined);
  s.publish();s.fetches=[];s.newRun();assert.equal(s.run.sandbox.uploadImg(url),output);assert.equal(s.fetches.length,0);
  assert.equal(s.run.context.pendingAssets.length,0);assert.deepEqual([...s.run.context.assetWarnings],['pdf-sync-manual']);
});

test('a small complete 200 Range response is reused and PDF metadata errors retain links with explicit non-fresh warnings',()=>{
  const url='https://www.dropbox.com/x/paper.pdf?dl=0',body=Buffer.from('%PDF-1.7\nsmall');
  const complete=fixture();complete.http(url,body,{rangeLength:body.length});complete.newRun({refreshAssets:true});complete.run.sandbox.uploadImg(url);assert.equal(complete.fetches.length,1);assert.equal(complete.run.context.pendingAssets.length,1);
  for(const options of [{rangeStatus:403},{rangeError:true},{rangeStatus:206}, {rangeStatus:304}]) {
    for(const existing of [false,true]) {
      const s=fixture();s.http(url,body,options);if(existing)s.entries['pdf/paper.pdf']={type:'blob',sha:gitSha('%PDF-old')};
      s.newRun({refreshAssets:true});const output=s.run.sandbox.uploadImg(url);assert(existing ? /^\.\/pdf\/paper\.pdf\?v=/.test(output) : output===url);
      assert.deepEqual([...s.run.context.assetWarnings],['pdf-metadata-unavailable']);assert.equal(s.run.context.pendingAssets.length,0);assert.equal(Object.keys(s.run.context.assetRegistry.staged).length,0);assert.equal(s.fetches.length,1);
    }
  }
});

test('Drive PDF size metadata avoids oversized blob download while image size overflow still aborts',()=>{
  const s=fixture(),url='https://drive.google.com/file/d/document/view';
  s.drives.set('document',{name:'large.pdf',body:Buffer.from('%PDF-unused'),size:20*1024*1024,modified:s.now});
  s.entries['pdf/large.pdf']={type:'blob',sha:gitSha('%PDF-old')};s.newRun({refreshAssets:true});assert.match(s.run.sandbox.uploadImg(url),/^\.\/pdf\/large\.pdf\?v=/);
  assert.equal(s.blobReads,0);assert.equal(s.run.context.pendingAssets.length,0);assert.deepEqual([...s.run.context.assetWarnings],['oversized-pdf-kept']);
  const image=fixture(),body=Buffer.alloc(16*1024*1024+1);body[0]=255;body[1]=216;image.http(remote,body);
  assert.throws(()=>image.run.sandbox.uploadImg(remote),/16 MiB/);assert.equal(image.run.context.pendingAssets.length,0);assert.equal(image.run.context.assetWarnings,undefined);
});

test('ordinary/rebuild/data updates preserve PDF legacy or external links without HTTP requests or Drive blob reads',()=>{
  const url='https://www.dropbox.com/x/paper.pdf?dl=0',drive='https://drive.google.com/file/d/document/view';
  for(const flags of [{},{forceRegenerate:true},{refreshData:true}]) {
    const s=fixture();s.entries['pdf/paper.pdf']={type:'blob',sha:gitSha('%PDF-old')};s.drives.set('document',{name:'drive.pdf',body:Buffer.from('%PDF-unused'),size:30*1024*1024,modified:s.now});
    s.newRun(flags);assert.match(s.run.sandbox.uploadImg(url),/^\.\/pdf\/paper\.pdf\?v=/);assert.equal(s.run.sandbox.uploadImg(drive),drive);
    assert.equal(s.run.sandbox.uploadImg('https://www.dropbox.com/x/missing.pdf?dl=0'),'https://www.dropbox.com/x/missing.pdf?dl=0');
    assert.equal(s.fetches.length,0);assert.equal(s.blobReads,0);assert.equal(s.run.context.pendingAssets.length,0);assert.equal(Object.keys(s.run.context.assetRegistry.staged).length,0);
    assert.deepEqual([...s.run.context.assetWarnings],['pdf-sync-manual','pdf-sync-manual','pdf-sync-manual']);s.publish();assert.equal(s.grid,null);
  }
});

test('a successful manual PDF publish followed by registry-save failure does not revert to its legacy copy on normal update',()=>{
  const s=fixture(),url='https://www.dropbox.com/x/paper.pdf?dl=0';s.entries['pdf/paper.pdf']={type:'blob',sha:gitSha('%PDF-legacy')};
  s.http(url,Buffer.from('%PDF-current'));s.newRun({refreshAssets:true});const publishedUrl=s.run.sandbox.uploadImg(url);
  s.failWrite=true;const result=s.publish();assert.equal(result.changed,true);assert.equal(result.assetsSaved,false);
  s.failWrite=false;s.fetches=[];s.newRun();assert.equal(s.run.sandbox.uploadImg(url),publishedUrl);
  assert.equal(s.fetches.length,0);assert.equal(s.run.context.pendingAssets.length,0);assert.equal(Object.keys(s.run.context.assetRegistry.staged).length,0);
  assert.deepEqual([...s.run.context.assetWarnings],['pdf-sync-manual']);
});

test('PDF recovery never chooses a deterministic path owned by a conflicting source identity',()=>{
  for(const conflictingRecord of [false,true]) {
    const s=fixture(),url='https://www.dropbox.com/x/paper.pdf?dl=0',r=s.run.sandbox;
    const source=r.cmsAssetSource_(url),key=r.cmsAssetKey_(source.identity),target=r.cmsAssetPath_('paper.pdf',key),store=r.cmsAssetRegistry_();
    s.entries[target]={type:'blob',sha:gitSha('%PDF-unrelated')};s.entries['pdf/paper.pdf']={type:'blob',sha:gitSha('%PDF-legacy')};
    if(conflictingRecord)store.records[key]={identity:'http:https://other.example/paper.pdf',path:target};
    else store.owners[target]='different-source-key';
    assert.equal(r.uploadImg(url),'./pdf/paper.pdf?v='+gitSha('%PDF-legacy').slice(0,12));assert.equal(s.fetches.length,0);assert.equal(s.run.context.pendingAssets.length,0);
  }
});

test('external asset HTTP calls have a bounded timeout and progress logs contain only quantitative values',()=>{
  const s=fixture(),logs=[];s.run.sandbox.console.log=value=>logs.push(value);
  for(let i=0;i<5;i++){const url=remote.replace('/example/','/source'+i+'/');s.http(url);s.run.sandbox.uploadImg(url);}
  assert(s.fetches.every(call=>call.options.timeoutSeconds===20));assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/dropbox|private-key|photo|source/);
  assert.match(logs[0],/"checked":5/);
});

test('byte validation covers images/PDFs, rejects mislabeled files and enforces the size limit',()=>{
  const r=fixture().run.sandbox;
  assert.doesNotThrow(()=>r.cmsValidateAsset_('paper.pdf',bytes('%PDF-1.7\nbody')));assert.doesNotThrow(()=>r.cmsValidateAsset_('photo.jpg',bytes(jpegA)));
  assert.throws(()=>r.cmsValidateAsset_('photo.png',bytes(jpegA)),/match/);assert.throws(()=>r.cmsValidateAsset_('photo.jpg',[]),/empty/);
  assert.throws(()=>r.cmsValidateAsset_('photo.jpg',new Array(16*1024*1024+1)),/16 MiB/);
});

test('unsafe HTTP validator formula prefixes are never stored or reused as request headers',()=>{
  for(const etag of ['=IMPORTXML("https://bad","x")',' +formula','@value','-value']) {
    const s=fixture();s.http(remote,jpegA,{etag});s.run.sandbox.uploadImg(remote);s.publish();assert.equal(s.grid[1][5],'');
    s.newRun();s.run.sandbox.uploadImg(remote);assert.deepEqual({...s.fetches.at(-1).options.headers},{});
  }
});
