'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const root = path.resolve(__dirname, '../..');
const CACHE = '_cms_cache';
const HEAD = ['Lab', 'Language', 'Function', 'Text', 'Image'];
function buffer(value) { return typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from((value || []).map(byte => (byte + 256) % 256)); }
function rich(text, bold = false, italic = false, color = '#000000') {
  return {getRuns: () => [{getText: () => text, getTextStyle: () => ({isBold: () => bold, isItalic: () => italic, getForegroundColorObject: () => ({asRgbColor: () => ({asHexString: () => color})})})}]};
}
function fixture(initialRows = {}) {
  const state = {
    now: Date.UTC(2026, 9, 8), grid: null, writes: 0, creates: 0, reads: 0, renderCalls: [], assetCalls: 0,
    cacheFail: false, cacheReadFail: false, maxRows: 2, maxColumns: 2, expands: 0, hidden: false, frozen: 0,
    activeSheet: {name: 'page'}, insertionIndex: null, restores: 0,
    rows: {page: [HEAD, ['All', 'Common', 'Content', 'One', ''], ['All', 'Common', 'Content', 'Two', '']], ...initialRows},
    rich: {}, parameters: {Content: ['Lab', 'Language', 'Function', '/* Text', '/* img url'], H1: ['Lab', 'Language', 'Function', '/* Title'], Alumni: ['Lab', 'Language', 'Function', '/* Name'], Member: ['Lab', 'Language', 'Function', '/* Name'], Publication: ['Lab', 'Language', 'Function', '/* Pubmed ID']},
    members: ['A Member'], journals: {Journal: 'J'}, citation: 'External title 1', driveName: 'photo.jpg',
    entries: {'page.html': {type: 'blob', sha: 'a'.repeat(40)}}
  };
  const cacheSheet = {
    getLastRow: () => state.grid ? state.grid.reduce((last, row, index) => row.some(value => value !== '') ? index + 1 : last, 0) : 0,
    getDataRange: () => ({getValues() { if (state.cacheReadFail) throw new Error('Read failure'); state.reads++; return (state.grid || []).slice(0, cacheSheet.getLastRow()).map(row => row.slice()); }}),
    getRange: (row, column, height, width) => ({
      setValues(values) {
        if (state.cacheFail) throw new Error('Cache write quota');
        assert.equal(values.length, height); assert(values.every(value => value.length === width));
        state.writes++;
        state.grid = values.map(value => value.slice());
      },
      setBackground() {}
    }),
    clearContents() { state.grid = []; },
    getMaxRows: () => state.maxRows, getMaxColumns: () => state.maxColumns,
    insertRowsAfter(_last, count) { state.maxRows += count; state.expands++; },
    insertColumnsAfter(_last, count) { state.maxColumns += count; state.expands++; },
    setFrozenRows(count) { state.frozen = count; }
  };
  state.newRun = (options = {}) => {
    const context = {
      spreadsheet: {
        getId: () => 'preview-workbook',
        getSheetByName: name => name === CACHE && state.grid !== null ? cacheSheet : null,
        getActiveSheet: () => state.activeSheet,
        getNumSheets: () => Object.keys(state.rows).length + (state.grid === null ? 0 : 1),
        setActiveSheet(sheet) { state.activeSheet = sheet; state.restores++; },
        insertSheet(name, index) { assert.equal(name, CACHE); state.insertionIndex = index; state.creates++; state.grid = []; state.activeSheet = cacheSheet; return cacheSheet; }
      },
      pendingAssets: [], assets: {}, parameters: state.parameters, pages: Object.keys(state.rows).filter(name => !['header', 'footer', 'sidebar', 'mobilemenu'].includes(name)),
      members: state.members, journals: state.journals, ...options
    };
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return state.now; } }
    const sandbox = {
      Date: Clock, console: {warn() {}, log() {}}, PREVIEW_SITE_URL: 'https://example.org/preview', PreElement: 'START', PostElement: 'END',
      Utilities: {
        DigestAlgorithm: {SHA_1: 'sha1', SHA_256: 'sha256'},
        newBlob: value => ({getBytes: () => [...buffer(value)], getDataAsString: () => buffer(value).toString('utf8')}),
        computeDigest: (algorithm, value) => [...crypto.createHash(algorithm).update(buffer(value)).digest()],
        base64Decode: value => [...Buffer.from(value, 'base64')]
      },
      cmsContext_: () => context,
      cmsSheetRows_: name => ({sheet: {getSheetId: () => Object.keys(state.rows).indexOf(name) + 100}, values: state.rows[name], rich: state.rich[name] || state.rows[name].map(row => row.map(() => null))}),
      cmsGithubSnapshot_: () => ({entries: state.entries}),
      previewPrepareHtml_: value => value.replace('PRODUCTION', 'PREVIEW'),
      uploadImg(value) {
        state.assetCalls++;
        const local = /^\.\//.test(value) ? value : './img/' + state.driveName;
        const assetPath = local.slice(2);
        if (!state.entries[assetPath] || context.refreshAssets) context.pendingAssets.push({path: assetPath, content: Buffer.from('asset bytes').toString('base64')});
        return local;
      },
      appendSingle(row, richrow) {
        state.renderCalls.push({row: row.slice(), previous: sandbox.PreElement, next: sandbox.PostElement});
        if (!row[2] || row[2] === 'Pass') return '';
        let text = String(row[3] || '');
        if (richrow && richrow[3]) {
          const run = richrow[3].getRuns()[0], style = run.getTextStyle();
          text += ':' + [style.isBold(), style.isItalic(), style.getForegroundColorObject().asRgbColor().asHexString()].join('/');
        }
        if (row[2] === 'Publication') text += ':' + state.citation + ':' + context.members.join(',') + ':' + context.journals.Journal;
        if (row[2] === 'Alumni') text += ':' + JSON.stringify(sandbox.PreElement) + ':' + JSON.stringify(sandbox.PostElement);
        const image = row[4] ? '<img src="' + sandbox.uploadImg(row[4]) + '">' : '';
        return '<section>' + text + image + '</section>';
      }
    };
    vm.createContext(sandbox);
    const load = name => vm.runInContext(fs.readFileSync(path.join(root, 'cms', name), 'utf8'), sandbox, {filename: name});
    load('Hashes.gs'); load('RenderCache.gs');
    state.run = {context, sandbox, load};
    return state.run;
  };
  state.render = (name = 'page') => state.run.sandbox.cmsCacheRenderRows_(name);
  state.publish = (fragment, {selector = '.posts', page = 'page', fail = false, wrongSha = false, normalized = false} = {}) => {
    const {context, sandbox} = state.run;
    const file = {path: page + '.html', html: '<html>' + (normalized ? 'PRODUCTION' : '') + fragment + '</html>', expectedSha: state.entries[page + '.html']?.sha};
    sandbox.cmsCacheStagePage_(file, selector, fragment);
    if (fail) throw new Error('GitHub publish failed');
    const actualSha = wrongSha ? state.entries[page + '.html'].sha : sandbox.cmsGitBlobSha_(sandbox.previewPrepareHtml_(file.html));
    if (!wrongSha) state.entries[page + '.html'] = {type: 'blob', sha: actualSha};
    const assetShas = {};
    context.pendingAssets.forEach(asset => {
      const sha = asset.sha || sandbox.cmsGitBlobSha_(sandbox.Utilities.base64Decode(asset.content));
      state.entries[asset.path] = {type: 'blob', sha}; assetShas[asset.path] = sha;
    });
    const result = {changed: !wrongSha, pageShas: {[file.path]: actualSha}, assetShas};
    sandbox.cmsCacheCommit_(result);
    return result;
  };
  return state;
}
function counters(state) { return state.run.context.cacheStats; }
function seed(state, name = 'page') { state.newRun(); const html = state.render(name); state.publish(html); return html; }

