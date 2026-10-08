'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), {test} = require('node:test');
const root = path.resolve(__dirname, '../..');
const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');
const gitSha = value => { const data = Buffer.isBuffer(value) ? value : Buffer.from(value); return sha1(Buffer.concat([Buffer.from('blob ' + data.length + '\0'), data])); };
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
function fixture() {
  const context = {pendingAssets: [], github: {head: '1'.repeat(40), tree: '2'.repeat(40), entries: {
    'img/a.png': {type: 'blob', sha: A}, 'img/b.svg': {type: 'blob', sha: B},
    'img/日本語 図.png': {type: 'blob', sha: C}, 'img/foo,bar.png': {type: 'blob', sha: A},
    'img_new/legacy.png': {type: 'blob', sha: C}, 'pdf/paper.pdf': {type: 'blob', sha: B},
    'js/common.js': {type: 'blob', sha: C}, 'docs/private-source.json': {type: 'blob', sha: C}
  }}};
  const io = []; let decodes = 0;
  const runtime = vm.createContext({
    cmsContext_: () => context, cmsGithubSnapshot_: () => context.github, cmsGitBlobSha_: bytes => gitSha(Buffer.from(bytes)),
    PropertiesService: {getScriptProperties: () => ({getProperty: () => 'dummy-token'})},
    SpreadsheetApp: {getActiveSpreadsheet: () => ({getId: () => '1TRYhl0WmqhEykYCvFtZzJG4J17YChKiqausAxT8iwHk'})},
    Utilities: {base64Decode: text => { decodes++; return Array.from(Buffer.from(text, 'base64')); }, base64Encode: text => Buffer.from(text).toString('base64'),
      newBlob: bytes => ({getDataAsString: () => Buffer.from(bytes).toString('utf8')})},
    UrlFetchApp: {fetch: (url, request) => { io.push([url, request]); return {getResponseCode: () => 200, getContentText: () => '{}'}; }}
  });
  for (const file of ['PreviewIsolation.gs', 'AssetVersions.gs']) vm.runInContext(fs.readFileSync(path.join(root, 'cms', file), 'utf8'), runtime, {filename: file});
  return {runtime, context, io, decodes: () => decodes};
}

