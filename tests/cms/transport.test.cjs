'use strict';
/** Isolated GAS VM with fake Sheets, Drive and GitHub services: no live writes.
 * Run: node --test tests/cms/transport.test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const PREVIEW_SHEET = '1TRYhl0WmqhEykYCvFtZzJG4J17YChKiqausAxT8iwHk';
const PREVIEW_REPO = 'ponnhide/yachielab-preview';
const PREVIEW_BRANCH = 'codex/preview';
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const COMMIT = 'c'.repeat(40);
const BLOB = 'd'.repeat(40);
const CHANGED_HEAD = 'e'.repeat(40);
const NEW_TREE = 'f'.repeat(40);
const html = '<html><head></head><body><main><div class="posts">日本語</div></main></body></html>';

function bytes(value) { return Array.from(Buffer.isBuffer(value) ? value : Buffer.from(value)); }
function blob(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : value.map(byte => (byte + 256) % 256));
  return { getBytes: () => bytes(buffer), getDataAsString: () => buffer.toString('utf8') };
}
function response(payload, status = 200, asset = null) {
  return {
    getResponseCode: () => status,
    getContentText: () => typeof payload === 'string' ? payload : JSON.stringify(payload),
    getBlob: () => asset ? blob(asset) : blob(typeof payload === 'string' ? payload : JSON.stringify(payload))
  };
}

function fixture(options = {}) {
  const state = {
    io: [], activeId: options.activeId || PREVIEW_SHEET, head: HEAD, tree: TREE,
    treeUnchanged: false, status: options.status || 200,
    reads: {}, mutations: [], menuItems: [], menusAdded: 0, activeSheet: 'contact',
    entries: [
      {path: 'contact.html', type: 'blob', mode: '100644', sha: BLOB},
      {path: 'research.html', type: 'blob', mode: '100644', sha: '1'.repeat(40)},
      {path: 'img/existing.jpg', type: 'blob', mode: '100644', sha: '2'.repeat(40)}
    ],
    downloads: new Map(), drives: new Map()
  };
  const values = {
    parameters: [
      ['Function', 'Parameter1', 'Parameter2'],
      ['Member', '/* Name', '/* Name in publication'],
      ['Alumni', '/* Name', '/* Name in publication'],
      ['H1', '/* Title', '/* Style']
    ],
    'item list': [
      ['a', 'b', 'c', 'Sheet', 'Page', '', '', '', 'Journal', 'Replacement'],
      ['', '', '', 'contact', 'contact', '', '', '', 'Journal of Examples', 'J Examples'],
      ['', '', '', 'research', 'research', '', '', '', '', ''],
      ['', '', '', '', 'contact', '', '', '', '', ''],
      ['', '', '', 'yuka', '', '', '', '', '', '']
    ],
    people: [['Lab', 'Language', 'Function', 'Name', 'Publication names'], ['UBC', 'English', 'Member', 'Alice', 'A Example, Alice Example']],
    alumni: [['Lab', 'Language', 'Function', 'Name', 'Publication names'], ['Osaka', 'Japanese', 'Alumni', 'Bob', 'B Example']],
    contact: [['Lab', 'Language', 'Function', 'Title', 'Style'], ['All', 'English', 'H1', 'Contact', '']],
    research: [['Lab', 'Language', 'Function', 'Title', 'Style'], ['All', 'English', 'H1', 'Research', '']]
  };
  Object.assign(values, options.sheetRows || {});
  function getSheet(name) {
    if (!values[name]) return null;
    const range = {
      getDisplayValues() { state.reads[name + ':values'] = (state.reads[name + ':values'] || 0) + 1; return values[name]; },
      getValues() { state.reads[name + ':values'] = (state.reads[name + ':values'] || 0) + 1; return values[name]; },
      getRichTextValues() { state.reads[name + ':rich'] = (state.reads[name + ':rich'] || 0) + 1; return values[name].map(row => row.map(() => null)); },
      setFontColors(value) { state.mutations.push(['setFontColors', name, value]); },
      setFontColor(value) { state.mutations.push(['setFontColor', name, value]); },
      getFontColors() { return values[name].map(row => row.map(() => '#000000')); }
    };
    return { getName: () => name, getDataRange: () => range, getRange: () => range };
  }
  const spreadsheet = {
    getId: () => state.activeId, getSheetByName: getSheet,
    getActiveSheet: () => getSheet(state.activeSheet),
    toast() {}
  };
  const menu = { addItem(label, handler) { state.menuItems.push([label, handler]); return menu; }, addSeparator() { return menu; }, addToUi() { state.menusAdded++; return menu; } };
  const context = {
    console, GITHUB_TOKEN: options.token === undefined ? 'test-preview-token' : options.token,
    REPO_NAME: options.repo || PREVIEW_REPO, BRANCH: options.branch || PREVIEW_BRANCH,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => options.token === undefined ? 'test-preview-token' : options.token }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet, getActiveSheet: () => getSheet(state.activeSheet),
      getUi: () => ({ createMenu: () => menu, alert() {} })
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }), getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      newBlob: value => blob(value),
      base64Decode: value => bytes(Buffer.from(value, 'base64')),
      base64Encode: value => Buffer.from(typeof value === 'string' ? value : value.map(byte => (byte + 256) % 256)).toString('base64')
    },
    DriveApp: { getFileById(id) {
      const file = state.drives.get(id);
      if (!file) throw new Error('Unknown mock Drive asset: ' + id);
      return { getName: () => file.name, getBlob: () => blob(file.bytes) };
    } },
    UrlFetchApp: { fetch(url, request) {
      const method = String(request && request.method || 'get').toLowerCase();
      let payload = null;
      if (request && request.payload) payload = JSON.parse(request.payload);
      state.io.push({ url: String(url), method, payload, headers: request && request.headers, request });
      if (state.status !== 200) return response({ message: 'mock failure' }, state.status);
      if (!String(url).startsWith('https://api.github.com/')) {
        if (state.downloads.has(String(url))) return response('asset', 200, state.downloads.get(String(url)));
        return response('PMID- 123\nJT  - Journal of Examples\n', 200);
      }
      const endpoint = String(url).split('/repos/' + PREVIEW_REPO + '/')[1] || '';
      if (method === 'get' && endpoint.startsWith('git/ref/heads/')) return response({ object: { sha: state.head } });
      if (method === 'get' && endpoint.startsWith('git/commits/')) return response({ sha: HEAD, tree: { sha: state.tree } });
      if (method === 'get' && endpoint.startsWith('git/trees/')) return response({ sha: state.tree, tree: state.entries, truncated: Boolean(state.truncated) });
      if (method === 'get' && endpoint.startsWith('contents/')) return response({ sha: BLOB, content: Buffer.from(html).toString('base64') });
      if (method === 'post' && endpoint === 'git/blobs') return response({ sha: '3'.repeat(40) }, 201);
      if (method === 'post' && endpoint === 'git/trees') return response({ sha: state.treeUnchanged ? state.tree : NEW_TREE }, 201);
      if (method === 'post' && endpoint === 'git/commits') return response({ sha: COMMIT }, 201);
      if (method === 'patch' && endpoint === 'git/refs/heads/' + PREVIEW_BRANCH) {
        if (state.head !== HEAD) return response({ message: 'not fast forward' }, 422);
        state.head = payload.sha;
        return response({ object: { sha: state.head } });
      }
      return response({ ok: true });
    } }
  };
  vm.createContext(context);
  function load(name) {
    let source = fs.readFileSync(path.join(root, 'cms', name), 'utf8');
    if (name === 'PreviewIsolation.gs') {
      if (options.repo) source = source.replace('const REPO_NAME = PREVIEW_REPOSITORY;', 'const REPO_NAME = ' + JSON.stringify(options.repo) + ';');
      if (options.branch) source = source.replace('const BRANCH = PREVIEW_BRANCH;', 'const BRANCH = ' + JSON.stringify(options.branch) + ';');
    }
    vm.runInContext(source, context, { filename: name });
  }
  ['PreviewIsolation.gs', 'SheetRepository.gs', 'SheetStyles.gs', 'GitHub.gs', 'AssetStore.gs'].forEach(load);
  state.context = context;
  state.load = load;
  state.github = (endpoint, method = 'get', payload) => context.previewFetch_('https://api.github.com/repos/' + PREVIEW_REPO + '/' + endpoint, {method, payload: payload === undefined ? undefined : JSON.stringify(payload)});
  return state;
}
function blockedWithoutIo(state, action) {
  const before = state.io.length;
  assert.throws(action);
  assert.equal(state.io.length, before, 'Rejected request must not reach UrlFetchApp.fetch');
}
function writeEntries() { return [{path: 'contact.html', type: 'blob', mode: '100644', content: html}]; }
function posts(state, endpoint) { return state.io.filter(call => call.method === 'post' && call.url.endsWith('/' + endpoint)); }

// Guard tests deliberately call the lowest-level network boundary directly.
test('wrong spreadsheet and wrong repository/constants stop before any network request', () => {
  const wrongSheet = fixture({ activeId: 'production-spreadsheet' });
  blockedWithoutIo(wrongSheet, () => wrongSheet.github('contents/contact.html?ref=codex%2Fpreview'));
  const wrongRepo = fixture();
  blockedWithoutIo(wrongRepo, () => wrongRepo.context.previewFetch_('https://api.github.com/repos/yachielab/yachielab.github.io/contents/contact.html?ref=main'));
  const wrongConstants = fixture({ repo: 'yachielab/yachielab.github.io' });
  blockedWithoutIo(wrongConstants, () => wrongConstants.github('contents/contact.html'));
  const wrongBranch = fixture({ branch: 'main' });
  blockedWithoutIo(wrongBranch, () => wrongBranch.github('contents/contact.html'));
});

test('main contents/ref reads and ref writes are blocked, including an encoded branch', () => {
  const state = fixture();
  blockedWithoutIo(state, () => state.github('contents/contact.html?ref=main'));
  blockedWithoutIo(state, () => state.github('contents/contact.html?ref=codex%2Fpreview&ref=main'));
  blockedWithoutIo(state, () => state.github('git/ref/heads/main'));
  blockedWithoutIo(state, () => state.github('git/refs/heads/main', 'patch', {sha: COMMIT, force: false}));
  blockedWithoutIo(state, () => state.github('git/refs/heads/%6dain', 'patch', {sha: COMMIT, force: false}));
});

test('CNAME/workflow/parent traversal paths and delete requests never reach GitHub', () => {
  const state = fixture();
  for (const file of ['CNAME', '.github/workflows/publish.yml', '../contact.html', 'img/../CNAME', 'img/%2e%2e/CNAME']) {
    blockedWithoutIo(state, () => state.github('git/trees', 'post', {base_tree: TREE, tree: [{path: file, mode: '100644', type: 'blob', content: html}]}));
  }
  blockedWithoutIo(state, () => state.github('contents/img/%2e%2e%2fCNAME', 'put', {branch: PREVIEW_BRANCH, content: Buffer.from('malicious').toString('base64')}));
  blockedWithoutIo(state, () => state.github('contents/contact.html', 'delete', {branch: PREVIEW_BRANCH}));
  blockedWithoutIo(state, () => state.github('git/refs/heads/' + PREVIEW_BRANCH, 'delete'));
  blockedWithoutIo(state, () => state.github('git/trees', 'post', {base_tree: TREE, tree: [{path: 'contact.html', mode: '100644', type: 'blob', sha: null}]}));
});

test('allowed tree writes retain HTML/asset paths; preview ref updates require force:false', () => {
  const state = fixture();
  state.github('git/trees', 'post', {base_tree: TREE, tree: writeEntries().concat([{path: 'img/new.jpg', type: 'blob', mode: '100644', sha: BLOB}, {path: 'pdf/example.pdf', type: 'blob', mode: '100644', sha: BLOB}])});
  state.github('git/refs/heads/' + PREVIEW_BRANCH, 'patch', {sha: COMMIT, force: false});
  assert.equal(state.io.length, 2);
  assert.equal(state.io[1].payload.force, false);
  assert.ok(state.io.every(call => call.url.startsWith('https://api.github.com/repos/' + PREVIEW_REPO + '/')));
  const denied = fixture();
  blockedWithoutIo(denied, () => denied.github('git/refs/heads/' + PREVIEW_BRANCH, 'patch', {sha: COMMIT, force: true}));
  blockedWithoutIo(denied, () => denied.github('git/refs/heads/' + PREVIEW_BRANCH, 'patch', {sha: COMMIT}));
  [{ref: 'refs/heads/main'}, {branch: 'main'}, {refs: ['refs/heads/main']}].forEach(extra => {
    blockedWithoutIo(denied, () => denied.github('git/refs/heads/' + PREVIEW_BRANCH, 'patch', {sha: COMMIT, force: false, ...extra}));
  });
});

test('missing credentials, unsupported methods and API failures fail explicitly', () => {
  const missing = fixture({ token: '' });
  blockedWithoutIo(missing, () => missing.github('contents/contact.html'));
  const unsupported = fixture();
  blockedWithoutIo(unsupported, () => unsupported.github('issues', 'post', {title: 'Unrelated'}));
  const failed = fixture({ status: 403 });
  assert.throws(() => failed.github('contents/contact.html'), /403/);
  assert.equal(failed.io.length, 1);
  const missingFile = fixture({ status: 404 });
  assert.equal(missingFile.context.getGithubFileContent('ignored', PREVIEW_REPO, 'missing.html', PREVIEW_BRANCH), null);
});

test('PubMed requests use the ordinary external fetch path unchanged', () => {
  const state = fixture();
  const options = {muteHttpExceptions: true, followRedirects: true};
  const url = 'https://pubmed.ncbi.nlm.nih.gov/123/?format=pubmed';
  const result = state.context.previewFetch_(url, options);
  assert.match(result.getContentText(), /PMID- 123/);
  assert.equal(state.io[0].url, url);
  assert.equal(state.io[0].request, options);
  assert.equal(state.io[0].headers, undefined, 'GitHub credentials must not go to PubMed');
});

test('branch changes during rendering stop before creating trees or updating refs', () => {
  const state = fixture();
  state.context.cmsGithubSnapshot_();
  state.io.length = 0;
  state.head = CHANGED_HEAD;
  assert.throws(() => state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}]), /changed during rendering/i);
  assert.equal(posts(state, 'git/trees').length, 0);
  assert.equal(state.io.filter(call => call.method === 'patch').length, 0);
});

test('the orchestration captures its branch snapshot before rendering starts', () => {
  const state = fixture();
  state.context.console = { error() {} };
  state.load('Cms.gs');
  assert.throws(() => state.context.cmsRun_(function () {
    state.head = CHANGED_HEAD; // Concurrent unrelated commit while the renderer works.
    return state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}]);
  }), /changed during rendering/i);
  assert.equal(posts(state, 'git/trees').length, 0);
  assert.equal(state.io.filter(call => call.method === 'patch').length, 0);
});

test('same generated tree produces no new commit/ref update', () => {
  const state = fixture();
  state.treeUnchanged = true;
  const result = state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}]);
  assert.equal(result.changed, false);
  assert.equal(result.commit, HEAD);
  assert.equal(posts(state, 'git/trees').length, 1);
  assert.equal(posts(state, 'git/commits').length, 0);
  assert.equal(state.io.filter(call => call.method === 'patch').length, 0);
});

test('several pages and an asset are published as one tree, one commit and one ref update', () => {
  const state = fixture();
  state.context.cmsContext_().pendingAssets.push({path: 'img/new.jpg', content: Buffer.from([255, 216, 255, 217]).toString('base64')});
  const result = state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}, {path: 'research.html', html, expectedSha: '1'.repeat(40)}], 'Preview batch');
  assert.equal(result.changed, true);
  assert.equal(result.pages, 2);
  assert.equal(result.assets, 1);
  assert.equal(posts(state, 'git/blobs').length, 1);
  assert.equal(posts(state, 'git/trees').length, 1);
  assert.equal(posts(state, 'git/commits').length, 1);
  const tree = posts(state, 'git/trees')[0].payload;
  assert.equal(tree.base_tree, TREE);
  assert.deepEqual(tree.tree.map(entry => entry.path), ['contact.html', 'research.html', 'img/new.jpg']);
  assert.equal(posts(state, 'git/commits')[0].payload.parents[0], HEAD);
  const ref = state.io.filter(call => call.method === 'patch');
  assert.equal(ref.length, 1);
  assert.equal(ref[0].payload.sha, COMMIT);
  assert.equal(ref[0].payload.force, false);
});

test('a contents blob SHA mismatch and an incomplete GitHub tree stop before writes', () => {
  const state = fixture();
  assert.throws(() => state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: '9'.repeat(40)}]), /Page changed during rendering/i);
  assert.equal(state.io.filter(call => call.method !== 'get').length, 0);
  const incomplete = fixture();
  incomplete.truncated = true;
  assert.throws(() => incomplete.context.cmsGithubSnapshot_(), /incomplete/i);
});

test('Sheet rows, journal/member metadata and GitHub snapshot are cached within one execution', () => {
  const state = fixture();
  assert.equal(state.io.length, 0, 'Module evaluation must not read the network');
  assert.deepEqual(state.reads, {}, 'Module evaluation must not read Sheets');
  const context = state.context.cmsContext_();
  assert.deepEqual(Array.from(context.pages), ['contact', 'research']);
  assert.deepEqual(Array.from(context.members), ['A Example', 'Alice Example'], 'Preserve active-member highlighting; Alumni rows do not add defaults.');
  assert.equal(context.journals['Journal of Examples'], 'J Examples');
  state.context.cmsSheetRows_('contact');
  state.context.cmsSheetRows_('contact');
  state.context.getMembers();
  state.context.get_publications();
  state.context.getIndependentPages();
  ['parameters', 'item list', 'people', 'alumni', 'contact'].forEach(name => {
    assert.equal(state.reads[name + ':values'], 1, name + ' display values should be read once');
    assert.equal(state.reads[name + ':rich'], 1, name + ' rich text should be read once');
  });
  const first = state.context.cmsGithubSnapshot_();
  const io = state.io.length;
  assert.equal(state.context.cmsGithubSnapshot_(), first);
  assert.equal(state.io.length, io);
});

test('asset signatures reject HTML and extension mismatches and accept PDF/JPEG bytes', () => {
  const state = fixture();
  assert.throws(() => state.context.cmsValidateAsset_('photo.jpg', bytes('<!doctype html><html><body>Drive signin</body></html>')), /HTML page/i);
  assert.throws(() => state.context.cmsValidateAsset_('document.jpg', bytes('%PDF-1.7\nexample')), /do not match/i);
  assert.throws(() => state.context.cmsValidateAsset_('photo.png', [255, 216, 255, 217]), /do not match/i);
  assert.throws(() => state.context.cmsValidateAsset_('photo.jpg', []), /empty/i);
  assert.doesNotThrow(() => state.context.cmsValidateAsset_('document.pdf', bytes('%PDF-1.7\n%%EOF')));
  assert.doesNotThrow(() => state.context.cmsValidateAsset_('photo.jpeg', [255, 216, 255, 224, 0, 16, 255, 217]));
});

test('asset downloads and native Drive uploads validate actual bytes and queue once per source', () => {
  const state = fixture();
  state.downloads.set('https://example.org/bad.jpg', Buffer.from('<html><head>Access denied</head></html>'));
  assert.throws(() => state.context.uploadImg('https://example.org/bad.jpg'), /HTML page/i);
  assert.equal(state.context.cmsContext_().pendingAssets.length, 0);
  state.downloads.set('https://example.org/report.pdf', Buffer.from('%PDF-1.7\n%%EOF'));
  assert.equal(state.context.uploadImg('https://example.org/report.pdf'), './pdf/report.pdf');
  assert.equal(state.context.uploadImg('https://example.org/report.pdf'), './pdf/report.pdf');
  assert.equal(state.io.filter(call => call.url === 'https://example.org/report.pdf').length, 1);
  state.drives.set('native-file', {name: 'Portrait.jpeg', bytes: [255, 216, 255, 224, 0, 16, 255, 217]});
  assert.equal(state.context.uploadImg('https://drive.google.com/file/d/native-file/view'), './img/Portrait.jpeg');
  assert.equal(state.context.cmsContext_().pendingAssets.length, 2);
  assert.equal(state.io.filter(call => call.url.includes('drive.google.com')).length, 0, 'Native DriveApp access should replace HTML download URLs');
});

test('onOpen only adds menus and does not read or recolor the workbook', () => {
  const state = fixture();
  state.load('Cms.gs');
  const before = { io: state.io.length, reads: {...state.reads}, mutations: state.mutations.length };
  state.context.onOpen();
  assert.equal(state.io.length, before.io);
  assert.deepEqual(state.reads, before.reads);
  assert.equal(state.mutations.length, before.mutations);
  assert.ok(state.menuItems.length > 0);
  assert.ok(state.menusAdded > 0);
  state.menuItems.forEach(([, handler]) => assert.equal(typeof state.context[handler], 'function', 'Menu handler must exist: ' + handler));
});

test('AVIF cannot be an MP4 container and PNG requires its full eight-byte signature', () => {
  const state = fixture();
  assert.throws(() => state.context.cmsValidateAsset_('wrong.avif', bytes('\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0000\u0000isommp41')), /do not match/i);
  assert.throws(() => state.context.cmsValidateAsset_('short.png', [137, 80, 78, 71]), /do not match/i);
  assert.doesNotThrow(() => state.context.cmsValidateAsset_('image.avif', bytes('\u0000\u0000\u0000\u0018ftypavif\u0000\u0000\u0000\u0000avifmif1')));
  assert.doesNotThrow(() => state.context.cmsValidateAsset_('image.png', [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
});

test('legacy asset uploads validate bytes, deduplicate equal paths and reject differing filename collisions', () => {
  const state = fixture();
  const invalid = Buffer.from('<html><body>HTML pretending to be a photo</body></html>').toString('base64');
  assert.throws(() => state.context.uploadGitHub('ignored', PREVIEW_REPO, 'img/bad.jpg', PREVIEW_BRANCH, invalid), /HTML page/i);
  assert.equal(state.context.cmsContext_().pendingAssets.length, 0);
  const first = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]).toString('base64');
  state.context.uploadGitHub('ignored', PREVIEW_REPO, 'img/portrait.jpg', PREVIEW_BRANCH, first);
  state.context.uploadGitHub('ignored', PREVIEW_REPO, 'img/portrait.jpg', PREVIEW_BRANCH, first);
  assert.equal(state.context.cmsContext_().pendingAssets.length, 1);
  const different = Buffer.from([255, 216, 255, 225, 0, 16, 255, 217]).toString('base64');
  assert.throws(() => state.context.uploadGitHub('ignored', PREVIEW_REPO, 'img/portrait.jpg', PREVIEW_BRANCH, different), /share the filename/i);
  assert.equal(state.context.cmsContext_().pendingAssets.length, 1);
});


function assertBalancedMarkup(markup) {
  const stack = [];
  const voidTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source']);
  for (const match of markup.matchAll(/<(\/)?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const tag = match[2].toLowerCase();
    if (voidTags.has(tag)) continue;
    if (match[1]) assert.equal(stack.pop(), tag, 'Unexpected closing tag: ' + match[0]);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], 'Every generated wrapper must be closed');
}

test('actual shared header rows preserve the language controls after blank Lab wrapper rows', () => {
  const fixtureRows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shared-header.json'), 'utf8'));
  const state = fixture({sheetRows: {header: fixtureRows.header, parameters: fixtureRows.parameters}});
  ['showdown.gs', 'Renderer.gs', 'Publications.gs', 'Cms.gs'].forEach(state.load);
  assert.ok(fixtureRows.header.some(row => row[0] === '' && row[2] === 'div' && row[4] === 'head-lang-logo'));
  assert.ok(fixtureRows.header.some(row => row[0] === '' && row[2] === '/div'));
  const rendered = state.context.cmsRenderRows_('header');
  assertBalancedMarkup(rendered);
  assert.equal((rendered.match(/<div\b/g) || []).length, 5);
  assert.equal((rendered.match(/<\/div>/g) || []).length, 5);
  for (const [id, label] of [['EN', 'English'], ['JA', '日本語'], ['ZH', '中文']]) {
    const control = new RegExp('<section\\b[^>]*id="' + id + '"[^>]*>[\\s\\S]*?<p>' + label + '<\\/p>[\\s\\S]*?<\\/section>');
    assert.match(rendered, control);
    assert.equal((rendered.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
  }
  const languageWrapper = rendered.indexOf('id="head-lang-logo"');
  assert.ok(languageWrapper > rendered.indexOf('id="top-menu"'));
  assert.ok(rendered.indexOf('id="languages"') > languageWrapper);
  assert.ok(rendered.indexOf('id="ZH"') > languageWrapper);
  assert.equal(state.io.length, 0, 'Rendering local header rows must not call GitHub or download assets');
});

test('blank Lab still terminates an independent page even when later rows have valid functions', () => {
  const state = fixture({sheetRows: {contact: [
    ['Lab', 'Language', 'Function', 'Title', 'Style'],
    ['All', 'English', 'H1', 'Visible before the terminator', ''],
    ['', '', 'H1', 'Blank Lab terminates this page', ''],
    ['All', 'English', 'H1', 'Must not leak after the terminator', '']
  ]}});
  ['showdown.gs', 'Renderer.gs', 'Publications.gs', 'Cms.gs'].forEach(state.load);
  const rendered = state.context.cmsRenderRows_('contact');
  assert.match(rendered, /Visible before the terminator/);
  assert.doesNotMatch(rendered, /Blank Lab terminates|Must not leak/);
  assertBalancedMarkup(rendered);
  assert.equal(state.io.length, 0);
});