test('Git object hashes use byte length and match UTF8/binary Git SHA1', () => {
  const state = fixture(); const {sandbox} = state.newRun();
  for (const value of ['', '日本語\n🙂', [0, 255, 128, 13, 10]]) {
    const data = buffer(value);
    const expected = crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + data.length + '\0'), data])).digest('hex');
    assert.equal(sandbox.cmsGitBlobSha_(value), expected);
  }
});

test('cold render stages without writes; publish saves one visible cache table; warm reuses every row and skips its page', () => {
  const state = fixture(); state.newRun(); const first = state.render();
  assert.equal(state.creates, 0); assert.equal(state.writes, 0);
  assert.equal(counters(state).rowsRendered, 2);
  state.publish(first, {normalized: true});
  assert.equal(state.creates, 1); assert.equal(state.writes, 1); assert.equal(state.hidden, false); assert.equal(state.frozen, 1); assert.equal(state.expands, 2);
  assert.deepEqual(Array.from(state.grid[0]), ['Type','Key','Source','SourceId','Row','Fingerprint','RendererVersion','GeneratedAt','HTML','Dependencies','SHA']);
  state.newRun(); const second = state.render();
  assert.equal(second, first); assert.equal(counters(state).rowsReused, 2); assert.equal(counters(state).rowsRendered, 0);
  assert.equal(state.reads, 1); assert.equal(state.run.context.sheetReads, 1);
  assert.equal(state.run.sandbox.cmsCacheCanSkipFragment_('page', '.posts', second), true);
  state.run.sandbox.cmsCacheCommit_({changed: false, pageShas: {'page.html': state.entries['page.html'].sha}, assetShas: {}});
  assert.equal(state.writes, 1, 'Unchanged cache must not be rewritten');
});