test('known local image, legacy image and PDF URLs get stable content versions without filename changes', () => {
  const {runtime: r} = fixture();
  for (const prefix of ['./', '', '../', '/']) assert.equal(r.cmsAssetVersionUrl_(prefix + 'img/a.png'), prefix + 'img/a.png?v=' + A.slice(0, 12));
  assert.equal(r.cmsAssetVersionUrl_('./img_new/legacy.png'), './img_new/legacy.png?v=' + C.slice(0, 12));
  assert.equal(r.cmsAssetVersionUrl_('./pdf/paper.pdf'), './pdf/paper.pdf?v=' + B.slice(0, 12));
});
test('other queries and hashes survive while duplicate old versions are removed', () => {
  const {runtime: r} = fixture();
  const expected = './img/a.png?x=1&keep=a%26b&v=' + A.slice(0, 12) + '#detail';
  assert.equal(r.cmsAssetVersionUrl_('./img/a.png?x=1&v=old&keep=a%26b&%76=older#detail'), expected);
  assert.equal(r.cmsAssetVersionUrl_(expected), expected);
});
test('preview absolute/base-root URLs and UTF-8 encoded paths resolve to the repository asset', () => {
  const {runtime: r} = fixture();
  for (const prefix of ['https://ponnhide.github.io/yachielab-preview/', '//ponnhide.github.io/yachielab-preview/', '/yachielab-preview/']) {
    assert.equal(r.cmsAssetVersionUrl_(prefix + 'img/a.png'), prefix + 'img/a.png?v=' + A.slice(0, 12));
  }
  const url = './img/' + encodeURIComponent('日本語 図.png');
  assert.equal(r.cmsAssetVersionUrl_(url), url + '?v=' + C.slice(0, 12));
});
test('external, data, blob, unknown, malformed and traversal URLs remain untouched', () => {
  const {runtime: r} = fixture();
  for (const url of ['https://example.org/img/a.png?v=old', 'https://ponnhide.github.io/other/img/a.png', 'data:image/png;base64,AAA', 'blob:123', '#mask', './img/missing.png', './img/%ED%A0%80.png', './img/../a.png', './img/%2e%2e/a.png']) assert.equal(r.cmsAssetVersionUrl_(url), url);
});
test('pending content bytes override snapshot versions and reuse the computed SHA across repeated rewrites', () => {
  const {runtime: r, context, decodes} = fixture();
  const first = Buffer.from([0, 127, 128, 255]);
  context.pendingAssets.push({path: 'img/a.png', content: first.toString('base64')});
  const expected = './img/a.png?v=' + gitSha(first).slice(0, 12);
  assert.equal(r.cmsAssetVersionUrl_('./img/a.png'), expected);
  assert.equal(r.cmsAssetVersionUrl_('./img/a.png'), expected);
  assert.equal(decodes(), 1);
  const second = Buffer.from([0, 127, 128, 254]);
  context.pendingAssets[0].content = second.toString('base64');
  assert.equal(r.cmsAssetVersionUrl_(expected), './img/a.png?v=' + gitSha(second).slice(0, 12));
  assert.equal(decodes(), 2);
});
test('HTML src, poster, unquoted URLs, PDF href and amp-escaped queries are versioned idempotently', () => {
  const {runtime: r} = fixture();
  const input = '<img src="./img/a.png?x=1&amp;v=old#p"><video poster=./img/b.svg></video><a href="./pdf/paper.pdf#page=2">PDF</a><a href="./index.html">Home</a>';
  const output = r.cmsVersionAssetHtml_(input);
  assert(output.includes('src="./img/a.png?x=1&amp;v=' + A.slice(0, 12) + '#p"'));
  assert(output.includes('poster="./img/b.svg?v=' + B.slice(0, 12) + '"'));
  assert(output.includes('href="./pdf/paper.pdf?v=' + B.slice(0, 12) + '#page=2"'));
  assert(output.includes('<a href="./index.html">Home</a>'));
  assert.equal(r.cmsVersionAssetHtml_(output), output);
});
test('srcset descriptors and data URLs containing commas stay intact', () => {
  const {runtime: r} = fixture();
  const input = '<source srcset="./img/a.png 1x, ./img/b.svg 2x, data:image/png;base64,AAAA 3x"><img srcset="./img/foo,bar.png 1x, ./img/a.png 2x">';
  const output = r.cmsVersionAssetHtml_(input);
  assert(output.includes('./img/a.png?v=' + A.slice(0, 12) + ' 1x, ./img/b.svg?v=' + B.slice(0, 12) + ' 2x, data:image/png;base64,AAAA 3x'));
  assert(output.includes('./img/foo,bar.png?v=' + A.slice(0, 12) + ' 1x'));
});
test('CSS url functions are rewritten while comments, literal strings and script template text are untouched', () => {
  const {runtime: r} = fixture();
  const input = '<!-- <img src="./img/a.png"> --><script>const s=\'<img src="./img/a.png">\';</script><div title="example src=\'./img/a.png\'" style="background:url(\'../img/a.png\');mask:url(#mask)"></div><style>/* url("./img/a.png") */ .x::after{content:"url(\'./img/a.png\')"} .x{background:url( ./img/b.svg )}</style>';
  const output = r.cmsVersionAssetHtml_(input);
  assert(output.includes('background:url(\'../img/a.png?v=' + A.slice(0, 12) + '\')'));
  assert(output.includes('background:url( ./img/b.svg?v=' + B.slice(0, 12) + ' )'));
  assert(output.includes('<!-- <img src="./img/a.png"> -->'));
  assert(output.includes('<script>const s=\'<img src="./img/a.png">\';</script>'));
  assert(output.includes('title="example src=\'./img/a.png\'"'));
  assert(output.includes('/* url("./img/a.png") */'));
  assert(output.includes('content:"url(\'./img/a.png\')"'));
});
test('manifest includes only sorted public repository paths and content SHA-1 values', () => {
  const {runtime: r} = fixture();
  const manifest = JSON.parse(JSON.stringify(r.cmsAssetVersionsManifest_()));
  assert.equal(manifest.version, 1);
  assert(Object.keys(manifest.assets).every(key => /^(img|img_new|pdf)\//.test(key)));
  assert(!JSON.stringify(manifest).includes('private-source'));
  assert.deepEqual(Object.keys(manifest.assets), Object.keys(manifest.assets).sort());
  assert(Object.values(manifest.assets).every(value => /^[a-f0-9]{40}$/.test(value)));
});
test('manifest writes are permitted only for the exact root JSON path and strict public schema', () => {
  const {runtime: r, io} = fixture();
  const content = JSON.stringify(r.cmsAssetVersionsManifest_());
  assert.equal(r.previewAssetVersionsContent_(content), true);
  r.previewFetch_('https://api.github.com/repos/ponnhide/yachielab-preview/git/trees', {method: 'post', payload: JSON.stringify({base_tree: 'a'.repeat(40), tree: [{path: 'asset-versions.json', mode: '100644', type: 'blob', content}]})});
  assert.equal(io.length, 1);
  for (const invalid of [
    {version: 2, assets: {}}, {version: 1, assets: [], token: 'secret'}, {version: 1, assets: {'https://drive.google.com/private': A}},
    {version: 1, assets: {'img/../private': A}}, {version: 1, assets: {'img/a?token=secret': A}}, {version: 1, assets: {'img/a': [A]}},
    {version: 1, assets: {'img/a': 'secret'}}, {version: 1, assets: {'img/a': A}, sources: ['private URL']}
  ]) assert.equal(r.previewAssetVersionsContent_(JSON.stringify(invalid)), false);
  assert.throws(() => r.previewFetch_('https://api.github.com/repos/ponnhide/yachielab-preview/git/trees', {method: 'post', payload: JSON.stringify({base_tree: 'a'.repeat(40), tree: [{path: 'docs/asset-versions.json', mode: '100644', type: 'blob', content}]})}));
  assert.equal(io.length, 1);
});
test('assets runtime injection is ordered before common, including index compatibility, and stays idempotent', () => {
  const {runtime: r} = fixture();
  for (const body of ['<script src="./js/common.js" defer></script>', '<script src="./js/index.js" defer></script>']) {
    const output = r.previewPrepareHtml_('<html><head>' + body + '</head><body></body></html>');
    assert(output.indexOf('./js/assets.js') < output.indexOf('./js/common.js'));
    assert.equal((output.match(/src="\.\/js\/assets\.js"/g) || []).length, 1);
    assert.equal(r.previewPrepareHtml_(output), output);
  }
});

function publisherFixture() {
  const state = fixture(), {runtime: r, context, io} = state;
  vm.runInContext(fs.readFileSync(path.join(root, 'cms/GitHub.gs'), 'utf8'), r, {filename: 'GitHub.gs'});
  r.cmsSiteSettings_ = () => ({logoActiveOpacity: 1, logoInactiveOpacity: 0.5, logoTransitionMs: 300});
  r.UrlFetchApp.fetch = (url, request) => {
    const payload = request.payload && JSON.parse(request.payload), endpoint = url.split('/yachielab-preview/')[1];
    io.push({url, method: request.method, endpoint, payload});
    let response = {};
    if (endpoint.startsWith('git/ref/heads/')) response = {object: {sha: context.github.head}};
    else if (endpoint === 'git/blobs') response = {sha: state.wrongBlobSha ? '9'.repeat(40) : gitSha(Buffer.from(payload.content, 'base64'))};
    else if (endpoint === 'git/trees') response = {sha: state.unchangedTree ? context.github.tree : '3'.repeat(40)};
    else if (endpoint === 'git/commits') response = {sha: '4'.repeat(40)};
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify(response)};
  };
  return state;
}

test('HTML URLs, uploaded asset bytes and public manifest publish in the same atomic commit', () => {
  const {runtime: r, context, io} = publisherFixture();
  const binary = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]);
  const expected = gitSha(binary);
  context.pendingAssets.push({path: 'img/a.png', content: binary.toString('base64')});
  const result = r.cmsPublish_([{path: 'contact.html', html: '<html><head></head><body><img src="./img/a.png?v=old"></body></html>'}], 'Update assets');
  assert.equal(result.changed, true);
  const trees = io.filter(call => call.endpoint === 'git/trees');
  assert.equal(trees.length, 1);
  const entries = trees[0].payload.tree;
  const page = entries.find(entry => entry.path === 'contact.html');
  const asset = entries.find(entry => entry.path === 'img/a.png');
  const manifest = JSON.parse(entries.find(entry => entry.path === 'asset-versions.json').content);
  assert(page.content.includes('./img/a.png?v=' + expected.slice(0, 12)));
  assert.equal(asset.sha, expected);
  assert.equal(manifest.assets['img/a.png'], expected);
  assert.equal(result.pageShas['contact.html'], gitSha(page.content));
  assert.equal(result.assetShas['img/a.png'], expected);
  assert.equal(io.filter(call => call.endpoint === 'git/commits').length, 1);
  assert.equal(io.filter(call => call.method === 'patch').length, 1);
});

