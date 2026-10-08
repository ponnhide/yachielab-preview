'use strict';
/** Isolated GAS VM with fake Sheets, Drive and GitHub services: no live writes.
 * Run: node --test tests/cms/transport.test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
    reads: {}, mutations: [], menuItems: [], menusAdded: 0, activeSheet: 'contact', toasts: [], logs: [], sleeps: [],
    blobStatuses: (options.blobStatuses || []).slice(),
    entries: [
      {path: 'contact.html', type: 'blob', mode: '100644', sha: BLOB},
      {path: 'research.html', type: 'blob', mode: '100644', sha: '1'.repeat(40)},
      {path: 'img/existing.jpg', type: 'blob', mode: '100644', sha: '2'.repeat(40)}
    ],
    downloads: new Map(), drives: new Map(), contents: new Map()
  };
  const values = {
    header: [['Lab', 'Language', 'Function', 'Direction', 'ID', 'Style'], ['All', 'Common', 'div', 'v', 'head', '']],
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
  state.values = values;
  function getSheet(name) {
    if (!values[name]) return null;
    function range(startRow, startColumn, rowCount, columnCount) {
      const matrix = () => Array.from({length: rowCount}, (_, r) => Array.from({length: columnCount}, (_, c) => values[name][startRow + r - 1]?.[startColumn + c - 1] ?? ''));
      return {
      getDisplayValues() { state.reads[name + ':values'] = (state.reads[name + ':values'] || 0) + 1; return matrix(); },
      getValues() { state.reads[name + ':values'] = (state.reads[name + ':values'] || 0) + 1; return matrix(); },
      getRichTextValues() { state.reads[name + ':rich'] = (state.reads[name + ':rich'] || 0) + 1; return matrix().map(row => row.map(() => null)); },
      setValues(rows) {
        assert.ok(['_cms_cache','_cms_assets'].includes(name), 'Technical writes must not alter source content tabs');
        if (options.cacheWriteFailure) throw new Error('Mock cache storage failure');
        state.mutations.push(['setValues', name, rows.length]);
        rows.forEach((row, r) => row.forEach((cell, c) => {
          const target = values[name][startRow + r - 1] ||= [];
          target[startColumn + c - 1] = cell;
        }));
        return this;
      },
      clearContent() { state.mutations.push(['clearContent', name]); for (let r = 0; r < rowCount; r++) if (values[name][startRow + r - 1]) values[name][startRow + r - 1].splice(startColumn - 1, columnCount, ...Array(columnCount).fill('')); return this; },
      clear() { return this.clearContent(); },
      setFontColors(value) { state.mutations.push(['setFontColors', name, value]); },
      setFontColor(value) { state.mutations.push(['setFontColor', name, value]); },
      getFontColors() { return matrix().map(row => row.map(() => '#000000')); }
    }; }
    const sheet = {
      getName: () => name,
      getDataRange: () => range(1, 1, Math.max(1, values[name].length), Math.max(1, ...values[name].map(row => row.length))),
      getRange: (row = 1, column = 1, rows = values[name].length, columns = Math.max(1, ...values[name].map(value => value.length))) => range(row, column, rows, columns),
      getLastRow: () => values[name].reduce((last, row, index) => row.some(cell => cell !== '' && cell != null) ? index + 1 : last, 0),
      getLastColumn: () => Math.max(1, ...values[name].map(row => row.length)),
      getMaxRows: () => 1000, getMaxColumns: () => 26,
      clearContents() { state.mutations.push(['clearContents', name]); values[name] = []; return sheet; },
      hideSheet() { state.mutations.push(['hideSheet', name]); return sheet; },
      setFrozenRows() { return sheet; },
      insertRowsAfter() { return sheet; }, insertColumnsAfter() { return sheet; }
    };
    return sheet;
  }
  const spreadsheet = {
    getId: () => state.activeId, getSheetByName: getSheet,
    getActiveSheet: () => getSheet(state.activeSheet),
    insertSheet(name) { assert.ok(['_cms_cache','_cms_assets'].includes(name)); values[name] = []; state.mutations.push(['insertSheet', name]); return getSheet(name); },
    toast(...args) { state.toasts.push(args); }
  };
  const menu = { addItem(label, handler) { state.menuItems.push([label, handler]); return menu; }, addSeparator() { return menu; }, addToUi() { state.menusAdded++; return menu; } };
  const context = {
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => state.logs.push([level, ...args])])), GITHUB_TOKEN: options.token === undefined ? 'test-preview-token' : options.token,
    REPO_NAME: options.repo || PREVIEW_REPO, BRANCH: options.branch || PREVIEW_BRANCH,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => options.token === undefined ? 'test-preview-token' : options.token }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet, getActiveSheet: () => getSheet(state.activeSheet),
      getUi: () => ({ createMenu: () => menu, alert() {} })
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }), getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      sleep: milliseconds => state.sleeps.push(milliseconds),
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_1: 'SHA_1', SHA_256: 'SHA_256' },
      computeDigest: (algorithm, value) => bytes(crypto.createHash(String(algorithm).replace(/[-_]/g, '').toLowerCase()).update(Buffer.from(typeof value === 'string' ? value : value.map(byte => (byte + 256) % 256))).digest()),
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
      if (method === 'get' && endpoint.startsWith('contents/site-settings.json')) return response({sha: BLOB, content: Buffer.from(JSON.stringify({logoActiveOpacity: 1, logoInactiveOpacity: 0.5, logoTransitionMs: 300})).toString('base64')});
      if (method === 'get' && endpoint.startsWith('contents/')) {
        const name = endpoint.slice('contents/'.length).split('?')[0];
        const entry = state.entries.find(value => value.path === name);
        return response({ sha: entry ? entry.sha : BLOB, content: Buffer.from(state.contents.get(name) || html).toString('base64') });
      }
      if (method === 'post' && endpoint === 'git/blobs') {
        const status = state.blobStatuses.length ? state.blobStatuses.shift() : 201;
        return status === 201 ? response({ sha: gitBlobSha(Buffer.from(payload.content, 'base64')) }, 201) :
          response({message: 'Private mock response must not be exposed'}, status);
      }
      if (method === 'post' && endpoint === 'git/trees') {
        state.preparedEntries = payload.tree;
        return response({ sha: state.treeUnchanged ? state.tree : NEW_TREE }, 201);
      }
      if (method === 'post' && endpoint === 'git/commits') {
        if (state.changeHeadBeforeFinalRef) state.head = CHANGED_HEAD;
        return response({ sha: COMMIT }, 201);
      }
      if (method === 'patch' && endpoint === 'git/refs/heads/' + PREVIEW_BRANCH) {
        if (state.head !== HEAD) return response({ message: 'not fast forward' }, 422);
        state.head = payload.sha;
        state.tree = NEW_TREE;
        for (const entry of state.preparedEntries || []) {
          const sha = entry.sha || gitBlobSha(entry.content);
          state.entries = state.entries.filter(previous => previous.path !== entry.path).concat([{path: entry.path, type: 'blob', mode: '100644', sha}]);
          if (entry.content !== undefined) state.contents.set(entry.path, entry.content);
        }
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
  ['PreviewIsolation.gs', 'SheetRepository.gs', 'SheetStyles.gs', 'Hashes.gs', 'RenderCache.gs', 'AssetVersions.gs', 'GitHub.gs', 'AssetRegistry.gs', 'AssetStore.gs', 'Pages.gs'].forEach(load);
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
function gitBlobSha(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return crypto.createHash('sha1').update(Buffer.from('blob ' + content.length + '\0')).update(content).digest('hex');
}
function addCurrentSettings(state) {
  const content = JSON.stringify({logoActiveOpacity: 1, logoInactiveOpacity: 0.5, logoTransitionMs: 300}, null, 2) + '\n';
  state.entries.push({path: 'site-settings.json', type: 'blob', mode: '100644', sha: gitBlobSha(content)});
  const assets = {};
  state.entries.filter(entry => entry.type === 'blob' && /^(?:img|img_new|pdf)\//.test(entry.path)).sort((a,b)=>a.path.localeCompare(b.path)).forEach(entry => { assets[entry.path] = entry.sha; });
  const manifest = JSON.stringify({version:1,assets}, null, 2) + '\n';
  state.entries = state.entries.filter(entry => entry.path !== 'asset-versions.json');
  state.entries.push({path: 'asset-versions.json', type:'blob', mode:'100644', sha:gitBlobSha(manifest)});
}

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
  assert.deepEqual(tree.tree.map(entry => entry.path).sort(), ['contact.html', 'research.html', 'site-settings.json', 'img/new.jpg', 'asset-versions.json'].sort());
  const settings = tree.tree.find(entry => entry.path === 'site-settings.json');
  assert.deepEqual(JSON.parse(settings.content), {logoActiveOpacity: 1, logoInactiveOpacity: 0.5, logoTransitionMs: 300});
  assert.doesNotMatch(settings.content, /test-preview-token|spreadsheet|repository/i);
  assert.equal(posts(state, 'git/commits')[0].payload.parents[0], HEAD);
  const ref = state.io.filter(call => call.method === 'patch');
  assert.equal(ref.length, 1);
  assert.equal(ref[0].payload.sha, COMMIT);
  assert.equal(ref[0].payload.force, false);
});

test('head CSS settings publish only numeric values with seconds converted to milliseconds', () => {
  const state = fixture({sheetRows: {header: [
    ['Lab', 'Language', 'Function', 'Direction', 'ID', 'Style'],
    ['All', 'Common', 'div', 'v', 'head', 'display:flex; --lab-logo-active-opacity:0.8 !important; --lab-logo-inactive-opacity:0.25; --lab-logo-transition-duration:.45s;'],
    ['All', 'Common', 'div', 'v', 'other', '--lab-logo-active-opacity:0;']
  ]}});
  const result = state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}]);
  assert.equal(result.pages, 1, 'The JSON settings file is not an HTML page');
  const content = posts(state, 'git/trees')[0].payload.tree.find(entry => entry.path === 'site-settings.json').content;
  assert.deepEqual(JSON.parse(content), {logoActiveOpacity: 0.8, logoInactiveOpacity: 0.25, logoTransitionMs: 450});
  assert.equal(state.reads['header:values'], 1);
  assert.equal(state.reads['header:rich'], 1);
});

test('settings bounds include zero and the maximum duration, and the last CSS declaration wins', () => {
  const state = fixture({sheetRows: {header: [
    ['Lab', 'Language', 'Function', 'Direction', 'ID', 'Style'],
    ['All', 'Common', 'div', 'v', 'head', '--lab-logo-active-opacity:0.2; --lab-logo-active-opacity:1; --lab-logo-inactive-opacity:0; --lab-logo-transition-duration:10s;']
  ]}});
  const settings = JSON.parse(JSON.stringify(state.context.cmsSiteSettings_()));
  assert.deepEqual(settings, {logoActiveOpacity: 1, logoInactiveOpacity: 0, logoTransitionMs: 10000});
  assert.equal(state.context.cmsSiteSettings_(), state.context.cmsSiteSettings_(), 'Read the head settings once per execution');
});

test('a settings-only publication is still an atomic commit with zero HTML pages', () => {
  const state = fixture();
  const result = state.context.cmsPublish_([], 'Refresh site settings');
  assert.equal(result.changed, true);
  assert.equal(result.pages, 0);
  assert.equal(result.assets, 0);
  assert.deepEqual(posts(state, 'git/trees')[0].payload.tree.map(entry => entry.path).sort(), ['site-settings.json','asset-versions.json'].sort());
  assert.equal(posts(state, 'git/commits').length, 1);
  assert.equal(state.io.filter(call => call.method === 'patch').length, 1);
});

test('invalid Sheet settings fail before GitHub I/O rather than silently using defaults', () => {
  const bad = [
    '--lab-logo-active-opacity:NaN;', '--lab-logo-active-opacity:Infinity;', '--lab-logo-active-opacity:1.01;',
    '--lab-logo-inactive-opacity:-0.1;', '--lab-logo-inactive-opacity:50%;', '--lab-logo-inactive-opacity:;',
    '--lab-logo-active-opacity:<0.5>;', '--lab-logo-transition-duration:10001ms;',
    '--lab-logo-active-opacity:0.5; --lab-logo-active-opacity:;',
    '--lab-logo-active-opacity:0.5; --lab-logo-active-opacity:<0.8>;',
    '--lab-logo-transition-duration:-1ms;', '--lab-logo-transition-duration:300;',
    '--lab-logo-transition-duration:calc(1s);', '--lab-logo-transition-duration:1e309s;'
  ];
  for (const css of bad) {
    const state = fixture({sheetRows: {header: [['Lab', 'Language', 'Function', 'Direction', 'ID', 'Style'], ['All', 'Common', 'div', 'v', 'head', css]]}});
    blockedWithoutIo(state, () => state.context.cmsPublish_([{path: 'contact.html', html}]));
  }
});

test('missing or duplicated head settings rows stop before any GitHub operation', () => {
  for (const rows of [[], [['All', 'Common', 'div', 'v', 'other', '']], [['All', 'Common', 'div', 'v', 'head', ''], ['All', 'Common', 'div', 'v', 'head', '']]]) {
    const state = fixture({sheetRows: {header: [['Lab', 'Language', 'Function', 'Direction', 'ID', 'Style'], ...rows]}});
    blockedWithoutIo(state, () => state.context.cmsPublish_([{path: 'contact.html', html}]));
  }
});

test('the exact root settings JSON can be read and written on the preview branch', () => {
  const state = fixture();
  const settings = {logoActiveOpacity: 1, logoInactiveOpacity: 0.5, logoTransitionMs: 300};
  const content = JSON.stringify(settings);
  const read = state.context.getGithubFileContent('ignored', PREVIEW_REPO, 'site-settings.json', PREVIEW_BRANCH);
  assert.deepEqual(JSON.parse(Buffer.from(read.content, 'base64').toString('utf8')), settings);
  assert.match(state.io[0].url, /contents\/site-settings\.json\?ref=codex%2Fpreview$/);
  state.github('git/trees', 'post', {base_tree: TREE, tree: [{path: 'site-settings.json', mode: '100644', type: 'blob', content}]});
  assert.equal(posts(state, 'git/trees')[0].payload.tree[0].content, content, 'JSON must not pass through the HTML normalizer');
  state.github('contents/site-settings.json', 'put', {branch: PREVIEW_BRANCH, content: Buffer.from(content).toString('base64')});
  assert.equal(state.io.at(-1).method, 'put');
});

test('settings guards reject other JSON paths, opaque blob SHAs, invalid schemas and main', () => {
  const state = fixture();
  const valid = {logoActiveOpacity: 1, logoInactiveOpacity: 0.5, logoTransitionMs: 300};
  for (const name of ['other.json', 'docs/site-settings.json', '/site-settings.json', 'site-settings.json/other', '../site-settings.json', 'site-settings%2ejson']) {
    blockedWithoutIo(state, () => state.github('git/trees', 'post', {base_tree: TREE, tree: [{path: name, mode: '100644', type: 'blob', content: JSON.stringify(valid)}]}));
  }
  blockedWithoutIo(state, () => state.github('git/trees', 'post', {base_tree: TREE, tree: [{path: 'site-settings.json', mode: '100644', type: 'blob', sha: BLOB}]}));
  const invalid = ['not JSON', '{}', '[]', 'null', JSON.stringify({...valid, token: 'do not publish'}), JSON.stringify({...valid, logoActiveOpacity: '1'}), JSON.stringify({...valid, logoInactiveOpacity: 1.1}), JSON.stringify({...valid, logoTransitionMs: -1}), JSON.stringify({...valid, logoTransitionMs: 10001})];
  for (const content of invalid) {
    blockedWithoutIo(state, () => state.github('git/trees', 'post', {base_tree: TREE, tree: [{path: 'site-settings.json', mode: '100644', type: 'blob', content}]}));
    blockedWithoutIo(state, () => state.github('contents/site-settings.json', 'put', {branch: PREVIEW_BRANCH, content: Buffer.from(content).toString('base64')}));
  }
  blockedWithoutIo(state, () => state.github('contents/site-settings.json?ref=main'));
  blockedWithoutIo(state, () => state.github('contents/site-settings.json', 'put', {branch: 'main', content: Buffer.from(JSON.stringify(valid)).toString('base64')}));
});

test('a contents blob SHA mismatch and an incomplete GitHub tree stop before writes', () => {
  const state = fixture();
  assert.throws(() => state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: '9'.repeat(40)}]), /Page changed during rendering/i);
  assert.equal(state.io.filter(call => call.method !== 'get').length, 0);
  const incomplete = fixture();
  incomplete.truncated = true;
  assert.throws(() => incomplete.context.cmsGithubSnapshot_(), /incomplete/i);
});

test('a new-page publication cannot replace an existing file', () => {
  const state = fixture();
  assert.throws(() => state.context.cmsPublish_([{path: 'contact.html', html, expectedAbsent: true}]), /already exists/);
  assert.equal(state.io.filter(call => call.method !== 'get').length, 0);
});

test('page registration rejects case-only collisions while deduplicating identical names', () => {
  const repeated = fixture();
  assert.deepEqual(Array.from(repeated.context.getIndependentPages()), ['contact', 'research']);
  const conflicting = fixture();
  conflicting.values['item list'].push(['', '', '', '', 'CONTACT']);
  assert.throws(() => conflicting.context.getIndependentPages(), /differ only by letter case/);
  assert.equal(conflicting.io.length, 0); assert.equal(conflicting.mutations.length, 0);
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
  state.context.cmsContext_().refreshAssets = true;
  state.downloads.set('https://example.org/bad.jpg', Buffer.from('<html><head>Access denied</head></html>'));
  assert.throws(() => state.context.uploadImg('https://example.org/bad.jpg'), /HTML page/i);
  assert.equal(state.context.cmsContext_().pendingAssets.length, 0);
  state.downloads.set('https://www.dropbox.com/report.pdf?dl=1', Buffer.from('%PDF-1.7\n%%EOF'));
  const first = state.context.uploadImg('https://www.dropbox.com/report.pdf?dl=0');
  assert.match(first, /^\.\/pdf\/report--[a-f0-9]{12}\.pdf\?v=[a-f0-9]{12}$/);
  assert.equal(state.context.uploadImg('https://www.dropbox.com/report.pdf?dl=0'), first);
  assert.equal(state.io.filter(call => call.url === 'https://www.dropbox.com/report.pdf?dl=1').length, 1);
  state.drives.set('native-file', {name: 'Portrait.jpeg', bytes: [255, 216, 255, 224, 0, 16, 255, 217]});
  assert.match(state.context.uploadImg('https://drive.google.com/file/d/native-file/view'), /^\.\/img\/Portrait--[a-f0-9]{12}\.jpeg\?v=[a-f0-9]{12}$/);
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
  assert.deepEqual(state.menuItems, [['Update the current page', 'update_webpage']]);
  assert.equal(state.menusAdded, 1);
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
  state.context.cmsGithubSnapshot_(); // Real menu actions capture this before rendering.
  const initialIo = state.io.length;
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
  assert.equal(state.io.length, initialIo, 'Local header rendering reuses the captured repository tree and must not download assets');
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

test('identical UTF-8 HTML and settings skip all writes while returning page SHAs for cache commit', () => {
  const state = fixture();
  addCurrentSettings(state);
  const expected = gitBlobSha(state.context.previewPrepareHtml_(html));
  state.entries.find(entry => entry.path === 'contact.html').sha = expected;
  const result = state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: expected}]);
  assert.equal(result.changed, false);
  assert.equal(result.pages, 0);
  assert.equal(result.pageShas['contact.html'], expected);
  assert.equal(state.io.filter(call => call.method !== 'get').length, 0);
  assert.equal(state.io.filter(call => call.url.includes('/git/ref/heads/')).length, 2, 'Snapshot and final no-op lease must both be checked');
});

test('zero HTML files with unchanged settings avoids tree, commit and ref writes', () => {
  const state = fixture();
  addCurrentSettings(state);
  const result = state.context.cmsPublish_([]);
  assert.equal(result.changed, false);
  assert.equal(result.pages, 0);
  assert.equal(result.commit, HEAD);
  assert.equal(posts(state, 'git/trees').length, 0);
  assert.equal(state.io.filter(call => call.method !== 'get').length, 0);
});

test('unchanged binary assets skip blob uploads as well as publication trees', () => {
  const state = fixture();
  addCurrentSettings(state);
  const content = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]);
  const expected = gitBlobSha(content);
  state.entries.find(entry => entry.path === 'img/existing.jpg').sha = expected;
  addCurrentSettings(state);
  state.context.cmsContext_().pendingAssets.push({path: 'img/existing.jpg', content: content.toString('base64')});
  const result = state.context.cmsPublish_([]);
  assert.equal(result.changed, false);
  assert.equal(result.assets, 0);
  assert.equal(result.assetShas['img/existing.jpg'], expected);
  assert.equal(posts(state, 'git/blobs').length, 0);
  assert.equal(posts(state, 'git/trees').length, 0);
});

test('large legacy image bytes reuse the repository blob under the new source-specific path', () => {
  const state = fixture();
  const content = Buffer.alloc(3122891, 0xa5), expected = gitBlobSha(content);
  state.entries.push({path: 'img/legacy-large.JPG', type: 'blob', mode: '100644', sha: expected});
  const newPath = 'img/joinus--123456789abc.JPG';
  state.context.cmsContext_().pendingAssets.push({path: newPath, content: content.toString('base64')});
  const result = state.context.cmsPublish_([]);
  assert.equal(result.changed, true);
  assert.equal(result.assets, 1, 'A new filename still changes the publication tree');
  assert.equal(result.assetShas[newPath], expected);
  assert.equal(posts(state, 'git/blobs').length, 0, 'Known image bytes must never be uploaded again');
  assert.deepEqual(posts(state, 'git/trees')[0].payload.tree.find(entry => entry.path === newPath),
    {path: newPath, mode: '100644', type: 'blob', sha: expected});
  assert.ok(state.entries.some(entry => entry.path === 'img/legacy-large.JPG' && entry.sha === expected));
  assert.equal(state.io.filter(call => call.method === 'patch').length, 1);
  assert.deepEqual(state.sleeps, []);
});

test('new blob 500/502/503/504 retries are bounded and preserve content and atomic publication', () => {
  for (const status of [500, 502, 503, 504]) {
    const state = fixture({blobStatuses: [status, status, 201]});
    const content = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]);
    const asset = {path: 'img/new-retry.jpg', content: content.toString('base64')};
    state.context.cmsContext_().pendingAssets.push(asset);
    const result = state.context.cmsPublish_([]);
    assert.equal(result.assetShas[asset.path], gitBlobSha(content));
    assert.equal(posts(state, 'git/blobs').length, 3);
    posts(state, 'git/blobs').forEach(call => assert.deepEqual(call.payload, {content: asset.content, encoding: 'base64'}));
    assert.deepEqual(state.sleeps, [500, 1500]);
    assert.equal(posts(state, 'git/trees').length, 1);
    assert.equal(posts(state, 'git/commits').length, 1);
    assert.equal(state.io.filter(call => call.method === 'patch').length, 1);
    assert.equal(state.context.cmsContext_().githubWrites, 6, 'Every actual retry must count as a GitHub write');
    assert.deepEqual(state.logs, [], 'Failed attempt bodies must not be logged');
  }
});

test('three failed new-blob attempts stop before any tree, commit or branch mutation', () => {
  const state = fixture({blobStatuses: [500, 502, 504, 201]});
  state.context.cmsContext_().pendingAssets.push({path: 'img/fails.jpg', content: Buffer.from([255, 216, 255, 217]).toString('base64')});
  assert.throws(() => state.context.cmsPublish_([]), /^Error: Preview GitHub request failed with HTTP 504\.$/);
  assert.equal(posts(state, 'git/blobs').length, 3);
  assert.deepEqual(state.sleeps, [500, 1500]);
  assert.equal(state.context.cmsContext_().githubWrites, 3);
  assert.equal(posts(state, 'git/trees').length, 0);
  assert.equal(posts(state, 'git/commits').length, 0);
  assert.equal(state.io.filter(call => call.method === 'patch').length, 0);
  assert.equal(state.head, HEAD);
  assert.deepEqual(state.logs, []);
});

test('blob validation/rate-limit errors and non-blob operations are never retried', () => {
  for (const status of [400, 403, 404, 409, 413, 422, 429, 501]) {
    const state = fixture({blobStatuses: [status, 201]});
    assert.throws(() => state.context.cmsGithub_('git/blobs', 'post', {content: 'eA==', encoding: 'base64'}), new RegExp('HTTP ' + status));
    assert.equal(posts(state, 'git/blobs').length, 1);
    assert.equal(state.context.cmsContext_().githubWrites, 1);
    assert.deepEqual(state.sleeps, []);
  }
  for (const [endpoint, method, payload] of [
    ['git/trees', 'post', {base_tree: TREE, tree: writeEntries()}],
    ['git/refs/heads/' + PREVIEW_BRANCH, 'patch', {sha: COMMIT, force: false}],
    ['git/ref/heads/' + PREVIEW_BRANCH, 'get', null]
  ]) {
    const state = fixture({status: 500});
    assert.throws(() => state.context.cmsGithub_(endpoint, method, payload), /HTTP 500/);
    assert.equal(state.io.length, 1);
    assert.deepEqual(state.sleeps, []);
  }
  const state = fixture(); let attempts = 0;
  state.context.previewFetch_ = () => { attempts++; throw new Error('Transport interrupted'); };
  assert.throws(() => state.context.cmsGithub_('git/blobs', 'post', {content: 'eA==', encoding: 'base64'}), /Transport interrupted/);
  assert.equal(attempts, 1, 'Only the exact sanitized GitHub HTTP error permits retry');
  assert.deepEqual(state.sleeps, []);
});

test('two new filenames with identical binary bytes need only one blob upload', () => {
  const state = fixture();
  const content = Buffer.from([255, 216, 255, 217]).toString('base64');
  state.context.cmsContext_().pendingAssets.push({path: 'img/first.jpg', content}, {path: 'img/second.jpg', content});
  const result = state.context.cmsPublish_([]);
  assert.equal(result.assets, 2);
  assert.equal(result.assetShas['img/first.jpg'], result.assetShas['img/second.jpg']);
  assert.equal(posts(state, 'git/blobs').length, 1);
  assert.equal(posts(state, 'git/trees').length, 1);
  assert.equal(state.io.filter(call => call.method === 'patch').length, 1);
});

test('a branch change immediately before the final ref update never publishes the prepared commit', () => {
  const state = fixture();
  state.changeHeadBeforeFinalRef = true;
  assert.throws(() => state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}]), /changed before publication/i);
  assert.equal(posts(state, 'git/commits').length, 1, 'An unreferenced prepared commit is safe to leave behind');
  assert.equal(state.io.filter(call => call.method === 'patch').length, 0);
});

test('a valid fragment cache hit returns null without Contents GET or Cheerio processing', () => {
  const state = fixture();
  state.load('Cms.gs');
  state.context.cmsCacheCanSkipFragment_ = () => true;
  state.context.Cheerio = {load() { throw new Error('Cached pages must not be parsed'); }};
  assert.equal(state.context.cmsReplaceFragment_('contact', '.posts', 'same fragment'), null);
  assert.equal(state.io.length, 0);
  assert.equal(state.context.cmsContext_().cacheStats.pagesSkipped, 1);
});

test('shared-component cache hits render each source once and skip every page Contents GET', () => {
  const state = fixture();
  addCurrentSettings(state);
  state.load('Cms.gs');
  const rendered = [];
  state.context.cmsRenderRows_ = name => { rendered.push(name); return '<div>' + name + '</div>'; };
  state.context.cmsCacheCanSkipFragment_ = () => true;
  state.context.Cheerio = {load() { throw new Error('Shared cache hits must not be parsed'); }};
  const result = state.context.update_shared_components();
  assert.deepEqual(rendered, ['header', 'footer', 'sidebar', 'mobilemenu']);
  assert.equal(result.changed, false);
  assert.equal(result.metrics.pagesSkipped, 3, 'Two registered pages plus the homepage are skipped once each');
  assert.equal(state.io.filter(call => call.url.includes('/contents/')).length, 0);
  assert.equal(posts(state, 'git/trees').length, 0);
});

test('mixed shared-component hits fetch and parse a page once and stage all selector SHAs', () => {
  const state = fixture();
  state.load('Cms.gs');
  state.context.cmsCacheCanSkipFragment_ = (name, selector) => selector !== 'footer';
  const changes = ['#normal_header', 'footer', 'aside', '#mobile-menu'].map(selector => ({selector, fragment: '<div>' + selector + '</div>'}));
  const appended = [], staged = []; let parsed = 0;
  state.context.Cheerio = {load() {
    parsed++;
    return selector => ({length: 1, attr() { return this; }, empty() { return this; }, append(fragment) { appended.push([selector, fragment]); return this; }, html() { return '<head></head><body><footer>updated</footer></body>'; }});
  }};
  state.context.cmsCacheStagePage_ = (file, selector, fragment) => staged.push([file.path, selector, fragment]);
  const file = state.context.cmsReplaceFragments_('contact', changes);
  assert.equal(file.path, 'contact.html');
  assert.equal(parsed, 1);
  assert.equal(state.io.filter(call => call.url.includes('/contents/')).length, 1);
  assert.equal(appended.length, 1);
  assert.equal(appended[0][0], 'footer');
  assert.deepEqual(staged.map(value => value[1]), changes.map(value => value.selector), 'Cached selectors must inherit the newly published full-page SHA too');
});

test('cache-save failures after publication remain success and log no cache payload', () => {
  const state = fixture();
  state.load('Cms.gs');
  state.context.cmsCacheCommit_ = () => { throw new Error('PRIVATE CACHE PAYLOAD'); };
  const result = state.context.cmsRun_(() => state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}]), 'update_webpage');
  assert.equal(result.changed, true);
  assert.equal(result.cacheSaved, false);
  assert.equal(result.metrics.cacheWriteErrors, 1);
  assert.equal(state.head, COMMIT);
  assert.match(state.toasts.at(-1)[0], /Preview updated/);
  assert.match(state.toasts.at(-1)[0], /Cache save failed/);
  assert.doesNotMatch(JSON.stringify(state.logs), /PRIVATE CACHE PAYLOAD/);
  const metrics = JSON.parse(state.logs.find(entry => entry[0] === 'info')[1].replace('CMS metrics: ', ''));
  assert.equal(metrics.command, 'update_webpage');
  assert.ok(Object.entries(metrics).every(([key, value]) => key === 'command' || typeof value === 'number'));
});

test('member and journal getters stay lazy and read each source tab at most once', () => {
  const state = fixture();
  const context = state.context.cmsContext_();
  assert.deepEqual(Object.keys(state.reads).sort(), ['item list:rich', 'item list:values', 'parameters:rich', 'parameters:values']);
  assert.equal(context.sheetReads, 2);
  const members = context.members;
  assert.equal(context.members, members);
  assert.equal(state.reads['people:values'], 1);
  assert.equal(state.reads['alumni:values'], 1);
  assert.equal(context.sheetReads, 4);
  const journals = context.journals;
  assert.equal(context.journals, journals);
  assert.equal(state.reads['item list:values'], 1);
});

test('rebuild, fresh-data and asset refresh handlers set distinct flags without leaking them between runs', () => {
  const state = fixture();
  state.load('Cms.gs');
  const flags = [];
  state.context.cmsUpdateTab_ = () => {
    const context = state.context.cmsContext_();
    flags.push([!!context.forceRegenerate, !!context.refreshData, !!context.refreshAssets]);
    return {changed: false, pages: 0, assets: 0};
  };
  state.context.cmsCacheCommit_ = result => { result.cacheSaved = true; };
  state.context.rebuild_current_page();
  state.context.refresh_current_data();
  state.context.refresh_current_assets();
  assert.deepEqual(flags, [[true, false, false], [false, true, false], [false, false, true]]);
});

test('a failed publication never commits a performance cache', () => {
  const state = fixture();
  state.load('Cms.gs');
  let cacheCommits = 0;
  state.context.cmsCacheCommit_ = () => cacheCommits++;
  assert.throws(() => state.context.cmsRun_(() => {
    state.head = CHANGED_HEAD;
    return state.context.cmsPublish_([{path: 'contact.html', html, expectedSha: BLOB}]);
  }), /changed during rendering/i);
  assert.equal(cacheCommits, 0);
  assert.equal(state.mutations.length, 0);
});

test('an actual cold-then-warm update reuses rows and avoids Contents, trees and cache rewrites', () => {
  const state = fixture();
  addCurrentSettings(state);
  ['showdown.gs', 'Renderer.gs', 'Publications.gs', 'Cms.gs'].forEach(state.load);
  state.context.Cheerio = {load() {
    let posts = '';
    return selector => ({length: selector.includes('cms-generated-page') ? 0 : 1, attr() { return this; }, empty() { return this; }, append(fragment) { if (selector === '.posts') posts = fragment; return this; },
      html() { return '<head></head><body data-page="contact"><main><div class="posts">' + posts + '</div></main></body>'; }});
  }};
  const cold = state.context.update_webpage();
  assert.equal(cold.changed, true);
  assert.equal(cold.metrics.rowsRendered, 1);
  assert.equal(cold.cacheSaved, true);
  assert.ok(state.values._cms_cache.length > 1, 'Successful publication creates the disposable cache');
  assert.equal(state.reads['people:values'], undefined, 'Non-publication rendering must not read member metadata');
  const mutationCount = state.mutations.length;
  state.io.length = 0;
  state.context.Cheerio = {load() { throw new Error('Warm cache must skip the HTML parser'); }};
  const warm = state.context.update_webpage();
  assert.equal(warm.changed, false);
  assert.equal(warm.metrics.rowsRendered, 0);
  assert.equal(warm.metrics.rowsReused, 1);
  assert.equal(warm.metrics.pagesSkipped, 1);
  assert.equal(state.io.filter(call => call.url.includes('/contents/')).length, 0);
  assert.equal(state.io.filter(call => call.method !== 'get').length, 0);
  assert.equal(state.mutations.length, mutationCount, 'Unchanged cache records need no Sheet write');
});

test('rebuild bypasses both row reuse and the full-page fragment skip', () => {
  const state = fixture();
  state.load('Cms.gs');
  state.context.cmsContext_().forceRegenerate = true;
  state.context.cmsCacheCanSkipFragment_ = () => { throw new Error('Rebuild must not consult the page skip cache'); };
  state.context.cmsCacheStagePage_ = () => {};
  let parsed = 0;
  state.context.Cheerio = {load() { parsed++; return selector => ({length: selector.includes('cms-generated-page') ? 0 : 1, attr() { return this; }, empty() { return this; }, append() { return this; }, html() { return '<body></body>'; }}); }};
  const file = state.context.cmsReplaceFragment_('contact', '.posts', 'unchanged');
  assert.equal(file.path, 'contact.html');
  assert.equal(parsed, 1);
  assert.equal(state.io.filter(call => call.url.includes('/contents/')).length, 1);
});