test('creating the cache at the end restores the active content tab even if saving the cache fails', () => {
  for (const fail of [false, true]) {
    const state = fixture(); const active = state.activeSheet, sourceValues = JSON.stringify(state.rows);
    state.newRun(); const html = state.render(); state.cacheFail = fail;
    const result = state.publish(html);
    assert.equal(result.cacheSaved, !fail);
    assert.equal(state.insertionIndex, Object.keys(state.rows).length, 'Cache tab follows every existing content tab');
    assert.equal(state.activeSheet, active, 'insertSheet must not move the user away from the update target');
    assert.equal(state.restores, 1);
    assert.equal(JSON.stringify(state.rows), sourceValues, 'Creating a cache does not edit any source cells');
  }
});

test('blank and comment-marker cells do not read ignored native formatting or invalidate HTML', () => {
  const state = fixture(); const {sandbox: r, context, load} = state.newRun();
  load('SheetStyles.gs'); load('Renderer.gs');
  const unreadable = {getRuns() { throw new Error('Formatting of an unused cell must not be read'); }};
  for (const text of ['', '/* Text', '  /* Related info']) {
    const row = ['All', 'Common', 'Content', text, ''];
    assert.equal(r.rendererRichText_(text, unreadable), text);
    const styled = [null, null, null, unreadable];
    assert.equal(r.cmsCacheFingerprint_(context, 'source', row, styled), r.cmsCacheFingerprint_(context, 'source', row, []));
  }
});

test('one row edit regenerates one row and sorting/repeated content is independent of row numbers', () => {
  const state = fixture(); seed(state);
  state.rows.page[1][3] = 'Edited'; state.newRun(); const edited = state.render();
  assert.equal(counters(state).rowsRendered, 1); assert.equal(counters(state).rowsReused, 1); state.publish(edited);
  state.rows.page = [HEAD, state.rows.page[2], state.rows.page[1]]; state.newRun(); const sorted = state.render();
  assert.equal(counters(state).rowsRendered, 0); assert.equal(counters(state).rowsReused, 2);
  assert.ok(sorted.indexOf('Two') < sorted.indexOf('Edited')); state.publish(sorted);
  state.rows.page.push(state.rows.page[1].slice()); state.newRun(); const duplicated = state.render();
  assert.equal(counters(state).rowsReused, 3); assert.equal((duplicated.match(/Two/g) || []).length, 2);
});

test('deleting rows prunes stale records only after success', () => {
  const state = fixture(); seed(state); assert.equal(state.grid.filter(row => row[0] === 'row').length, 2);
  state.rows.page.pop(); state.newRun(); const html = state.render();
  assert.equal(state.grid.filter(row => row[0] === 'row').length, 2);
  state.publish(html); assert.equal(state.grid.filter(row => row[0] === 'row').length, 1);
  state.newRun(); assert.equal(state.render(), '<section>One</section>'); assert.equal(counters(state).rowsReused, 1);
});