test('an unchanged settings/asset manifest generates no tree or commit and verifies the branch lease', () => {
  const {runtime: r, context, io} = publisherFixture();
  context.github.entries['site-settings.json'] = {type: 'blob', sha: gitSha(JSON.stringify(r.cmsSiteSettings_(), null, 2) + '\n')};
  context.github.entries['asset-versions.json'] = {type: 'blob', sha: gitSha(JSON.stringify(r.cmsAssetVersionsManifest_(), null, 2) + '\n')};
  const result = r.cmsPublish_([]);
  assert.equal(result.changed, false);
  assert.equal(result.assetShas['img_new/legacy.png'], C);
  assert.equal(io.filter(call => call.method !== 'get').length, 0);
  assert(io.some(call => call.endpoint.startsWith('git/ref/heads/')));
});

test('a mismatching uploaded blob SHA stops before writing a tree or ref', () => {
  const state = publisherFixture();
  state.wrongBlobSha = true;
  state.context.pendingAssets.push({path: 'img/a.png', content: Buffer.from([0, 1, 2, 3]).toString('base64')});
  assert.throws(() => state.runtime.cmsPublish_([]), /Asset blob SHA verification failed/);
  assert.equal(state.io.filter(call => call.endpoint === 'git/trees').length, 0);
  assert.equal(state.io.filter(call => call.method === 'patch').length, 0);
});