test('rich text, relevant schema and renderer version invalidate output even when display values stay the same', () => {
  const state = fixture(); state.rich.page = [[], [null,null,null,rich('One')], []]; seed(state);
  state.rich.page[1][3] = rich('One', true, true, '#ff0000'); state.newRun(); const html = state.render();
  assert.equal(counters(state).rowsRendered, 1); assert.match(html, /true\/true\/#ff0000/); state.publish(html);
  state.parameters.Content = [...state.parameters.Content, '/* Style']; state.newRun(); state.render(); assert.equal(counters(state).rowsRendered, 2);
  state.newRun(); state.run.sandbox.CMS_CACHE_RENDERER_VERSION_ = 'next-version'; state.render(); assert.equal(counters(state).rowsRendered, 2);
});

test('real rendered text formatting invalidates its row while unrendered title/style formatting is ignored', () => {
  const state = fixture({page: [HEAD, ['All','Common','Content','Text','width: 300px'], ['All','Common','H1','Heading','width: 350px']]});
  state.parameters.Content = ['/* Text (Markdown)', '/* Style'];
  state.parameters.H1 = ['Lab','Language','Function','/* Title','/* Style'];
  state.rich.page = [[], [null,null,null,rich('Text'),rich('width: 300px')], [null,null,null,rich('Heading'),rich('width: 350px')]];
  const runReal = () => { const run = state.newRun(); ['showdown.gs','SheetStyles.gs','Renderer.gs','Publications.gs'].forEach(run.load); };
  runReal(); const first = state.render(); state.publish(first);
  // These native cells cannot affect renderer output and must not incur runs/style reads.
  const unrendered = {getRuns() { throw new Error('Unrendered rich cell was inspected'); }};
  state.rich.page[1][4] = unrendered;
  state.rich.page[2][3] = unrendered; state.rich.page[2][4] = unrendered;
  runReal(); assert.equal(state.render(), first); assert.equal(counters(state).rowsReused, 2); assert.equal(counters(state).rowsRendered, 0);
  state.rich.page[1][3] = rich('Text', true, false, '#ff0000');
  runReal(); const changed = state.render();
  assert.equal(counters(state).rowsRendered, 1); assert.equal(counters(state).rowsReused, 1);
  assert.match(changed, /<strong>/); assert.match(changed, /color:#ff0000/); assert.notEqual(changed, first);
});

test('publication global aliases/journal changes invalidate citations but ordinary rows do not eagerly read them', () => {
  const state = fixture({page: [HEAD, ['All','Common','Publication','123',''], ['All','Common','Content','Text','']]}); seed(state);
  state.members.push('B Member'); state.newRun(); state.render(); assert.equal(counters(state).rowsRendered, 1); assert.equal(counters(state).rowsReused, 1);
  state.newRun(); state.journals.Journal = 'Renamed'; state.render(); assert.equal(counters(state).rowsRendered, 1);
  const plain = fixture(); const {context} = plain.newRun();
  Object.defineProperties(context, {members: {get() {throw new Error('Eager member lookup');}}, journals: {get() {throw new Error('Eager journal lookup');}}});
  assert.doesNotThrow(() => plain.render());
});

test('Alumni neighboring rows and START/END changes are part of its cache identity', () => {
  const state = fixture({page: [HEAD, ['All','Common','H1','Group',''], ['All','Common','Alumni','Name',''], ['All','Common','Content','Following','']]}); seed(state);
  state.rows.page[1][2] = 'Content'; state.newRun(); state.render();
  assert.equal(counters(state).rowsRendered, 2); assert.equal(counters(state).rowsReused, 1);
  state.newRun(); state.rows.page.pop(); const ended = state.render(); assert.match(ended, /END/); assert.equal(counters(state).rowsRendered, 2);
});

test('changed/missing local assets invalidate a row and missing assets are queued again on its render', () => {
  const state = fixture({page: [HEAD, ['All','Common','Content','Picture','./img/photo.jpg']]}); seed(state);
  const original = state.entries['img/photo.jpg'].sha;
  state.newRun(); state.render(); assert.equal(counters(state).rowsReused, 1); assert.equal(state.run.context.pendingAssets.length, 0);
  state.entries['img/photo.jpg'].sha = 'b'.repeat(40); state.newRun(); state.render(); assert.equal(counters(state).rowsRendered, 1);
  delete state.entries['img/photo.jpg']; state.newRun(); const html = state.render();
  assert.equal(counters(state).rowsRendered, 1); assert.equal(state.run.context.pendingAssets.length, 1);
  state.publish(html); const record = state.grid.find(row => row[0] === 'row'); assert.equal(JSON.parse(record[9])[0].sha, original);
});

test('Publication and Drive HTML expire after six hours and cache hits do not extend GeneratedAt', () => {
  const state = fixture({page: [HEAD, ['All','Common','Publication','123',''], ['All','Common','Content','Drive','https://drive.google.com/file/d/id/view']]}); seed(state);
  const timestamp = state.grid.find(row => row[0] === 'row')[7];
  state.now += 5 * 3600000; state.newRun(); const warm = state.render(); assert.equal(counters(state).rowsReused, 2); state.publish(warm);
  assert.equal(state.grid.find(row => row[0] === 'row')[7], timestamp);
  state.now += 3600001; state.citation = 'External title 2'; state.driveName = 'renamed.jpg'; state.newRun(); const expired = state.render();
  assert.equal(counters(state).rowsRendered, 2); assert.match(expired, /External title 2/); assert.match(expired, /renamed.jpg/);
});

test('asset/force rebuild bypass every row; refreshData bypasses only external Publication and forces no page skip when rebuilding', () => {
  const state = fixture({page: [HEAD, ['All','Common','Publication','123',''], ['All','Common','Content','Text','']]}); const html = seed(state);
  for (const flag of ['refreshAssets', 'forceRegenerate']) { state.newRun({[flag]: true}); state.render(); assert.equal(counters(state).rowsRendered, 2); }
  assert.equal(state.run.sandbox.cmsCacheCanSkipFragment_('page', '.posts', html), false);
  state.newRun({refreshData: true}); state.render(); assert.equal(counters(state).rowsRendered, 1); assert.equal(counters(state).rowsReused, 1);
});

test('cache HTML/fingerprint/source/dependency corruption is a miss, never authoritative content', () => {
  for (const corrupt of [row => {row[8] = '<section>Injected cache text</section>';}, row => {row[5] = 'bad';}, row => {row[3] = 'different-source';}, row => {row[10] = 'f'.repeat(40);}, row => {row[9] = 'not-json';}]) {
    const state = fixture(); seed(state); corrupt(state.grid.find(row => row[0] === 'row'));
    state.newRun(); const html = state.render(); assert.doesNotMatch(html, /Injected/); assert.equal(counters(state).rowsRendered, 1); assert.equal(counters(state).corruptRecords, 1);
  }
  const asset = fixture({page: [HEAD, ['All','Common','Content','Picture','./img/photo.jpg']]}); seed(asset);
  asset.grid.find(row => row[0] === 'row')[9] = '[]'; asset.newRun(); asset.render(); assert.equal(counters(asset).rowsRendered, 1);
});

test('oversized records and broken schemas regenerate and compact themselves without blocking publication', () => {
  const state = fixture({page: [HEAD, ['All','Common','Content','x'.repeat(40001),'']]}); state.newRun(); const html = state.render();
  state.publish(html); assert.equal(state.grid.filter(row => row[0] === 'row').length, 0); assert.equal(counters(state).rowsUncached, 1);
  state.newRun(); state.render(); assert.equal(counters(state).rowsRendered, 1);
  const broken = fixture(); broken.grid = [['Old','Schema'], ['manually changed']]; broken.newRun(); const text = broken.render(); assert.equal(counters(broken).cacheReadErrors, 1);
  const result = broken.publish(text); assert.equal(result.cacheSaved, true); assert.equal(broken.grid[0][0], 'Type');
});

test('publish failure never creates/writes the cache, and a cache failure after publish remains a distinct success', () => {
  const state = fixture(); state.newRun(); const html = state.render(); assert.throws(() => state.publish(html, {fail: true}), /GitHub/);
  assert.equal(state.creates, 0); assert.equal(state.writes, 0);
  assert.throws(() => state.run.sandbox.cmsCacheCommit_({error: 'failed'}), /successful publish/); assert.equal(state.creates, 0);
  state.cacheFail = true; const result = state.publish(html); assert.equal(result.changed, true); assert.equal(result.cacheSaved, false); assert.match(result.cacheWarning, /Website published/); assert.equal(counters(state).cacheWriteErrors, 1);
  state.cacheFail = false; state.newRun(); assert.equal(state.render(), html); assert.equal(counters(state).rowsRendered, 2);
});

test('page skip requires actual published SHA, matching fragment and version; mock unchanged tree cannot promote a different fragment', () => {
  const state = fixture(); const first = seed(state); state.newRun();
  assert.equal(state.run.sandbox.cmsCacheCanSkipFragment_('page', '.posts', first), true);
  assert.equal(state.run.sandbox.cmsCacheCanSkipFragment_('page', '.posts', first + 'changed'), false);
  state.entries['page.html'].sha = 'c'.repeat(40); assert.equal(state.run.sandbox.cmsCacheCanSkipFragment_('page', '.posts', first), false);
  state.rows.page[1][3] = 'Updated'; state.newRun(); const updated = state.render(); state.publish(updated, {wrongSha: true});
  state.newRun(); assert.equal(state.run.sandbox.cmsCacheCanSkipFragment_('page', '.posts', updated), false);
  assert.equal(state.grid.filter(row => row[0] === 'page').length, 0, 'Contradictory success must invalidate the affected selector record');
});

test('a real Renderer preserves intentional blank Lab header wrappers and independent page terminators through warm reuse', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/shared-header.json'), 'utf8'));
  const state = fixture({header: rows.header, page: [HEAD, ['All','Common','H1','Visible',''], ['', '', 'H1','Stop',''], ['All','Common','H1','Hidden','']]});
  state.parameters = Object.fromEntries(rows.parameters.slice(1).map(row => [row[0].trim(), ['Lab','Language','Function', ...row.slice(1).map(value => value.replace(/ \(.+\)/, ''))]]));
  for (const university of ['ubc', 'osaka']) for (const color of ['white', 'teal']) {
    state.entries['img/header-' + university + '-' + color + '.svg'] = {type: 'blob', sha: 'd'.repeat(40)};
  }
  const runReal = () => {
    const run = state.newRun(); ['showdown.gs', 'SheetStyles.gs', 'Renderer.gs', 'Publications.gs'].forEach(run.load); return run;
  };
  runReal(); const header = state.render('header'); for (const language of ['EN','JA','ZH']) assert.match(header, new RegExp('id="' + language + '"'));
  const body = state.render('page'); assert.match(body, /Visible/); assert.doesNotMatch(body, /Stop|Hidden/);
  const file = {path: 'page.html', html: '<html>' + header + body + '</html>'};
  const index = {path: 'index.html', html: '<html>' + header + '</html>'};
  const sha = state.run.sandbox.cmsGitBlobSha_(file.html), indexSha = state.run.sandbox.cmsGitBlobSha_(index.html);
  state.entries['page.html'] = {type: 'blob', sha}; state.entries['index.html'] = {type: 'blob', sha: indexSha};
  state.run.sandbox.cmsCacheStagePage_(file, '.posts', body);
  state.run.sandbox.cmsCacheStagePage_(file, '#normal_header', header);
  state.run.sandbox.cmsCacheStagePage_(index, '#normal_header', header);
  state.run.sandbox.cmsCacheCommit_({changed: true, pageShas: {'page.html': sha, 'index.html': indexSha}, assetShas: {}});
  runReal(); assert.equal(state.render('header'), header); assert.equal(state.render('page'), body); assert.equal(counters(state).rowsRendered, 0); assert(counters(state).rowsReused > 0);
});


test('a failed cache save after successful fresh publication cannot roll the citation back on the next normal run', () => {
  const state = fixture({page: [HEAD, ['All','Common','Publication','123',''], ['All','Common','Content','Plain','']]});
  const oldHtml = seed(state);
  state.citation = 'Fresh citation'; state.newRun({refreshData: true}); const freshHtml = state.render();
  state.cacheFail = true; const published = state.publish(freshHtml);
  assert.equal(published.cacheSaved, false);
  assert.notEqual(state.entries['page.html'].sha, state.grid.find(row => row[0] === 'page')[10]);
  state.cacheFail = false; state.newRun(); const renderer = state.run.sandbox.appendSingle;
  let forcedCitation = false;
  state.run.sandbox.appendSingle = (row, richrow) => { if (row[2] === 'Publication') forcedCitation = state.run.context.refreshData === true; return renderer(row, richrow); };
  const next = state.render();
  assert.equal(counters(state).rowsReused, 0); assert.equal(counters(state).rowsRendered, 2);
  assert.equal(forcedCitation, true, 'An actual stale published SHA bypasses the raw citation cache too');
  assert.equal(next, freshHtml); assert.notEqual(next, oldHtml);
  assert.equal(state.run.context.refreshData, undefined, 'Source-scoped refresh must not leak into other tabs');
});

test('missing page-cache state rebuilds rows without forcing the raw PubMed cache on a first seed', () => {
  const state = fixture({page: [HEAD, ['All','Common','Publication','123','']]}); seed(state);
  state.grid = state.grid.filter(row => row[0] !== 'page'); state.newRun(); const renderer = state.run.sandbox.appendSingle;
  let refresh = null;
  state.run.sandbox.appendSingle = (row, richrow) => { refresh = state.run.context.refreshData; return renderer(row, richrow); };
  state.render(); assert.equal(counters(state).rowsReused, 0); assert.equal(refresh, undefined);
});

test('Member output has no neighboring-row dependency and one edited biography invalidates only its own row', () => {
  const state = fixture({page: [HEAD, ['All','Common','Member','Alice',''], ['All','Common','Member','Bob',''], ['All','Common','Member','Charlie','']]}); seed(state);
  state.rows.page[2][3] = 'Bob changed'; state.newRun(); state.render();
  assert.equal(counters(state).rowsRendered, 1); assert.equal(counters(state).rowsReused, 2);
});

test('source asset checks happen before row reuse and changed bytes invalidate only their row', () => {
  const state = fixture({page: [HEAD, ['All','Common','Content','One','https://example.org/photo.jpg'], ['All','Common','Content','Two','']]});
  let sourceSha = 'a'.repeat(40), checks = 0;
  function run() {
    state.newRun();
    state.run.sandbox.cmsAssetRowFingerprint_ = row => {
      checks++;
      return row[4] ? [{sourceKey: 'same-source', path:'img/photo.jpg', sha:sourceSha}] : [];
    };
    return state.render();
  }
  state.entries['img/photo.jpg'] = {type:'blob', sha:sourceSha};
  state.publish(run());
  state.publish(run());
  assert.equal(counters(state).rowsReused, 2);
  assert.equal(checks, 4, 'Both runs verify source bytes before cache lookup');
  sourceSha = 'b'.repeat(40);
  run();
  assert.equal(counters(state).rowsRendered, 1);
  assert.equal(counters(state).rowsReused, 1);
});

test('known SHA-only queued assets enter cache dependencies without decoding bytes and reuse after publication',()=>{
  const state=fixture({page:[HEAD,['All','Common','Content','Large picture','./img/new-large.jpg']]});state.entries['img/legacy-large.jpg']={type:'blob',sha:'a'.repeat(40)};
  const {context,sandbox:r}=state.newRun();context.pendingAssets.push({path:'img/new-large.jpg',sha:'a'.repeat(40)});
  r.Utilities.base64Decode=()=>{throw new Error('A SHA-only asset has no base64 content');};
  assert.equal(r.cmsCachePendingSha_(context,'img/new-large.jpg'),'a'.repeat(40));
  r.uploadImg=value=>value;const html=state.render();state.publish(html);
  assert.equal(JSON.parse(state.grid.find(row=>row[0]==='row')[9])[0].sha,'a'.repeat(40));
  state.newRun();assert.equal(state.render(),html);assert.equal(counters(state).rowsReused,1);
  state.run.context.pendingAssets.push({path:'img/unverified.jpg',sha:'f'.repeat(40)});assert.throws(()=>state.run.sandbox.cmsCachePendingSha_(state.run.context,'img/unverified.jpg'),/Unknown pending asset blob/);
});

test('cache SHA-only assets reject mixed bytes and empty SHA fields while reading one captured snapshot',()=>{
  const state=fixture(),{context,sandbox:r}=state.newRun();state.entries['img/known.jpg']={type:'blob',sha:'a'.repeat(40)};
  let snapshots=0;r.cmsGithubSnapshot_=()=>{snapshots++;return{entries:state.entries};};
  r.Utilities.base64Decode=()=>{throw new Error('A declared SHA-only record must not fall through to content decoding');};
  for(const asset of [{path:'img/mixed.jpg',sha:'a'.repeat(40),content:'eA=='},{path:'img/empty.jpg',sha:'',content:'eA=='},{path:'img/null.jpg',sha:null,content:'eA=='}]) {
    context.pendingAssets=[asset];assert.throws(()=>r.cmsCachePendingSha_(context,asset.path),/Unknown pending asset blob/);
  }
  context.pendingAssets=[{path:'img/clone.jpg',sha:'a'.repeat(40)}];snapshots=0;
  assert.equal(r.cmsCachePendingSha_(context,'img/clone.jpg'),'a'.repeat(40));assert.equal(snapshots,1,'Verify the captured repository snapshot once, not once per tree entry');
});