test('an unchanged returned tree exposes only the existing asset SHAs to successful-cache recording', () => {
  const state = publisherFixture();
  state.unchangedTree = true;
  state.context.pendingAssets.push({path: 'img/a.png', content: Buffer.from([0, 1, 2, 3]).toString('base64')});
  const result = state.runtime.cmsPublish_([]);
  assert.equal(result.changed, false);
  assert.equal(result.assetShas['img/a.png'], A, 'Unpublished pending bytes must not be recorded as deployed');
  assert.equal(state.io.filter(call => call.method === 'patch').length, 0);
});

test('SHA-only known repository assets version and publish without decoding, base64 uploads or private source data',()=>{
  const {runtime:r,context,io,decodes}=publisherFixture();context.pendingAssets.push({path:'img/large--source.jpg',sha:A});
  assert.equal(r.cmsAssetVersionUrl_('./img/large--source.jpg'),'./img/large--source.jpg?v='+A.slice(0,12));assert.equal(decodes(),0);
  const result=r.cmsPublish_([]);assert.equal(result.assetShas['img/large--source.jpg'],A);
  assert.equal(io.filter(call=>call.endpoint==='git/blobs').length,0);
  const tree=io.find(call=>call.endpoint==='git/trees');assert.deepEqual(JSON.parse(JSON.stringify(tree.payload.tree.find(item=>item.path==='img/large--source.jpg'))),{path:'img/large--source.jpg',mode:'100644',type:'blob',sha:A});
});
test('unknown or ambiguous SHA-only pending entries fail before any tree, commit or ref publication',()=>{
  for(const asset of [{path:'img/new.jpg',sha:'f'.repeat(40)},{path:'img/new.jpg',sha:'bad'},{path:'img/new.jpg',sha:A,content:'eA=='}]) {
    const {runtime:r,context,io}=publisherFixture();context.pendingAssets.push(asset);assert.throws(()=>r.cmsPublish_([]),/Unverified known asset SHA/);
    assert.equal(io.filter(call=>call.method==='post'||call.method==='patch').length,0);
  }
});
